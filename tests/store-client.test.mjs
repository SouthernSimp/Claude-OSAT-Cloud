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

test('a rejected change reloads the window from the store and says so', async () => {
  const hub = createHub({ ...createEmptyDoc(), notes: [note('keep')] })
  const bridge = memoryBridge(hub)
  const client = createStoreClient({ ...bridge, commit: async () => { throw new Error('INVALID_OPS: test') } }, { batchMs: 1 })
  await client.start()
  client.commit((state) => ({ ...state, notes: [] }))
  await settle()
  assert.deepEqual(client.workspace.notes.map((n) => n.id), ['keep'])
  assert.equal(client.getSnapshot().status.state, 'error')
})
