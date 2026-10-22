import assert from 'node:assert/strict'
import test from 'node:test'

import { clientTouch, isClient, setClient } from '../src/boards/boards-model.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'

const T0 = Date.UTC(2026, 9, 15, 9, 0)
const iso = (ms) => new Date(ms).toISOString()
const DAY = 86400000
const note = (id, markdown, extra = {}, at = 0) => ({ id, title: markdown.split('\n')[0], markdown, tags: [], createdAt: iso(T0 + at), updatedAt: iso(T0 + at), ...extra })
const state = normalizeWorkspace({
  ...createDefaultWorkspace(),
  folders: [
    { id: 'fortis', name: 'Fortis', createdAt: iso(T0), client: true },
    { id: 'demo', name: 'Demo', parentId: 'fortis', createdAt: iso(T0) },
    { id: 'home', name: 'Home', createdAt: iso(T0) },
  ],
  notes: [
    note('deck', 'Send the deck\n\nFrom Granola: [Fortis kickoff](https://notes.granola.ai/d/1)', { folderId: 'fortis', source: 'Granola', what: 'todo' }, DAY),
    note('pricing', 'Agree pricing\n\nFrom Granola: [Fortis kickoff](https://notes.granola.ai/d/1)', { unsorted: true, source: 'Granola', what: 'todo' }, DAY),
    note('call', 'Fortis call · Oct 20\n\n## In short\n\nWent well.\n\n#meeting', { folderId: 'demo', source: 'Meeting' }, 5 * DAY),
    note('call-t', 'Fortis call · Oct 20 · Transcript\n\nhello\n\n#meeting', { folderId: 'demo', source: 'Meeting' }, 5 * DAY),
    note('idea', 'A logo for the new site', { folderId: 'fortis' }, 2 * DAY),
    note('lunch', 'Lunch with fortis on Friday', { folderId: 'home' }, 3 * DAY),
    note('fortissimo', 'Practice the fortissimo bit', { folderId: 'home' }, 4 * DAY),
    { id: 'day-2026-10-18', kind: 'day', date: '2026-10-18', title: 'Saturday', markdown: 'Emailed Fortis the plan', createdAt: iso(T0 + 3.5 * DAY), updatedAt: iso(T0 + 3.5 * DAY) },
    note('gone', 'Fortis old note', { folderId: 'home', trashedAt: iso(T0) }, 6 * DAY),
  ],
})

test('a board is marked a client and back; only client: true is kept', () => {
  assert.equal(isClient(state.folders.find((folder) => folder.id === 'fortis')), true)
  const on = setClient(state, 'home', true)
  assert.equal(isClient(on.folders.find((folder) => folder.id === 'home')), true)
  const off = setClient(on, 'home', false)
  assert.equal('client' in off.folders.find((folder) => folder.id === 'home'), false)
  assert.equal(setClient(state, 'fortis', true).folders[0], state.folders[0], 'marking again changes nothing')
  assert.equal(normalizeWorkspace({ ...state, folders: [{ id: 'x', name: 'X', client: 'yes' }] }).folders[0].client, undefined)
})

test('a client page: its meetings once each, mentions elsewhere, never a transcript, a lookalike word or the Bin', () => {
  const { items, lastMet } = clientTouch(state, state.folders[0])
  assert.deepEqual(items.map((item) => [item.id, item.from]), [
    ['call', 'meeting'],
    ['day-2026-10-18', 'Day page'],
    ['lunch', 'Home'],
    ['granola:https://notes.granola.ai/d/1', 'granola'],
  ])
  assert.equal(items.find((item) => item.from === 'granola').title, 'Fortis kickoff')
  assert.equal(lastMet, T0 + 5 * DAY)
  // The board's own stickies are on the overview already; they aren't listed again.
  assert.equal(items.some((item) => item.noteId === 'idea'), false)
})

test('a client with no meetings: no last met; a two-letter name finds no mentions', () => {
  const ab = normalizeWorkspace({ ...state, folders: [{ id: 'ab', name: 'AB', client: true, createdAt: iso(T0) }], notes: [note('x', 'Call AB about it', {}, 0)] })
  assert.deepEqual(clientTouch(ab, ab.folders[0]), { items: [], lastMet: null })
})

test('schema 16: nothing changes on the way up', () => {
  assert.ok(SCHEMA >= 16)
  const old = { ...createEmptyDoc(), schema: 15, rev: 3, folders: [{ id: 'a', name: 'A', parentId: null, createdAt: iso(T0), collapsed: false }] }
  assert.deepEqual(migrate(old).folders, old.folders)
})
