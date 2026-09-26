import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createPhoneBridge, fileName, mirrorPlan } = require('../desktop/phone.cjs')

const made = []
const temp = async () => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-phone-')); made.push(dir); return dir }
after(() => Promise.all(made.map((dir) => fs.rm(dir, { recursive: true, force: true }))))

const note = (id, title, extra = {}) => ({ id, title, markdown: `${title} body`, createdAt: `2026-09-2${id.length}T00:00:00.000Z`, folderId: null, ...extra })

test('each note has one place in the copy: its folder, Unsorted, or Days', () => {
  const folders = [{ id: 'f1', name: 'Home', parentId: null }, { id: 'f2', name: 'Garden: beds', parentId: 'f1' }]
  const plan = mirrorPlan([
    note('a', 'Tomatoes', { folderId: 'f2' }),
    note('bb', 'Loose thought', { unsorted: true }),
    note('ccc', 'Friday, September 25', { kind: 'day', date: '2026-09-25' }),
    note('dddd', 'Plan'),
    note('eeeee', 'plan'),
    note('ffffff', 'Gone', { trashedAt: '2026-09-25T00:00:00.000Z' }),
    note('ggggggg', 'Old', { archived: true }),
  ], folders)
  assert.equal(plan.get('a').relative, path.join('Home', 'Garden beds', 'Tomatoes.md'))
  assert.equal(plan.get('bb').relative, path.join('Unsorted', 'Loose thought.md'))
  assert.equal(plan.get('ccc').relative, path.join('Days', '2026-09-25.md'))
  assert.equal(plan.get('dddd').relative, 'Plan.md')
  assert.equal(plan.get('eeeee').relative, 'plan (2).md', 'names that differ only in case get a number')
  assert.equal(plan.has('ffffff') || plan.has('ggggggg'), false)
  assert.equal(plan.get('a').content, 'Tomatoes body\n')
  assert.equal(fileName('  ../a/b:c\u0007  '), 'a b c')
  assert.equal(fileName(''), 'Untitled')
})

async function bridge() {
  const root = await temp()
  const captured = []
  let notes = []
  const phone = createPhoneBridge({
    root,
    capture: (text) => captured.push(text),
    snapshot: () => ({ notes, folders: [] }),
    now: () => Date.now() + 60_000, // every file has settled
  })
  await phone.prepare()
  return { root, phone, captured, setNotes: (next) => { notes = next } }
}

test('text dropped in the Inbox becomes a thought and moves to Added', async () => {
  const { root, phone, captured } = await bridge()
  const inbox = path.join(root, 'Inbox')
  await fs.writeFile(path.join(inbox, 'Text.txt'), '﻿Call the vet\nabout Friday\n')
  await fs.writeFile(path.join(inbox, 'Idea.md'), '# Garden\nMore garlic')
  await fs.writeFile(path.join(inbox, 'empty.txt'), '   ')
  await fs.writeFile(path.join(inbox, '.hidden.txt'), 'secret')
  await fs.writeFile(path.join(inbox, 'photo.jpg'), 'not text')
  await fs.writeFile(path.join(root, 'Inbox', 'Added', 'Text.txt'), 'an older one')
  assert.equal(await phone.scan(), 2)
  assert.deepEqual(captured.sort(), ['# Garden\nMore garlic', 'Call the vet\nabout Friday'])
  assert.deepEqual((await fs.readdir(inbox)).sort(), ['.hidden.txt', 'Added', 'photo.jpg'])
  assert.deepEqual((await fs.readdir(path.join(inbox, 'Added'))).sort(), ['Idea.md', 'Text 2.txt', 'Text.txt', 'empty.txt'])
  assert.ok(phone.status().lastCapture)
  assert.equal(await phone.scan(), 0, 'a file is only ever taken once')
  assert.ok((await fs.readFile(path.join(root, 'What lives here.txt'), 'utf8')).includes('Inbox'))
})

test('a file still arriving from iCloud waits for the next look', async () => {
  const root = await temp()
  const captured = []
  const phone = createPhoneBridge({ root, capture: (text) => captured.push(text), snapshot: () => ({ notes: [], folders: [] }) })
  await phone.prepare()
  await fs.writeFile(path.join(root, 'Inbox', 'Text.txt'), 'Just now')
  assert.equal(await phone.scan(), 0)
  assert.deepEqual(captured, [])
})

test('the copy follows renames and the Trash, and only OSAT’s own files are ever removed', async () => {
  const { root, phone, setNotes } = await bridge()
  const notesDir = path.join(root, 'Notes')
  await fs.writeFile(path.join(notesDir, 'Mine.md'), 'written by Nate on the phone')
  setNotes([note('a', 'Garden'), note('bb', 'Taxes')])
  await phone.mirror()
  assert.equal(await fs.readFile(path.join(notesDir, 'Garden.md'), 'utf8'), 'Garden body\n')
  setNotes([note('a', 'Garden plans', { markdown: 'Garlic in October' }), note('bb', 'Taxes', { trashedAt: 'x' })])
  await phone.mirror()
  const files = (await fs.readdir(notesDir)).sort()
  assert.deepEqual(files, ['.osat-mirror.json', 'Garden plans.md', 'Mine.md'])
  assert.equal(await fs.readFile(path.join(notesDir, 'Garden plans.md'), 'utf8'), 'Garlic in October\n')

  // A manifest changed elsewhere cannot point OSAT outside the Notes folder.
  await fs.writeFile(path.join(root, 'outside.txt'), 'keep me')
  await fs.writeFile(path.join(notesDir, '.osat-mirror.json'), JSON.stringify({ files: { x: '../outside.txt', y: '/etc/hosts' } }))
  const fresh = createPhoneBridge({ root, capture: () => {}, snapshot: () => ({ notes: [], folders: [] }) })
  await fresh.mirror()
  assert.equal(await fs.readFile(path.join(root, 'outside.txt'), 'utf8'), 'keep me')

  await phone.removeCopies()
  assert.deepEqual((await fs.readdir(notesDir)).sort(), ['Mine.md'])
})
