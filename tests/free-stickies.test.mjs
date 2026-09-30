import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeNote } from '../shared/note-core.mjs'
import { applyOps, createEmptyDoc, diffDocs, migrate, SCHEMA, validateOps } from '../shared/store-core.mjs'
import { addFolder, addSticky, moveSticky, pileOf, placeSticky } from '../src/nodes-model.js'
import { updateNote } from '../src/notes-model.js'
import { makeBackup, normalizeWorkspace, readWorkspaceBackup } from '../src/osat-data.js'

test('free Sky stickies: capture with zero nodes, move the same note, save/reload, file, return and Undo without losing edits', () => {
  const original = createEmptyDoc()
  const made = addSticky(original, 'Call Tommy\nAsk about the bag', null, { at: { x: -240, y: 180 } })
  assert.equal(made.state.folders.length, 0, 'capture never creates an anchor')
  assert.deepEqual(made.note.at, { x: -240, y: 180 })
  assert.equal(pileOf(made.state.notes)[0].id, made.note.id, 'still available to Notes and Sort Unsorted')

  const moved = placeSticky(made.state, made.note.id, { x: 860, y: -90 })
  assert.equal(moved.notes.length, 1)
  assert.equal(moved.notes[0].id, made.note.id)
  assert.equal(moved.notes[0].source, made.note.source)
  const ops = validateOps(diffDocs(made.state, moved))
  const saved = applyOps(made.state, ops)
  const reloaded = normalizeWorkspace(migrate(JSON.parse(JSON.stringify(saved.doc))))
  assert.deepEqual(reloaded.notes[0].at, { x: 860, y: -90 })
  assert.deepEqual(readWorkspaceBackup(makeBackup(reloaded)).notes[0].at, reloaded.notes[0].at)

  const edited = updateNote(saved.doc, made.note.id, { markdown: 'Call Tommy\nNew words after moving' })
  const undone = applyOps(edited, saved.inverse).doc
  assert.deepEqual(undone.notes[0].at, made.note.at)
  assert.equal(undone.notes[0].markdown, edited.notes[0].markdown, 'Undo moves only; later writing stays')

  const node = addFolder(moved, 'Clients')
  const filed = moveSticky(node.state, made.note.id, node.folder.id)
  assert.equal(pileOf(filed.notes).length, 0, 'a filed sticky is not also shown freely')
  assert.equal(pileOf(filed.notes, node.folder.id)[0].id, made.note.id)
  const detached = placeSticky(filed, made.note.id, { x: -10, y: -20 })
  const returned = placeSticky(detached, made.note.id, null)
  assert.equal(returned.notes[0].folderId, null)
  assert.equal('at' in returned.notes[0], false, 'Back to Unsorted removes only the free placement')
  assert.equal(returned.notes[0].markdown, made.note.markdown)

  for (const at of [undefined, {}, { x: Infinity, y: 0 }, { x: 0, y: NaN }, { x: '4', y: 2 }]) {
    assert.equal(placeSticky(made.state, made.note.id, at), made.state, 'invalid geometry changes nothing')
    assert.equal('at' in normalizeNote({ ...made.note, at }), false)
  }
  assert.equal(placeSticky(made.state, 'missing', { x: 1, y: 2 }), made.state)
  for (const patch of [{ archived: true }, { trashedAt: '2026-09-29' }, { kind: 'day', date: '2026-09-29' }]) {
    const state = { ...made.state, notes: [{ ...made.note, ...patch }] }
    assert.equal(placeSticky(state, made.note.id, { x: 1, y: 2 }), state)
  }

  const old = { ...original, schema: 8 }
  assert.deepEqual(migrate(old), { ...old, schema: SCHEMA }, 'migration changes no existing notes or folders')
  assert.throws(() => migrate({ schema: SCHEMA + 1 }), /newer OSAT/)
})
