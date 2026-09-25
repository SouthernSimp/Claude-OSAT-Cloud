/* End-to-end check of the packaged OSAT V2 app, offline, in an isolated data
   folder: Notes (folders, wikilinks, tasks) and Mindmap (composer, cards,
   cluster), then what actually reached the local database.
   Run after `npm run dist:mac`:
     node tests/offline-qa.mjs */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.OSAT_PLAYWRIGHT || '/Users/nate/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const qa = await mkdtemp(path.join(tmpdir(), 'osat-v2-qa-'));
const entry = path.join(root, 'release/mac-arm64/OSAT V2.app/Contents/Resources/app.asar/desktop/main.cjs');

const app = await _electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: [path.join(root, 'tests/electron-qa-entry.cjs')],
  env: { ...process.env, OSAT_QA_DATA: qa, OSAT_QA_ENTRY: entry },
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.log('UI error:', error.message); });
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Notes', exact: true }).first().waitFor();
  console.log('Data path:', await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData')));

  // Notes: a folder, a note inside it with a task and a wikilink.
  await page.getByRole('button', { name: 'Notes', exact: true }).first().click();
  await page.getByRole('button', { name: 'New folder' }).first().click();
  await page.getByLabel('Folder name').fill('QA folder');
  await page.getByLabel('Folder name').press('Enter');
  await page.getByRole('heading', { name: 'QA folder' }).waitFor();
  await page.getByRole('button', { name: 'New note' }).first().click();
  await page.getByLabel('Note title').fill('Offline plan');
  await page.getByLabel('Note text').fill('# Offline plan\n\n- [ ] Ship it #qa\n\nSee [[Second note]].');
  await page.getByRole('tab', { name: 'Read' }).click();
  await page.getByRole('checkbox', { name: 'Mark as done' }).click();
  await page.getByRole('button', { name: 'Second note' }).click();
  await page.getByLabel('Note title').waitFor();
  assert.equal(await page.getByLabel('Note title').inputValue(), 'Second note');
  await page.getByRole('tab', { name: 'Write' }).click();

  // Mindmap: both notes are on the desk; the composer places a third; cluster by tag.
  await page.getByRole('button', { name: 'Mindmap', exact: true }).first().click();
  await page.locator('.card').nth(1).waitFor();
  await page.getByLabel('New note').fill('Composer card #qa');
  await page.getByLabel('New note').press('Enter');
  await page.locator('.card').nth(2).waitFor();
  await page.getByRole('button', { name: 'Sort by tag' }).click();
  await page.locator('.frame').first().waitFor();
  assert.ok((await page.locator('.frame').count()) >= 2, 'clusters become frames');

  // Let the trailing save land, then read the database directly.
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('osat-field-local-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const query = db.transaction('workspace').objectStore('workspace').get('primary');
      query.onsuccess = () => { resolve(JSON.parse(JSON.stringify(query.result))); db.close(); };
    };
  }));
  assert.equal(state.folders.length, 1);
  assert.equal(state.notes.length, 3);
  assert.ok(state.notes.find((note) => note.title === 'Offline plan').markdown.includes('- [x] Ship it'), 'task toggled from reading view');
  assert.equal(state.notes.find((note) => note.title === 'Offline plan').folderId, state.folders[0].id);
  assert.equal(state.sorter.boards[0].notes.length, 3);
  assert.ok(state.sorter.boards[0].groups.length >= 2);
  assert.deepEqual(errors, []);
  console.log('Offline QA passed:', { notes: state.notes.length, folders: state.folders.length, cards: state.sorter.boards[0].notes.length, frames: state.sorter.boards[0].groups.length });
} finally {
  await app.close();
}
