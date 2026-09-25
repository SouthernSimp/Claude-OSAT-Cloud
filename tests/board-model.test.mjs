import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { createFolder } from '../src/notes-model.js'
import {
  addCardsToBoard, boardToJson, boardToMarkdown, cardMatches, cardPaper, clusterCards, contentBounds, ensureTagColors,
  findFreeSpot, fitCamera, importBoardText, newBoard, normalizeBoardDoc, reconcileBoards, removeCards, stockFor, tidyGrid,
  updateBoard, wirePath, anchor,
} from '../src/board-model.js'

const workspaceWith = (notes, folders = [], sorter) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders, sorter })

test('a V1 sorter document migrates: text dropped from cards, hidden ids move to the desk board', () => {
  const state = workspaceWith(
    [{ id: 'n1', title: 'Keep', markdown: 'Original' }, { id: 'n2', title: 'Hidden', markdown: 'Not on the board' }],
    [],
    { schema: 1, activeId: 'osat-board', hiddenNoteIds: ['n2'], boards: [{ id: 'osat-board', name: 'My notes', notes: [{ id: 'n1', text: 'Original', x: 40, y: 60, w: 224, h: 180, color: 'sand' }], links: [], views: [], tagColors: {}, cam: { x: 1, y: 2, z: 1 } }] },
  )
  const board = state.sorter.boards[0]
  assert.equal(state.sorter.schema, 2)
  assert.deepEqual(board.scope, { kind: 'all', folderId: null })
  assert.deepEqual(board.notes.map((card) => card.id), ['n1'])
  assert.equal('text' in board.notes[0], false)
  assert.equal(board.notes[0].color, 'apricot')
  assert.deepEqual(board.hidden, ['n2'])
})

test('auto boards follow Notes: new notes appear, archived and trashed notes leave, manual boards keep their cards', () => {
  const folder = createFolder('Work')
  const manual = { ...newBoard('Manual'), id: 'manual', notes: [{ id: 'a', x: 0, y: 0, w: 200, h: 150 }, { id: 'b', x: 300, y: 0, w: 200, h: 150 }], links: [{ id: 'l1', a: 'a', b: 'b' }] }
  const folderBoard = { ...newBoard('Work board', { kind: 'folder', folderId: folder.id }), id: 'work' }
  const state = workspaceWith(
    [
      { id: 'a', title: 'A', markdown: 'plain' },
      { id: 'b', title: 'B', markdown: 'archived later', archived: true },
      { id: 'c', title: 'C', markdown: 'in work', folderId: folder.id },
      { id: 'd', title: 'D', markdown: 'gone', trashedAt: '2026-09-01T00:00:00.000Z' },
    ],
    [folder],
    { boards: [{ id: 'osat-board', name: 'Desk', notes: [{ id: 'd', x: 0, y: 0, w: 200, h: 150 }], links: [] }, manual, folderBoard], activeId: 'osat-board' },
  )
  const [desk, manualBoard, work] = state.sorter.boards
  assert.deepEqual(desk.notes.map((card) => card.id).sort(), ['a', 'c'])
  assert.deepEqual(manualBoard.notes.map((card) => card.id), ['a', 'b'])
  assert.equal(manualBoard.links.length, 1)
  assert.deepEqual(work.notes.map((card) => card.id), ['c'])
  // Cards never overlap when they are placed automatically.
  const [first, second] = desk.notes
  assert.ok(first.x + first.w <= second.x || second.x + second.w <= first.x || first.y + first.h <= second.y || second.y + second.h <= first.y)
})

test('removing a card from an auto board hides the note until it is added back', () => {
  const state = workspaceWith([{ id: 'a', title: 'A', markdown: '' }, { id: 'b', title: 'B', markdown: '' }])
  const removed = normalizeWorkspace(updateBoard(state, 'osat-board', (board) => removeCards(board, ['a'])))
  assert.deepEqual(removed.sorter.boards[0].notes.map((card) => card.id), ['b'])
  assert.deepEqual(removed.sorter.boards[0].hidden, ['a'])
  const restored = normalizeWorkspace(updateBoard(removed, 'osat-board', (board) => addCardsToBoard(board, [{ id: 'a', w: 200, h: 150 }])))
  assert.deepEqual(restored.sorter.boards[0].notes.map((card) => card.id).sort(), ['a', 'b'])
  assert.deepEqual(restored.sorter.boards[0].hidden, [])
})

test('paper stock, colours and tag colours', () => {
  assert.equal(stockFor('short').w, 176)
  assert.equal(stockFor('- one\n- two\n- three').ruled, true)
  const board = { ...newBoard('x'), tagColors: { work: 'rose' } }
  assert.equal(cardPaper({ color: null }, { tags: ['work'] }, board), 'rose')
  assert.equal(cardPaper({ color: 'mint' }, { tags: ['work'] }, board), 'mint')
  assert.equal(cardPaper({ color: null }, { tags: [] }, board), 'canary')
  const withCards = { ...board, notes: [{ id: 'a' }, { id: 'b' }] }
  const notes = new Map([['a', { tags: ['alpha'] }], ['b', { tags: ['beta'] }]])
  const coloured = ensureTagColors(withCards, notes)
  assert.ok(coloured.tagColors.alpha && coloured.tagColors.beta && coloured.tagColors.alpha !== coloured.tagColors.beta)
  assert.equal(ensureTagColors(coloured, notes), coloured)
})

test('filters match by tags, query and connection state', () => {
  const board = { ...newBoard('x'), links: [{ id: 'l', a: 'a', b: 'b' }] }
  const note = { title: 'Alpha', markdown: 'body', tags: ['one', 'two'] }
  assert.equal(cardMatches({ id: 'a' }, note, board, { tags: ['one'], mode: 'any', query: '', untagged: false, unconnected: false }), true)
  assert.equal(cardMatches({ id: 'a' }, note, board, { tags: ['one', 'three'], mode: 'all', query: '', untagged: false, unconnected: false }), false)
  assert.equal(cardMatches({ id: 'a' }, note, board, { tags: [], mode: 'any', query: 'BODY', untagged: false, unconnected: false }), true)
  assert.equal(cardMatches({ id: 'a' }, note, board, { tags: [], mode: 'any', query: '', untagged: false, unconnected: true }), false)
  assert.equal(cardMatches({ id: 'c' }, { ...note, tags: [] }, board, { tags: [], mode: 'any', query: '', untagged: true, unconnected: true }), true)
})

test('cluster layout separates groups and returns one frame per key', () => {
  const cards = Array.from({ length: 6 }, (_, index) => ({ id: `c${index}`, x: 0, y: 0, w: 200, h: 150 }))
  const tags = ['a', 'a', 'b', 'b', 'b', '']
  const result = clusterCards(cards, (card) => tags[Number(card.id.slice(1))], (key) => key ? `#${key}` : 'Untagged', () => 'sky', 'tag')
  assert.equal(result.cards.length, 6)
  assert.deepEqual(result.groups.map((group) => group.name), ['#b', '#a', 'Untagged'])
  result.groups.forEach((group) => {
    const members = result.cards.filter((card) => card.x >= group.x && card.x + card.w <= group.x + group.w && card.y >= group.y && card.y + card.h <= group.y + group.h)
    assert.ok(members.length >= 1)
  })
  const tidy = tidyGrid(cards)
  assert.equal(new Set(tidy.map((card) => `${card.x},${card.y}`)).size, 6)
})

test('geometry helpers: free spots, bounds, fit and wires', () => {
  const cards = [{ x: 0, y: 0, w: 200, h: 150 }]
  const spot = findFreeSpot(cards, 200, 150)
  assert.ok(spot.x >= 216 || spot.y >= 166 || spot.x <= -216 || spot.y <= -166)
  assert.deepEqual(contentBounds([{ x: 10, y: 20, w: 100, h: 50 }, { x: -10, y: 0, w: 20, h: 100 }]), { x: -10, y: 0, w: 120, h: 100 })
  const cam = fitCamera({ x: 0, y: 0, w: 1000, h: 500 }, { w: 800, h: 600 })
  assert.ok(cam.z < 1 && cam.z > 0.5)
  const a = { x: 0, y: 0, w: 100, h: 100 }, b = { x: 300, y: 0, w: 100, h: 100 }
  const from = anchor(a, b), to = anchor(b, a)
  assert.deepEqual([from.x, from.nx, to.x, to.nx], [100, 1, 300, -1])
  assert.match(wirePath(from, to).d, /^M100 50C/)
})

test('export and import round trip through the sorter JSON shape and plain text', () => {
  const state = workspaceWith([{ id: 'a', title: 'Alpha', markdown: 'Alpha #one' }, { id: 'b', title: 'Beta', markdown: 'Beta' }])
  const board = { ...state.sorter.boards[0], links: [{ id: 'l', a: 'a', b: 'b', label: 'because', arrow: true }] }
  const notesById = new Map(state.notes.map((note) => [note.id, note]))
  const json = boardToJson(board, notesById)
  assert.equal(json.board.notes[0].text, 'Alpha #one')
  const imported = importBoardText(JSON.stringify(json))
  assert.equal(imported.error, '')
  assert.deepEqual(imported.notes.map((note) => note.markdown), ['Alpha #one', 'Beta'])
  assert.equal(imported.links.length, 1)
  assert.notEqual(imported.notes[0].id, 'a')
  const markdown = boardToMarkdown(board, notesById)
  assert.match(markdown, /## #one/)
  assert.match(markdown, /Alpha → Beta/)
  const plain = importBoardText('first thought\nsecond thought')
  assert.equal(plain.notes.length, 2)
  assert.equal(importBoardText('').error, 'Paste JSON or plain text first.')
  assert.equal(importBoardText('{"nope":1}').error, 'No notes were found in that JSON.')
})

test('an empty or broken document always yields one desk board', () => {
  const doc = normalizeBoardDoc({ boards: [null, { id: 'x', notes: 'nope' }] })
  assert.equal(doc.boards.length, 1)
  assert.equal(doc.boards[0].id, 'x')
  assert.equal(normalizeBoardDoc(undefined).boards[0].id, 'osat-board')
  const state = createDefaultWorkspace()
  assert.equal(reconcileBoards(state).boards[0].scope.kind, 'all')
})
