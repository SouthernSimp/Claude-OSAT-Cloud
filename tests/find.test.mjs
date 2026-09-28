import assert from 'node:assert/strict'
import test from 'node:test'

import { findAll } from '../src/lib/find.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const at = (day) => `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`
const workspace = {
  ...normalizeWorkspace({
    ...createDefaultWorkspace(),
    folders: [{ id: 'f-trips', name: 'Trips', parentId: null }],
    notes: [
      { id: 'n-tent', title: 'Tent repair', markdown: 'Patch the tent before the trip #gear', tags: ['gear'], folderId: 'f-trips', updatedAt: at(3) },
      { id: 'n-pack', title: 'Packing list', markdown: 'Tent, stove, a good book', tags: [], updatedAt: at(5) },
      { id: 'n-old', title: 'Garden', markdown: 'Tomatoes', tags: [], updatedAt: at(1) },
      { id: 'n-gone', title: 'Tent (trashed)', markdown: 'tent', tags: [], trashedAt: at(2), updatedAt: at(9) },
      ...[6, 7, 8].map((day) => ({ id: `n-${day}`, title: `Tent day ${day}`, markdown: '', tags: [], updatedAt: at(day) })),
    ],
  }),
  sorter: { boards: [{ id: 'b-trip', name: 'Trip board', notes: ['n-tent'] }] },
}
const keys = (rows) => rows.map((row) => row.key)

test('words match title and text, newest first, title matches ahead; trashed notes never', () => {
  const rows = findAll(workspace, 'stove')
  assert.deepEqual(keys(rows), ['note:n-pack'])
  assert.deepEqual(rows[0].go, ['Notes', { noteId: 'n-pack' }])
  const tent = findAll(workspace, 'tent')
  assert.ok(!keys(tent).includes('note:n-gone'))
  assert.equal(tent[0].key, 'note:n-8', 'a title match, newest first')
})

test('#tags require the tag and leave rooms and folders out', () => {
  assert.deepEqual(keys(findAll(workspace, '#gear')), ['note:n-tent'])
  assert.deepEqual(keys(findAll(workspace, '#gear patch')), ['note:n-tent'])
  assert.deepEqual(keys(findAll(workspace, '#nothing')), [])
})

test('nodes by name open laid out in the Sky', () => {
  const rows = findAll(workspace, 'trip')
  const folder = rows.find((row) => row.kind === 'folder')
  assert.deepEqual(folder?.go, ['Mindmap', { folderId: 'f-trips' }])
  assert.equal(folder?.hint, 'Node')
  assert.ok(!rows.some((row) => row.kind === 'board'), 'the old boards are not offered')
})

test('rooms by the start of their words, ahead of notes', () => {
  assert.deepEqual(findAll(workspace, 'cal')[0], { key: 'room:Calendar', label: 'Calendar', hint: 'The month, and the day in it', kind: 'room', go: ['Calendar'] })
  assert.ok(!findAll(workspace, 'endar').some((row) => row.kind === 'room'))
  assert.ok(!findAll(workspace, 'desk').some((row) => row.go[0] === 'Today'), 'the desk is where the line already is')
})

test('actions answer to their other words', () => {
  for (const word of ['under', 'incognito', 'offline', 'private', 'go under']) {
    assert.deepEqual(findAll(workspace, word)[0].go, ['Under'], word)
  }
  for (const word of ['focus', 'pomodoro', 'timer']) {
    assert.deepEqual(findAll(workspace, word)[0].go, ['Focus'], word)
  }
  assert.deepEqual(findAll(workspace, 'new note').find((row) => row.kind === 'action').go, ['Notes', { action: 'new' }])
  for (const word of ['add a widget', 'widget', 'widgets']) {
    assert.deepEqual(findAll(workspace, word)[0].go, ['Widgets'], word)
  }
  assert.ok(!findAll(workspace, 'habits').some((row) => row.go[0] === 'Widgets'), 'a room\'s name finds the room, not the tray')
})

test('hidden rooms are found by name: Now playing', () => {
  assert.deepEqual(findAll(workspace, 'now playing')[0].go, ['NowPlaying'])
})

test('files on this Mac come in as rows, and notes make room for them', () => {
  const files = [
    { rootId: 'desktop', relative: 'Plans/tent.pdf', name: 'tent.pdf', kind: 'file' },
    { rootId: 'documents', relative: 'Tents', name: 'Tents', kind: 'folder' },
  ]
  const rows = findAll(workspace, 'tent', { files })
  assert.equal(rows.filter((row) => row.kind === 'note').length, 3)
  const pdf = rows.find((row) => row.kind === 'file')
  assert.equal(pdf.hint, 'Desktop / Plans')
  assert.deepEqual(pdf.go, ['Files', { rootId: 'desktop', relative: 'Plans', select: 'Plans/tent.pdf' }])
  assert.deepEqual(rows.find((row) => row.kind === 'mac-folder').go, ['Files', { rootId: 'documents', relative: 'Tents' }])
})

test('at most five, however much matches', () => {
  const files = Array.from({ length: 8 }, (_, index) => ({ rootId: 'desktop', relative: `t${index}.txt`, name: `t${index}.txt`, kind: 'file' }))
  assert.equal(findAll(workspace, 't', { files }).length, 5)
  assert.equal(findAll(workspace, 'tent').length, 5)
})

test('an empty line jumps: the four latest notes, then the spaces', () => {
  const rows = findAll(workspace, '  ')
  assert.deepEqual(keys(rows).slice(0, 4), ['note:n-8', 'note:n-7', 'note:n-6', 'note:n-pack'])
  assert.deepEqual(rows.slice(4).map((row) => row.go[0]), ['Notes', 'Mindmap', 'Assistant', 'Files'])
})

test('under, only notes: no rooms, actions, folders or files', () => {
  const files = [{ rootId: 'desktop', relative: 'trip.txt', name: 'trip.txt', kind: 'file' }]
  assert.ok(findAll(workspace, 'trip', { files, under: true }).every((row) => row.kind === 'note'))
  assert.deepEqual(findAll(workspace, 'under', { under: true }), [])
  assert.ok(findAll(workspace, '', { under: true }).every((row) => row.kind === 'note'))
})
