/* A window's view of the workspace.

   `commit(updater)` is synchronous, like setState with a function: the window
   sees its change at once. The change is turned into operations, batched for
   ~120 ms and sent to the store. The client keeps two things apart:
   - confirmed: the document as the store has ordered it (by `rev`)
   - pending:   this window's operations the store hasn't confirmed yet
   What the window shows is confirmed + pending. Another window's change is
   applied to `confirmed` and pending is replayed on top, so edits never
   bounce back and nothing typed here is lost. */
import { applyOps, compactOps, diffDocs } from '../../shared/store-core.mjs'

export function createStoreClient(bridge, {
  normalize = (doc) => doc,
  prepare = (next) => next,
  afterRemote = null,
  recovery = null,
  batchMs = 120,
  gapMs = 2000,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
} = {}) {
  let confirmed = null
  let confirmedRev = 0
  let current = null
  let unsent = []
  const inflight = []
  const arrived = new Map()
  const listeners = new Set()
  let status = { ready: false, state: 'loading', message: 'Opening your workspace' }
  let snapshot = { workspace: null, status }
  let sendTimer = null
  let gapTimer = null
  let started = null
  let sending = null
  let blocked = false

  const emit = () => {
    if (current && recovery) {
      try {
        const ops = compactOps(pending())
        if (ops.length) recovery.write({ ops, workspace: current })
        else recovery.clear()
      } catch {
        status = { ...status, state: 'error', message: 'The recovery copy could not be saved. Keep this window open and export your writing.' }
      }
    }
    snapshot = { workspace: current, status }
    for (const listener of listeners) listener()
  }
  const setStatus = (next) => { status = { ...status, ...next }; emit() }
  const pending = () => [...inflight.flat(), ...unsent]

  function adopt(rev, doc) {
    confirmed = doc
    confirmedRev = rev
    current = doc
    arrived.clear()
    inflight.length = 0
    unsent = []
    const normalized = normalize(doc)
    if (normalized !== doc) commit(() => normalized)
  }

  function start() {
    if (started) return started
    bridge.onChange?.(onMessage)
    bridge.onStatus?.((next) => setStatus({ state: next.state, message: next.message || '' }))
    started = Promise.resolve(bridge.load()).then(({ rev, doc }) => {
      let draft = null
      try { draft = recovery?.read() } catch { /* the confirmed workspace still opens */ }
      adopt(rev, doc)
      if (draft?.ops?.length) {
        unsent = [...draft.ops, ...unsent]
        current = applyOps(current, unsent).doc
        blocked = true
        if (sendTimer) { timers.clear(sendTimer); sendTimer = null }
        setStatus({ ready: true, state: 'error', message: 'Recovered unsaved changes. Your writing is here; retry saving or export a copy.' })
      } else setStatus({ ready: true, state: pending().length ? 'saving' : 'saved', message: '' })
    }, (error) => {
      setStatus({ ready: false, state: 'error', message: error?.message || String(error) })
    })
    return started
  }

  function commit(updater) {
    if (!current) throw new Error('The workspace is not open yet.')
    const proposed = typeof updater === 'function' ? updater(current) : updater
    if (!proposed || proposed === current) return current
    const next = prepare(proposed, current)
    const ops = diffDocs(current, next)
    current = next
    if (ops.length) {
      unsent.push(...ops)
      if (!blocked && !sendTimer) sendTimer = timers.set(send, batchMs)
      if (!blocked) status = { ...status, state: 'saving', message: 'Saving…' }
    }
    emit()
    return current
  }

  function takeBatch() {
    if (sendTimer) { timers.clear(sendTimer); sendTimer = null }
    if (!unsent.length) return null
    const batch = compactOps(unsent)
    unsent = []
    inflight.push(batch)
    return batch
  }

  function send() {
    if (sendTimer) { timers.clear(sendTimer); sendTimer = null }
    if (sending) return sending
    if (blocked) return Promise.resolve()
    const batch = takeBatch()
    if (!batch) return Promise.resolve()
    sending = Promise.resolve().then(() => bridge.commit(batch)).then(
      ({ rev }) => receive(rev, batch, true),
      (error) => {
        const index = inflight.indexOf(batch)
        if (index >= 0) inflight.splice(index, 1)
        unsent = compactOps([...batch, ...unsent])
        blocked = true
        if (sendTimer) { timers.clear(sendTimer); sendTimer = null }
        setStatus({ state: 'error', message: `Couldn't save (${error?.message || error}). Your changes are still here. Retry saving or export a copy.` })
      },
    ).finally(() => {
      sending = null
      if (!blocked && unsent.length && !sendTimer) sendTimer = timers.set(send, batchMs)
    })
    return sending
  }

  /* For page unload: hand everything over before the window goes away. */
  function sendNow() {
    if (blocked || sending) { emit(); return }
    const batch = takeBatch()
    if (!batch) return
    if (!bridge.commitSync) { unsent = [...batch, ...unsent]; inflight.pop(); emit(); return }
    try {
      const { rev, durable } = bridge.commitSync(batch)
      if (durable !== false) receive(rev, batch, true)
    } catch {
      // The recovery copy survives even when the window's last save fails.
      unsent = [...batch, ...unsent]
      inflight.pop()
      emit()
    }
  }

  function onMessage(message) {
    if (!message || !Number.isInteger(message.rev)) return
    if (message.reset) {
      if (message.rev > confirmedRev) { adopt(message.rev, message.doc); emit() }
      return
    }
    receive(message.rev, message.ops, false)
  }

  function receive(rev, ops, own) {
    if (rev <= confirmedRev) return
    arrived.set(rev, { ops, own })
    let remote = false
    while (arrived.has(confirmedRev + 1)) {
      const next = arrived.get(confirmedRev + 1)
      arrived.delete(confirmedRev + 1)
      confirmed = applyOps(confirmed, next.ops).doc
      confirmedRev += 1
      if (next.own) inflight.shift()
      else remote = true
    }
    if (arrived.size && !gapTimer) gapTimer = timers.set(() => recover(), gapMs)
    if (!arrived.size && gapTimer) { timers.clear(gapTimer); gapTimer = null }
    const waiting = pending()
    if (remote) {
      current = waiting.length ? applyOps(confirmed, waiting).doc : confirmed
      emit()
      const fixed = afterRemote?.(current)
      if (fixed && fixed !== current) commit(() => fixed)
    } else if (!waiting.length) {
      // Everything this window did is confirmed; keep the window's own objects.
      confirmed = current
    }
    if (!blocked && !waiting.length) status = { ...status, state: 'saved', message: '' }
    emit()
  }

  /* Something went out of step: reload from the store and keep unsent edits. */
  function recover(message) {
    if (gapTimer) { timers.clear(gapTimer); gapTimer = null }
    return Promise.resolve(bridge.load()).then(({ rev, doc }) => {
      const acknowledged = new Set([...arrived].filter(([at, entry]) => at <= rev && entry.own).map(([, entry]) => entry.ops))
      const keep = compactOps([...inflight.filter((batch) => !acknowledged.has(batch)).flat(), ...unsent])
      adopt(rev, doc)
      if (keep.length) {
        current = applyOps(current, keep).doc
        unsent = keep
        if (!blocked && !sendTimer) sendTimer = timers.set(send, batchMs)
      }
      if (message) setStatus({ state: 'error', message })
      else { if (!keep.length && !blocked) status = { ...status, state: 'saved', message: '' }; emit() }
    }).catch((error) => { blocked = true; setStatus({ state: 'error', message: `Couldn't refresh the saved workspace (${error?.message || error}). Your changes are still here.` }) })
  }

  return {
    start,
    commit,
    flush: send,
    flushNow: sendNow,
    async retry() {
      blocked = false
      setStatus({ state: 'saving', message: 'Saving…' })
      do { await send() } while (!blocked && unsent.length)
      if (!blocked && !pending().length) setStatus({ state: 'saved', message: '' })
    },
    replace: (doc) => bridge.replace(doc),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    get workspace() { return current },
    get rev() { return confirmedRev },
    get pendingCount() { return pending().length },
  }
}
