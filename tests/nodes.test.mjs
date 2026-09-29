import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import {
  addFolder, addSticky, applySuggestions, boardSpots, CARD, ensureFolderPath, fileByMentions, filedAs, forgetEmptyFolders, folderLinks, linkFolders, linkedWith, makeRoom, mentionedIn,
  mentionName, moveFolder, moveSticky, nodeFrom, nodesOf, parseMentions, parseSortReply, pileOf, placeNodes, rankAt, removeFolder,
  renameFolder, sortPrompt, suggestBranches, tidyBoard, unlinkFolders,
} from '../src/nodes-model.js'

const at = (minute) => new Date(Date.UTC(2026, 8, 28, 9, minute)).toISOString()
const note = (id, extra = {}) => ({ id, title: id, markdown: id, createdAt: at(1), updatedAt: at(1), ...extra })
const folder = (id, extra = {}) => ({ id, name: id, createdAt: at(1), ...extra })
const space = (notes = [], folders = []) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders })
const titles = (list) => list.map((item) => item.title || item.name)

test('schema 3: folders keep their rank, paper, links and layout; notes their rank, paper and scratch', () => {
  const state = space(
    [note('a', { rank: 5, color: 'sky', kind: 'scratch' }), note('b', { rank: 'high', color: 'plaid' })],
    [folder('x', { rank: 2, color: 'mint', links: ['y', 'y', 'x', 'gone'], layout: 'down' }), folder('y', { layout: 'sideways' })],
  )
  const [x, y] = state.folders
  assert.deepEqual([x.rank, x.color, x.links, x.layout], [2, 'mint', ['y'], 'down'])
  assert.deepEqual(['rank', 'color', 'links', 'layout'].map((key) => key in y), [false, false, false, false])
  const [a, b] = state.notes
  assert.deepEqual([a.rank, a.color, a.kind], [5, 'sky', 'scratch'])
  assert.deepEqual(['rank', 'color'].map((key) => key in b), [false, false], 'nothing is kept that was never set')
  assert.equal(SCHEMA, 3)
  const old = { ...createEmptyDoc(), schema: 2, rev: 4, folders: [folder('x')] }
  assert.deepEqual(migrate(old), { ...old, schema: 3 }, 'schema 2 needs no changes')
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

test('a scratch sticky joins a node and leaves the scratch page; day pages never move', () => {
  let state = space([note('s', { kind: 'scratch' }), { id: 'day-2026-09-28', kind: 'day', date: '2026-09-28', title: 'Today', markdown: '' }], [folder('rnd')])
  assert.deepEqual(pileOf(state.notes, null), [], 'scratch stickies and day pages are in no pile')
  state = moveSticky(state, 's', 'rnd')
  assert.equal(state.notes.find((item) => item.id === 's').kind, null)
  assert.equal(moveSticky(state, 'day-2026-09-28', 'rnd'), state)
})

test('nodes rank left to right, renumber, and become branches when dropped into another', () => {
  let state = space([], [folder('n1', { createdAt: at(1) }), folder('n2', { createdAt: at(2) }), folder('rnd', { createdAt: at(3) })])
  assert.deepEqual(nodesOf(state.folders).map(({ folder: item, number }) => `${number}:${item.name}`), ['1:n1', '2:n2', '3:rnd'])
  state = moveFolder(state, 'rnd', null, 1)
  assert.deepEqual(nodesOf(state.folders).map(({ folder: item, number }) => `${number}:${item.name}`), ['1:n1', '2:rnd', '3:n2'])
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
  assert.equal(addSticky(state, 'down here', null, { kind: 'scratch' }).note.unsorted, false)
  assert.equal(addSticky(state, '   ').note, null)
})

test('removing a node keeps its stickies in Unsorted and drops its links', () => {
  let state = space([note('in-node', { folderId: 'rnd' }), note('in-branch', { folderId: 'ideas' })], [folder('rnd'), folder('ideas', { parentId: 'rnd' }), folder('other', { links: ['rnd'] })])
  state = removeFolder(state, 'rnd')
  assert.deepEqual(state.folders.map((item) => item.id), ['other'])
  assert.equal(state.folders[0].links.length, 0)
  assert.deepEqual(state.notes.map((item) => [item.id, item.folderId, item.unsorted]), [['in-node', null, true], ['in-branch', null, true]])
})

test('links join two nodes once, either way round, and come apart', () => {
  let state = space([], [folder('a'), folder('b'), folder('c')])
  state = linkFolders(state, 'a', 'b')
  assert.equal(linkFolders(state, 'b', 'a'), state, 'already linked')
  assert.equal(linkFolders(state, 'a', 'a'), state)
  state = linkFolders(state, 'c', 'a')
  assert.deepEqual(folderLinks(state.folders), [{ a: 'a', b: 'b' }, { a: 'c', b: 'a' }])
  assert.deepEqual(linkedWith(state.folders, 'a').sort(), ['b', 'c'])
  state = unlinkFolders(state, 'b', 'a')
  assert.deepEqual(linkedWith(state.folders, 'a'), ['c'])
  assert.equal('links' in state.folders[0], false, 'an empty list of links is not kept')
})

test('the scratch page becomes a node, in order', () => {
  let state = space([note('x', { kind: 'scratch' }), note('y', { kind: 'scratch' })])
  const made = nodeFrom(state, ['y', 'x'], 'Evening plan')
  state = made.state
  assert.equal(made.folder.name, 'Evening plan')
  assert.deepEqual(titles(pileOf(state.notes, made.folder.id)), ['y', 'x'])
})

test('sorting help without the AI: a matching #tag first, then shared words', () => {
  const state = space(
    [
      note('idea', { title: 'Sky map glow', markdown: 'Sky map glow #ideas' }),
      note('buy', { title: 'Buy a portable charger', markdown: 'Buy a portable charger' }),
      note('lost', { title: 'Zebra', markdown: 'Zebra' }),
      note('charger', { title: 'Charger list', markdown: 'portable charger options', folderId: 'n2b' }),
    ].map((item) => ({ ...item, folderId: item.folderId || 'rnd' })),
    [folder('rnd'), folder('ideas', { name: 'IDEAS', parentId: 'rnd' }), folder('n2b', { name: 'Need 2 buy', parentId: 'rnd' })],
  )
  // In the pile's order (same time, so by id).
  assert.deepEqual(suggestBranches(state, 'rnd'), [
    { noteId: 'buy', folderId: 'n2b', why: 'words' },
    { noteId: 'idea', folderId: 'ideas', why: 'tag' },
  ])
  assert.deepEqual(suggestBranches(state, 'ideas'), [], 'no branches, no suggestions')
})

test('the AI’s sorting answer is read line by line, forgivingly', () => {
  const branches = [{ id: 'b1', name: 'Ideas' }, { id: 'b2', name: 'Need 2 buy' }]
  const loose = [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }, { id: 's5' }]
  const reply = 'Here you go:\n1 -> 2\n2 → new: "Questions"\n3: none\n4 => new: ideas\n9 -> 1\n1 -> 1\nsticky 5 -> branch 1'
  assert.deepEqual(parseSortReply(reply, branches, loose), [
    { noteId: 's1', folderId: 'b2' },
    { noteId: 's2', branch: 'Questions' },
    { noteId: 's4', folderId: 'b1' },
    { noteId: 's5', folderId: 'b1' },
  ])
  const [system, user] = sortPrompt(branches, [{ id: 's1', title: 'Buy tape', markdown: 'Buy tape' }])
  assert.equal(system.role, 'system')
  assert.match(user.content, /1\. Ideas\n2\. Need 2 buy/)
  assert.match(user.content, /Stickies:\n1\. Buy tape$/)
})

test('accepted suggestions move stickies, making each new branch once', () => {
  let state = space([note('a', { folderId: 'rnd' }), note('b', { folderId: 'rnd' }), note('c', { folderId: 'rnd' })], [folder('rnd'), folder('ideas', { parentId: 'rnd' })])
  state = applySuggestions(state, 'rnd', [{ noteId: 'a', folderId: 'ideas' }, { noteId: 'b', branch: 'Questions' }, { noteId: 'c', branch: 'questions' }])
  const questions = state.folders.find((item) => item.name === 'Questions')
  assert.equal(state.folders.filter((item) => item.parentId === 'rnd').length, 2)
  assert.deepEqual(titles(pileOf(state.notes, questions.id)), ['b', 'c'])
  assert.deepEqual(titles(pileOf(state.notes, 'ideas')), ['a'])
})

test('@ in a note: the longest node name wins, a branch after a slash, a new word is a node to make', () => {
  const folders = [folder('g', { name: 'Garden' }), folder('p', { name: 'Project Direction' }), folder('i', { name: 'Ideas', parentId: 'g' })]
  const found = parseMentions('see @Project Direction, @garden/ideas and @Gardening; mail x@y.com, @3, @Garden/New, @Garden again @garden', folders)
  assert.deepEqual(found.map(({ folderId, missing }) => [folderId, missing]), [['p', []], ['i', []], [null, ['Gardening']], ['g', ['New']], ['g', []]])
  assert.equal(mentionName(folders, found[1]), 'Garden › Ideas')
  assert.equal(mentionName(folders, found[3]), 'Garden › New')
  assert.deepEqual(parseMentions('no mentions here, a@b.c, (@Garden)', folders).map((item) => item.folderId), ['g'])
})

test('@ files a note: the first new @ is its home, a new name makes the node, old mentions do nothing', () => {
  let state = space([note('n', { markdown: 'buy seeds' })], [folder('g', { name: 'Garden' })])
  assert.equal(fileByMentions(state, 'n'), state, 'no @, nothing changes')
  state = { ...state, notes: state.notes.map((item) => ({ ...item, markdown: 'buy seeds @Garden and @Shopping' })) }
  state = fileByMentions(state, 'n')
  const shopping = state.folders.find((item) => item.name === 'Shopping')
  assert.ok(shopping && !shopping.parentId, 'the new name became a node')
  const filed = state.notes.find((item) => item.id === 'n')
  assert.deepEqual([filed.folderId, filed.unsorted], ['g', false])
  assert.deepEqual(mentionedIn(state).get(shopping.id)?.map((item) => item.id), ['n'], 'the second @ links it')
  assert.equal(mentionedIn(state).has('g'), false, 'its own node does not list it twice')
  // Dragged somewhere else, editing words around the same @s doesn't pull it back.
  state = moveSticky(state, 'n', shopping.id)
  const before = state.notes[0].markdown
  state = { ...state, notes: state.notes.map((item) => ({ ...item, markdown: `${item.markdown}!` })) }
  assert.equal(fileByMentions(state, 'n', before).notes[0].folderId, shopping.id)
})

test('@ on a new sticky files it, even from the desk or the scratch page; a day page never moves', () => {
  const base = space([], [folder('g', { name: 'Garden' })])
  const desk = addSticky(base, 'water the roses @Garden', null, { source: 'Desk' })
  assert.deepEqual([desk.note.folderId, desk.note.unsorted], ['g', false])
  const scratch = addSticky(base, 'tomatoes @Garden', null, { kind: 'scratch' })
  assert.deepEqual([scratch.note.folderId, scratch.note.kind], ['g', null])
  const day = space([note('day-2026-09-28', { kind: 'day', date: '2026-09-28', markdown: 'walked @Garden' })], [folder('g', { name: 'Garden' })])
  assert.equal(fileByMentions(day, 'day-2026-09-28').notes[0].folderId ?? null, null)
  assert.deepEqual(mentionedIn(day).get('g')?.map((item) => item.id), ['day-2026-09-28'])
})

test('Undo after an @: the note goes back and the nodes it made go again, unless used since', () => {
  const before = space([], [folder('g', { name: 'Garden' })])
  const { state, note: made } = addSticky(before, 'seeds @Garden @Mom @Shops', null, { source: 'Home' })
  const filing = filedAs(before, state, made.id)
  assert.equal(filing.where, 'Garden')
  assert.equal(filing.made.length, 2)
  const shops = state.folders.find((item) => item.name === 'Shops')
  const used = addSticky(state, 'milk', shops.id).state
  const undone = forgetEmptyFolders(moveSticky(used, made.id, null), filing.made)
  assert.deepEqual(undone.folders.map((item) => item.name).sort(), ['Garden', 'Shops'])
  assert.equal(filedAs(state, state, made.id).where, null, 'nothing moved, nowhere to say')
})

test('a picked "New node" path is made once, reusing what is there', () => {
  const base = space([], [folder('g', { name: 'Garden' })])
  const { state, folder: made } = ensureFolderPath(base, ' garden / Big ideas ')
  assert.deepEqual([made.name, made.parentId, state.folders.length], ['Big ideas', 'g', 2])
  assert.equal(ensureFolderPath(state, 'Garden/big ideas').state, state)
})

test('renaming a node rewrites its @mentions, branches included', () => {
  let state = space(
    [note('a', { markdown: 'see @garden/Ideas and @Garden. not @Gardening, not x@Garden' })],
    [folder('g', { name: 'Garden' }), folder('i', { name: 'Ideas', parentId: 'g' })],
  )
  state = renameFolder(state, 'g', 'Yard')
  assert.equal(state.notes[0].markdown, 'see @Yard/Ideas and @Yard. not @Gardening, not x@Garden')
  state = renameFolder(state, 'i', 'Big ideas')
  assert.equal(state.notes[0].markdown, 'see @Yard/Big ideas and @Yard. not @Gardening, not x@Garden')
  assert.deepEqual(parseMentions(state.notes[0].markdown, state.folders).map((item) => item.folderId), ['i', 'g', null])
  assert.equal(renameFolder(state, 'g', '  '), state, 'an empty name changes nothing')
})

test('the board: unplaced nodes line up after the others, Unsorted waits on the left', () => {
  const folders = space([], [folder('a', { rank: 1 }), folder('b', { rank: 2, at: { x: 900, y: 300 } }), folder('c', { rank: 3 })]).folders
  const spots = boardSpots(folders, new Map([['a', { w: 500, h: 400 }]]))
  assert.deepEqual(spots.get('a'), { x: 0, y: 0 })
  assert.deepEqual(spots.get('b'), { x: 900, y: 300 })
  assert.deepEqual(spots.get('c'), { x: 900 + CARD.w + CARD.gap, y: 0 })
  assert.deepEqual(spots.get(null), { x: -CARD.w - CARD.gap, y: 0 })
})

test('the board: moving a node keeps every other one where it shows, and the numbers follow left to right', () => {
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
