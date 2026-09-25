import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js';
import { captureThought, noteFromCapture, updateNote } from '../src/notes-model.js';

test('a captured thought is one editable note across inbox, notes and Mindmap, including after reload', () => {
  const before = createDefaultWorkspace();
  assert.equal(captureThought(before, '  ').state, before);
  const captured = captureThought(before, 'A new chapter\n\nKeep [[Reading list]] close. #personal');
  const reloaded = normalizeWorkspace(captured.state);
  const note = reloaded.notes.find((item) => item.id === captured.note.id);
  assert.equal(note.title, 'A new chapter');
  assert.equal(note.markdown, 'A new chapter\n\nKeep [[Reading list]] close. #personal');
  assert.equal(note.originCaptureId, reloaded.capture.id);
  assert.ok(reloaded.sorter.boards[0].notes.some((card) => card.id === note.id));
  const edited = updateNote(reloaded, note.id, { markdown: 'Edited in Notes' });
  const reopened = noteFromCapture(edited, reloaded.capture);
  assert.equal(reopened.note.id, note.id);
  assert.equal(reopened.note.markdown, 'Edited in Notes');
  assert.equal(reopened.state.notes.length, reloaded.notes.length);
  assert.equal(before.notes.length, 0);
});
