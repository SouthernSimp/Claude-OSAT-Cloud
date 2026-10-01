import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accessLine, dueLabel, gridRange, macCalendars, macEvents, macReminders, mergeEvents, newMacEvent, newReminder, soonReminders,
} from '../shared/mac-calendar-model.mjs'

test('the grid range covers the six weeks the month grid draws', () => {
  const { from, to } = gridRange(2026, 8) // September 2026 starts on a Tuesday
  assert.equal(new Date(from).getDay(), 0)
  assert.equal(new Date(from).getDate(), 30) // Aug 30
  assert.equal(Math.round((Date.parse(to) - Date.parse(from)) / 86400000), 42)
})

test('the Mac’s events keep OSAT’s shape, name their calendar and are marked as the Mac’s', () => {
  const calendars = macCalendars([{ id: 'c1', title: 'Work', source: 'iCloud', color: '#336699', writable: true }, { id: '', title: 'x' }])
  assert.equal(calendars.length, 1)
  const events = macEvents([
    { id: 'e1', title: 'Standup', start: '2026-09-30T15:00:00Z', end: '2026-09-30T15:30:00Z', calendar: 'c1' },
    { id: 'e2', title: '', start: 'nonsense', calendar: 'c1' },
    { id: 'e3', title: 'Holiday', start: '2026-10-01T04:00:00Z', allDay: true, calendar: 'gone' },
  ], calendars)
  assert.equal(events.length, 2)
  assert.deepEqual([events[0].id, events[0].mac, events[0].calendarName, events[0].color], ['mac:e1', true, 'Work', '#336699'])
  assert.equal(events[1].calendarName, '')
  assert.equal(events[1].allDay, true)
})

test('merging sorts both together and leaves out calendars switched off', () => {
  const own = [{ id: 'a', start: '2026-09-30T16:00:00Z' }]
  const mac = [
    { id: 'mac:1', start: '2026-09-30T15:00:00Z', calendarId: 'c1' },
    { id: 'mac:2', start: '2026-09-30T17:00:00Z', calendarId: 'c2' },
  ]
  assert.deepEqual(mergeEvents(own, mac).map((e) => e.id), ['mac:1', 'a', 'mac:2'])
  assert.deepEqual(mergeEvents(own, mac, ['c1']).map((e) => e.id), ['a', 'mac:2'])
  assert.equal(own.length, 1)
})

test('an event for the Mac needs a calendar, a title and a start; the end defaults to an hour', () => {
  assert.equal(newMacEvent({ calendar: 'c1', title: '', start: '2026-09-30T15:00:00Z' }), null)
  assert.equal(newMacEvent({ calendar: '', title: 'x', start: '2026-09-30T15:00:00Z' }), null)
  const event = newMacEvent({ calendar: 'c1', title: ' Dentist ', start: '2026-09-30T15:00:00Z', end: '2026-09-30T14:00:00Z' })
  assert.equal(event.title, 'Dentist')
  assert.equal(event.end, '2026-09-30T16:00:00.000Z')
})

test('reminders: due soon or undated, dated ones first, and plain labels', () => {
  const now = new Date(2026, 8, 30, 10)
  const all = macReminders([
    { id: '1', title: 'Later', due: '2026-10-20' },
    { id: '2', title: 'No date' },
    { id: '3', title: 'Tomorrow', due: '2026-10-01', time: '09:00' },
    { id: '4', title: 'Late', due: '2026-09-25' },
    { id: '5', title: 'Today', due: '2026-09-30', time: '17:00' },
    { id: '6', title: '' },
  ])
  const soon = soonReminders(all, now)
  assert.deepEqual(soon.map((r) => r.id), ['4', '5', '3', '2'])
  assert.deepEqual(soon.map((r) => dueLabel(r, now)), ['Earlier', 'Today 17:00', 'Tomorrow', 'No date'])
  assert.equal(dueLabel({ due: '2026-10-05' }, now), 'Mon, Oct 5')
})

test('a new reminder needs words; a bad date is just no date', () => {
  assert.equal(newReminder({ title: '  ' }), null)
  assert.deepEqual(newReminder({ title: 'Call Sam', due: 'soon' }), { title: 'Call Sam', due: '' })
})

test('a refused Mac says the way forward in plain words', () => {
  assert.match(accessLine('denied'), /System Settings → Privacy & Security → Calendars/)
  assert.match(accessLine('denied', 'reminders'), /Privacy & Security → Reminders/)
  assert.equal(accessLine('allowed'), null)
  assert.equal(accessLine('notAsked'), null)
})
