/* The one workspace, owned by the main process. Windows send operations; this
   applies them in order through the shared hub, saves shortly after (250 ms
   after the last change, never more than a second behind), and reports whether
   the last save worked. `core` is shared/store-core.mjs, passed in so this file
   stays CommonJS and testable in plain Node. */
const path = require('node:path')
const nodeFs = require('node:fs/promises')
const { createFileStore } = require('./file.cjs')

async function createStore({
  dir,
  core,
  fs = nodeFs,
  now = () => new Date(),
  writeDelay = 250,
  maxDelay = 1000,
  retryDelay = 5000,
  timers = { set: setTimeout, clear: clearTimeout },
}) {
  const files = createFileStore({ dir, fs, now })
  const { doc: saved, recovered } = await files.read()
  const hub = core.createHub(core.migrate(saved || core.createEmptyDoc()))
  const listeners = new Set()
  let status = {
    state: 'saved',
    savedAt: null,
    message: recovered
      ? recovered.from
        ? `The workspace file couldn't be read, so OSAT opened the copy from ${recovered.from.slice(10, 20)}. The unreadable file was kept.`
        : 'The workspace file couldn\'t be read and no earlier copy was found. The unreadable file was kept.'
      : '',
  }
  let savedRev = saved ? hub.rev : -1
  let dirtySince = null
  let timer = null
  let writing = Promise.resolve()

  const setStatus = (next) => {
    status = next
    for (const listener of listeners) listener(status)
  }

  function schedule(delay) {
    const started = dirtySince ?? Date.now()
    dirtySince = started
    if (timer) timers.clear(timer)
    const wait = delay ?? Math.max(0, Math.min(writeDelay, started + maxDelay - Date.now()))
    timer = timers.set(() => { timer = null; flush().catch(() => {}) }, wait)
  }

  function flush() {
    if (timer) { timers.clear(timer); timer = null }
    if (hub.rev === savedRev) return writing
    dirtySince = null
    const doc = hub.doc
    writing = writing.catch(() => {}).then(() => files.write(doc)).then(
      () => {
        savedRev = doc.rev
        if (status.state !== 'saved' || status.message) setStatus({ state: 'saved', savedAt: now().toISOString(), message: '' })
        else status = { ...status, savedAt: now().toISOString() }
      },
      (error) => {
        setStatus({ state: 'error', savedAt: status.savedAt, message: `OSAT couldn't save to disk (${error.code || error.message}). It will keep trying; nothing typed so far is lost while OSAT stays open.` })
        schedule(retryDelay)
        throw error
      },
    )
    return writing
  }

  return {
    recovered,
    load: () => ({ rev: hub.rev, doc: hub.doc }),
    connect: (listener) => hub.connect(listener),
    disconnect: (id) => hub.disconnect(id),
    commit(from, ops) {
      const result = hub.commit(from, ops)
      schedule()
      return result
    },
    /* Import: the current workspace is copied aside first, then replaced for every window. */
    async replace(doc) {
      await flush().catch(() => {})
      const aside = path.join(dir, `workspace.before-import-${now().toISOString().replace(/[:.]/g, '-')}.json`)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(aside, `${JSON.stringify(hub.doc)}\n`, { encoding: 'utf8', mode: 0o600 })
      const result = hub.replace(doc)
      await flush()
      return result
    },
    flush,
    /* Called as the app quits, after every window has handed over its last edits. */
    flushSync() {
      if (timer) { timers.clear(timer); timer = null }
      if (hub.rev === savedRev) return
      files.writeSync(hub.doc)
      savedRev = hub.rev
    },
    status: () => status,
    onStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

module.exports = { createStore }
