import assert from 'node:assert/strict'
import test from 'node:test'

import { noteHeading, noteKind, noteWhere } from '../src/assistant/ask-sources.js'
import { notesContext, outbound } from '../src/assistant/chats.js'
import { namedFolder, notesForQuestion, relatedForAsk } from '../src/assistant/work-scope.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const NOW = new Date(2026, 9, 6, 9, 0)
const day = (month, date) => new Date(2026, month, date, 12).toISOString()
const note = (id, extra = {}) => ({ id, title: id, markdown: id, createdAt: day(8, 1), updatedAt: day(8, 1), ...extra })
const folder = (id, extra = {}) => ({ id, name: id, createdAt: day(0, 1), ...extra })
const space = (notes, folders = []) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders })
const ids = (list) => list.map((item) => item.id)

test('a question that names a node pulls that node’s newest stickies, branches included', () => {
  const state = space(
    [note('Jordan likes tea', { folderId: 'jordan', updatedAt: day(8, 3) }), note('Jordan’s lease', { folderId: 'sub', updatedAt: day(8, 9) }), note('Old gift idea', { folderId: 'jordan', updatedAt: day(1, 1) }), note('Pasta', { folderId: 'food' })],
    [folder('jordan', { name: 'Jordan' }), folder('sub', { name: 'Lease', parentId: 'jordan' }), folder('food', { name: 'Food' })],
  )
  assert.equal(namedFolder(state.folders, 'what’s in my notes about jordan?').id, 'jordan')
  assert.equal(namedFolder(state.folders, 'anything about Jordanian cuisine?'), null, 'whole words only')
  assert.deepEqual(ids(relatedForAsk(state, 'what’s in my notes about Jordan?', NOW)).sort(), ['Jordan likes tea', 'Jordan’s lease', 'Old gift idea'].sort())
})

test('a time in the question keeps only what was touched since, and a bare time gives the newest stickies', () => {
  const state = space([
    note('Contract draft', { updatedAt: day(8, 20) }),
    note('Contract from spring', { updatedAt: day(2, 4) }),
    note('Groceries', { updatedAt: day(8, 25) }),
    note('Dentist', { updatedAt: day(9, 2) }),
  ])
  assert.deepEqual(ids(relatedForAsk(state, 'what did I write about the contract last month?', NOW)), ['Contract draft'])
  // "last month" reaches back to the 1st of last month (as in the Files room), so this month counts too.
  assert.deepEqual(ids(relatedForAsk(state, 'what did I write last month?', NOW)), ['Dentist', 'Groceries', 'Contract draft'], 'newest first, nothing from spring')
  assert.deepEqual(ids(relatedForAsk(state, 'what about the contract?', NOW)).sort(), ['Contract draft', 'Contract from spring'])
  const long = `${'I was thinking about so many things and trying to remember '.repeat(2)}what I wrote about the contract last month`
  assert.deepEqual(ids(relatedForAsk(state, long, NOW)), ['Contract draft'], 'a time at the end of a long question still counts')
})

test('the Bin stays out, and an explicit scope still wins', () => {
  const state = space([note('Contract', { trashedAt: day(8, 2) }), note('Contract two', { folderId: 'a' })], [folder('a', { name: 'Alpha' })])
  assert.deepEqual(ids(notesForQuestion(state, 'the contract')), ['Contract two'])
  assert.deepEqual(notesForQuestion(state, 'the contract', { scope: 'none' }), [])
  assert.deepEqual(ids(notesForQuestion(state, 'the contract', { noteIds: ['Contract two'] })), ['Contract two'])
})

test('each source says what it is and where it lives', () => {
  const folders = [folder('jordan', { name: 'Jordan' }), folder('lease', { name: 'Lease', parentId: 'jordan' })]
  const scan = note('Lease', { source: 'Scan', folderId: 'lease', updatedAt: day(8, 28) })
  assert.equal(noteKind(scan), 'Scan')
  assert.equal(noteKind(note('x', { kind: 'day' })), 'Journal')
  assert.equal(noteKind(note('x')), 'Sticky')
  assert.equal(noteWhere(scan, folders), 'in Jordan / Lease')
  assert.equal(noteWhere(note('x'), folders), 'in Unsorted')
  assert.equal(noteWhere(note('x', { at: { x: 1, y: 2 } }), folders), 'on the Sky')
  assert.equal(noteHeading(scan, folders), 'SCAN: Lease (in Jordan / Lease, edited Sep 28, 2026)')
})

test('Ask’s prompt labels what it read; other callers keep the plain NOTE label', () => {
  const folders = [folder('jordan', { name: 'Jordan' })]
  const notes = [note('Tea', { folderId: 'jordan', markdown: 'Jordan likes tea.' })]
  assert.match(notesContext(notes, ['Tea'], folders), /^STICKY: Tea \(in Jordan, edited Sep 1, 2026\)\nJordan likes tea\.$/)
  assert.equal(notesContext(notes, ['Tea']), 'NOTE: Tea\nJordan likes tea.')
  const sent = outbound('sys', [], 'Tea?', notes, ['Tea'], [], folders)
  assert.match(sent.at(-1).content, /\[FROM MY NOTES — use them if they help\]\nSTICKY: Tea/)
})
