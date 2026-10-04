import assert from 'node:assert/strict'
import test from 'node:test'
import { arrangeTopics } from '../src/sky/arrange.js'
import { applyOps, diffDocs } from '../shared/store-core.mjs'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const fixture = () => normalizeWorkspace({
  ...createDefaultWorkspace(),
  folders: [
    ...Array.from({ length: 7 }, (_, index) => ({ id: `topic-${index}`, name: `Topic ${index}`, rank: index + 1, at: { x: 1000 - index * 10, y: -500 } })),
    { id: 'branch', name: 'Branch', parentId: 'topic-0', at: { x: -321, y: 123 } },
  ],
  notes: [
    { id: 'inside', title: 'Keep this', markdown: 'My writing', folderId: 'branch', at: { x: 100, y: 90 } },
    { id: 'free', title: 'A free sticky', markdown: 'Keep its place', at: { x: 2000, y: -2000 } },
  ],
})

test('arranging topics preserves branches, free stickies, content, identity and rank', () => {
  const state = fixture()
  const next = arrangeTopics(state)
  assert.equal(next.notes, state.notes)
  assert.equal(next.folders.find((folder) => folder.id === 'branch'), state.folders.find((folder) => folder.id === 'branch'))
  assert.deepEqual(next.folders.map(({ id, rank, parentId }) => ({ id, rank, parentId })), state.folders.map(({ id, rank, parentId }) => ({ id, rank, parentId })))
  assert.deepEqual(state.folders[0].at, { x: 1000, y: -500 }, 'the original document is untouched')
})

test('measured large cards do not overlap across rows or columns', () => {
  const state = fixture()
  const sizes = new Map(state.folders.map((folder) => [folder.id, { w: 420, h: 360 }]))
  const next = arrangeTopics(state, sizes)
  const roots = next.folders.filter((folder) => !folder.parentId)
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
    const a = roots[i].at, b = roots[j].at
    assert.ok(Math.abs(a.x - b.x) >= 420 || Math.abs(a.y - b.y) >= 360)
  }
})

test('arrangement Undo restores positions without erasing later writing', () => {
  const state = fixture()
  const next = arrangeTopics(state)
  const { inverse } = applyOps(state, diffDocs(state, next))
  const edited = { ...next, notes: next.notes.map((note) => note.id === 'inside' ? { ...note, markdown: 'Later writing' } : note) }
  const undone = applyOps(edited, inverse).doc
  assert.deepEqual(undone.folders, state.folders)
  assert.equal(undone.notes.find((note) => note.id === 'inside').markdown, 'Later writing')
})

test('an empty workspace needs no arrangement', () => {
  const state = createDefaultWorkspace()
  assert.equal(arrangeTopics(state), state)
})
