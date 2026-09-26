/* Keeps this Mac in step with your other devices through the OSAT folder in iCloud
   Drive (its Sync folder). The engine (shared/sync-engine.mjs) does the merging; this
   gives it the folder, the store, and a small file to remember where it got to.
   It talks to iCloud while the iPhone link is on. Once set up, it also notes changes
   made while the link is off (`load` at launch), and sends them when it comes back on. */
const path = require('node:path')
const nodeFs = require('node:fs/promises')
const fsSync = require('node:fs')
const { randomUUID } = require('node:crypto')

/* The engine's file API over a real folder. Writes land whole (temp file, rename). */
function folderFiles(root, fs = nodeFs) {
  const full = (relative) => path.join(root, relative)
  return {
    async list(dir) {
      try {
        return await fs.readdir(full(dir))
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
    },
    async read(relative) {
      try {
        return await fs.readFile(full(relative), 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async write(relative, text) {
      const target = full(relative)
      await fs.mkdir(path.dirname(target), { recursive: true })
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, text)
        await fs.rename(temporary, target)
      } finally {
        await fs.rm(temporary, { force: true })
      }
    },
  }
}

function createMacSync({ root, store, createSyncEngine, statePath, onStatus = () => {}, fs = nodeFs, watch = fsSync.watch }) {
  let engine = null
  let client = null
  let stopCommits = null
  let chain = Promise.resolve()
  let flushTimer = null
  let pullTimer = null
  let poll = null
  let watcher = null
  let status = { on: false, lastArrival: null, devices: 0, error: '' }

  const setStatus = (patch) => {
    status = { ...status, ...patch }
    onStatus(status)
  }

  async function saveState(current) {
    const temporary = `${statePath}.${process.pid}.tmp`
    await fs.mkdir(path.dirname(statePath), { recursive: true })
    await fs.writeFile(temporary, JSON.stringify(current.state()), { mode: 0o600 })
    await fs.rename(temporary, statePath)
  }

  /* One sync task at a time; each one ends by remembering where it got to. */
  const run = (task) => {
    chain = chain.then(async () => {
      const current = engine
      if (!current) return
      await task(current)
      await saveState(current)
      if (status.error) setStatus({ error: '' })
    }).catch((error) => {
      setStatus({ error: `OSAT couldn't keep your devices in step (${error.code || error.message}). It will try again.` })
    })
    return chain
  }

  const flushSoon = () => {
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => run((current) => current.flush()), 1500)
  }
  const pull = async (current) => {
    const arrived = await current.pull()
    const devices = Object.keys(current.state().seen).length
    if (arrived || devices !== status.devices) setStatus({ devices, ...(arrived ? { lastArrival: new Date().toISOString() } : {}) })
  }
  const pullSoon = () => {
    clearTimeout(pullTimer)
    pullTimer = setTimeout(() => run(pull), 700)
  }

  /* Picks up where this Mac left off, without touching iCloud. Only when sync was
     set up before, unless `create` (the first time the link is turned on). */
  async function load(create = false) {
    if (engine) return true
    let state = null
    try {
      state = JSON.parse(await fs.readFile(statePath, 'utf8'))
    } catch {
      if (!create) return false // never set up on this Mac
    }
    client = store.connect(() => {})
    engine = createSyncEngine({
      device: state?.device || `mac-${randomUUID().slice(0, 8)}`,
      files: folderFiles(root, fs),
      state,
      doc: () => store.load().doc,
      apply: (ops) => store.commit(client, ops),
    })
    // Everything changed on this Mac is shared, except what sync itself brought in.
    stopCommits = store.onCommit((from, ops) => {
      if (from === client || !engine) return
      engine.record(ops)
      if (status.on) flushSoon()
    })
    return true
  }

  async function start() {
    if (status.on) return
    await load(true)
    await fs.mkdir(path.join(root, 'Sync'), { recursive: true })
    await run((current) => current.start())
    try {
      watcher = watch(path.join(root, 'Sync'), { recursive: true }, pullSoon)
    } catch {
      // The poll below still hears other devices.
    }
    poll = setInterval(pullSoon, 20000)
    setStatus({ on: true })
    pullSoon()
    if (engine.waiting) flushSoon()
  }

  /* Stops talking to iCloud; changes made meanwhile are still noted for later. */
  function pause() {
    clearTimeout(flushTimer)
    clearTimeout(pullTimer)
    clearInterval(poll)
    watcher?.close()
    watcher = null
    saveNow()
    if (status.on) setStatus({ on: false })
  }

  /* Remembers where this Mac got to, right now (as the app quits). */
  function saveNow() {
    if (!engine) return
    try {
      fsSync.mkdirSync(path.dirname(statePath), { recursive: true })
      fsSync.writeFileSync(statePath, JSON.stringify(engine.state()), { mode: 0o600 })
    } catch {
      // The next launch begins from the last save.
    }
  }

  /* For tests: forget this Mac's engine entirely (the saved file stays). */
  function close() {
    pause()
    stopCommits?.()
    if (client) store.disconnect(client)
    engine = null
    client = null
  }

  return {
    load,
    start,
    pause,
    close,
    saveNow,
    status: () => status,
    /* For tests: wait until every queued sync task has finished. */
    settle: async () => {
      clearTimeout(flushTimer)
      clearTimeout(pullTimer)
      await run((current) => current.flush())
      await run(pull)
    },
  }
}

module.exports = { createMacSync, folderFiles }
