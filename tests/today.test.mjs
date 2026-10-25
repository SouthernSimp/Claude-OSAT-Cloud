import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { dashboardBoards, dayLine, dayPlan, greeting, meetingPrep, quietClients, monthMoney, openTodos, recentWork } from '../src/today/today-model.js'

const NOW = new Date(2026, 9, 19, 9, 0).getTime()
const iso = (ms) => new Date(ms).toISOString()
const HOUR = 3600000
const sticky = (id, text, extra = {}, ago = 0) => ({ id, title: text, markdown: text, tags: [], createdAt: iso(NOW - ago), updatedAt: iso(NOW - ago), ...extra })
const state = normalizeWorkspace({
  ...createDefaultWorkspace(),
  folders: [{ id: 'fortis', name: 'Fortis', rank: 1, createdAt: iso(NOW) }],
  notes: [
    sticky('call', 'Call the merchant back', { what: 'todo', folderId: 'fortis' }, HOUR),
    sticky('doing', 'Fix the demo slides', { what: 'todo', stage: 'doing' }, 5 * HOUR),
    sticky('friday', 'Send the invoice Friday', { what: 'todo' }, 2 * HOUR),
    sticky('late', 'Pay the phone bill October 17', { what: 'todo' }, 48 * HOUR),
    sticky('done', 'Book the venue', { what: 'todo', doneAt: iso(NOW) }),
    sticky('idea', 'A bot that keeps the books', { what: 'idea' }),
    sticky('dentist', 'Dentist today at 2pm', { what: 'date' }),
    sticky('lunch', 'Lunch with Tyler today at noon', { what: 'date', cal: { id: 'mac:1', where: 'mac', start: iso(NOW) } }),
  ],
})

test('to-dos: open ones only, Doing first, then a day, then the newest; one from before today is late', () => {
  const todos = openTodos(state, NOW)
  assert.deepEqual(todos.map((item) => item.note.id), ['doing', 'late', 'friday', 'call'])
  assert.equal(todos.find((item) => item.note.id === 'call').board, 'Fortis')
  assert.equal(todos.find((item) => item.note.id === 'late').late, true)
  assert.equal(todos.find((item) => item.note.id === 'friday').late, false)
})

test('the day: the Mac’s events (not a hidden calendar), OSAT’s own, and dated stickies not on a calendar, all-day first', () => {
  const at = (h, m = 0) => new Date(2026, 9, 19, h, m).toISOString()
  const plan = dayPlan({
    mac: [
      { id: 'mac:standup', title: 'Standup', start: at(9, 30), end: at(9, 45), calendarId: 'work' },
      { id: 'mac:private', title: 'Hidden', start: at(11), end: at(12), calendarId: 'home' },
      { id: 'mac:holiday', title: 'Holiday', start: at(0), end: new Date(2026, 9, 20).toISOString(), allDay: true, calendarId: 'work' },
      { id: 'mac:yesterday', title: 'Yesterday', start: new Date(2026, 9, 18).toISOString(), end: at(0), allDay: true, calendarId: 'work' },
      { id: 'mac:tomorrow', title: 'Tomorrow', start: new Date(2026, 9, 20, 9).toISOString(), end: '', calendarId: 'work' },
    ],
    hidden: ['home'],
    own: [{ id: 'event-1', title: 'Gym', start: at(17, 30), end: at(18, 30) }],
    notes: state.notes,
  }, NOW)
  assert.deepEqual(plan.map((item) => item.title), ['Holiday', 'Standup', 'Dentist today at 2pm', 'Gym'])
  assert.deepEqual(plan.map((item) => item.from), ['mac', 'mac', 'sticky', 'osat'])
})

test('greeting by the hour', () => {
  assert.equal(greeting(new Date(2026, 9, 19, 8)), 'Good morning')
  assert.equal(greeting(new Date(2026, 9, 19, 13)), 'Good afternoon')
  assert.equal(greeting(new Date(2026, 9, 19, 20)), 'Good evening')
})

test('the day in one line, never a scold', () => {
  assert.equal(dayLine({}), 'A clear day. Write anything in the bar above and OSAT puts it where it goes.')
  assert.equal(dayLine({ events: 2, todos: 3, late: 1, waiting: 1 }), '2 things on your calendar, 3 to-dos (1 from before today) and 1 sticky waiting in Just in.')
  assert.equal(dayLine({ todos: 1 }), '1 to-do.')
})

test('money this month', () => {
  const budget = { transactions: [
    { amountMinor: -8500, date: '2026-10-02' },
    { amountMinor: 250000, date: '2026-10-01' },
    { amountMinor: -1200, date: '2026-09-30' },
  ] }
  assert.deepEqual(monthMoney(budget, '2026-10'), { spent: 8500, income: 250000 })
})

test('dashboard board progress includes branch steps and matches the Board, without changing user order', () => {
  const workspace = normalizeWorkspace({ ...createDefaultWorkspace(), folders: [
    { id: 'first', name: 'First', rank: 1 }, { id: 'second', name: 'Second', rank: 2 },
    { id: 'branch', name: 'Branch', parentId: 'first', rank: 0 },
  ], notes: [
    sticky('open', 'Send quote', { folderId: 'first', what: 'todo' }),
    sticky('finished', 'Measure site', { folderId: 'branch', what: 'todo', doneAt: iso(NOW) }),
    sticky('staged', 'A staged note', { folderId: 'branch', what: 'note', stage: 'next' }),
    sticky('plain', 'A plain note', { folderId: 'first', what: 'note' }),
    sticky('trashed', 'Deleted step', { folderId: 'first', what: 'todo', trashedAt: iso(NOW) }),
  ] })
  assert.deepEqual(dashboardBoards(workspace).map(({ folder, count, total, done }) => [folder.name, count, total, done]), [
    ['First', 4, 3, 1], ['Second', 0, 0, 0],
  ])
})

test('recent work uses edit time, omits deleted notes, journal pages and to-dos, limits to four and leaves source order alone', () => {
  const notes = [
    sticky('old', 'Older', {}, 5 * HOUR),
    sticky('edited', 'Edited', { updatedAt: iso(NOW + HOUR) }, 8 * HOUR),
    sticky('latest', 'Latest'), sticky('third', 'Third', {}, HOUR), sticky('fourth', 'Fourth', {}, 2 * HOUR),
    sticky('deleted', 'Deleted', { trashedAt: iso(NOW), updatedAt: iso(NOW + 3 * HOUR) }),
    sticky('journal', 'Day', { kind: 'day', updatedAt: iso(NOW + 4 * HOUR) }),
    sticky('todo', 'Call Sam', { what: 'todo', updatedAt: iso(NOW + 5 * HOUR) }),
  ]
  const before = notes.map((note) => note.id)
  assert.deepEqual(recentWork({ notes }).map((note) => note.id), ['edited', 'latest', 'third', 'fourth'])
  assert.deepEqual(notes.map((note) => note.id), before)
  assert.deepEqual(recentWork({ notes: [] }), [])
})

test('before a client meeting: the next one not over yet, with when you last met, their to-dos and notes', () => {
  const at = (h) => new Date(2026, 9, 19, h).toISOString()
  const day = (d) => new Date(2026, 9, d, 10).toISOString()
  const prep = normalizeWorkspace({
    ...createDefaultWorkspace(),
    folders: [{ id: 'fortis', name: 'Fortis', client: true, createdAt: iso(NOW) }, { id: 'home', name: 'Home', createdAt: iso(NOW) }],
    notes: [
      { id: 'call', title: 'Fortis call · Oct 14', markdown: 'Went well.\n\n#meeting', tags: ['meeting'], folderId: 'fortis', source: 'Meeting', createdAt: day(14), updatedAt: day(14) },
      sticky('deck', 'Send the deck', { what: 'todo', folderId: 'fortis' }),
      sticky('sam', 'Sam: send the price list', { what: 'todo', folderId: 'fortis' }),
      sticky('named', 'Ask Fortis about the logo', { what: 'todo', folderId: 'home' }),
      sticky('other', 'Call the plumber', { what: 'todo', folderId: 'home' }),
      sticky('lunch', 'Lunch idea: Fortis likes tacos', { folderId: 'home' }, 24 * HOUR),
    ],
  })
  const plan = [
    { id: 'a', title: 'Fortis standup', start: at(7), end: at(8) },
    { id: 'b', title: 'Dentist', start: at(10), end: at(11) },
    { id: 'c', title: 'Fortis kickoff', start: at(14), end: at(15) },
  ]
  const ready = meetingPrep(prep, plan, NOW)
  assert.equal(ready.item.id, 'c', 'the one that is over is skipped, and one not with a client')
  assert.equal(ready.folder.id, 'fortis')
  assert.equal(ready.lastMeeting.noteId, 'call')
  assert.deepEqual(ready.todos.map((item) => item.note.id).sort(), ['deck', 'named', 'sam'])
  assert.deepEqual(ready.notes.map((item) => item.noteId), ['lunch'])
  assert.equal(meetingPrep(prep, plan.slice(1, 2), NOW), null)
  assert.equal(meetingPrep(state, plan, NOW), null, 'no clients, no prep')
})

test('clients gone quiet: met before, not in three weeks, longest first; never met is left out', () => {
  const ago = (days) => iso(NOW - days * 24 * HOUR)
  const met = (id, folderId, days) => ({ id, title: 'Call', markdown: 'Call\n\n#meeting', tags: ['meeting'], folderId, createdAt: ago(days), updatedAt: ago(days) })
  const quiet = normalizeWorkspace({
    ...createDefaultWorkspace(),
    folders: ['acme', 'fortis', 'new', 'home'].map((id) => ({ id, name: id, client: id !== 'home', createdAt: iso(NOW) })),
    notes: [met('a', 'acme', 40), met('f', 'fortis', 25), met('h', 'home', 90), met('f2', 'fortis', 30)],
  })
  assert.deepEqual(quietClients(quiet, NOW).map(({ folder }) => folder.id), ['acme', 'fortis'])
  const fresh = { ...quiet, notes: [...quiet.notes, met('f3', 'fortis', 2)] }
  assert.deepEqual(quietClients(fresh, NOW).map(({ folder }) => folder.id), ['acme'])
})
