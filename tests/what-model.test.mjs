import assert from 'node:assert/strict'
import test from 'node:test'

import { readWhatAnswer, whatMessages } from '../shared/ai-tasks.mjs'
import { normalizeNote } from '../shared/note-core.mjs'
import { createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'
import { findWhen, guessWhat, listItems, whatOf, whenOf } from '../shared/what-model.mjs'

// Wednesday, October 14 2026, 9 in the evening (local time, as stickies are read).
const NOW = new Date(2026, 9, 14, 21, 0)
const sticky = (text, extra = {}) => normalizeNote({ id: 'n', markdown: text, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...extra })
const what = (text, extra) => guessWhat(sticky(text, extra)).what

test('Nate’s own stickies (the Oct 12 canvas) read as what they are', () => {
  assert.equal(what('When you enter a next step into OSAT, it shouldnt go to that widget on the left and then a journal appears for the day.'), 'problem')
  assert.equal(what('Start back with the basics, I need to make sure OSAT is helping me take things one step at a time.'), 'todo')
  assert.equal(what('Since CleanShot X is a connection or intergration. Does that mean we can do this with any application already downloaded?'), 'question')
  assert.equal(what('I believe merging the Quick Bar and Ask could be done, if done properly'), 'idea')
  assert.equal(what('Need to update your billing information on most of your websites'), 'todo')
  assert.equal(what('We could integrate n8n or something very similar inside OSAT to help with bot automation and pipelines.'), 'idea')
  assert.equal(what('Should the quick bar replace Spotlight for good'), 'question', 'a question without its question mark')
  assert.equal(what('The canvas is hard to read'), 'problem')
})

test('code says when it is only guessing, so the AI settles those', () => {
  assert.deepEqual([guessWhat(sticky('Spotlight Search')).what, guessWhat(sticky('Spotlight Search')).sure], ['idea', false])
  assert.equal(guessWhat(sticky('x'.repeat(700))).what, 'note')
  assert.equal(guessWhat(sticky('x'.repeat(700))).sure, false)
  assert.equal(guessWhat(sticky('Is it done?')).sure, true)
  assert.equal(guessWhat(sticky('Something I can’t place')).sure, false, '"can’t" alone is not a problem')
})

test('shopping: a list of food and household things, or buying said outright', () => {
  assert.equal(what('milk, bread, turkey, swiss, mayo'), 'buy')
  assert.equal(what('sourdough\nturkey\nswiss\nmayo\nlettuce'), 'buy', 'sandwich things, one per line')
  assert.equal(what('- 2 lbs ground beef\n- a dozen eggs\n- paper towels'), 'buy')
  assert.equal(what('Pick up milk'), 'buy')
  assert.equal(what('Buy a new monitor'), 'buy', 'anything bought counts')
  assert.equal(what('get the oil changed'), 'todo', 'an errand that is not shopping')
  assert.equal(what('Garage: this weekend I need to clear it out, sell the bike and the old desk, and measure the wall by the door before I buy anything.'), 'todo', 'buying mentioned in passing')
  assert.notEqual(what('need more time on the Fortis demo'), 'buy')
  assert.notEqual(what('Spotlight, Raycast, Alfred'), 'buy', 'a list that is not groceries')
  assert.deepEqual(listItems('2 lbs ground beef, a dozen eggs and milk'), ['ground beef', 'eggs', 'milk'])
})

test('Nate’s tags decide outright: #n2b and #w2b buy, #n2d to do, #a2c the calendar', () => {
  assert.equal(what('A standing desk #w2b'), 'buy')
  assert.equal(what('Taxes #n2d'), 'todo')
  assert.equal(what('Fortis demo Friday #a2c'), 'date')
  assert.equal(what('Fortis demo #a2c'), 'todo', 'no day to put on the calendar')
  assert.equal(what('Fortis demo idea #bs'), 'idea')
})

test('a day in a sticky, read from the day it was written', () => {
  assert.deepEqual(findWhen('Dentist Thursday 2pm', NOW), { date: '2026-10-15', time: '14:00', title: 'Dentist' })
  assert.deepEqual(findWhen('Fortis call Fri 10am', NOW), { date: '2026-10-16', time: '10:00', title: 'Fortis call' })
  assert.deepEqual(findWhen('Rent due Nov 1', NOW), { date: '2026-11-01', time: '', title: 'Rent due' })
  assert.deepEqual(findWhen('Call mom tomorrow at 3', NOW), { date: '2026-10-15', time: '15:00', title: 'Call mom' })
  assert.deepEqual(findWhen('Pay rent by 11/1', NOW), { date: '2026-11-01', time: '', title: 'Pay rent' })
  assert.deepEqual(findWhen('Follow up with Ana in 2 weeks', NOW), { date: '2026-10-28', time: '', title: 'Follow up with Ana' })
  assert.deepEqual(findWhen('Christmas party at 7', NOW), { date: '2026-12-25', time: '19:00', title: 'Christmas party' })
  assert.deepEqual(findWhen('Party tonight', NOW), { date: '2026-10-14', time: '19:00', title: 'Party' })
  assert.deepEqual(findWhen('Lunch with Sam on 2026-11-03 at 12:30', NOW), { date: '2026-11-03', time: '12:30', title: 'Lunch with Sam' })
})

test('a weekday named on that same day is today when its time is still ahead', () => {
  const thursdayMorning = new Date(2026, 9, 15, 8, 0)
  assert.equal(findWhen('Dentist Thursday 2pm', thursdayMorning).date, '2026-10-15')
  assert.equal(findWhen('Dentist Thursday', thursdayMorning).date, '2026-10-22', 'no time: next week')
})

test('no day where there is none, or where it already happened', () => {
  assert.equal(findWhen('Met Jordan last monday', NOW), null)
  assert.equal(findWhen('Called the bank yesterday at 3pm', NOW), null)
  assert.equal(findWhen('Mix 1/2 cup flour', NOW), null, 'half a cup is not January 2nd')
  assert.equal(findWhen('I sat down with the team', NOW), null, '"sat" is not Saturday')
  assert.equal(findWhen('Oct 3 was a good day', NOW), null, 'a day that already went by this year')
  assert.equal(findWhen('See https://example.com/?date=11/1', NOW), null)
  assert.equal(findWhen('Wedding 6/12/2027', NOW).date, '2027-06-12', 'a year written is kept, however far off')
})

test('a sticky with a day is a date, unless it asks or shops', () => {
  assert.equal(what('Dentist Thursday 2pm'), 'date')
  assert.equal(what('Is the dentist Thursday?'), 'question')
  assert.equal(what('Pick up milk tomorrow'), 'buy')
  const scanned = sticky('Call the school', { ask: { event: { title: 'School call', date: '2026-10-20', time: '08:30' } } })
  assert.deepEqual({ ...whenOf(scanned), start: undefined }, { date: '2026-10-20', time: '08:30', title: 'School call', start: undefined })
  assert.equal(whenOf(scanned).start.getHours(), 8)
})

test('the AI’s or Nate’s pick wins over code; a day page is no kind at all', () => {
  assert.equal(whatOf(sticky('Spotlight Search', { what: 'question' })), 'question')
  assert.equal(whatOf(sticky('milk, eggs')), 'buy')
  assert.equal(whatOf({ ...sticky('Today'), kind: 'day', date: '2026-10-14' }), null)
})

test('schema 13: a sticky keeps what it is, when it was done and its calendar event; nothing else', () => {
  assert.equal(SCHEMA, 13)
  const old = { ...createEmptyDoc(), schema: 12, rev: 4, notes: [sticky('kept')] }
  assert.deepEqual(migrate(old).notes, old.notes)
  const kept = sticky('x', { what: 'buy', doneAt: '2026-10-15T10:00:00.000Z', cal: { id: 'E1', where: 'mac', start: '2026-10-15T18:00:00.000Z' } })
  assert.equal(kept.what, 'buy')
  assert.equal(kept.doneAt, '2026-10-15T10:00:00.000Z')
  assert.deepEqual(kept.cal, { id: 'E1', where: 'mac', start: '2026-10-15T18:00:00.000Z' })
  assert.deepEqual(sticky('x', { cal: { off: true, id: 'E1' } }).cal, { off: true })
  const dropped = sticky('x', { what: 'chore', doneAt: 'soon', cal: { id: 'E1', where: 'google', start: 'x' } })
  assert.equal('what' in dropped || 'doneAt' in dropped || 'cal' in dropped, false)
})

test('the AI is asked in one word per sticky, and a loose answer is read', () => {
  const [, ask] = whatMessages(['milk, bread', 'Is it done?'])
  assert.match(ask.content, /1\. milk, bread\n2\. Is it done\?/)
  assert.deepEqual(readWhatAnswer('Sure! Here they are:\n1: Idea\n2. **buy**\n3 - to do\n4: groceries\n5: banana\n9: note\n2: idea', 5), [
    { sticky: 0, what: 'idea' }, { sticky: 1, what: 'buy' }, { sticky: 2, what: 'todo' }, { sticky: 3, what: 'buy' },
  ])
})
