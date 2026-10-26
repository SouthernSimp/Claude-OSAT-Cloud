import assert from 'node:assert/strict'
import test from 'node:test'

import { addBoard, boardOverview, boardsOf, findOn, isFavorite, JUST_IN, mapColumns, moveToBoard, rankIn, setFavorite, setStage, stageColumns, stageOf, stickiesOn } from '../src/boards/boards-model.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { normalizeNote } from '../shared/note-core.mjs'
import { applyOps, createEmptyDoc, diffDocs, migrate, SCHEMA, validateOps } from '../shared/store-core.mjs'

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

test('the overview keeps the Board’s steps and hand ordering, Doing then Next then Later, with honest progress', () => {
  const notes = stickiesOn(state, 'osat')
  const before = structuredClone(notes)
  const overview = boardOverview(notes, T0)
  assert.deepEqual(ids(overview.steps), ['ship', 'granola', 'canvas'])
  assert.deepEqual([overview.done, overview.total], [1, 4], 'a plain idea is not a step; a problem is')
  assert.deepEqual(notes, before, 'opening the overview never changes notes or ranks')
  const moved = setStage(state, ['granola'], 'next')
  assert.deepEqual(ids(boardOverview(stickiesOn(moved, 'osat'), T0).steps), ['ship', 'granola', 'canvas'])
  const done = setStage(state, ['ship'], 'done')
  assert.deepEqual([boardOverview(stickiesOn(done, 'osat'), T0).done, boardOverview(stickiesOn(done, 'osat'), T0).total], [2, 4])
})

test('the overview dates include today, in time order, and skip old, completed, deleted, invalid and question dates', () => {
  const now = new Date(2026, 9, 17, 16).getTime()
  const dated = (id, date, extra = {}) => sticky(id, id, { what: 'date', ask: { event: { date, title: id } }, ...extra })
  const notes = [
    dated('future', '2026-10-22'), dated('today', '2026-10-17'), dated('old', '2026-10-16'),
    dated('done', '2026-10-18', { doneAt: iso(T0) }), dated('deleted', '2026-10-18', { trashedAt: iso(T0) }),
    dated('question', '2026-10-18', { what: 'question' }), dated('invalid', 'not-a-date'),
    sticky('relative', 'Site visit tomorrow', { what: 'date' }), // written October 15, so tomorrow is already past
  ]
  assert.deepEqual(boardOverview(notes, now).upcoming.map(({ note }) => note.id), ['today', 'future'])
})

test('the overview recent notes follow edits, never include Trash or day pages, and retain every matching note', () => {
  const notes = [
    sticky('old-edited', 'Old note', {}, 1), sticky('new', 'New note', {}, 10),
    sticky('deleted', 'Deleted', { trashedAt: iso(T0) }, 20), sticky('day', 'Journal', { kind: 'day' }, 30),
  ].map((note) => Object.freeze(note.id === 'old-edited' ? { ...note, updatedAt: iso(T0 + 40) } : note))
  Object.freeze(notes)
  assert.deepEqual(ids(boardOverview(notes, T0).recent), ['old-edited', 'new'])
  const many = Array.from({ length: 20 }, (_, i) => sticky(`n${i}`, 'Matching action', { what: 'todo' }, i))
  assert.equal(boardOverview(many, T0).steps.length, 20, 'the preview limit never discards steps from the model')
  assert.equal(findOn(many, 'Matching action').length, 20, 'search can reach every match beyond the preview')
})

test('an empty or finished overview has no invented steps or dates', () => {
  assert.deepEqual(boardOverview([], T0), { steps: [], done: 0, total: 0, upcoming: [], recent: [] })
  const notes = [sticky('done', 'Complete the job', { what: 'todo', doneAt: iso(T0) })]
  const finished = boardOverview(notes, T0)
  assert.deepEqual([finished.steps.length, finished.done, finished.total, finished.upcoming.length], [0, 1, 1, 0])
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

test('a favorite board (Phase 99): added and taken off, saved through the store; only favorite: true is kept', () => {
  const home = (s) => s.folders.find((folder) => folder.id === 'home')
  const on = setFavorite(state, 'home', true)
  assert.equal(isFavorite(home(on)), true)
  assert.equal(setFavorite(on, 'home', true), on, 'marking again changes nothing')
  assert.equal(setFavorite(state, 'home', false), state, 'nothing to take off')
  const off = setFavorite(on, 'home', false)
  assert.equal('favorite' in home(off), false)
  assert.equal(home(applyOps(state, validateOps(diffDocs(state, on))).doc).favorite, true)
  assert.equal('favorite' in home(applyOps(on, validateOps(diffDocs(on, off))).doc), false, 'taken off in the store too')
  assert.equal(home(normalizeWorkspace(on)).favorite, true)
  assert.equal(normalizeWorkspace({ ...state, folders: [{ id: 'x', name: 'X', favorite: 'yes' }] }).folders[0].favorite, undefined)
})

test('schema 18: nothing changes on the way up', () => {
  assert.ok(SCHEMA >= 18)
  const old = { ...createEmptyDoc(), schema: 17, rev: 3, folders: [{ id: 'a', name: 'A', parentId: null, createdAt: iso(T0), collapsed: false }] }
  assert.deepEqual(migrate(old), { ...old, schema: SCHEMA })
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

test('a card says where a sticky came from in today’s words, and a picture as [Screenshot]', async () => {
  const { cardWords, sourceWords } = await import('../src/boards/boards-model.js')
  assert.equal(sourceWords('Desk'), 'Typed')
  assert.equal(sourceWords('Sky'), 'Board')
  assert.equal(sourceWords('Quick bar'), 'Quick bar')
  assert.equal(sourceWords(undefined), '')
  assert.equal(cardWords('Test\n![Screenshot](osat-picture:8405cf2f.png) and ![](osat-picture:a.png)'), 'Test\n[Screenshot] and [Picture]')
  assert.equal(cardWords('From Granola: [Fortis kickoff](https://notes.granola.ai/d/1)'), 'From Granola: Fortis kickoff')
})
