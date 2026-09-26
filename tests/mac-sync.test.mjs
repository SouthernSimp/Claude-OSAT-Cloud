import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { createRequire } from 'node:module'
import * as core from '../shared/store-core.mjs'
import { createSyncEngine } from '../shared/sync-engine.mjs'

const require = createRequire(import.meta.url)
const { createStore } = require('../desktop/store/index.cjs')
const { createMacSync } = require('../desktop/sync.cjs')

const made = []
const temp = async () => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-sync-')); made.push(dir); return dir }
after(() => Promise.all(made.map((dir) => fs.rm(dir, { recursive: true, force: true }))))

const note = (id, title = id) => ({ id, title, markdown: '', tags: [], createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', folderId: null, pinned: false, archived: false, trashedAt: null })

/* A Mac: its own data folder and store, a window, and sync with the shared folder. */
async function mac(root) {
  const dir = await temp()
  const store = await createStore({ dir: path.join(dir, 'store'), core, writeDelay: 5, maxDelay: 20 })
  const heard = []
  const window = store.connect((message) => heard.push(message))
  const start = () => {
    const sync = createMacSync({ root, store, createSyncEngine, statePath: path.join(dir, 'store', 'sync.json'), watch: () => ({ close() {} }) })
    return sync.start().then(() => sync)
  }
  return {
    dir, store, heard, start,
    commit: (ops) => store.commit(window, ops),
    titles: () => store.load().doc.notes.map((n) => n.title).sort(),
  }
}

test('two Macs sharing the folder stay in step, and the windows hear what arrives', async () => {
  const root = await temp()
  const first = await mac(root)
  first.commit([{ t: 'add', c: 'notes', v: note('a', 'Garden') }])
  const firstSync = await first.start()

  const second = await mac(root)
  const secondSync = await second.start()
  assert.deepEqual(second.titles(), ['Garden'], 'the second Mac caught up from the first one’s snapshot')
  assert.ok(second.heard.length, 'the second Mac’s window heard the notes arrive')

  first.commit([{ t: 'add', c: 'notes', v: note('b', 'Taxes') }])
  second.commit([{ t: 'patch', c: 'notes', id: 'a', v: { title: 'Garden plans' } }])
  await firstSync.settle()
  await secondSync.settle()
  await firstSync.settle()
  assert.deepEqual(first.titles(), ['Garden plans', 'Taxes'])
  assert.deepEqual(second.titles(), ['Garden plans', 'Taxes'])
  assert.equal(secondSync.status().devices, 1)

  // Quit and reopen: the second Mac carries on as the same device.
  secondSync.close()
  const saved = JSON.parse(await fs.readFile(path.join(second.dir, 'store', 'sync.json'), 'utf8'))
  const reopened = await second.start()
  second.commit([{ t: 'patch', c: 'notes', id: 'b', v: { pinned: true } }])
  await reopened.settle()
  await firstSync.settle()
  assert.equal(first.store.load().doc.notes.find((n) => n.id === 'b').pinned, true)
  assert.equal(JSON.parse(await fs.readFile(path.join(second.dir, 'store', 'sync.json'), 'utf8')).device, saved.device)
  const devices = (await fs.readdir(path.join(root, 'Sync'))).sort()
  assert.equal(devices.length, 2, `one folder per Mac: ${devices}`)

  firstSync.close()
  reopened.close()
  await first.store.flush()
  await second.store.flush()
})

test('changes made while the link is off are shared when it comes back on', async () => {
  const root = await temp()
  const first = await mac(root)
  const firstSync = await first.start()
  firstSync.pause()
  first.commit([{ t: 'add', c: 'notes', v: note('offline', 'Written while off') }])
  firstSync.saveNow()
  firstSync.close()
  // Relaunch with the link still off: load() notes changes without touching iCloud.
  const later = createMacSyncFor(first, root)
  assert.equal(await later.load(), true)
  first.commit([{ t: 'patch', c: 'notes', id: 'offline', v: { pinned: true } }])
  await later.start()
  await later.settle()
  const second = await mac(root)
  const secondSync = await second.start()
  await secondSync.settle()
  assert.deepEqual(second.titles(), ['Written while off'])
  assert.equal(second.store.load().doc.notes[0].pinned, true)
  later.close()
  secondSync.close()
  await first.store.flush()
  await second.store.flush()
})

function createMacSyncFor(device, root) {
  return createMacSync({ root, store: device.store, createSyncEngine, statePath: path.join(device.dir, 'store', 'sync.json'), watch: () => ({ close() {} }) })
}
