import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { dayLine, dayPlan, greeting, monthMoney, openTodos } from '../src/today/today-model.js'

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
