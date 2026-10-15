import assert from 'node:assert/strict'
import test from 'node:test'
import { fileUnsorted, undoFiling } from '../src/sky/sort-review.js'
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

test('Sky and recoverable Trash share safe placement Undo without overwriting later edits or locations', () => {
  const state = fixture()
  const placed = fileUnsorted(state, ['n0'], null, '', { at: { x: 123, y: 456 } })
  assert.deepEqual(placed.state.notes[0].at, { x: 123, y: 456 })
  assert.deepEqual(undoFiling(placed.state, placed.changes).state.notes[0], state.notes[0])
  assert.equal(fileUnsorted(state, ['n0'], null, '', { at: { x: NaN, y: 1 } }).state, state)
  const trashed = fileUnsorted(state, ['n0'], null, '', { trash: true })
  assert.ok(trashed.state.notes[0].trashedAt)
  const edited = { ...trashed.state, notes: trashed.state.notes.map((note) => note.id === 'n0' ? { ...note, markdown: 'Later writing' } : note) }
  assert.deepEqual(undoFiling(edited, trashed.changes).state.notes[0], { ...state.notes[0], markdown: 'Later writing' })
  const archived = { ...placed.state, notes: placed.state.notes.map((note) => note.id === 'n0' ? { ...note, archived: true } : note) }
  assert.equal(undoFiling(archived, placed.changes).restored, 0)
})


test('a new node uses one of the same name, and Undo takes away a node made for it only while empty', () => {
  const before = fixture()
  const made = fileUnsorted(before, ['n0'], null, 'Garden')
  assert.ok(made.made)
  const again = fileUnsorted(made.state, ['n1'], null, 'garden')
  assert.deepEqual([again.made, again.folderId], [null, made.made])
  const empty = undoFiling(made.state, made.changes, [made.made]).state
  assert.ok(!empty.folders.some((folder) => folder.id === made.made))
  const kept = undoFiling(again.state, made.changes, [made.made]).state
  assert.ok(kept.folders.some((folder) => folder.id === made.made), 'n1 is still in it')
})
