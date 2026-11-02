import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { notesInList } from '../src/notes-model.js'
import {
  autoFileSettings, fileForYou, fileRequests, filedLine, filingGroups, needsGist, QUIET_MS, readyToFile, waitingFromBefore, withGist,
} from '../src/sky/auto-file.js'
import { undoFiling } from '../src/sky/sort-review.js'

const T0 = Date.UTC(2026, 9, 6, 9, 0)
const iso = (ms) => new Date(ms).toISOString()
const sticky = (id, text, extra = {}) => ({ id, title: text.split('\n')[0], markdown: text, tags: [], unsorted: true, source: 'Quick bar', createdAt: iso(T0), updatedAt: iso(T0), ...extra })
const space = (notes) => normalizeWorkspace({
  ...createDefaultWorkspace(),
  folders: [{ id: 'jordan', name: 'Jordan', createdAt: iso(T0) }, { id: 'osat', name: 'OSAT ideas', createdAt: iso(T0) }],
  notes,
})

const state = space([
  sticky('a', 'Send Jordan the quote'),
  sticky('b', 'Dark mode for the desk'),
  sticky('c', 'Buy cat litter'),
  sticky('d', 'Cat vet Friday'),
  sticky('e', 'Something unclear'),
  sticky('old', 'From before', { createdAt: iso(T0 - 86400000), updatedAt: iso(T0 - 86400000) }),
  sticky('free', 'On the Sky', { at: { x: 1, y: 2 } }),
  sticky('pin', 'Pinned', { pinned: true }),
  { id: 'mine', title: 'Written in Notes', markdown: 'Written in Notes', createdAt: iso(T0), updatedAt: iso(T0) },
])

test('filing is on unless turned off, and only for stickies written since it started', () => {
  assert.deepEqual(autoFileSettings({}), { on: true, since: null })
  assert.deepEqual(autoFileSettings({ autoFile: { on: false, since: iso(T0) } }), { on: false, since: iso(T0) })
  assert.equal(readyToFile(state, { since: null, now: T0 + QUIET_MS }).ready.length, 0, 'no start yet: nothing')
  assert.equal(waitingFromBefore(state, iso(T0)), 1)
})

test('it waits until the pile has been quiet, then takes only dumped stickies', () => {
  const early = readyToFile(state, { since: iso(T0), now: T0 + 1000 })
  assert.deepEqual(early, { ready: [], wait: QUIET_MS - 1000 })
  const { ready } = readyToFile(state, { since: iso(T0), now: T0 + QUIET_MS, tried: new Set(['e']) })
  assert.deepEqual(ready.map((note) => note.id).sort(), ['a', 'b', 'c', 'd'], 'not one from before, on the Sky, pinned, written in Notes or tried')
})

test("only the model's own picks move; one run is one Undo, and Filed for you lists them", () => {
  const { ready } = readyToFile(state, { since: iso(T0), now: T0 + QUIET_MS })
  const { places, batches } = fileRequests(state, ready)
  assert.equal(batches.length, 1)
  const index = (id) => ready.findIndex((note) => note.id === id) + 1
  const place = (id) => places.findIndex((item) => item.id === id) + 1
  const answer = [`${index('a')}: ${place('jordan')}`, `${index('b')}: ${place('osat')}`, `${index('c')}: new: Cat`, `${index('d')}: new: Cat`, `${index('e')}: none`].join('\n')
  const groups = filingGroups(state, ready, places, [{ from: 0, text: answer }])
  const run = fileForYou(state, groups, iso(T0 + QUIET_MS))
  const byId = (s, id) => s.notes.find((note) => note.id === id)
  assert.equal(byId(run.state, 'a').folderId, 'jordan')
  assert.deepEqual(byId(run.state, 'a').filed, { by: 'ai', at: iso(T0 + QUIET_MS), into: 'jordan' })
  assert.equal(byId(run.state, 'c').folderId, byId(run.state, 'd').folderId, 'a new node both share')
  assert.equal(byId(run.state, 'e').folderId, null, 'what it was unsure of stays for Nate')
  assert.equal(run.made.length, 1)
  assert.match(filedLine(run.state, run.moved), /^Filed 4 stickies into /)
  assert.deepEqual(notesInList(run.state, 'filed', null, T0 + QUIET_MS).map((note) => note.id).sort(), ['a', 'b', 'c', 'd'])

  const back = undoFiling(run.state, run.changes, run.made).state
  assert.equal(byId(back, 'a').folderId, null)
  assert.equal(byId(back, 'a').unsorted, true)
  assert.equal('filed' in byId(back, 'a'), false)
  assert.equal(back.folders.length, 2, 'the node it made goes again while empty')

  // Moved by hand since: no longer "filed for you".
  const moved = { ...run.state, notes: run.state.notes.map((note) => (note.id === 'a' ? { ...note, folderId: 'osat' } : note)) }
  assert.equal(notesInList(moved, 'filed', null, T0 + QUIET_MS).some((note) => note.id === 'a'), false)
})

test('a long sticky gets a gist; its title only when the title was just its first line', () => {
  const long = 'Thinking about the garage: ' + 'lots of words '.repeat(30)
  const s = space([sticky('l', long), sticky('own', long, { title: 'My garage plan' })])
  assert.equal(needsGist(s.notes[0]), true)
  const next = withGist(withGist(s, 'l', { title: 'Garage clear-out', gist: 'Clear the garage.' }), 'own', { title: 'Other', gist: 'Clear it.' })
  assert.equal(next.notes.find((note) => note.id === 'l').title, 'Garage clear-out')
  assert.equal(next.notes.find((note) => note.id === 'l').markdown, long, 'its own words never change')
  assert.equal(next.notes.find((note) => note.id === 'own').title, 'My garage plan')
  assert.equal(needsGist(next.notes[0]), false)
  const asked = fileRequests(next, [next.notes.find((note) => note.id === 'l')]).batches[0].messages[1].content
  assert.match(asked, /Clear the garage\./, 'the model reads the gist, not the long text')
})
