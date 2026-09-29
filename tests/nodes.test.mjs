import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import {
  addFolder, addSticky, boardSpots, CARD, findMentions, freeNodeName, importNode, linkMentions, makeRoom, mentionedIn, moveFolder, moveSticky, moveToItems,
  nodesMentioned, nodesOf, pileOf, placeNodes, rankAt, removeFolder, renameFolder, splitMentions, suggestBranches, suggestionGroups, tidyBoard,
} from '../src/nodes-model.js'

const at = (minute) => new Date(Date.UTC(2026, 8, 28, 9, minute)).toISOString()
const note = (id, extra = {}) => ({ id, title: id, markdown: id, createdAt: at(1), updatedAt: at(1), ...extra })
const folder = (id, extra = {}) => ({ id, name: id, createdAt: at(1), ...extra })
const space = (notes = [], folders = []) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders })
const titles = (list) => list.map((item) => item.title || item.name)

test('schema 3: folders keep their rank, paper, links and layout; notes their rank and paper', () => {
  const state = space(
    [note('a', { rank: 5, color: 'sky', kind: 'scratch' }), note('b', { rank: 'high', color: 'plaid' })],
    [folder('x', { rank: 2, color: 'mint', links: ['y', 'y', 'x', 'gone'], layout: 'down' }), folder('y', { layout: 'sideways' })],
  )
  const [x, y] = state.folders
  assert.deepEqual([x.rank, x.color, x.links, x.layout], [2, 'mint', ['y'], 'down'])
  assert.deepEqual(['rank', 'color', 'links', 'layout'].map((key) => key in y), [false, false, false, false])
  const [a, b] = state.notes
  assert.deepEqual([a.rank, a.color, a.kind], [5, 'sky', null], 'the scratch page is gone (schema 5)')
  assert.deepEqual(['rank', 'color'].map((key) => key in b), [false, false], 'nothing is kept that was never set')
  const old = { ...createEmptyDoc(), schema: 2, rev: 4, folders: [folder('x')] }
  assert.deepEqual(migrate(old), { ...old, schema: SCHEMA }, 'with no projects, nothing changes')
})

test('ranks: first, last, between, and a fresh spacing when there is no room left', () => {
  assert.deepEqual(rankAt([], 0), { rank: 1024 })
  const list = [{ id: 'a', rank: 10 }, { id: 'b', rank: 20 }]
  assert.equal(rankAt(list, 0).rank, 10 - 1024)
  assert.equal(rankAt(list, 2).rank, 20 + 1024)
  assert.equal(rankAt(list).rank, 20 + 1024, 'the end when no index is given')
  assert.equal(rankAt(list, 1).rank, 15)
  const tight = [{ id: 'a', rank: 1 }, { id: 'b', rank: 1 + Number.EPSILON }]
  const spaced = rankAt(tight, 1)
  assert.deepEqual(spaced.renumber, [{ id: 'a', rank: 1024 }, { id: 'b', rank: 3072 }])
  assert.equal(spaced.rank, 2048)
})

test('stickies move into a node at a place, and back to Unsorted', () => {
  let state = space([note('one', { unsorted: true }), note('two'), note('three')], [folder('rnd')])
  state = moveSticky(state, 'two', 'rnd')
  state = moveSticky(state, 'three', 'rnd')
  state = moveSticky(state, 'one', 'rnd', 1)
  assert.deepEqual(titles(pileOf(state.notes, 'rnd')), ['two', 'one', 'three'])
  assert.equal(state.notes.find((item) => item.id === 'one').unsorted, false, 'filing clears Unsorted')
  state = moveSticky(state, 'one', null)
  assert.deepEqual(titles(pileOf(state.notes, null)), ['one'])
  assert.equal(state.notes.find((item) => item.id === 'one').unsorted, true)
  assert.equal(moveSticky(state, 'one', 'missing').notes.find((item) => item.id === 'one').folderId, null, 'an unknown folder is Unsorted')
})

test('day pages are in no pile and never move', () => {
  const state = space([{ id: 'day-2026-09-28', kind: 'day', date: '2026-09-28', title: 'Today', markdown: '' }], [folder('rnd')])
  assert.deepEqual(pileOf(state.notes, null), [])
  assert.equal(moveSticky(state, 'day-2026-09-28', 'rnd'), state)
})

test('nodes rank left to right and become branches when dropped into another', () => {
  let state = space([], [folder('n1', { createdAt: at(1) }), folder('n2', { createdAt: at(2) }), folder('rnd', { createdAt: at(3) })])
  assert.deepEqual(nodesOf(state.folders).map(({ folder: item }) => item.name), ['n1', 'n2', 'rnd'])
  state = moveFolder(state, 'rnd', null, 1)
  assert.deepEqual(nodesOf(state.folders).map(({ folder: item }) => item.name), ['n1', 'rnd', 'n2'])
  state = moveFolder(state, 'n2', 'rnd')
  assert.deepEqual(nodesOf(state.folders).map(({ folder: item }) => item.name), ['n1', 'rnd'])
  assert.equal(state.folders.find((item) => item.id === 'n2').parentId, 'rnd')
  assert.equal(moveFolder(state, 'rnd', 'n2'), state, 'a node can’t go inside its own branch')
})

test('new nodes, branches and stickies take their place', () => {
  let state = space([], [folder('a')])
  let made = addFolder(state, 'First', null, 0)
  state = made.state
  assert.deepEqual(nodesOf(state.folders).map(({ folder: item }) => item.name), ['First', 'a'])
  made = addFolder(state, '  #IDEAS  ', 'a')
  state = made.state
  assert.equal(made.folder.parentId, 'a')
  assert.equal(made.folder.name, '#IDEAS')
  assert.equal(addFolder(state, '   ').folder, null)
  const first = addSticky(state, 'Get a charger\nfor Shawna', made.folder.id)
  const second = addSticky(first.state, 'Budget tonight', made.folder.id, { index: 0 })
  assert.equal(first.note.title, 'Get a charger')
  assert.equal(first.note.unsorted, false)
  assert.deepEqual(titles(pileOf(second.state.notes, made.folder.id)), ['Budget tonight', 'Get a charger'])
  assert.equal(addSticky(state, 'loose').note.unsorted, true)
  assert.equal(addSticky(state, '   ').note, null)
})

test('removing a node keeps its stickies in Unsorted and drops its links', () => {
  let state = space([note('in-node', { folderId: 'rnd' }), note('in-branch', { folderId: 'ideas' })], [folder('rnd'), folder('ideas', { parentId: 'rnd' }), folder('other', { links: ['rnd'] })])
  state = removeFolder(state, 'rnd')
  assert.deepEqual(state.folders.map((item) => item.id), ['other'])
  assert.equal(state.folders[0].links.length, 0)
  assert.deepEqual(state.notes.map((item) => [item.id, item.folderId, item.unsorted]), [['in-node', null, true], ['in-branch', null, true]])
})

test('Move to: Unsorted, then each node with its branches, leaving out where it is', () => {
  const folders = space([], [folder('g', { name: 'Garden', rank: 1 }), folder('i', { name: 'Ideas', parentId: 'g' }), folder('w', { name: 'Work', rank: 2 })]).folders
  const picked = []
  const items = moveToItems(folders, (id) => picked.push(id), { skip: 'w' })
  assert.deepEqual(items.map((item) => item.label), ['Unsorted', 'Garden', '↳ Ideas'])
  items[2].onSelect()
  assert.deepEqual(picked, ['i'])
  assert.deepEqual(moveToItems(folders, () => {}, { skip: null }).map((item) => item.label), ['Garden', '↳ Ideas', 'Work'], 'already in Unsorted')
  assert.deepEqual(moveToItems([], () => {}, { unsorted: false }), [{ note: 'No nodes yet.' }])
})

test('Help me sort: a matching #tag first, then shared words, one line per branch', () => {
  const state = space(
    [
      note('idea', { title: 'Sky map glow', markdown: 'Sky map glow #ideas' }),
      note('buy', { title: 'Buy a portable charger', markdown: 'Buy a portable charger' }),
      note('lost', { title: 'Zebra', markdown: 'Zebra' }),
      note('charger', { title: 'Charger list', markdown: 'portable charger options', folderId: 'n2b' }),
    ].map((item) => ({ ...item, folderId: item.folderId || 'rnd' })),
    [folder('rnd'), folder('ideas', { name: 'IDEAS', parentId: 'rnd', rank: 1 }), folder('n2b', { name: 'Need 2 buy', parentId: 'rnd', rank: 2 })],
  )
  // In the pile's order (same time, so by id).
  assert.deepEqual(suggestBranches(state, 'rnd'), [
    { noteId: 'buy', folderId: 'n2b' },
    { noteId: 'idea', folderId: 'ideas' },
  ])
  assert.deepEqual(suggestionGroups(state, 'rnd'), [{ folderId: 'ideas', noteIds: ['idea'] }, { folderId: 'n2b', noteIds: ['buy'] }])
  assert.deepEqual(suggestBranches(state, 'ideas'), [], 'no branches, no suggestions')
})

test('@ in a note: the longest node name wins, a branch after a slash, emails and unknown names are only words', () => {
  const folders = [folder('g', { name: 'Garden' }), folder('p', { name: 'Project Direction' }), folder('i', { name: 'Ideas', parentId: 'g' })]
  const text = 'see @Project Direction, @garden/ideas and @Gardening; mail x@y.com, @3, @Garden/New, (@Garden)'
  assert.deepEqual(findMentions(text, folders).map(({ folderId, name }) => [folderId, name]), [['p', 'project direction'], ['i', 'garden/ideas'], ['g', 'garden'], ['g', 'garden']])
  assert.deepEqual(nodesMentioned({ markdown: text }, folders), ['p', 'i', 'g'])
  assert.deepEqual(splitMentions('go @Garden now', folders), ['go ', { folderId: 'g', text: '@Garden' }, ' now'])
  assert.deepEqual(splitMentions('no @Gardn here', folders), ['no @Gardn here'])
})

test('@ only links: nothing is filed, nothing is made from a typo, and the note remembers the node by id', () => {
  const base = space([], [folder('g', { name: 'Garden' })])
  const { state, note: made } = addSticky(base, 'water the roses @Garden and @Gardn', null, { source: 'Desk' })
  assert.deepEqual([made.folderId, made.unsorted], [null, true], 'still in Unsorted')
  assert.equal(state.folders.length, 1, 'no node from a typo')
  assert.deepEqual(made.refs, { garden: 'g' })
  assert.deepEqual(mentionedIn(state).get('g')?.map((item) => item.id), [made.id])
  assert.equal(linkMentions(state, made.id), state, 'nothing new, nothing changes')
  const filed = moveSticky(state, made.id, 'g')
  assert.equal(mentionedIn(filed).has('g'), false, 'its own node does not list it twice')
  const day = space([note('day-2026-09-28', { kind: 'day', date: '2026-09-28', markdown: 'walked @Garden' })], [folder('g', { name: 'Garden' })])
  assert.deepEqual(mentionedIn(day).get('g')?.map((item) => item.id), ['day-2026-09-28'])
})

test('renaming a node changes no words, and its @mentions still point at it', () => {
  let state = space([note('a', { markdown: 'see @Garden/Ideas and @Garden. not @Gardening, not x@Garden' })], [folder('g', { name: 'Garden' }), folder('i', { name: 'Ideas', parentId: 'g' })])
  state = linkMentions(state, 'a')
  state = renameFolder(state, 'g', 'Yard')
  assert.equal(state.notes[0].markdown, 'see @Garden/Ideas and @Garden. not @Gardening, not x@Garden')
  assert.deepEqual(nodesMentioned(state.notes[0], state.folders), ['i', 'g'])
  // A new node called Garden doesn't take the old words away from Yard.
  state = addFolder(state, 'Garden').state
  assert.deepEqual(nodesMentioned(state.notes[0], state.folders), ['i', 'g'])
  assert.equal(renameFolder(state, 'g', '  '), state, 'an empty name changes nothing')
  const stored = normalizeWorkspace(state).notes[0]
  assert.deepEqual(stored.refs, { 'garden/ideas': 'i', garden: 'g' }, 'refs are kept when the workspace is loaded')
})

test('Import: one file is one new node, with branches, stickies and finished steps; a taken name gets a number', () => {
  const file = {
    title: 'Garden',
    summary: 'What grows where.',
    branches: [
      { title: 'Beds', leaves: [{ text: 'Tomatoes', done: false }, { text: 'Dig the bed', done: true }], sub_branches: [{ title: 'Herbs', leaves: [{ text: 'Basil' }] }] },
      { title: 'Tools', summary: 'In the shed.', leaves: [] },
      { title: '', leaves: [{ text: 'no name, skipped' }] },
    ],
  }
  const base = space([], [folder('g', { name: 'Garden' })])
  const { state, folder: made, branches } = importNode(base, file)
  assert.deepEqual([made.name, made.parentId, branches], ['Garden 2', null, 3])
  assert.equal(state.folders.find((item) => item.id === 'g').name, 'Garden', 'the old node is untouched')
  const beds = state.folders.find((item) => item.name === 'Beds')
  const herbs = state.folders.find((item) => item.name === 'Herbs')
  assert.equal(herbs.parentId, beds.id)
  assert.deepEqual(pileOf(state.notes, made.id).map((item) => item.markdown), ['What grows where.'])
  assert.deepEqual(pileOf(state.notes, beds.id).map((item) => item.markdown), ['Tomatoes', '- [x] Dig the bed'])
  assert.deepEqual(pileOf(state.notes, herbs.id).map((item) => item.markdown), ['Basil'])
  assert.ok(state.notes.every((item) => !item.unsorted && !item.color && item.source === 'Import'))
  assert.equal(freeNodeName(state.folders, 'garden'), 'garden 3')
  assert.throws(() => importNode(base, { branches: [] }), /node file/)
  assert.throws(() => importNode(base, { title: 'X', branches: 'no' }), /node file/)
})

test('the board: unplaced nodes line up after the others, Unsorted waits on the left', () => {
  const folders = space([], [folder('a', { rank: 1 }), folder('b', { rank: 2, at: { x: 900, y: 300 } }), folder('c', { rank: 3 })]).folders
  const spots = boardSpots(folders, new Map([['a', { w: 500, h: 400 }]]))
  assert.deepEqual(spots.get('a'), { x: 0, y: 0 })
  assert.deepEqual(spots.get('b'), { x: 900, y: 300 })
  assert.deepEqual(spots.get('c'), { x: 900 + CARD.w + CARD.gap, y: 0 })
  assert.deepEqual(spots.get(null), { x: -CARD.w - CARD.gap, y: 0 })
})

test('the board: moving a node keeps every other one where it shows, and the order follows left to right', () => {
  let state = space([], [folder('a', { rank: 1 }), folder('b', { rank: 2 }), folder('c', { rank: 3 })])
  const spots = boardSpots(state.folders)
  state = placeNodes(state, spots, new Map([['c', { x: -700.4, y: 120 }]]))
  assert.deepEqual(titles(nodesOf(state.folders).map(({ folder: item }) => item)), ['c', 'a', 'b'])
  assert.deepEqual(state.folders.find((item) => item.id === 'c').at, { x: -700, y: 120 })
  assert.deepEqual(state.folders.find((item) => item.id === 'b').at, spots.get('b'))
  const same = placeNodes(state, boardSpots(state.folders), new Map())
  assert.ok(same.folders.every((item, index) => item === state.folders[index]), 'nothing moved, nothing changes')
  assert.ok(tidyBoard(state).folders.every((item) => !('at' in item)))
  const normalized = space([], [folder('x', { at: { x: 1.6, y: Infinity } }), folder('y', { at: { x: 2e9, y: -3.2 } })]).folders
  assert.deepEqual(normalized.map((item) => item.at), [undefined, { x: 1e6, y: -3 }])
})

test('the board: a node that opens pushes the cards it covers to the right, and those they cover', () => {
  const boxes = new Map([
    ['a', { x: 0, y: 0, w: 600, h: 400 }],
    ['b', { x: 300, y: 0, w: 240, h: 150 }],
    ['c', { x: 620, y: 20, w: 240, h: 150 }],
    ['d', { x: 0, y: 900, w: 240, h: 150 }],
    ['e', { x: -500, y: 0, w: 240, h: 150 }],
  ])
  const moved = makeRoom(boxes, 'a', 40)
  assert.deepEqual(moved.get('b'), { x: 640, y: 0 })
  assert.deepEqual(moved.get('c'), { x: 920, y: 20 })
  assert.equal(moved.has('d') || moved.has('e'), false, 'far below and to the left stay put')
})
