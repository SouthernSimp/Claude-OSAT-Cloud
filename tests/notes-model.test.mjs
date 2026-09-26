import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import {
  backlinks, canMoveFolder, createFolder, ensureDayNote, relinkRenamedNote, deleteFolder, excerpt, folderPath, folderSubtree, folderTree,
  moveNotes, noteCounts, normalizeFolders, notesInList, outline, parseWikilinks, renameWikilinks, resolveWikilink,
  searchNotes, sortNotes, tagIndex, trashNotes, restoreNotes, emptyTrash, updateNote, wikilinkPairs, wordCount,
} from '../src/notes-model.js'

const workspaceWith = (notes, folders = []) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders })

test('folders normalize: cycles and missing parents fall back to the root', () => {
  const folders = normalizeFolders([
    { id: 'a', name: 'A', parentId: 'b' },
    { id: 'b', name: 'B', parentId: 'a' },
    { id: 'c', name: 'C', parentId: 'missing' },
    { id: 'c', name: 'Duplicate' },
    { id: 'd', name: '   ' },
  ])
  assert.deepEqual(folders.map((folder) => [folder.id, folder.parentId]), [['a', null], ['b', 'a'], ['c', null]])
})

test('folder tree, subtree, path and move guards', () => {
  const root = createFolder('Projects')
  const child = createFolder('OSAT', root.id)
  const grandchild = createFolder('V2', child.id)
  const folders = normalizeFolders([root, child, grandchild, createFolder('Personal')])
  assert.deepEqual(folderTree(folders).map(({ folder, depth }) => `${depth}:${folder.name}`), ['0:Personal', '0:Projects', '1:OSAT', '2:V2'])
  assert.deepEqual([...folderSubtree(folders, root.id)].sort(), [root.id, child.id, grandchild.id].sort())
  assert.deepEqual(folderPath(folders, grandchild.id), ['Projects', 'OSAT', 'V2'])
  assert.equal(canMoveFolder(folders, root.id, grandchild.id), false)
  assert.equal(canMoveFolder(folders, grandchild.id, root.id), true)
})

test('deleting a folder keeps its notes and moves them up one level', () => {
  const root = createFolder('Projects')
  const child = createFolder('OSAT', root.id)
  const state = workspaceWith([{ id: 'n1', title: 'Inside', markdown: '', folderId: child.id }], [root, child])
  const next = deleteFolder(state, child.id)
  assert.equal(next.folders.length, 1)
  assert.equal(next.notes.find((note) => note.id === 'n1').folderId, root.id)
  const gone = deleteFolder(next, root.id)
  assert.equal(gone.notes.find((note) => note.id === 'n1').folderId, null)
})

test('a note whose folder no longer exists is unfiled after normalization', () => {
  const state = workspaceWith([{ id: 'n1', title: 'Lost', markdown: '', folderId: 'ghost' }])
  assert.equal(state.notes[0].folderId, null)
})

test('a note keeps where it came from and whether it is sorted through normalization', () => {
  const state = workspaceWith([{ id: 'n1', title: 'Reviewed thought', markdown: 'Useful detail', unsorted: true, source: 'Quick capture' }])
  assert.equal(state.notes[0].unsorted, true)
  assert.equal(state.notes[0].source, 'Quick capture')
  assert.equal('originCaptureId' in state.notes[0], false)
})

test('wikilinks parse, resolve case-insensitively, and produce backlinks', () => {
  assert.deepEqual(parseWikilinks('See [[Plan A]] and [[plan a|the plan]] plus [[Other#Heading]]'), ['Plan A', 'Other'])
  const state = workspaceWith([
    { id: 'plan', title: 'Plan A', markdown: 'The plan.' },
    { id: 'ref', title: 'Journal', markdown: 'Working on [[plan a]] today.' },
    { id: 'trashed', title: 'Old', markdown: '[[Plan A]]', trashedAt: '2026-01-01T00:00:00.000Z' },
  ])
  assert.equal(resolveWikilink(state.notes, 'PLAN A').id, 'plan')
  assert.deepEqual(backlinks(state.notes, state.notes[0]).map((note) => note.id), ['ref'])
  assert.deepEqual(wikilinkPairs(state.notes), [{ a: 'ref', b: 'plan' }])
})

test('renaming a note rewrites links that pointed at the old title', () => {
  const state = workspaceWith([
    { id: 'plan', title: 'Plan A', markdown: '' },
    { id: 'ref', title: 'Journal', markdown: 'See [[Plan A]] and [[plan a|alias]].' },
  ])
  const typed = updateNote(state, 'plan', { title: 'Plan B' })
  assert.equal(typed.notes.find((note) => note.id === 'ref').markdown, 'See [[Plan A]] and [[plan a|alias]].', 'typing a title does not rewrite other notes')
  const renamed = relinkRenamedNote(typed, 'Plan A', 'Plan B')
  assert.equal(renamed.notes.find((note) => note.id === 'ref').markdown, 'See [[Plan B]] and [[Plan B|alias]].')
  assert.equal(relinkRenamedNote(renamed, 'Plan A', 'Plan B'), renamed)
  assert.deepEqual(renameWikilinks(state.notes, 'Plan A', ''), state.notes)
})

test('smart lists, search grammar, sorting and counts', () => {
  const folder = createFolder('Work')
  const now = Date.parse('2026-09-13T12:00:00.000Z')
  const state = workspaceWith([
    { id: 'a', title: 'Alpha', markdown: 'body #work', pinned: true, updatedAt: '2026-09-12T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z', folderId: folder.id },
    { id: 'b', title: 'Beta', markdown: 'other', updatedAt: '2026-09-13T00:00:00.000Z', createdAt: '2026-09-02T00:00:00.000Z' },
    { id: 'c', title: 'Gamma', markdown: 'archived', archived: true, updatedAt: '2026-08-01T00:00:00.000Z' },
    { id: 'daily-plan-2026-09-13', kind: 'day', date: '2026-09-13', title: 'Today’s next steps', markdown: '- [ ] one', updatedAt: '2026-09-13T01:00:00.000Z' },
  ], [folder])
  assert.deepEqual(notesInList(state, 'all').map((note) => note.id).sort(), ['a', 'b', 'daily-plan-2026-09-13'])
  assert.deepEqual(notesInList(state, 'folder', folder.id).map((note) => note.id), ['a'])
  assert.deepEqual(notesInList(state, 'archived').map((note) => note.id), ['c'])
  assert.deepEqual(notesInList(state, 'daily').map((note) => note.id), ['daily-plan-2026-09-13'])
  assert.deepEqual(notesInList(state, 'recent', null, now).map((note) => note.id).sort(), ['a', 'b', 'daily-plan-2026-09-13'])
  assert.deepEqual(searchNotes(state.notes, '#work').map((note) => note.id), ['a'])
  assert.deepEqual(searchNotes(state.notes, 'other').map((note) => note.id), ['b'])
  assert.deepEqual(sortNotes(notesInList(state, 'all'), 'title').map((note) => note.id), ['a', 'b', 'daily-plan-2026-09-13'])
  assert.deepEqual(sortNotes(notesInList(state, 'all'), 'updated').map((note) => note.id), ['a', 'daily-plan-2026-09-13', 'b'])
  assert.deepEqual(tagIndex(state.notes), [{ tag: 'work', count: 1 }])
  assert.deepEqual(noteCounts(state), { all: 3, unsorted: 0, pinned: 1, unfiled: 2, daily: 1, archived: 1, trashed: 0 })
})

test('trash is reversible and empty trash is final', () => {
  const state = workspaceWith([{ id: 'a', title: 'A', markdown: '', pinned: true }, { id: 'b', title: 'B', markdown: '' }])
  const trashed = trashNotes(state, ['a'])
  assert.equal(trashed.notes[0].pinned, false)
  assert.equal(notesInList(trashed, 'trash').length, 1)
  assert.equal(notesInList(restoreNotes(trashed, ['a']), 'trash').length, 0)
  assert.deepEqual(emptyTrash(trashed).notes.map((note) => note.id), ['b'])
  assert.equal(moveNotes(state, ['b'], 'missing').notes[1].folderId, null)
})

test('the day note is created once and reused', () => {
  const state = workspaceWith([])
  const first = ensureDayNote(state, '2026-09-13')
  assert.equal(first.created, true)
  assert.equal(first.note.id, 'day-2026-09-13')
  assert.equal(first.note.kind, 'day')
  assert.equal(first.note.title, 'Sunday, September 13')
  const second = ensureDayNote(first.state, '2026-09-13')
  assert.equal(second.created, false)
  assert.equal(second.state.notes.length, 1)
})

test('outline, word count and excerpt read markdown sensibly', () => {
  const markdown = '# Title\n\nSome words here.\n\n```\n# not a heading\n```\n\n## Section\n\n- [ ] task\n- item'
  assert.deepEqual(outline(markdown).map((item) => `${item.level}:${item.text}`), ['1:Title', '2:Section'])
  assert.equal(wordCount('one two three'), 3)
  assert.equal(excerpt(markdown), 'Some words here. Section ☐ task • item')
  assert.equal(excerpt('# Title\n\nProof first. #work #launch-plan\nEnds here.'), 'Proof first. Ends here.')
})

test('Ask picks the notes that share the question’s rarer words', async () => {
  const { relatedNotes } = await import('../src/notes-model.js')
  const note = (id, title, markdown, extra = {}) => ({ id, title, markdown, tags: [], updatedAt: '2026-09-20T00:00:00.000Z', ...extra })
  const notes = [
    note('garden', 'Garden plans', 'Plant the tomatoes before the frost. Buy compost.'),
    note('taxes', 'Taxes', 'Find last year’s return and the receipts.'),
    note('day', 'Friday', 'Called mum. Garden looked good.'),
    note('trash', 'Tomatoes', 'Old tomato list', { trashedAt: '2026-09-21T00:00:00.000Z' }),
    note('lists', 'Shopping', 'Milk, bread, eggs'),
  ]
  assert.deepEqual(relatedNotes(notes, 'When should I plant my tomatoes?').map((item) => item.id), ['garden'])
  assert.deepEqual(relatedNotes(notes, 'What did I write about the garden?').map((item) => item.id), ['garden', 'day'])
  assert.deepEqual(relatedNotes(notes, 'hello there, how are you?'), [])
  assert.deepEqual(relatedNotes(notes, 'receipts'), [notes[1]])
})
