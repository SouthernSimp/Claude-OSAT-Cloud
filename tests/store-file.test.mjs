import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import * as realFs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as core from '../shared/store-core.mjs'

const require = createRequire(import.meta.url)
const { createFileStore } = require('../desktop/store/file.cjs')
const { createStore } = require('../desktop/store/index.cjs')

async function folder(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'osat-store-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60))
const clock = (iso) => { let now = new Date(iso); return { now: () => now, set: (next) => { now = new Date(next) } } }
const manualTimers = () => {
  const pending = new Set()
  return { set: (fn) => { const handle = { fn }; pending.add(handle); return handle }, clear: (handle) => pending.delete(handle), run: () => { for (const handle of [...pending]) { pending.delete(handle); handle.fn() } }, pending }
}

test('writes are atomic, leave no temp files, and read back exactly', async (t) => {
  const dir = await folder(t)
  const files = createFileStore({ dir })
  assert.deepEqual(await files.read(), { doc: null, recovered: null })
  await files.write({ rev: 1, notes: [{ id: 'a' }] })
  assert.deepEqual((await files.read()).doc, { rev: 1, notes: [{ id: 'a' }] })
  assert.deepEqual((await readdir(dir)).sort(), ['workspace.json'])
})

test('a failed write never damages the saved file', async (t) => {
  const dir = await folder(t)
  const good = createFileStore({ dir })
  await good.write({ rev: 1 })
  const broken = createFileStore({ dir, fs: { ...realFs, rename: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) } } })
  await assert.rejects(broken.write({ rev: 2 }), /disk full/)
  assert.deepEqual((await good.read()).doc, { rev: 1 })
  assert.deepEqual((await readdir(dir)).filter((name) => name !== 'snapshots'), ['workspace.json'], 'no temp file is left behind')
})

test('an unreadable file is set aside and the newest snapshot opens instead', async (t) => {
  const dir = await folder(t)
  const time = clock('2026-09-20T09:00:00Z')
  const files = createFileStore({ dir, now: time.now })
  await files.write({ rev: 1, day: 20 })
  time.set('2026-09-21T09:00:00Z')
  await files.write({ rev: 2, day: 21 }) // snapshots the 20th first
  await writeFile(path.join(dir, 'workspace.json'), '{ half written')
  const { doc, recovered } = await files.read()
  assert.deepEqual(doc, { rev: 1, day: 20 })
  assert.equal(recovered.from, 'workspace-2026-09-21.json')
  assert.ok((await readdir(dir)).some((name) => name.startsWith('workspace.unreadable-')))
})

test('one snapshot per day, and only the newest fourteen are kept', async (t) => {
  const dir = await folder(t)
  const time = clock('2026-09-01T12:00:00Z')
  const files = createFileStore({ dir, now: time.now })
  for (let day = 1; day <= 20; day += 1) {
    time.set(`2026-09-${String(day).padStart(2, '0')}T12:00:00Z`)
    await files.write({ day })
    await files.write({ day, again: true })
  }
  const kept = await files.snapshots()
  assert.equal(kept.length, 14)
  assert.equal(kept.at(-1), 'workspace-2026-09-20.json')
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'snapshots', 'workspace-2026-09-20.json'), 'utf8')), { day: 19, again: true })
})

test('the store saves shortly after a commit, reports failures calmly and keeps retrying', async (t) => {
  const dir = await folder(t)
  const timers = manualTimers()
  let failNext = false
  const fs = { ...realFs, rename: async (...args) => { if (failNext) { failNext = false; throw Object.assign(new Error('nope'), { code: 'EIO' }) } return realFs.rename(...args) } }
  const store = await createStore({ dir, core, fs, timers })
  const seen = []
  store.onStatus((status) => seen.push(status.state))
  const window = store.connect(() => {})
  assert.deepEqual(store.commit(window, [{ t: 'add', c: 'notes', v: { id: 'n1', title: 'Hello' } }]), { rev: 1 })
  assert.equal(timers.pending.size, 1)
  failNext = true
  timers.run()
  await settle()
  assert.equal(store.status().state, 'error')
  assert.equal(timers.pending.size, 1, 'a retry is scheduled')
  timers.run()
  await settle()
  assert.equal(store.status().state, 'saved')
  assert.deepEqual(seen, ['error', 'saved'])
  const reopened = await createStore({ dir, core, timers })
  assert.equal(reopened.load().doc.notes[0].title, 'Hello')
  assert.equal(reopened.load().rev, 1)
})

test('importing keeps a copy of the workspace it replaces and resets every window', async (t) => {
  const dir = await folder(t)
  const store = await createStore({ dir, core, timers: manualTimers() })
  const heard = []
  const a = store.connect((message) => heard.push(message))
  store.commit(a, [{ t: 'add', c: 'notes', v: { id: 'old' } }])
  await store.replace({ ...core.createEmptyDoc(), notes: [{ id: 'new' }] })
  assert.equal(heard.at(-1).reset, true)
  assert.deepEqual(store.load().doc.notes, [{ id: 'new' }])
  const aside = (await readdir(dir)).find((name) => name.startsWith('workspace.before-import-'))
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, aside), 'utf8')).notes, [{ id: 'old' }])
})

test('a store never opens data from a newer OSAT', async (t) => {
  const dir = await folder(t)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'workspace.json'), JSON.stringify({ schema: 99 }))
  await assert.rejects(createStore({ dir, core }), /newer OSAT/)
})

test('quitting saves synchronously, and an older write finishing late never replaces it', async (t) => {
  const dir = await folder(t)
  const store = await createStore({ dir, core, timers: manualTimers() })
  const window = store.connect(() => {})
  store.commit(window, [{ t: 'set', p: 'theme', v: 'dark' }])
  store.flushSync()
  assert.equal(JSON.parse(await readFile(path.join(dir, 'workspace.json'), 'utf8')).theme, 'dark')
  const files = createFileStore({ dir })
  await files.write({ rev: 5, theme: 'new' })
  await files.write({ rev: 4, theme: 'old' })
  assert.equal((await files.read()).doc.theme, 'new')
})
