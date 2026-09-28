import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import {
  addFolder, addSticky, applySuggestions, folderLinks, linkFolders, linkedWith, moveFolder, moveSticky, nodeFrom, nodesOf,
  parseSortReply, pileOf, rankAt, removeFolder, sortPrompt, suggestBranches, unlinkFolders,
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
