import assert from 'node:assert/strict'
import test from 'node:test'

import { readSortUnsortedAnswer, sortUnsortedMessages } from '../shared/ai-tasks.mjs'
import { pileOf } from '../src/nodes-model.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import {
  asksToSort, BATCH, modelSuggestions, sortGroups, sortPlaces, sortRequests, stillToSort, unsortedStickies, wordNodes, wordSuggestions,
} from '../src/sky/sort-unsorted.js'
import { fileUnsorted, undoFiling } from '../src/sky/sort-review.js'

// What Unsorted's sorter does with a group: the same filing as one sticky.
const applyGroup = (state, group) => fileUnsorted(state, group.noteIds, group.kind === 'make' ? null : group.folderId, group.kind === 'make' ? group.name : '')

const at = (minute) => new Date(Date.UTC(2026, 8, 29, 9, minute)).toISOString()
const sticky = (id, text, extra = {}) => ({ id, title: text, markdown: text, tags: [], createdAt: at(1), updatedAt: at(1), ...extra })
const folder = (id, name, extra = {}) => ({ id, name, createdAt: at(1), ...extra })
const space = (notes, folders) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders })

const state = space([
  sticky('a', 'Dark mode for the desk'),
  sticky('b', 'Export a node as Markdown'),
  sticky('c', 'Buy cat litter'),
  sticky('d', 'Cat vet on Friday'),
  sticky('e', 'Cats need new toys'),
  sticky('f', 'Tomatoes need water', { tags: ['garden'] }),
  sticky('g', 'Call the landlord'),
  sticky('in-features', 'Sync between two Macs', { folderId: 'features' }),
  sticky('in-ideas', 'Dark theme colours', { folderId: 'ideas' }),
], [
  folder('features', 'Features', { rank: 1 }),
  folder('ideas', 'Ideas', { parentId: 'features', rank: 1 }),
  folder('garden', 'Garden', { rank: 2 }),
])

test('the places are the nodes and then the branches in them, each with a couple of examples', () => {
  const places = sortPlaces(state)
  assert.deepEqual(places.map((place) => place.name), ['Features', 'Features / Ideas', 'Garden'])
  assert.deepEqual(places[0].peek, ['Sync between two Macs'])
  assert.deepEqual(unsortedStickies(state).map((note) => note.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  const free = { ...state, notes: state.notes.map((note) => (note.id === 'g' ? { ...note, at: { x: 1, y: 2 } } : note)) }
  assert.ok(!unsortedStickies(free).some((note) => note.id === 'g'), 'a sticky set free on the Sky is not sorted again')
})

test('the question lists the places and the stickies, and stays a few at a time', () => {
  const { places, batches } = sortRequests(state)
  assert.equal(places.length, 3)
  assert.equal(batches.length, 1)
  const words = batches[0].messages.at(-1).content
  assert.match(words, /2\. Features \/ Ideas \(has: Dark theme colours\)/)
  assert.match(words, /3\. Buy cat litter/)
  assert.match(words, /new: Cats/)
  const many = space(Array.from({ length: BATCH * 2 + 1 }, (_, index) => sticky(`n${index}`, `Thought ${index}`)), [])
  assert.deepEqual(sortRequests(many).batches.map((batch) => batch.from), [0, BATCH, BATCH * 2])
  const hundred = space(Array.from({ length: 100 }, (_, index) => sticky(`h${index}`, `Thought ${index}`)), [])
  assert.equal(unsortedStickies(hundred).length, 100, 'a pile of a hundred is sorted in one go')
  assert.equal(sortRequests(hundred).batches.length, 5)
  assert.match(sortRequests(many).batches[0].messages.at(-1).content, /\(none yet\)/)
})

test('the reader takes numbers, names and new names, forgivingly', () => {
  const names = ['Features', 'Features / Ideas', 'Garden']
  const read = readSortUnsortedAnswer('Here is the answer:\n```\n1: 2\n2. new: Cats\n3 -> New node: cats\n4: none\n5: Garden\n6: 9\n7: new: Solo\n8: 2\n9: Place 1\n```', names, 9)
  assert.deepEqual(read.homes, [{ sticky: 0, place: 1 }, { sticky: 4, place: 2 }, { sticky: 7, place: 1 }, { sticky: 8, place: 0 }])
  assert.deepEqual(read.made, [{ name: 'Cats', stickies: [1, 2] }], 'one sticky alone is never a node; a number that does not exist is nothing')
  assert.deepEqual(readSortUnsortedAnswer('1: 1\n1: 2\n0: 1\n99: 1', names, 2).homes, [{ sticky: 0, place: 0 }], 'each sticky once, only the ones that exist')
  assert.deepEqual(readSortUnsortedAnswer('no idea, sorry', names, 3), { homes: [], made: [] })
  assert.deepEqual(readSortUnsortedAnswer('1: new: Garden\n2: new: features', names, 2).homes, [{ sticky: 0, place: 2 }, { sticky: 1, place: 0 }], 'a "new" name that is a place is that place')
  assert.equal(sortUnsortedMessages({ places: [], stickies: ['x'] })[0].role, 'system')
})

test('without a model, words and #tags place stickies and gather new nodes', () => {
  const groups = wordSuggestions(state)
  const move = (folderId) => groups.find((group) => group.kind === 'move' && group.folderId === folderId)?.noteIds
  assert.deepEqual(move('garden'), ['f'], 'a #tag naming a node')
  assert.ok(move('ideas')?.includes('a') || move('features')?.includes('a'), 'dark mode goes with the dark theme')
  const made = groups.find((group) => group.kind === 'make')
  assert.equal(made?.name, 'Cat', 'three stickies about cats could be a node')
  assert.deepEqual(made.noteIds.sort(), ['c', 'd', 'e'])
  assert.ok(!groups.some((group) => group.noteIds.includes('g')), 'nothing fits the landlord: it stays where it is')
  assert.ok(groups.every((group) => group.kind !== 'make' || group.noteIds.length > 1), 'a single leftover never becomes a node')
})

test('a tag on two stickies is a new node; a common word never is', () => {
  const notes = [sticky('x', 'Buy a tent', { tags: ['camping'] }), sticky('y', 'Stove gas', { tags: ['camping'] }), sticky('z', 'Call mom'), sticky('w', 'Call dad'), sticky('v', 'Call the bank')]
  assert.deepEqual(wordNodes(notes), [{ name: 'Camping', noteIds: ['x', 'y'] }])
})

test('the model’s answers are read per batch, and words place what it left', () => {
  const { places } = sortRequests(state)
  const stickies = unsortedStickies(state)
  // 1 Dark mode → Ideas (2), 2 Export → Features (1), 3–5 cats → a new node, 6 none, 7 none
  const answer = '1: 2\n2: 1\n3: new: Cats\n4: new: Cats\n5: new: Cats\n6: none\n7: none'
  const groups = modelSuggestions(state, stickies, places, [{ from: 0, text: answer }])
  assert.deepEqual(groups.map((group) => group.key), ['move:ideas', 'move:features', 'move:garden', 'make:cats'])
  assert.deepEqual(groups.find((group) => group.key === 'make:cats').noteIds, ['c', 'd', 'e'])
  assert.deepEqual(groups.find((group) => group.key === 'move:garden').noteIds, ['f'], 'the tomatoes were left, and their #tag places them')
  // A model that only chatters places nothing itself, so the words do all of it.
  const chatter = modelSuggestions(state, stickies, places, [{ from: 0, text: 'Sure! I would love to help.' }])
  assert.deepEqual(chatter.map((group) => group.key).sort(), wordSuggestions(state).map((group) => group.key).sort())
})

test('a suggestion moves its stickies to the end of the place, and one Undo takes it back', () => {
  const [move] = sortGroups({ homes: [{ noteId: 'a', folderId: 'ideas' }, { noteId: 'b', folderId: 'ideas' }] })
  const done = applyGroup(state, move)
  assert.deepEqual(pileOf(done.state.notes, 'ideas').map((note) => note.id), ['in-ideas', 'a', 'b'])
  assert.equal(done.made, null)
  assert.equal(done.state.notes.find((note) => note.id === 'a').unsorted, false)
  const back = undoFiling(done.state, done.changes, []).state
  assert.deepEqual(pileOf(back.notes, null).map((note) => note.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
  assert.deepEqual(pileOf(back.notes, 'ideas').map((note) => note.id), ['in-ideas'])
})

test('Make it makes the node and moves the stickies into it; Undo removes the node again', () => {
  const [make] = sortGroups({ made: [{ name: 'Cats', noteIds: ['c', 'd', 'e'] }] })
  const done = applyGroup(state, make)
  assert.ok(done.made)
  const node = done.state.folders.find((item) => item.id === done.made)
  assert.deepEqual([node.name, node.parentId], ['Cats', null])
  assert.deepEqual(pileOf(done.state.notes, done.made).map((note) => note.id).sort(), ['c', 'd', 'e'])
  const again = applyGroup(done.state, { ...make, name: 'cats', noteIds: ['g'] })
  assert.equal(again.made, null, 'a node of that name is used, not made twice')
  assert.equal(again.folderId, done.made)
  const back = undoFiling(done.state, done.changes, [done.made]).state
  assert.equal(back.folders.length, state.folders.length)
  assert.deepEqual(pileOf(back.notes, null).map((note) => note.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
})

test('what is still to sort: only stickies still in Unsorted, and a new node needs two', () => {
  const groups = sortGroups({ homes: [{ noteId: 'a', folderId: 'ideas' }], made: [{ name: 'Cats', noteIds: ['c', 'd'] }] })
  const moved = applyGroup(state, { kind: 'move', folderId: 'ideas', noteIds: ['c'] }).state
  assert.deepEqual(stillToSort(groups, moved).map((group) => [group.key, group.noteIds]), [['move:ideas', ['a']]])
  assert.deepEqual(stillToSort(groups, state).map((group) => group.key), ['move:ideas', 'make:cats'])
})

test('"sort these" is a request to sort, and a question about sorting is still a question', () => {
  for (const yes of ['sort these', 'Sort my unsorted stickies', 'can you sort them?', 'Please sort out the mess', 'help me sort everything!']) assert.equal(asksToSort(yes), true, yes)
  for (const no of ['sort of a hard question', 'how do I sort my closet', 'what should I sort first', 'Sorting hat', '', undefined]) assert.equal(asksToSort(no), false, String(no))
})
