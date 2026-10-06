import assert from 'node:assert/strict'
import test from 'node:test'
import { createNote, updateNote } from '../src/notes-model.js'
import { noteAiRequest, saveNoteAiResponse } from '../src/notes/note-ai.js'

test('note AI shares only the current note and explicitly selected active context, within a disclosed budget', () => {
  const source = { id: 'source', title: 'Current thought', markdown: 'My original writing' }
  const privateNote = { id: 'private', title: 'Private', markdown: 'Unselected secret' }
  const chosen = { id: 'chosen', title: 'Chosen', markdown: 'Useful selected context' }
  const text = (request) => request.messages.map((message) => message.content).join('\n')
  assert.match(text(noteAiRequest(source, 'summary')), /My original writing/)
  assert.doesNotMatch(text(noteAiRequest(source, 'summary')), /Unselected secret|Useful selected context/)
  const selected = noteAiRequest(source, 'untangle', [chosen, { ...privateNote, archived: true }, source])
  assert.match(text(selected), /Useful selected context/)
  assert.doesNotMatch(text(selected), /Unselected secret/)
  assert.equal(selected.truncated, false)
  const long = noteAiRequest({ ...source, markdown: 'a'.repeat(9000) }, 'steps', [{ ...chosen, markdown: 'b'.repeat(2000) }])
  assert.equal(long.truncated, true)
  assert.ok(long.messages[1].content.length < 12500)
  assert.throws(() => noteAiRequest({ ...source, markdown: ' ' }, 'summary'))
})

test('explicit AI save creates one linked note without changing the source or concurrent writing and placement', () => {
  let state = createNote({ notes: [], folders: [{ id: 'folder', name: 'Work' }] }, { id: 'source', title: 'Original', markdown: 'Writing\n', folderId: null }).state
  state = updateNote(state, 'source', { title: 'Renamed', markdown: 'Writing\nLater edits\n', folderId: 'folder', x: 42, y: 67 })
  const source = state.notes[0]
  const proposal = { id: 'note-response', task: 'summary', text: 'A reviewed summary.' }
  const next = saveNoteAiResponse(state, 'source', proposal)
  assert.strictEqual(next.notes[1], source)
  assert.equal(next.notes[0].folderId, 'folder')
  assert.equal(next.notes[0].markdown, 'From [[Renamed]]\n\nA reviewed summary.')
  assert.strictEqual(saveNoteAiResponse(next, 'source', proposal), next)
  assert.strictEqual(saveNoteAiResponse(state, 'missing', proposal), state)
  for (const patch of [{ archived: true }, { trashedAt: 'now' }]) {
    const unavailable = updateNote(state, 'source', patch)
    assert.strictEqual(saveNoteAiResponse(unavailable, 'source', proposal), unavailable)
  }
  assert.strictEqual(saveNoteAiResponse(state, 'source', { ...proposal, text: ' ' }), state)
})
