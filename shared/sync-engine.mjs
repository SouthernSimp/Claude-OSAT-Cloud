/* Sync through a shared folder (the OSAT folder in iCloud Drive). Each device only
   ever writes its own files, so no two devices edit the same file:
     Sync/<device>/<seq>.json      a batch of stamped changes, written once
     Sync/<device>/snapshot.json   all this device holds, so a new device can catch up
   `files` is a small async file API — { list(dir), read(path), write(path, text) } —
   so the Mac (Node) and the iPhone (Swift) each bring their own. `list` returns []
   and `read` returns null for what isn't there (or isn't downloaded yet).

   `doc()` returns this device's workspace as it is now and `apply(ops)` applies
   merged changes to it (through the store, so every window hears them). Both are
   called in the same moment, so no edit can slip in between. The caller runs start,
   pull and flush one at a time and hands every change the store applies to record(),
   except the ones this engine applied itself. */

import { applyOps, validateOps } from './store-core.mjs'
import { baseStamp, createClock, emptyMeta, mergeEntries, snapshotEntries, stampLocal, stampWorkspace } from './sync-core.mjs'

const SEGMENT = /^(\d{8})\.json$/
const DEVICE = /^[A-Za-z0-9-]{1,40}$/
const STAMP = /^\d{13}\.\d{6}\.[A-Za-z0-9-]{1,40}$/
const pad = (n) => String(n).padStart(8, '0')

/* Another device's files are never trusted blindly. */
function validEntry(entry) {
  if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !STAMP.test(entry[0])) return false
  try {
    validateOps([entry[1]])
    return true
  } catch {
    return false
  }
}

async function readJson(files, path) {
  try {
    const text = await files.read(path)
    return text == null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

export function createSyncEngine({ device, files, doc, apply, state = null, now = Date.now, snapshotEvery = 400 }) {
  if (!DEVICE.test(device)) throw new Error('A device id is letters, digits and dashes.')
  const clock = createClock(device, now, state?.clock || '')
  let meta = state?.meta || null
  let seq = state?.seq || 0
  let seen = { ...(state?.seen || {}) }
  let queue = [...(state?.queue || [])]
  let early = [] // this device's changes made before its first start
  let sinceSnapshot = state?.sinceSnapshot || 0

  const others = async () => (await files.list('Sync')).filter((name) => name !== device && DEVICE.test(name))
  // Captured in one go, so the workspace and its stamps always match.
  const snapshotText = (doc, atSeq) => JSON.stringify({ device, seq: atSeq, seen, meta, doc, at: clock.last })

  return {
    get started() { return Boolean(meta) },
    get waiting() { return queue.length + early.length },

    /* The first time this device syncs: stamp what it holds, catch up from the newest
       snapshot another device left, and leave a snapshot of its own. */
    async start() {
      if (meta) return
      let best = null
      for (const other of await others()) {
        const found = await readJson(files, `Sync/${other}/snapshot.json`)
        if (found?.device === other && found.meta && found.doc && (!best || String(found.at) > String(best.at))) best = found
      }
      // Reading is done; from here to apply() nothing waits, so nothing slips in.
      const current = doc()
      meta = stampWorkspace(current, emptyMeta(), baseStamp(device))
      const entries = best ? snapshotEntries(best.doc, best.meta).filter(validEntry) : []
      for (const [stamp] of entries) clock.observe(stamp)
      if (best) {
        seen = { ...best.seen, [best.device]: best.seq }
        delete seen[device]
      }
      // Changes made here before this first start are newer than anything heard so far.
      queue.push(...stampLocal(meta, early, clock))
      early = []
      const ops = entries.length ? mergeEntries(current, meta, entries) : []
      if (ops.length) apply(ops)
      const text = snapshotText(applyOps(current, ops).doc, seq)
      sinceSnapshot = snapshotEvery // the next flush leaves a snapshot…
      try {
        await files.write(`Sync/${device}/snapshot.json`, text)
        sinceSnapshot = 0 // …unless this one was written
      } catch {
        // iCloud will be there next time.
      }
    },

    /* This device's own changes, right after the store applied them. */
    record(ops) {
      if (!ops.length) return
      if (meta) queue.push(...stampLocal(meta, ops, clock))
      else early.push(...ops)
    },

    /* Writes the waiting changes as one new file, and now and then a fresh snapshot. */
    async flush() {
      if (!meta || !queue.length) return false
      const entries = queue
      const next = seq + 1
      const snapshot = sinceSnapshot + entries.length >= snapshotEvery ? snapshotText(doc(), next) : null
      queue = []
      try {
        await files.write(`Sync/${device}/${pad(next)}.json`, JSON.stringify({ device, seq: next, entries }))
      } catch (error) {
        queue = [...entries, ...queue]
        throw error
      }
      seq = next
      sinceSnapshot += entries.length
      if (snapshot) {
        await files.write(`Sync/${device}/snapshot.json`, snapshot)
        sinceSnapshot = 0
      }
      return true
    },

    /* Other devices' new changes, merged in. A file still on its way from iCloud (or one
       that arrives out of order) is simply read next time. Returns how many changes won. */
    async pull() {
      if (!meta) return 0
      const entries = []
      const reached = {}
      for (const other of await others()) {
        const numbers = new Set((await files.list(`Sync/${other}`)).map((name) => SEGMENT.exec(name)?.[1]).filter(Boolean).map(Number))
        for (let next = (seen[other] || 0) + 1; numbers.has(next); next += 1) {
          const segment = await readJson(files, `Sync/${other}/${pad(next)}.json`)
          if (!Array.isArray(segment?.entries)) break
          entries.push(...segment.entries.filter(validEntry))
          reached[other] = next
        }
      }
      Object.assign(seen, reached)
      for (const [stamp] of entries) clock.observe(stamp)
      const ops = entries.length ? mergeEntries(doc(), meta, entries) : []
      if (ops.length) apply(ops)
      return ops.length
    },

    /* What to keep between launches (the workspace itself is saved by the store). */
    state: () => ({ device, seq, seen, meta, queue, clock: clock.last, sinceSnapshot }),
  }
}
