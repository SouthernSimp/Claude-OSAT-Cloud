import assert from 'node:assert/strict'
import test from 'node:test'

import { readPhotoAnswer } from '../shared/ai-tasks.mjs'
import { JUST_IN } from '../src/boards/boards-model.js'
import { cameIn, dayLabel, guessBoards, mergeStickies, placeFrom, samePair, todayFlow, todaysBrief, undoOf, whereTo } from '../src/boards/just-in.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const NOW = new Date(2026, 9, 15, 9, 0).getTime()
const iso = (ms) => new Date(ms).toISOString()
const HOUR = 3600000
const sticky = (id, text, extra = {}, ago = 0) => ({ id, title: text, markdown: text, tags: [], createdAt: iso(NOW - ago), updatedAt: iso(NOW - ago), ...extra })
const filed = (into, ago = 0) => ({ folderId: into, filed: { by: 'ai', at: iso(NOW - ago), into } })
const state = normalizeWorkspace({
  ...createDefaultWorkspace(),
  folders: [
    { id: 'osat', name: 'OSAT', rank: 1, createdAt: iso(NOW) },
    { id: 'fortis', name: 'Fortis', rank: 2, createdAt: iso(NOW) },
  ],
  notes: [
    sticky('canvas', 'The canvas is hard to read', filed('osat'), HOUR),
    sticky('logo', 'Fortis demo needs the new logo', filed('fortis', 26 * HOUR), 26 * HOUR),
    sticky('mine', 'Ship the canvas', { folderId: 'osat' }, 2 * HOUR),
    sticky('old', 'Filed long ago', filed('osat', 20 * 24 * HOUR), 20 * 24 * HOUR),
    sticky('q', 'Can OSAT read Granola notes offline?', { unsorted: true }, 0.5 * HOUR),
    sticky('dentist', 'Dentist Thursday 2pm', { unsorted: true, cal: { id: 'event-1', where: 'osat', start: iso(NOW + 30 * HOUR) } }, 3 * HOUR),
    sticky('slides', 'Fortis slides for the demo call', { folderId: 'fortis' }, 30 * HOUR),
    { id: 'day-2026-10-15', kind: 'day', date: '2026-10-15', title: 'Thursday', markdown: '**Morning brief**\nGood morning. The day is open.\n*Written for you by OSAT’s AI.*\n\nMy own words', createdAt: iso(NOW), updatedAt: iso(NOW) },
  ],
})
const ids = (notes) => notes.map((note) => note.id)

test('Just in: what waits for a home, then what OSAT filed this week by day; not what you put there yourself', () => {
  const { waiting, days } = cameIn(state, NOW)
  assert.deepEqual(ids(waiting), ['q', 'dentist'])
  assert.deepEqual(days.map((day) => [day.label, ids(day.notes)]), [['Today', ['canvas']], ['Yesterday', ['logo']]])
})

test('where a sticky went, in one line, and what its Undo takes back', () => {
  const note = (id) => state.notes.find((item) => item.id === id)
  assert.deepEqual(whereTo(state, note('canvas')), ['OSAT → Problems'])
  assert.deepEqual(whereTo(state, note('q')), ['Questions'])
  assert.deepEqual(whereTo(state, note('dentist'), () => 'Fri, Oct 16, 2:00 PM'), ['Calendar · Fri, Oct 16, 2:00 PM'])
  assert.equal(undoOf(note('canvas')), 'board')
  assert.equal(undoOf(note('dentist')), 'calendar')
  assert.equal(undoOf(note('mine')), null)
})

test('a sticky you give a home from Just in stays on its list, saying where it went; one already on a board doesn’t', () => {
  const at = iso(NOW)
  const placed = placeFrom(state, ['q', 'mine'], 'fortis', at)
  const note = (id) => placed.notes.find((item) => item.id === id)
  assert.deepEqual(note('q').filed, { by: 'you', at, into: 'fortis' })
  assert.equal(note('mine').filed, undefined)
  assert.equal(undoOf(note('q')), 'board')
  assert.deepEqual(ids(cameIn(placed, NOW).days[0].notes), ['q', 'canvas'])
  // Back to Just in: waiting again.
  assert.ok(cameIn(placeFrom(placed, ['q'], JUST_IN), NOW).waiting.some((item) => item.id === 'q'))
})

test('a day is Today, Yesterday, its weekday this week, else its date', () => {
  assert.equal(dayLabel(iso(NOW), NOW), 'Today')
  assert.equal(dayLabel(iso(NOW - 24 * HOUR), NOW), 'Yesterday')
  assert.equal(dayLabel(iso(NOW - 3 * 24 * HOUR), NOW), 'Monday')
  assert.equal(dayLabel(iso(NOW - 20 * 24 * HOUR), NOW), 'Sep 25')
})

test('a sticky with no home is offered the boards it looks like', () => {
  assert.deepEqual(guessBoards(state, sticky('x', 'Call Fortis about the demo')), ['fortis'])
  assert.deepEqual(guessBoards(state, sticky('y', 'Pick up the kids')), [])
})

test('today’s morning brief comes from today’s journal page, without its marker lines', () => {
  assert.equal(todaysBrief(state, new Date(NOW)), 'Good morning. The day is open.')
  assert.equal(todaysBrief(state, new Date(NOW + 24 * HOUR)), '')
})

test('two stickies of one kind whose words nearly all match are offered to merge, older first', () => {
  const notes = [
    sticky('a', 'Call Jordan about the roof', {}, 2 * HOUR),
    sticky('b', 'Call Jordan back about roof', {}, HOUR),
    sticky('c', 'Fortis demo needs the new logo'),
    sticky('d', 'Fortis demo slides'),
  ]
  const pair = samePair(notes)
  assert.deepEqual([pair.a.id, pair.b.id, pair.key], ['a', 'b', 'a|b'])
  assert.equal(samePair(notes, ['a|b']), null)
  // Same words, different kinds: a question isn't the same as a to-do.
  assert.equal(samePair([sticky('e', 'Book the venue for March'), sticky('f', 'Book the venue for March?')]), null)
})

test('merging keeps both sets of words in the older sticky and bins the newer one', () => {
  const merged = mergeStickies(state, 'mine', 'canvas')
  const note = (id) => merged.notes.find((item) => item.id === id)
  assert.equal(note('mine').markdown, 'Ship the canvas\n\nThe canvas is hard to read')
  assert.ok(note('canvas').trashedAt)
  assert.equal(mergeStickies(merged, 'mine', 'canvas'), merged)
})

test('a photo’s answer: one sticky a line, bullets gone, each once, none is nothing', () => {
  assert.deepEqual(readPhotoAnswer('Here are the notes:\n- Spotlight Search\n2. Audio player?\n• milk, bread\n- spotlight search\n\n'), ['Spotlight Search', 'Audio player?', 'milk, bread'])
  assert.deepEqual(readPhotoAnswer('none'), [])
})

test('today’s intake in counts: what came in, and where it went', () => {
  assert.deepEqual(todayFlow(state, NOW), { came: 3, calendar: 1, questions: 1, buy: 0, board: 1, waiting: 2 })
})
