import assert from 'node:assert/strict'
import test from 'node:test'

import { applyOps, diffDocs, migrate, SCHEMA, validateOps } from '../shared/store-core.mjs'
import { connect, connected, disconnect, edgePath, folderKey, linksAt, linksOf, noteKey } from '../src/links-model.js'
import { addFolder, addSticky, moveFolder, moveSticky, placeSticky, removeFolder } from '../src/nodes-model.js'
import { trashNotes } from '../src/notes-model.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const at = new Date(Date.UTC(2026, 8, 30, 9)).toISOString()
const note = (id, extra = {}) => ({ id, title: id, markdown: id, createdAt: at, updatedAt: at, ...extra })
const folder = (id, extra = {}) => ({ id, name: id, createdAt: at, ...extra })
const space = (notes = [], folders = []) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders })

test('connections: drawn once between any two things, never filing or moving either end', () => {
  const state = space([note('a', { folderId: 'features' }), note('b'), note('c')], [folder('features'), folder('clients')])
  const one = connect(state, noteKey('a'), noteKey('b'))
  assert.deepEqual(one.notes.find((item) => item.id === 'a').links, ['note:b'])
  assert.equal(one.notes.find((item) => item.id === 'a').folderId, 'features', 'the sticky keeps its one home')
  assert.equal(one.notes.find((item) => item.id === 'b').folderId, null)
  assert.equal(connected(one, noteKey('b'), noteKey('a')), true, 'either way round')
  assert.equal(connect(one, noteKey('b'), noteKey('a')), one, 'no second line between the same two')
  assert.equal(connect(one, noteKey('c'), noteKey('c')), one, 'never to itself')
  assert.equal(connect(one, noteKey('c'), noteKey('gone')), one, 'never to something not there')

  const mixed = connect(one, noteKey('c'), folderKey('clients'))
  assert.deepEqual(linksOf(mixed).map((link) => [link.a, link.b]), [['note:a', 'note:b'], ['note:c', 'folder:clients']])
  assert.deepEqual(linksAt(mixed, noteKey('b')), ['note:a'])

  const cut = disconnect(mixed, noteKey('b'), noteKey('a'))
  assert.equal('links' in cut.notes.find((item) => item.id === 'a'), false, 'removed from the end it was drawn from')
  assert.equal(linksOf(cut).length, 1)

  // A sticky in the Bin keeps its line for Undo, but it isn't drawn while it's there.
  const binned = trashNotes(mixed, ['b'])
  assert.deepEqual(linksOf(binned).map((link) => link.key), ['folder:clients|note:c'])
  // Deleting a node takes the lines to it (and to its branches) away.
  assert.equal(linksOf(removeFolder(mixed, 'clients')).length, 1)
  assert.equal('links' in removeFolder(mixed, 'clients').notes.find((item) => item.id === 'c'), false)
})

test('connections survive saving, reloading and Undo', () => {
  const state = space([note('a'), note('b')])
  const next = connect(state, noteKey('a'), noteKey('b'))
  const ops = validateOps(diffDocs(state, next))
  const saved = applyOps(state, ops)
  const reloaded = normalizeWorkspace(migrate(JSON.parse(JSON.stringify(saved.doc))))
  assert.deepEqual(reloaded.notes.find((item) => item.id === 'a').links, ['note:b'])
  assert.equal(linksOf(applyOps(saved.doc, saved.inverse).doc).length, 0)
  // Only well-formed ends are kept.
  const odd = normalizeWorkspace({ ...createDefaultWorkspace(), notes: [note('x', { links: ['note:b', 'note:b', 'folder:', 'nope', 7, 'note:b c'] })] })
  assert.deepEqual(odd.notes[0].links, ['note:b'])
})

test('old folder links (schema 3) read as connections; a folder never links to itself or to one that is gone', () => {
  const state = space([], [folder('x', { links: ['y', 'x', 'gone', 'note:n1'] }), folder('y')])
  assert.deepEqual(state.folders[0].links, ['folder:y', 'note:n1'])
})

test('schema 10: a place kept by something with a parent is laid out afresh; nothing else changes', () => {
  const old = {
    schema: 9,
    notes: [note('free', { at: { x: 5, y: 6 } }), note('filed', { folderId: 'n', at: { x: 1, y: 2 } }), note('plain')],
    folders: [folder('n', { at: { x: 100, y: 0 } }), folder('b', { parentId: 'n', at: { x: 9, y: 9 } }), folder('loose', { kind: 'branch', at: { x: -50, y: 20 } })],
  }
  const doc = migrate(old)
  assert.equal(doc.schema, SCHEMA)
  assert.deepEqual(doc.notes.map((item) => item.at || null), [{ x: 5, y: 6 }, null, null])
  assert.deepEqual(doc.folders.map((item) => item.at || null), [{ x: 100, y: 0 }, null, { x: -50, y: 20 }])
  assert.equal(doc.notes[1].folderId, 'n', 'nothing is re-filed')
  assert.deepEqual(migrate({ ...old, notes: [], folders: [] }), { ...old, notes: [], folders: [], schema: SCHEMA, rev: 0 })
})

test('a new home lays a sticky or branch out afresh; moving inside the same home keeps its place', () => {
  let state = space()
  let made = addFolder(state, 'Clients')
  state = made.state
  const clients = made.folder.id
  made = addFolder(state, 'Tommy', clients)
  state = made.state
  const tommy = made.folder.id
  const sticky = addSticky(state, 'Call Tommy', clients)
  state = sticky.state
  const id = sticky.note.id
  const hung = { ...state, notes: state.notes.map((item) => (item.id === id ? { ...item, at: { x: 260, y: -40 } } : item)) }
  assert.deepEqual(moveSticky(hung, id, clients, 0).notes.find((item) => item.id === id).at, { x: 260, y: -40 }, 'reordered in the same node')
  assert.equal('at' in moveSticky(hung, id, tommy).notes.find((item) => item.id === id), false, 'into a branch')
  assert.equal('at' in moveSticky(hung, id, null).notes.find((item) => item.id === id), false, 'back to the Unsorted pile')
  assert.deepEqual(placeSticky(hung, id, { x: 1, y: 2 }).notes.find((item) => item.id === id).at, { x: 1, y: 2 }, 'set down on its own')

  const placed = { ...hung, folders: hung.folders.map((item) => (item.id === tommy ? { ...item, at: { x: 300, y: 0 } } : item)) }
  assert.deepEqual(moveFolder(placed, tommy, clients, 0).folders.find((item) => item.id === tommy).at, { x: 300, y: 0 })
  assert.equal('at' in moveFolder(placed, tommy, null, Infinity, { loose: true }).folders.find((item) => item.id === tommy), false)
})

test('edgePath joins the sides that face each other', () => {
  const left = { x: 0, y: 0, w: 100, h: 60 }
  assert.match(edgePath(left, { x: 300, y: 10, w: 100, h: 60 }).d, /^M100 30 C/, 'side by side: from the right edge')
  assert.match(edgePath({ x: 300, y: 10, w: 100, h: 60 }, left).d, /^M300 40 C/, 'from the left edge going left')
  assert.match(edgePath(left, { x: 10, y: 400, w: 100, h: 60 }).d, /^M50 60 C/, 'one above the other: from the bottom edge')
  assert.deepEqual(edgePath(left, { x: 300, y: 0, w: 100, h: 60 }).mid, { x: 200, y: 30 })
})
