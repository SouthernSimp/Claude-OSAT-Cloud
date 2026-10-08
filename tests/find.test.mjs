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

test('topics by name open laid out on the canvas', () => {
  const rows = findAll(workspace, 'trip')
  const folder = rows.find((row) => row.kind === 'folder')
  assert.deepEqual(folder?.go, ['Mindmap', { folderId: 'f-trips' }])
  assert.equal(folder?.hint, 'Topic')
  assert.ok(!rows.some((row) => row.kind === 'board'), 'the old boards are not offered')
})

test('a topic or branch is found by its name even when many notes match, and ahead of them', () => {
  const crowded = {
    ...workspace,
    folders: [...workspace.folders, { id: 'f-later', name: 'Later ideas', parentId: 'f-trips', createdAt: at(1) }],
    notes: [...workspace.notes, ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `n-later-${n}`, title: `Do it later ${n}`, markdown: 'later', tags: [], updatedAt: at(10 + n) }))],
  }
  const rows = findAll(crowded, 'later')
  assert.equal(rows.length, 5)
  assert.equal(rows[0].key, 'folder:f-later', 'the branch comes before the notes, though six notes match')
  assert.equal(rows[0].hint, 'Trips')
  assert.deepEqual(findAll(crowded, 'ideas later')[0].go, ['Mindmap', { folderId: 'f-later' }], 'every word of the name, in any order')
  assert.ok(findAll(crowded, 'later', { files: [{ rootId: 'desktop', relative: 'later.txt', name: 'later.txt', kind: 'file' }] }).some((row) => row.kind === 'file'), 'files still get a row')
})

test('rooms by the start of their words, ahead of notes', () => {
  assert.deepEqual(findAll(workspace, 'cal')[0], { key: 'room:Calendar', label: 'Calendar', hint: 'The month, and the day in it', kind: 'room', go: ['Calendar'] })
  assert.ok(!findAll(workspace, 'endar').some((row) => row.kind === 'room'))
  assert.ok(!findAll(workspace, 'desk').some((row) => row.go[0] === 'Today'), 'the desk is where the line already is')
})

test('actions answer to their other words', () => {
  for (const word of ['offline', 'online', 'incognito', 'private', 'wifi']) {
    assert.deepEqual(findAll(workspace, word)[0].go, ['Offline'], word)
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


test('the quick bar’s own commands: a sticky, a question, the clipboard; the line keeps its own rows instead', () => {
  const bar = (word) => findAll(workspace, word, { bar: true, limit: 30 }).filter((row) => row.kind === 'action').map((row) => row.key)
  assert.ok(bar('sticky').includes('act:sticky'))
  assert.ok(bar('ask').includes('act:ask'))
  assert.ok(bar('clipboard').includes('act:clipboard'))
  assert.ok(!findAll(workspace, 'sticky').some((row) => row.key === 'act:sticky'), 'the line already saves a sticky with Return')
  assert.ok(!findAll(workspace, 'ask').some((row) => row.key === 'act:ask'))
  assert.deepEqual(findAll(workspace, 'clipboard').find((row) => row.key === 'act:clipboard')?.go, ['Clipboard'], '⌘K on the desk opens the bar on the clipboard')
})
