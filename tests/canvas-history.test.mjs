import assert from 'node:assert/strict'
import test from 'node:test'
import { canvasChange, replayCanvas } from '../src/sky/canvas-history.js'
import { arrangeTopics } from '../src/sky/arrange.js'
import { moveFolder, moveSticky, placeSticky } from '../src/nodes-model.js'
import { connect, disconnect } from '../src/links-model.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const fixture = () => normalizeWorkspace({ ...createDefaultWorkspace(), folders: [
  { id: 'a', name: 'A', at: { x: 800, y: 900 } }, { id: 'b', name: 'B', at: { x: -700, y: 20 } },
  { id: 'branch', name: 'Branch', parentId: 'a', at: { x: 300, y: 600 } },
], notes: [{ id: 'n', title: 'Keep', markdown: 'Original', folderId: 'branch', at: { x: 50, y: 70 } }] })

test('multiple moves and arrangement undo and redo without replacing later writing or records', () => {
  const before = fixture(), arranged = arrangeTopics(before), moved = moveSticky(arranged, 'n', 'b')
  const arrange = canvasChange(before, arranged, 'Arrange'), move = canvasChange(arranged, moved, 'Move')
  const edited = { ...moved, notes: [{ ...moved.notes[0], markdown: 'Later writing', color: 'mint' }, { id: 'new', markdown: 'New writing' }] }
  const undone = replayCanvas(replayCanvas(edited, move, 'undo').state, arrange, 'undo').state
  assert.deepEqual(undone.folders, before.folders)
  assert.equal(undone.notes[0].markdown, 'Later writing')
  assert.equal(undone.notes[0].color, 'mint')
  assert.deepEqual(undone.notes[0].at, before.notes[0].at)
  assert.equal(undone.notes.length, 2)
  const redone = replayCanvas(replayCanvas(undone, arrange, 'redo').state, move, 'redo').state
  assert.equal(redone.notes[0].folderId, 'b')
  assert.equal(redone.notes[0].markdown, 'Later writing')
  assert.deepEqual(redone.folders, arranged.folders)
  assert.equal(canvasChange(before, { ...before, notes: [{ ...before.notes[0], markdown: 'Just writing' }] }, 'Write'), null)
})

test('Undo keeps newer positions and homes, skips deleted destinations and never revives deleted or trashed records', () => {
  const before = fixture(), moved = placeSticky(before, 'n', { x: 300, y: 400 })
  const entry = canvasChange(before, moved, 'Move')
  for (const newer of [placeSticky(moved, 'n', { x: 900, y: 800 }), moveSticky(moved, 'n', 'a'),
    { ...moved, notes: [] }, { ...moved, notes: [{ ...moved.notes[0], trashedAt: '2026-10-05' }] },
    { ...moved, folders: moved.folders.filter((folder) => folder.id !== 'branch') }]) {
    assert.equal(replayCanvas(newer, entry, 'undo').state, newer)
  }
  assert.equal(replayCanvas(before, entry, 'redo').state.notes[0].at.x, 300)
})

test('connection Undo and Redo preserve writing and later connections and require live endpoints', () => {
  const before = fixture(), linked = connect(before, 'note:n', 'folder:b')
  const entry = canvasChange(before, linked, 'Connect')
  assert.deepEqual(replayCanvas(linked, entry, 'undo').state.notes[0].links, before.notes[0].links)
  assert.deepEqual(replayCanvas(before, entry, 'redo').state.notes[0].links, ['folder:b'])
  const newer = connect(linked, 'note:n', 'folder:a')
  assert.equal(replayCanvas(newer, entry, 'undo').state, newer)
  const removed = disconnect(linked, 'note:n', 'folder:b')
  const removal = canvasChange(linked, removed, 'Disconnect')
  assert.deepEqual(replayCanvas(removed, removal, 'undo').state.notes[0].links, ['folder:b'])
  const missing = { ...removed, folders: removed.folders.filter((folder) => folder.id !== 'b') }
  assert.equal(replayCanvas(missing, removal, 'undo').state, missing)
})

test('branch move Undo preserves later names and refuses to create a hierarchy cycle', () => {
  const before = fixture(), moved = moveFolder(before, 'branch', 'b')
  const entry = canvasChange(before, moved, 'Move branch')
  const named = { ...moved, folders: moved.folders.map((folder) => folder.id === 'branch' ? { ...folder, name: 'Later name' } : folder) }
  const undone = replayCanvas(named, entry, 'undo').state
  assert.equal(undone.folders.find((folder) => folder.id === 'branch').name, 'Later name')
  assert.equal(undone.folders.find((folder) => folder.id === 'branch').parentId, 'a')
  const cyclic = moveFolder(moved, 'a', 'branch')
  assert.equal(replayCanvas(cyclic, entry, 'undo').state, cyclic)
})
