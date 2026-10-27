import assert from 'node:assert/strict'
import test from 'node:test'

import { addedLine, addOwnEvent, ahead, datesSettings, datesToAdd, eventFor, setDates, takeOff, withCal } from '../src/intake/dates.js'
import { aiWhat, comingUp, isJustIn, noteCounts, notesInList, setDone, setWhat } from '../src/notes-model.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { QUIET_MS } from '../src/sky/auto-file.js'
import { whenOf } from '../shared/what-model.mjs'

// Wednesday, October 14 2026, 9 in the morning, local time.
const T0 = new Date(2026, 9, 14, 9, 0).getTime()
const iso = (ms) => new Date(ms).toISOString()
const sticky = (id, text, extra = {}) => ({ id, title: text.split('\n')[0], markdown: text, tags: [], unsorted: true, source: 'Quick bar', createdAt: iso(T0), updatedAt: iso(T0), ...extra })
const space = (notes, settings = {}) => normalizeWorkspace({ ...createDefaultWorkspace(), folders: [{ id: 'osat', name: 'OSAT', createdAt: iso(T0) }], notes, settings })
const ids = (list) => list.map((note) => note.id)

const state = space([
  sticky('q', 'Can OSAT read Granola notes offline?', { unsorted: false, folderId: 'osat' }),
  sticky('q-done', 'Is a Mac mini enough?', { doneAt: iso(T0) }),
  sticky('milk', 'milk, bread, turkey, swiss, mayo'),
  sticky('dentist', 'Dentist Thursday 2pm'),
  sticky('rent', 'Rent due Nov 1', { unsorted: false, folderId: 'osat' }),
  sticky('ask', 'Is the dentist Thursday?'),
  sticky('idea', 'We could integrate n8n inside OSAT', { unsorted: false, folderId: 'osat', filed: { by: 'ai', at: iso(T0), into: 'osat' } }),
  sticky('old', 'Old idea', { unsorted: false, folderId: 'osat' }),
  sticky('bin', 'Dentist Friday', { trashedAt: iso(T0) }),
])

test('the lists OSAT keeps: every open question, everything to buy, days soonest first', () => {
  assert.deepEqual(ids(notesInList(state, 'questions', null, T0)).sort(), ['ask', 'q'], 'filed or not; an answered one is gone')
  assert.deepEqual(ids(notesInList(state, 'buy', null, T0)), ['milk'])
  assert.deepEqual(ids(notesInList(state, 'coming', null, T0)), ['dentist', 'rent'], 'soonest first; a question with a day asks, it isn’t on the way')
  const counts = noteCounts(state, T0)
  assert.deepEqual([counts.questions, counts.buy, counts.coming], [2, 1, 2])
})

test('Coming up keeps a day until it is over, and nothing done', () => {
  const friday = new Date(2026, 9, 16, 9, 0).getTime()
  assert.deepEqual(ids(comingUp(state.notes, friday).map(({ note }) => note)), ['rent'], 'Thursday went by')
  assert.deepEqual(ids(comingUp(setDone(state, ['rent'], true).notes, friday).map(({ note }) => note)), [])
})

test('Just in: what has no home yet and what the AI filed this week', () => {
  assert.deepEqual(ids(notesInList(state, 'justin', null, T0)).sort(), ['ask', 'dentist', 'idea', 'milk', 'q-done'])
  assert.equal(isJustIn(state.notes.find((note) => note.id === 'idea'), T0 + 8 * 86400000), false, 'a week later it has settled')
  assert.deepEqual(ids(notesInList(state, 'unsorted', null, T0)).sort(), ['ask', 'dentist', 'milk', 'q-done'], 'Unsorted still answers by name')
  assert.deepEqual(ids(notesInList(state, 'filed', null, T0)), ['idea'], 'and so does Filed for you')
})

test('Nate’s pick wins: the AI never renames what he named, and a date with no day is a to-do', () => {
  const named = setWhat(state, ['old'], 'question')
  const after = aiWhat(named, [['old', 'idea'], ['idea', 'date'], ['milk', 'buy'], ['rent', 'nonsense']])
  const byId = (id) => after.notes.find((note) => note.id === id)
  assert.equal(byId('old').what, 'question')
  assert.equal(byId('idea').what, 'todo', 'no day in its words')
  assert.equal(byId('milk').what, 'buy')
  assert.equal('what' in byId('rent'), false)
  assert.equal(setWhat(state, ['old'], 'nonsense'), state)
})

test('done and undone keep everything else', () => {
  const done = setDone(state, ['milk'], true, iso(T0 + 1000))
  assert.equal(done.notes.find((note) => note.id === 'milk').doneAt, iso(T0 + 1000))
  const undone = setDone(done, ['milk'], false)
  assert.deepEqual(undone.notes.find((note) => note.id === 'milk'), state.notes.find((note) => note.id === 'milk'))
})

test('dates go on the calendar only when written since it began, and once they are quiet', () => {
  const since = iso(T0 - 60000)
  const early = datesToAdd(state, { since, now: T0 + 1000 })
  assert.deepEqual(early.ready, [])
  assert.equal(early.wait, QUIET_MS - 1000, 'waits until the sticky has been quiet')
  const later = datesToAdd(state, { since, now: T0 + QUIET_MS })
  assert.deepEqual(later.ready.map(({ note }) => note.id).sort(), ['dentist', 'rent'], 'not the question, not the trashed one')
  assert.deepEqual(datesToAdd(state, { since: iso(T0 + 1), now: T0 + QUIET_MS }).ready, [], 'written before it began: by hand only')
  assert.deepEqual(datesToAdd(state, { since: null, now: T0 + QUIET_MS }).ready, [], 'not started yet')
  const tried = new Set(['dentist'])
  assert.deepEqual(datesToAdd(state, { since, now: T0 + QUIET_MS, tried }).ready.map(({ note }) => note.id), ['rent'])
  const onCal = withCal(state, 'dentist', { off: true })
  assert.deepEqual(datesToAdd(onCal, { since, now: T0 + QUIET_MS }).ready.map(({ note }) => note.id), ['rent'], 'taken off once: never put back on its own')
})

test('OSAT’s own calendar takes the event; taking it off removes it and remembers', () => {
  const note = state.notes.find((item) => item.id === 'dentist')
  const when = whenOf(note)
  const event = eventFor(note, when)
  assert.equal(event.title, 'Dentist')
  assert.equal(new Date(event.start).getHours(), 14)
  assert.equal(Date.parse(event.end) - Date.parse(event.start), 3600000)
  const added = addOwnEvent(state, 'dentist', event)
  const cal = added.notes.find((item) => item.id === 'dentist').cal
  assert.equal(cal.where, 'osat')
  assert.deepEqual(added.calendar.events.map((item) => item.id), [cal.id])
  const off = takeOff(added, 'dentist')
  assert.equal(off.mac, null)
  assert.deepEqual(off.state.calendar.events, [])
  assert.deepEqual(off.state.notes.find((item) => item.id === 'dentist').cal, { off: true })
  const mac = takeOff(withCal(state, 'dentist', { id: 'EK-1', where: 'mac', start: event.start }), 'dentist')
  assert.equal(mac.mac, 'EK-1', 'a Mac event is removed through the bridge')
})

test('a day with no time is half an hour at nine; the line says where it went', () => {
  const note = state.notes.find((item) => item.id === 'rent')
  const event = eventFor(note, whenOf(note))
  assert.equal(new Date(event.start).getHours(), 9)
  assert.equal(Date.parse(event.end) - Date.parse(event.start), 1800000)
  assert.equal(ahead(whenOf(note), new Date(2026, 10, 1, 18, 0).getTime()), true, 'still today')
  assert.equal(addedLine([{ when: whenOf(note) }]), 'Put “Rent due” on your calendar · Sun, Nov 1')
  assert.equal(addedLine([{ when: whenOf(note) }, { when: whenOf(note) }]), 'Put 2 dates on your calendar')
})

test('dates settings: on unless turned off, the Mac’s default calendar until one is chosen', () => {
  assert.deepEqual(datesSettings({}), { on: true, since: null, calendar: 'default' })
  assert.equal(datesSettings(setDates(state, { calendar: 'osat' }).settings).calendar, 'osat')
  const chosen = setDates(state, { calendar: 'EK-CAL', since: iso(T0) })
  assert.deepEqual(datesSettings(chosen.settings), { on: true, since: iso(T0), calendar: 'EK-CAL' })
  assert.equal(datesSettings(setDates(chosen, { on: false }).settings).on, false)
})
