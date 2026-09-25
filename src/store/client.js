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

  const emit = () => {
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
      adopt(rev, doc)
      setStatus({ ready: true, state: 'saved', message: '' })
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
      if (!sendTimer) sendTimer = timers.set(send, batchMs)
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
    const batch = takeBatch()
    if (!batch) return Promise.resolve()
    return Promise.resolve(bridge.commit(batch)).then(
      ({ rev }) => receive(rev, batch, true),
      (error) => recover(`That change couldn't be saved (${error?.message || error}). OSAT reloaded your workspace.`),
    )
  }

  /* For page unload: hand everything over before the window goes away. */
  function sendNow() {
    const batch = takeBatch()
    if (!batch) return
    if (!bridge.commitSync) { bridge.commit(batch); return }
    try {
      const { rev } = bridge.commitSync(batch)
      receive(rev, batch, true)
    } catch {
      // The window is closing; the store keeps whatever it already has.
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
  }

  /* Something went out of step: reload from the store and keep unsent edits. */
  function recover(message) {
    if (gapTimer) { timers.clear(gapTimer); gapTimer = null }
    const keep = unsent
    return Promise.resolve(bridge.load()).then(({ rev, doc }) => {
      adopt(rev, doc)
      if (keep.length) {
        current = applyOps(current, keep).doc
        unsent = keep
        if (!sendTimer) sendTimer = timers.set(send, batchMs)
      }
      if (message) setStatus({ state: 'error', message })
      else emit()
    })
  }

  return {
    start,
    commit,
    flush: send,
    flushNow: sendNow,
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
