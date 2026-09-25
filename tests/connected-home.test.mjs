import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js';
import { captureThought, noteFromCapture, updateNote } from '../src/notes-model.js';
import { validateShelfFile, MAX_FILE_BYTES } from '../src/lib/file-store.js';

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

test('offline cache leaves changing development modules to the server', () => {
  const handlers = {};
  runInNewContext(readFileSync(new URL('../public/service-worker.js', import.meta.url), 'utf8'), { URL, self: { location: { origin: 'http://127.0.0.1:5221' }, addEventListener: (name, callback) => { handlers[name] = callback; } } });
  for (const path of ['/src/App.jsx', '/.vite-osat-home/deps/react.js', '/node_modules/.vite/react.js', '/@vite/client']) {
    let intercepted = false;
    handlers.fetch({ request: { url: `http://127.0.0.1:5221${path}`, method: 'GET', destination: 'script' }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});

test('file shelf validates size before attempting to write a browser copy', () => {
  assert.doesNotThrow(() => validateShelfFile({ name: 'notes.md', size: MAX_FILE_BYTES }));
  assert.throws(() => validateShelfFile({ name: 'video.mov', size: MAX_FILE_BYTES + 1 }), /larger than 25 MB/);
  assert.throws(() => validateShelfFile(null), /Choose a file/);
});
