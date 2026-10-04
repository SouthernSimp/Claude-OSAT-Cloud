import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyDoc, createHub } from '../shared/store-core.mjs'
import { createStoreClient } from '../src/store/client.js'
import { memoryBridge } from '../src/store/bridges.js'

const settle = () => new Promise((resolve) => setTimeout(resolve, 15))
const note = (id, markdown = '') => ({ id, title: id, markdown, tags: [] })

async function twoWindows(doc = createEmptyDoc(), options = {}) {
  const hub = createHub(doc)
  const a = createStoreClient(memoryBridge(hub), { batchMs: 1, ...options })
  const b = createStoreClient(memoryBridge(hub), { batchMs: 1, ...options })
  await Promise.all([a.start(), b.start()])
  return { hub, a, b }
}

test('a change in one window reaches the store and the other window', async () => {
  const { hub, a, b } = await twoWindows()
  a.commit((state) => ({ ...state, notes: [note('from-a'), ...state.notes] }))
  assert.equal(a.workspace.notes[0].id, 'from-a', 'the window sees its own change at once')
  await settle()
  assert.equal(hub.doc.notes[0].id, 'from-a')
  assert.equal(b.workspace.notes[0].id, 'from-a')
  assert.equal(a.pendingCount, 0)
})

test('two windows editing at the same moment both keep their work', async () => {
  const { hub, a, b } = await twoWindows({ ...createEmptyDoc(), notes: [note('shared', 'x')] })
  a.commit((state) => ({ ...state, notes: [...state.notes, note('overlay-thought')] }))
  b.commit((state) => ({ ...state, notes: state.notes.map((n) => n.id === 'shared' ? { ...n, markdown: 'edited in the window' } : n) }))
  await settle()
  for (const doc of [hub.doc, a.workspace, b.workspace]) {
    assert.deepEqual(doc.notes.map((n) => n.id).sort(), ['overlay-thought', 'shared'])
    assert.equal(doc.notes.find((n) => n.id === 'shared').markdown, 'edited in the window')
  }
})

test('a burst of keystrokes is sent as one small batch, never the whole workspace', async () => {
  const hub = createHub({ ...createEmptyDoc(), notes: Array.from({ length: 300 }, (_, i) => note(`n${i}`)) })
  const sent = []
  const bridge = memoryBridge(hub)
  const spy = { ...bridge, commit: (ops) => { sent.push(ops); return bridge.commit(ops) } }
  const client = createStoreClient(spy, { batchMs: 5 })
  await client.start()
  for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
    client.commit((state) => ({ ...state, notes: state.notes.map((n) => n.id === 'n7' ? { ...n, markdown: text } : n) }))
  }
  await settle()
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], [{ t: 'patch', c: 'notes', id: 'n7', v: { markdown: 'hello' } }])
  assert.equal(hub.doc.notes[7].markdown, 'hello')
})

test('opening a window tidies old data once, and never echoes changes back', async () => {
  const hub = createHub({ ...createEmptyDoc(), notes: [{ id: 'n1', title: 'Old' }] })
  const normalize = (doc) => doc.notes.every((n) => Array.isArray(n.tags)) ? doc : { ...doc, notes: doc.notes.map((n) => ({ ...n, tags: [] })) }
  const heard = []
  hub.connect((message) => heard.push(message))
  const client = createStoreClient(memoryBridge(hub), { batchMs: 1, normalize })
  await client.start()
  await settle()
  assert.deepEqual(hub.doc.notes[0].tags, [])
  assert.equal(heard.length, 1)
  const before = client.workspace
  await settle()
  assert.equal(client.workspace, before, 'the confirmation does not rebuild the window state')
})

test('an import replaces the workspace in every window', async () => {
  const { a, b } = await twoWindows({ ...createEmptyDoc(), notes: [note('old')] })
  await a.replace({ ...createEmptyDoc(), notes: [note('imported')] })
  await settle()
  assert.deepEqual(a.workspace.notes.map((n) => n.id), ['imported'])
  assert.deepEqual(b.workspace.notes.map((n) => n.id), ['imported'])
})

test('closing a window hands over unsent edits synchronously', async () => {
  const { hub, a } = await twoWindows()
  a.commit((state) => ({ ...state, theme: 'dark' }))
  assert.equal(hub.doc.theme, 'system')
  a.flushNow()
  assert.equal(hub.doc.theme, 'dark')
})

test('a rejected save preserves writing, stops automatic retries, and saves on explicit retry', async () => {
  const hub = createHub({ ...createEmptyDoc(), notes: [note('keep', 'Before')] })
  const bridge = memoryBridge(hub)
  let reject = true
  let calls = 0
  const client = createStoreClient({ ...bridge, commit: async (ops) => { calls++; if (reject) throw new Error('INVALID_OPS: test'); return bridge.commit(ops) } }, { batchMs: 1 })
  await client.start()
  client.commit((state) => ({ ...state, notes: [note('keep', 'My writing')] }))
  await settle()
  assert.equal(client.workspace.notes[0].markdown, 'My writing')
  assert.equal(hub.doc.notes[0].markdown, 'Before')
  assert.ok(client.pendingCount > 0)
  assert.equal(client.getSnapshot().status.state, 'error')
  client.commit((state) => ({ ...state, notes: [note('keep', 'More writing')] }))
  await settle()
  assert.equal(calls, 1, 'an invalid operation is not retried automatically')
  reject = false
  await client.retry()
  assert.equal(hub.doc.notes[0].markdown, 'More writing')
  assert.equal(client.pendingCount, 0)
  assert.equal(client.getSnapshot().status.state, 'saved')
})

test('a failed in-flight batch and newer typing survive reload together', async () => {
  const hub = createHub({ ...createEmptyDoc(), notes: [note('draft', 'Before')] })
  const bridge = memoryBridge(hub)
  let saved = null
  const recovery = { read: () => saved, write: (value) => { saved = structuredClone(value) }, clear: () => { saved = null } }
  let fail
  const client = createStoreClient({ ...bridge, commit: () => new Promise((_, reject) => { fail = reject }) }, { batchMs: 1, recovery })
  await client.start()
  client.commit((state) => ({ ...state, notes: [note('draft', 'First sentence')] }))
  await settle()
  client.commit((state) => ({ ...state, notes: [note('draft', 'First sentence. Second sentence.')] }))
  fail(new Error('disk full'))
  await settle()
  client.flushNow()
  assert.equal(saved.workspace.notes[0].markdown, 'First sentence. Second sentence.')
  const reopened = createStoreClient(bridge, { recovery, batchMs: 1 })
  await reopened.start()
  assert.equal(reopened.workspace.notes[0].markdown, 'First sentence. Second sentence.')
  assert.equal(reopened.getSnapshot().status.state, 'error')
  assert.equal(hub.doc.notes[0].markdown, 'Before', 'recovered drafts wait for an explicit retry')
  await reopened.retry()
  assert.equal(hub.doc.notes[0].markdown, 'First sentence. Second sentence.')
  assert.equal(saved, null, 'the recovery copy clears only after confirmation')
})

test('pending saves are ordered while another window edits an unrelated field', async () => {
  const hub = createHub({ ...createEmptyDoc(), notes: [note('draft', 'Before')] })
  const bridge = memoryBridge(hub)
  const other = createStoreClient(memoryBridge(hub), { batchMs: 1 })
  let finish
  let count = 0
  const client = createStoreClient({ ...bridge, commit: (ops) => { count++; return new Promise((resolve) => { finish = () => resolve(bridge.commitSync(ops)) }) } }, { batchMs: 1 })
  await Promise.all([client.start(), other.start()])
  client.commit((state) => ({ ...state, notes: [note('draft', 'First')] }))
  await settle()
  client.commit((state) => ({ ...state, notes: [note('draft', 'Second')] }))
  other.commit((state) => ({ ...state, theme: 'dark' }))
  await settle()
  assert.equal(count, 1)
  finish()
  await settle()
  assert.equal(count, 2)
  finish()
  await settle()
  assert.equal(hub.doc.notes[0].markdown, 'Second')
  assert.equal(client.workspace.theme, 'dark')
  assert.equal(client.pendingCount, 0)
})

test('a failed synchronous close save retains a recovery copy', async () => {
  let saved
  const bridge = { load: async () => ({ rev: 0, doc: createEmptyDoc() }), commitSync: () => { throw new Error('disk full') } }
  const recovery = { read: () => null, write: (value) => { saved = value }, clear: () => {} }
  const client = createStoreClient(bridge, { recovery, timers: { set: () => 1, clear: () => {} } })
  await client.start()
  client.commit((state) => ({ ...state, notes: [note('new', 'Keep me')] }))
  client.flushNow()
  assert.equal(saved.workspace.notes[0].markdown, 'Keep me')
  assert.ok(client.pendingCount > 0)
})

test('a lost acknowledgment followed by retry reconciles without duplicate notes or a stuck Saving state', async () => {
  const hub = createHub()
  const bridge = memoryBridge(hub)
  let first = true
  const client = createStoreClient({ ...bridge, commit: async (ops) => {
    const result = await bridge.commit(ops)
    if (first) { first = false; throw new Error('acknowledgment lost') }
    return result
  } }, { batchMs: 1, gapMs: 1 })
  await client.start()
  client.commit((state) => ({ ...state, notes: [note('once', 'Once')] }))
  await settle()
  await client.retry()
  await settle()
  assert.equal(hub.doc.notes.length, 1)
  assert.equal(client.workspace.notes.length, 1)
  assert.equal(client.pendingCount, 0)
  assert.equal(client.getSnapshot().status.state, 'saved')
})
