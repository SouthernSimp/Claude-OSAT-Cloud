import assert from 'node:assert/strict'
import test from 'node:test'

import { asksAboutPlan, boardMap, OSAT_GUIDE, planLines } from '../src/assistant/board-context.js'
import { systemPrompt } from '../src/assistant/actions.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const at = new Date(Date.UTC(2026, 8, 28, 9, 0)).toISOString()
const note = (id, extra = {}) => ({ id, title: id, markdown: id, createdAt: at, updatedAt: at, ...extra })
const folder = (id, extra = {}) => ({ id, name: id, createdAt: at, ...extra })
const space = (notes = [], folders = [], extra = {}) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders, ...extra })
const NOW = new Date(2026, 8, 29, 9, 0)

test('the map names the nodes, their branches, and what waits in Unsorted', () => {
  const state = space(
    [note('Call mom', { unsorted: true }), note('Buy stamps', { folderId: 'wed' }), note('Cake tasting', { folderId: 'cake' }), note('Deleted one', { unsorted: true, trashedAt: at })],
    [folder('wed', { name: 'Wedding' }), folder('cake', { name: 'Cake', parentId: 'wed' })],
  )
  const map = boardMap(state, { now: NOW })
  assert.match(map, /Unsorted \(1 sticky, in no node yet\):\n- Call mom/)
  assert.doesNotMatch(map, /Deleted one/, 'the Trash stays out of it')
  assert.match(map, /- Wedding \(2 stickies\), branches: Cake \(1\); 1 sticky in no branch yet/)
  assert.match(map, /^THEIR OSAT\n/)
})

test('in the Sky it says so, and lists what is open there, branch by branch', () => {
  const state = space(
    [note('Buy stamps', { folderId: 'wed' }), note('Cake tasting', { folderId: 'cake' })],
    [folder('wed', { name: 'Wedding' }), folder('cake', { name: 'Cake', parentId: 'wed' })],
  )
  const map = boardMap(state, { open: ['wed', 'cake', 'missing'], where: 'sky', now: NOW })
  assert.match(map, /looking at the Sky right now/)
  assert.match(map, /Open in the Sky: Wedding\n {2}- Buy stamps\n {2}Cake:\n {2}- Cake tasting/)
  assert.doesNotMatch(map, /Open in the Sky: Cake/, 'a branch is not a node: only nodes open')
})

test('connections and the desk\'s stacks are named; a line to a sticky in the Bin is not', () => {
  const state = space(
    [note('Call Tommy', { folderId: 'cl', links: ['note:Bag'] }), note('Bag', { folderId: 'cl' }), note('Old one', { unsorted: true, trashedAt: at, links: ['note:Bag'] }), note('Eggs', { unsorted: true }), note('Milk', { unsorted: true })],
    [folder('cl', { name: 'Clients', links: ['note:Eggs'] })],
  )
  const map = boardMap(state, { now: NOW, stacks: [{ name: 'Groceries', titles: ['Eggs', 'Milk'] }, { name: '', titles: ['Bag'] }] })
  assert.match(map, /Connected \(a line between two things; nothing was filed by it\):\n- Call Tommy — Bag\n- Clients — Eggs/)
  assert.doesNotMatch(map, /Old one —|— Old one/)
  assert.match(map, /Stacks on the desk[^\n]*:\n- Groceries: Eggs · Milk\n- A stack: Bag/)
  assert.doesNotMatch(boardMap(space([note('a')]), { now: NOW }), /Connected|Stacks on the desk/, 'nothing to say, nothing said')
})

test('the guide teaches the mind map, connections, stacks and the Mac tools', () => {
  for (const words of [/mind map/, /connection/, /never files or moves/, /stack/, /quick search/, /the ring/]) assert.match(OSAT_GUIDE, words)
})

test('an empty workspace says so plainly', () => {
  const map = boardMap(space(), { now: NOW })
  assert.match(map, /Unsorted is empty\./)
  assert.match(map, /no nodes yet/)
})

test('Next and the Calendar come in only when there is something today or soon', () => {
  const day = note('day-2026-09-29', { kind: 'day', date: '2026-09-29', markdown: '- [ ] Call the landlord\n- [x] Done already' })
  const events = [
    { id: 'e1', title: 'Dentist', start: new Date(2026, 9, 1, 15, 0).toISOString(), end: '', notes: '' },
    { id: 'e2', title: 'Far away', start: new Date(2026, 10, 20, 15, 0).toISOString(), end: '', notes: '' },
  ]
  const map = boardMap(space([day], [], { calendar: { events } }), { now: NOW })
  assert.match(map, /Next \(steps for today\):\n- Call the landlord/)
  assert.doesNotMatch(map, /Done already/)
  assert.match(map, /Coming up on the Calendar \(next 8 days\):\n- Thu, Oct 1, 3:00 PM: Dentist/)
  assert.doesNotMatch(map, /Far away/)
  assert.doesNotMatch(boardMap(space(), { now: NOW }), /Next \(|Coming up/)
})

test('the map stays small however much there is, and says how much it left out', () => {
  const notes = Array.from({ length: 200 }, (_, i) => note(`sticky-${i}`, { title: `A thought number ${i} that goes on and on for a while`, unsorted: true }))
  const folders = Array.from({ length: 60 }, (_, i) => folder(`f${i}`, { name: `Node number ${i}` }))
  const map = boardMap(space(notes, folders), { now: NOW, maxChars: 2000 })
  assert.ok(map.length <= 2000, `${map.length} characters`)
  assert.match(map, /…and \d+ more stickies/)
})

test('the plan comes from the roadmap, one line a phase, only for a question about it', () => {
  const roadmap = '## Status\n\n| Phase | What | State |\n|---|---|---|\n| 14 | Connectors: Apple Mail, Gmail | Planned |\n| 15 | Paper in | Merged (PR #17) |\n\n## Context\n'
  assert.equal(planLines(roadmap), 'THE PLAN FOR OSAT (its roadmap: Tools → Roadmap, and its Timeline tab)\n- Phase 14: Connectors: Apple Mail, Gmail (planned)\n- Phase 15: Paper in (done)')
  assert.equal(planLines('nothing here'), '')
  for (const yes of ['Are we working on a built in email client?', 'Where is the project timeline board?', 'what is on the roadmap', 'Is that planned?']) assert.ok(asksAboutPlan(yes), yes)
  for (const no of ['What did I write about the garden?', 'Help me plan my day', 'What is today?']) assert.ok(!asksAboutPlan(no), no)
})

test('the prompt teaches OSAT\'s words, says it reads text only, and carries the map last', () => {
  const prompt = systemPrompt(new Date(2026, 8, 29, 12), 'I am Nate.', 'THEIR OSAT\nUnsorted is empty.')
  assert.ok(prompt.includes(OSAT_GUIDE))
  assert.match(prompt, /You read text only/)
  assert.match(prompt, /never move or change anything yourself/)
  assert.ok(prompt.indexOf('I am Nate.') < prompt.indexOf('THEIR OSAT'), 'about-you first, then the map')
  assert.ok(prompt.endsWith('Unsorted is empty.'))
  assert.doesNotMatch(systemPrompt(new Date(2026, 8, 29, 12)), /THEIR OSAT/, 'no map, no header')
})
