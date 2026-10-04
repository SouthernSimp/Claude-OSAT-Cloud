import assert from 'node:assert/strict'
import test from 'node:test'
import { fileUnsorted, undoFiling, reviewSuggestions } from '../src/sky/sort-review.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { moveSticky } from '../src/nodes-model.js'

const fixture = () => normalizeWorkspace({ ...createDefaultWorkspace(), folders: [{ id: 'topic', name: 'Work', at: { x: 90, y: 100 } }, { id: 'branch', name: 'Planning', parentId: 'topic' }], notes: [
  ...Array.from({ length: 220 }, (_, i) => ({ id: `n${i}`, title: `Thought ${i}`, markdown: `Original ${i}`, rank: i * 1024, unsorted: true, ...(i === 0 ? { links: ['folder:topic'] } : {}) })),
  { id: 'filed', title: 'Filed', folderId: 'topic', markdown: 'Keep' },
  { id: 'trash', title: 'Trash', trashedAt: '2026-10-04' }, { id: 'archive', title: 'Archive', archived: true }, { id: 'day', title: 'Day', kind: 'day', date: '2026-10-04' }, { id: 'free', title: 'Placed on Sky', at: { x: 500, y: -600 } },
] })

test('a large selected batch files once without changing content, identities, links or topic geometry', () => {
  const before = fixture()
  const ids = Array.from({ length: 200 }, (_, i) => `n${i}`)
  const result = fileUnsorted(before, [...ids, ...ids], 'branch')
  assert.equal(result.moved.length, 200)
  assert.equal(result.state.notes.length, before.notes.length)
  assert.equal(result.state.folders, before.folders)
  assert.deepEqual(result.state.notes.map(({ id, title, markdown, links }) => ({ id, title, markdown, links })), before.notes.map(({ id, title, markdown, links }) => ({ id, title, markdown, links })))
  assert.equal(result.state.notes.find((n) => n.id === 'n200').folderId, null)
})

test('stale selections and missing destinations never move other records', () => {
  const before = fixture()
  assert.equal(fileUnsorted(before, ['n0'], 'missing').state, before)
  assert.equal(fileUnsorted(before, ['filed', 'trash', 'archive', 'day', 'free', 'deleted'], 'branch', 'Empty topic').state, before)
  assert.deepEqual(fileUnsorted(before, ['n0', 'filed', 'trash'], 'branch').moved, ['n0'])
})

test('undo restores exact placement and ranks while retaining later writing and added notes', () => {
  const before = fixture()
  const result = fileUnsorted(before, ['n0', 'n1'], 'branch')
  const edited = { ...result.state, notes: [...result.state.notes.map((note) => note.id === 'n0' ? { ...note, markdown: 'Later writing' } : note), { id: 'later', title: 'Later' }] }
  const undone = undoFiling(edited, result.changes).state
  const original = before.notes.find((note) => note.id === 'n0')
  assert.deepEqual(undone.notes.find((note) => note.id === 'n0'), { ...original, markdown: 'Later writing' })
  assert.ok(undone.notes.some((note) => note.id === 'later'))
})

test('undo preserves a newer move and does not resurrect a deleted note', () => {
  const result = fileUnsorted(fixture(), ['n0', 'n1'], 'branch')
  const moved = moveSticky(result.state, 'n0', 'topic')
  const edited = { ...moved, notes: moved.notes.filter((note) => note.id !== 'n1') }
  const undone = undoFiling(edited, result.changes).state
  assert.equal(undone.notes.find((note) => note.id === 'n0').folderId, 'topic')
  assert.ok(!undone.notes.some((note) => note.id === 'n1'))
})

test('creating a topic requires a valid nonempty selection and undo preserves later topic work', () => {
  const before = fixture()
  const result = fileUnsorted(before, ['n0'], null, 'Garden')
  assert.equal(result.state.folders.length, before.folders.length + 1)
  assert.equal(result.state.notes.find((n) => n.id === 'n0').folderId, result.folderId)
  const later = moveSticky(result.state, 'n2', result.folderId)
  const undone = undoFiling(later, result.changes).state
  assert.ok(undone.folders.some((folder) => folder.id === result.folderId))
  assert.equal(undone.notes.find((n) => n.id === 'n2').folderId, result.folderId)
  assert.equal(undone.notes.find((n) => n.id === 'n0').folderId, null)
})

test('shared boilerplate is not enough to suggest unrelated destinations', () => {
  const state = fixture()
  const notes = [{ id: 'a', title: 'Unfiled thought', markdown: 'Review the next step', tags: [] }]
  const topics = { ...state, folders: [{ id: 'topic', name: 'Gardening' }], notes: [{ id: 'existing', title: 'Unfiled thought', markdown: 'Review the next step', folderId: 'topic' }] }
  assert.deepEqual(reviewSuggestions(topics, notes), [])
  const tagged = [{ ...notes[0], tags: ['gardening'] }]
  assert.equal(reviewSuggestions(topics, tagged)[0].folderId, 'topic')
})
