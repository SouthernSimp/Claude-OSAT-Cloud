import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { folderChildren } from '../src/notes-model.js'
import { nodesOf, pileOf } from '../src/nodes-model.js'
import {
  addCards, CARD, dropCard, freeSpots, groupBox, groupMessages, keywords, memberSpot, MIDDLE, newPile, pilesOf, readGroupAnswer, removeCards,
  sendToSky, settle, splitCard, splitStickies, takeSuggestion, ungroup, updatePile, wordSuggestions, branchName,
} from '../src/pile-model.js'

const space = () => normalizeWorkspace(createDefaultWorkspace())
const overlaps = (a, b) => a.x < b.x + CARD.w && b.x < a.x + CARD.w && a.y < b.y + CARD.h && b.y < a.y + CARD.h
const emptyPile = () => ({ id: 'p', name: '', createdAt: '2026-09-29T00:00:00.000Z', cards: [], groups: [] })
const withCards = (...texts) => addCards(emptyPile(), texts).pile

test('what was typed or pasted becomes stickies: a line each, or a paragraph each when there are blank lines', () => {
  assert.deepEqual(splitStickies('- call mom\n• florist\n3. dentist oct 14\n\n'), ['call mom', 'florist', 'dentist oct 14'])
  assert.deepEqual(splitStickies('Wedding\nflorist and cake\n\nCar\noil change'), ['Wedding\nflorist and cake', 'Car\noil change'])
  assert.deepEqual(splitStickies('   '), [])
  assert.deepEqual(splitStickies('[ ] buy milk\n[x] paid rent'), ['buy milk', 'paid rent'])
})

test('new stickies land around the quick input, never on it and never on each other', () => {
  const pile = withCards(...Array.from({ length: 40 }, (_, i) => `sticky ${i}`))
  const middle = { x: -MIDDLE.w / 2, y: -MIDDLE.h / 2, w: MIDDLE.w, h: MIDDLE.h }
  pile.cards.forEach((card, i) => {
    assert.ok(!(card.x < middle.x + middle.w && middle.x < card.x + CARD.w && card.y < middle.y + middle.h && middle.y < card.y + CARD.h), `card ${i} covers the input`)
    pile.cards.slice(i + 1).forEach((other) => assert.ok(!overlaps(card, other), `${card.text} overlaps ${other.text}`))
  })
  // The first one goes straight above the input.
  assert.ok(pile.cards[0].y < -MIDDLE.h / 2 && Math.abs(pile.cards[0].x + CARD.w / 2) < 2)
  assert.equal(freeSpots(pile, 3).length, 3)
})

test('a sticky dropped on another starts a branch; on a branch it joins; on the table it leaves', () => {
  let pile = withCards('florist', 'venue', 'oil change')
  const [a, b, c] = pile.cards.map((card) => card.id)
  const started = dropCard(pile, a, { kind: 'card', id: b })
  pile = started.pile
  assert.ok(started.started)
  assert.equal(pile.groups.length, 1)
  assert.deepEqual(pile.cards.filter((card) => card.group).map((card) => card.id), [b, a])
  // The branch takes the other sticky's place.
  assert.equal(pile.groups[0].x, withCards('florist', 'venue').cards[1].x)
  pile = dropCard(pile, c, { kind: 'group', id: started.started, before: a }).pile
  assert.deepEqual(pile.cards.filter((card) => card.group).map((card) => card.id), [b, c, a])
  // Dropped on a sticky in a branch, it joins that branch.
  pile = dropCard(pile, c, { kind: 'table', x: 900, y: 40 }).pile
  assert.deepEqual([pile.cards.find((card) => card.id === c).x, pile.cards.find((card) => card.id === c).group], [900, null])
  pile = dropCard(pile, c, { kind: 'card', id: a }).pile
  assert.equal(pile.cards.find((card) => card.id === c).group, started.started)
  // The last sticky out takes the branch with it.
  pile = dropCard(dropCard(dropCard(pile, a, { kind: 'table', x: 0, y: 400 }).pile, b, { kind: 'table', x: 0, y: 600 }).pile, c, { kind: 'table', x: 0, y: 800 }).pile
  assert.equal(pile.groups.length, 0)
})

test('a branch lays its stickies out in rows of three under its name', () => {
  const group = { id: 'g', x: 100, y: 50 }
  assert.equal(groupBox(group, 2).cols, 2)
  assert.equal(groupBox(group, 7).cols, 3)
  const first = memberSpot(group, 0, 7)
  const fourth = memberSpot(group, 3, 7)
  assert.equal(first.x, fourth.x)
  assert.ok(fourth.y > first.y)
})

test('taking stickies away or letting go of a branch never loses the others', () => {
  let pile = withCards('a1', 'b2', 'c3')
  const [a, b, c] = pile.cards.map((card) => card.id)
  const { pile: grouped, started } = dropCard(pile, a, { kind: 'card', id: b })
  pile = ungroup(grouped, started)
  assert.equal(pile.groups.length, 0)
  assert.equal(pile.cards.length, 3)
  assert.ok(pile.cards.every((card) => !card.group))
  pile = removeCards(dropCard(pile, a, { kind: 'card', id: b }).pile, [a, b])
  assert.deepEqual([pile.cards.map((card) => card.id), pile.groups.length], [[c], 0])
})

test('one sticky with several lines splits into one per line', () => {
  const pile = withCards('milk\neggs\nbread')
  const split = splitCard(pile, pile.cards[0].id)
  assert.deepEqual(split.cards.map((card) => card.text), ['milk', 'eggs', 'bread'])
})

test('help without the AI: shared words make a branch, and a branch takes stickies that name it', () => {
  let pile = withCards('Florist for the wedding', 'Wedding cake tasting', 'Oil change for the car', 'Car insurance renewal', 'Call mom')
  const suggestions = wordSuggestions(pile)
  assert.deepEqual(suggestions.map((item) => [item.name, item.cardIds.length]).sort(), [['Car', 2], ['Wedding', 2]])
  pile = takeSuggestion(pile, suggestions.find((item) => item.name === 'Wedding'))
  assert.equal(pile.groups.length, 1)
  assert.equal(branchName(pile, pile.groups[0]), 'Wedding')
  pile = addCards(pile, ['Wedding venue deposit']).pile
  const next = wordSuggestions(pile).find((item) => item.groupId)
  assert.equal(next.name, 'Wedding')
  assert.equal(next.cardIds.length, 1)
  assert.deepEqual(keywords('#N2D the florist\'s bills'), ['n2d', 'florist', 'bill'])
})

test('help with the AI: a forgiving reader, and names that match a branch join it', () => {
  let pile = withCards('florist', 'venue', 'oil change', 'insurance')
  pile = takeSuggestion(pile, { name: 'Wedding', cardIds: [pile.cards[0].id] })
  const messages = groupMessages(pile)
  assert.match(messages[1].content, /1\. venue/)
  assert.match(messages[1].content, /exist already; use one when it fits: Wedding/)
  const found = readGroupAnswer('```\n1: wedding\n2 - Car\n3. **Car**\n9: Nowhere\n1: Other\n```', pile)
  assert.deepEqual(found.map((item) => [item.name, item.cardIds.length, Boolean(item.groupId)]), [['Car', 2, false], ['Wedding', 1, true]])
})

test('piles live apart from the Sky until they are sent', () => {
  let state = space()
  const made = newPile(state, 'Kitchen table')
  state = updatePile(made.state, made.pile.id, (pile) => addCards(pile, ['florist', 'venue', 'oil change', 'call mom']).pile)
  const before = nodesOf(state.folders).length
  assert.equal(pilesOf(state)[0].cards.length, 4)
  // Saved and read back like the rest of the workspace.
  assert.equal(pilesOf(normalizeWorkspace(JSON.parse(JSON.stringify(state))))[0].cards.length, 4)
  state = updatePile(state, made.pile.id, (pile) => {
    const [a, b] = pile.cards
    const next = dropCard(pile, a.id, { kind: 'card', id: b.id })
    return { ...next.pile, groups: next.pile.groups.map((group) => ({ ...group, name: 'Wedding' })) }
  })
  assert.equal(nodesOf(state.folders).length, before)
  const sent = sendToSky(state, made.pile.id, { name: 'Kitchen table', mode: 'one' })
  const node = sent.state.folders.find((folder) => folder.id === sent.nodes[0])
  assert.equal(node.name, 'Kitchen table')
  assert.equal(node.fresh, true)
  assert.deepEqual(folderChildren(sent.state.folders, node.id).map((branch) => branch.name), ['Wedding'])
  assert.equal(pileOf(sent.state.notes, node.id).length, 2)
  assert.equal(pileOf(sent.state.notes, folderChildren(sent.state.folders, node.id)[0].id).length, 2)
  assert.equal(pilesOf(sent.state).length, 0)
  assert.equal(sent.notes.length, 4)
})

test('each branch can go to the Sky as a node of its own, loose stickies to Unsorted', () => {
  let state = space()
  const made = newPile(state)
  state = updatePile(made.state, made.pile.id, (pile) => {
    const filled = addCards(pile, ['florist', 'venue', 'call mom']).pile
    return dropCard(filled, filled.cards[0].id, { kind: 'card', id: filled.cards[1].id }).pile
  })
  const unsorted = pileOf(state.notes, null).length
  const sent = sendToSky(state, made.pile.id, { mode: 'each' })
  assert.equal(sent.nodes.length, 1)
  assert.equal(pileOf(sent.state.notes, sent.nodes[0]).length, 2)
  assert.equal(pileOf(sent.state.notes, null).length, unsorted + 1)
})

test('a branch that grows over loose stickies moves them aside; branches never sit on each other', () => {
  let pile = withCards('a1', 'b2', 'c3', 'd4', 'e5', 'f6')
  const [a, b, c, d] = pile.cards.map((card) => card.id)
  pile = dropCard(pile, a, { kind: 'card', id: b }).pile
  const group = pile.groups[0].id
  pile = dropCard(pile, c, { kind: 'group', id: group }).pile
  pile = dropCard(pile, d, { kind: 'group', id: group }).pile
  const settled = settle(pile)
  const box = groupBox(settled.groups[0], 4)
  settled.cards.filter((card) => !card.group).forEach((card) => {
    assert.ok(!(card.x < box.x + box.w && box.x < card.x + CARD.w && card.y < box.y + box.h && box.y < card.y + CARD.h), `${card.text} is under the branch`)
  })
  // Two branches made on top of each other: the later one moves.
  const two = settle({ ...settled, groups: [...settled.groups, { id: 'g2', name: 'Two', x: settled.groups[0].x, y: settled.groups[0].y }], cards: settled.cards.map((card) => (card.group ? card : { ...card, group: 'g2' })) })
  const [first, second] = two.groups.map((item) => groupBox(item, item.id === 'g2' ? 2 : 4))
  assert.ok(!(first.x < second.x + second.w && second.x < first.x + first.w && first.y < second.y + second.h && second.y < first.y + first.h))
  assert.equal(settle(settle(pile)).cards.length, 6)
})
