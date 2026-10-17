import assert from 'node:assert/strict'
import test from 'node:test'

import { asksAboutPlan, boardMap, OSAT_GUIDE, planLines } from '../src/assistant/board-context.js'
import { systemPrompt } from '../src/assistant/actions.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { openTodos } from '../src/today/today-model.js'

const at = new Date(Date.UTC(2026, 8, 28, 9, 0)).toISOString()
const note = (id, extra = {}) => ({ id, title: id, markdown: id, createdAt: at, updatedAt: at, ...extra })
const folder = (id, extra = {}) => ({ id, name: id, createdAt: at, ...extra })
const space = (notes = [], folders = [], extra = {}) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders, ...extra })
const NOW = new Date(2026, 8, 29, 9, 0)

test('the map names the boards, their branches, and what waits in Just in', () => {
  const state = space(
    [note('Call mom', { unsorted: true }), note('Buy stamps', { folderId: 'wed' }), note('Cake tasting', { folderId: 'cake' }), note('Deleted one', { unsorted: true, trashedAt: at })],
    [folder('wed', { name: 'Wedding' }), folder('cake', { name: 'Cake', parentId: 'wed' })],
  )
  const map = boardMap(state, { now: NOW })
  assert.match(map, /Just in \(1 sticky, waiting for a board\):\n- Call mom/)
  assert.doesNotMatch(map, /Deleted one/, 'the Trash stays out of it')
  assert.match(map, /- Wedding \(2 stickies\), branches: Cake \(1\); 1 sticky in no branch yet/)
  assert.match(map, /^THEIR OSAT\n/)
})

test('on the boards screen it says so, and lists the open board, branch by branch', () => {
  const state = space(
    [note('Buy stamps', { folderId: 'wed' }), note('Cake tasting', { folderId: 'cake' })],
    [folder('wed', { name: 'Wedding' }), folder('cake', { name: 'Cake', parentId: 'wed' })],
  )
  const map = boardMap(state, { open: ['wed', 'cake', 'missing'], where: 'sky', now: NOW })
  assert.match(map, /looking at their boards right now/)
  assert.match(map, /Open board: Wedding\n {2}- Buy stamps\n {2}Cake:\n {2}- Cake tasting/)
  assert.doesNotMatch(map, /Open board: Cake/, 'only top-level boards open')
})

test('saved connections are named; removed desk stacks and links to the Bin stay out', () => {
  const state = space(
    [note('Call Tommy', { folderId: 'cl', links: ['note:Bag'] }), note('Bag', { folderId: 'cl' }), note('Old one', { unsorted: true, trashedAt: at, links: ['note:Bag'] }), note('Eggs', { unsorted: true }), note('Milk', { unsorted: true })],
    [folder('cl', { name: 'Clients', links: ['note:Eggs'] })],
  )
  const map = boardMap(state, { now: NOW, stacks: [{ name: 'Groceries', titles: ['Eggs', 'Milk'] }, { name: '', titles: ['Bag'] }] })
  assert.match(map, /Connected \(a line between two things; nothing was filed by it\):\n- Call Tommy — Bag\n- Clients — Eggs/)
  assert.doesNotMatch(map, /Old one —|— Old one/)
  assert.doesNotMatch(map, /Groceries|A stack|Stacks on the desk/)
  assert.doesNotMatch(boardMap(space([note('a')]), { now: NOW }), /Connected|Stacks on the desk/, 'nothing to say, nothing said')
})

test('the guide teaches the current window, follow-ups and safe actions', () => {
  for (const words of [/one window with a sidebar/, /Just in/, /board/, /connection/, /never files or moves/, /Today/, /quick bar/, /the ring/, /Meetings makes a to-do/, /Granola/, /changes to another app wait for Allow/]) assert.match(OSAT_GUIDE, words)
  assert.doesNotMatch(OSAT_GUIDE, /Sky|Sort Unsorted|desk|canvas|topic|in Unsorted/)
})

test('an empty workspace says so plainly', () => {
  const map = boardMap(space(), { now: NOW })
  assert.match(map, /Nothing is waiting in Just in\./)
  assert.match(map, /no boards yet/)
})

test('Ask sees the same open to-dos in the same order as Today, without changing any notes', () => {
  const state = space([
    note('Send the estimate', { what: 'todo', folderId: 'client', stage: 'doing', source: 'Granola' }),
    note('Call the supplier', { what: 'todo', unsorted: true, stage: 'next' }),
    note('Order steel', { what: 'todo', folderId: 'client' }),
    note('Finished invoice', { what: 'todo', folderId: 'client', doneAt: at }),
    note('Deleted task', { what: 'todo', folderId: 'client', trashedAt: at }),
    note('An idea', { what: 'idea', folderId: 'client' }),
    note('day-2026-09-29', { kind: 'day', date: '2026-09-29', markdown: '- [ ] Journal task' }),
  ], [folder('client', { name: 'Client work' })])
  const before = structuredClone(state)
  const map = boardMap(state, { now: NOW })
  const section = map.split('\n\n').find((part) => part.startsWith('To do ('))
  assert.equal(section, `To do (3 open; Doing, then Next, then soonest):\n${openTodos(state, NOW).map(({ note, board }) => `- ${note.title} [${board || 'Just in'}]`).join('\n')}`)
  assert.doesNotMatch(section, /Finished invoice|Deleted task|An idea|Journal task/)
  assert.match(map, /Today's journal checklist:\n- Journal task/)
  assert.deepEqual(state, before)
  for (const scope of ['none', 'focus']) {
    const scoped = boardMap(state, { now: NOW, scope, focus: 'client', noteIds: [] })
    assert.doesNotMatch(scoped, /To do \(|Send the estimate|Call the supplier|Order steel|Journal task/)
  }
})

test('a large to-do list stays within the map budget and says what was omitted', () => {
  const notes = Array.from({ length: 100 }, (_, i) => note(`task-${i}`, { title: `Send estimate number ${i}`, what: 'todo', unsorted: true }))
  const map = boardMap(space(notes), { now: NOW, maxChars: 1800 })
  assert.ok(map.length <= 1800)
  assert.match(map, /To do \(100 open/)
  assert.match(map, /…and \d+ more to-dos/)
  assert.doesNotMatch(map, /Unsorted|Topics|Sky|canvas|desk/)
})

test('the journal checklist and Calendar come in only when there is something today or soon', () => {
  const day = note('day-2026-09-29', { kind: 'day', date: '2026-09-29', markdown: '- [ ] Call the landlord\n- [x] Done already' })
  const events = [
    { id: 'e1', title: 'Dentist', start: new Date(2026, 9, 1, 15, 0).toISOString(), end: '', notes: '' },
    { id: 'e2', title: 'Far away', start: new Date(2026, 10, 20, 15, 0).toISOString(), end: '', notes: '' },
  ]
  const map = boardMap(space([day], [], { calendar: { events } }), { now: NOW })
  assert.match(map, /Today's journal checklist:\n- Call the landlord/)
  assert.doesNotMatch(map, /Done already/)
  assert.match(map, /Coming up on the Calendar \(next 8 days\):\n- Thu, Oct 1, 3:00 PM: Dentist/)
  assert.doesNotMatch(map, /Far away/)
  assert.doesNotMatch(boardMap(space(), { now: NOW }), /journal checklist|Coming up/)
})

test('the map stays small however much there is, and says how much it left out', () => {
  const notes = Array.from({ length: 200 }, (_, i) => note(`sticky-${i}`, { title: `A thought number ${i} that goes on and on for a while`, unsorted: true }))
  const folders = Array.from({ length: 60 }, (_, i) => folder(`f${i}`, { name: `Board number ${i}` }))
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
  const prompt = systemPrompt(new Date(2026, 8, 29, 12), 'I am Nate.', 'THEIR OSAT\nNothing is waiting in Just in.')
  assert.ok(prompt.includes(OSAT_GUIDE))
  assert.match(prompt, /You read text only/)
  assert.match(prompt, /Only say you changed something after a tool confirms it/)
  assert.ok(prompt.indexOf('I am Nate.') < prompt.indexOf('THEIR OSAT'), 'about-you first, then the map')
  assert.ok(prompt.endsWith('Nothing is waiting in Just in.'))
  assert.doesNotMatch(systemPrompt(new Date(2026, 8, 29, 12)), /THEIR OSAT/, 'no map, no header')
})
