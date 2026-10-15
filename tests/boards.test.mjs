import assert from 'node:assert/strict'
import test from 'node:test'

import { addBoard, boardsOf, findOn, JUST_IN, mapColumns, moveToBoard, rankIn, setStage, stageColumns, stageOf, stickiesOn } from '../src/boards/boards-model.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { normalizeNote } from '../shared/note-core.mjs'
import { createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'

const T0 = Date.UTC(2026, 9, 15, 9, 0)
const iso = (ms) => new Date(ms).toISOString()
const sticky = (id, text, extra = {}, at = 0) => ({ id, title: text, markdown: text, tags: [], createdAt: iso(T0 + at), updatedAt: iso(T0 + at), ...extra })
const state = normalizeWorkspace({
  ...createDefaultWorkspace(),
  folders: [
    { id: 'osat', name: 'OSAT', rank: 1, createdAt: iso(T0) },
    { id: 'old-branch', name: 'IMPLEMENT', parentId: 'osat', createdAt: iso(T0) },
    { id: 'home', name: 'Home', rank: 2, createdAt: iso(T0) },
  ],
  notes: [
    sticky('n8n', 'We could integrate n8n inside OSAT', { folderId: 'osat' }, 1),
    sticky('canvas', 'The canvas is hard to read', { folderId: 'old-branch' }, 2),
    sticky('ship', 'Ship the new canvas', { folderId: 'osat', stage: 'doing' }, 3),
    sticky('granola', 'Connect Granola', { folderId: 'osat', rank: 2048 }, 4),
    sticky('fixed', 'Finish the Settings tiles', { folderId: 'osat', doneAt: iso(T0), rank: 1024 }, 5),
    sticky('milk', 'milk, bread, turkey', { unsorted: true }, 6),
    sticky('q', 'Is a Mac mini enough?', { unsorted: true }, 7),
    { id: 'day-2026-10-15', kind: 'day', date: '2026-10-15', title: 'Thursday', markdown: '', createdAt: iso(T0), updatedAt: iso(T0) },
  ],
})
const ids = (notes) => notes.map((note) => note.id)

test('a board is a topic at the top, its old branches’ stickies on it too; Just in is what has no home', () => {
  assert.deepEqual(boardsOf(state).map(({ folder, count }) => [folder.name, count]), [['OSAT', 5], ['Home', 0]])
  assert.deepEqual(ids(stickiesOn(state, 'osat')), ['fixed', 'granola', 'ship', 'canvas', 'n8n'], 'newest first')
  assert.deepEqual(ids(stickiesOn(state, JUST_IN)), ['q', 'milk'], 'never a day page')
})

test('the Map: one column per kind, the four main ones always there', () => {
  const columns = mapColumns(stickiesOn(state, 'osat'))
  assert.deepEqual(columns.map((column) => [column.title, ids(column.notes)]), [
    ['Ideas', ['n8n']], ['Questions', []], ['Problems', ['canvas']], ['To-dos', ['fixed', 'granola', 'ship']],
  ])
  assert.deepEqual(mapColumns(stickiesOn(state, JUST_IN)).map((column) => column.title), ['Ideas', 'Questions', 'Problems', 'To-dos', 'To buy'])
})

test('the Board: what is to be done, in Later / Next / Doing / Done, each in its own order', () => {
  const columns = stageColumns(stickiesOn(state, 'osat'))
  // Granola was ranked by hand (2048); a sticky never ranked ranks by when it was made, so after it.
  assert.deepEqual(columns.map((column) => [column.title, ids(column.notes)]), [['Later', ['granola', 'canvas']], ['Next', []], ['Doing', ['ship']], ['Done', ['fixed']]])
  assert.equal(stageOf({ stage: 'nonsense' }), 'later')
})

test('moving across the Board: Done ticks it off, leaving Done un-ticks it', () => {
  const done = setStage(state, ['granola'], 'done', iso(T0 + 9))
  assert.equal(stageOf(done.notes.find((note) => note.id === 'granola')), 'done')
  const back = setStage(done, ['granola'], 'next')
  const granola = back.notes.find((note) => note.id === 'granola')
  assert.deepEqual([granola.stage, 'doneAt' in granola], ['next', false])
  assert.deepEqual(setStage(state, ['granola'], 'sideways').notes, state.notes, 'no such stage: nothing moves')
})

test('a sticky dropped between two in a stage ranks between them, spacing them out when there is no room', () => {
  const later = stageColumns(stickiesOn(state, 'osat'))[0].notes
  const next = rankIn(state, 'ship', later, 1)
  const rank = (s, id) => s.notes.find((note) => note.id === id).rank
  const canvasRank = Date.parse(state.notes.find((note) => note.id === 'canvas').createdAt)
  assert.ok(rank(next, 'ship') > 2048 && rank(next, 'ship') < canvasRank, 'between Granola and the canvas')
  const tight = { ...state, notes: state.notes.map((note) => (note.id === 'canvas' ? { ...note, rank: 1 } : note.id === 'granola' ? { ...note, rank: 1 + Number.EPSILON } : note)) }
  const spaced = rankIn(tight, 'ship', [tight.notes.find((note) => note.id === 'canvas'), tight.notes.find((note) => note.id === 'granola')], 1)
  assert.ok(rank(spaced, 'canvas') < rank(spaced, 'ship') && rank(spaced, 'ship') < rank(spaced, 'granola'))
})

test('a new board is never a second one of the same name; stickies move onto a board and back to Just in', () => {
  const again = addBoard(state, '  osat ')
  assert.equal(again.folder.id, 'osat')
  assert.equal(again.state, state)
  const made = addBoard(state, 'Fortis')
  assert.equal(made.folder.name, 'Fortis')
  const moved = moveToBoard(made.state, ['milk', 'q'], 'home')
  assert.deepEqual(ids(stickiesOn(moved, 'home')).sort(), ['milk', 'q'])
  assert.deepEqual(ids(stickiesOn(moved, JUST_IN)), [])
  assert.deepEqual(ids(stickiesOn(moveToBoard(moved, ['q'], JUST_IN), JUST_IN)), ['q'])
})

test('find on a board: every word asked', () => {
  assert.deepEqual(ids(findOn(stickiesOn(state, 'osat'), 'CANVAS ship')), ['ship'])
  assert.equal(findOn(stickiesOn(state, 'osat'), '  ').length, 5)
})

test('schema 14: a sticky keeps its stage; nothing else', () => {
  assert.ok(SCHEMA >= 14)
  const old = { ...createEmptyDoc(), schema: 13, rev: 2, notes: [normalizeNote({ id: 'a', markdown: 'x' })] }
  assert.deepEqual(migrate(old).notes, old.notes)
  assert.equal(normalizeNote({ id: 'a', markdown: 'x', stage: 'doing' }).stage, 'doing')
  assert.equal('stage' in normalizeNote({ id: 'a', markdown: 'x', stage: 'done' }), false, 'Done is doneAt')
})

test('Undo on the canvas puts back only what the change touched', async () => {
  const { undoFrom } = await import('../src/boards/boards-model.js')
  const made = addBoard(state, 'Fortis')
  const after = moveToBoard(made.state, ['milk'], made.folder.id)
  const undo = undoFrom(state, after)
  // Meanwhile the AI filed the question somewhere else.
  const meanwhile = moveToBoard(after, ['q'], 'home')
  const back = undo(meanwhile)
  assert.equal(back.folders.some((folder) => folder.name === 'Fortis'), false, 'the board made for it goes')
  assert.equal(back.notes.find((note) => note.id === 'milk').unsorted, true, 'the sticky is back in Just in')
  assert.equal(back.notes.find((note) => note.id === 'q').folderId, 'home', 'what happened meanwhile stays')
})
