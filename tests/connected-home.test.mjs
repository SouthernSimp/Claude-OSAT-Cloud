import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js';
import { captureThought, keepNotes, moveNotes, notesInList, noteCounts, createFolder } from '../src/notes-model.js';

test('a captured thought is one unsorted note, on the Mindmap too, including after reload', () => {
  const before = createDefaultWorkspace();
  assert.equal(captureThought(before, '  ').state, before);
  const captured = captureThought(before, 'A new chapter\n\nKeep [[Reading list]] close. #personal', 'Overlay');
  const reloaded = normalizeWorkspace(captured.state);
  const note = reloaded.notes.find((item) => item.id === captured.note.id);
  assert.equal(reloaded.notes.length, 1);
  assert.equal(note.title, 'A new chapter');
  assert.equal(note.markdown, 'A new chapter\n\nKeep [[Reading list]] close. #personal');
  assert.deepEqual(note.tags, ['personal']);
  assert.equal(note.unsorted, true);
  assert.equal(note.source, 'Overlay');
  assert.ok(reloaded.sorter.boards[0].notes.some((card) => card.id === note.id));
  assert.deepEqual(notesInList(reloaded, 'unsorted').map((item) => item.id), [note.id]);
  assert.equal(noteCounts(reloaded).unsorted, 1);
});

test('a sticky stays in Unsorted until it is in a node', () => {
  const folder = createFolder('Ideas');
  let state = { ...createDefaultWorkspace(), folders: [folder] };
  const first = captureThought(state, 'one');
  const second = captureThought(first.state, 'two');
  state = keepNotes(second.state, [first.note.id]);
  assert.equal(state.notes.find((item) => item.id === first.note.id).unsorted, false);
  assert.deepEqual(notesInList(state, 'unsorted').map((item) => item.id).sort(), [first.note.id, second.note.id].sort(), 'kept, but in no node yet');
  state = moveNotes(state, [first.note.id, second.note.id], folder.id);
  assert.deepEqual(notesInList(state, 'unsorted'), []);
  assert.deepEqual(notesInList(state, 'unfiled'), [], 'the old Unfiled list is Unsorted');
});
