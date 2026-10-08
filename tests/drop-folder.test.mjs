import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as core from '../shared/node-file.mjs'
import { applyOps, createEmptyDoc } from '../shared/store-core.mjs'

const require = createRequire(import.meta.url)
const { moveInto, oneAtATime, settledFiles, uniqueTarget, watchFolder } = require('../desktop/folder-watch.cjs')
const { createDropFolder, fingerprint } = require('../desktop/bots/drop-folder.cjs')

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'osat-drop-'))
const later = () => Date.now() + 60_000 // every file has settled
const list = async (dir) => (await fs.readdir(dir)).sort()

test('settled files: hidden, unwanted and still-arriving files wait; too big is flagged; oldest first', async () => {
  const dir = await tempDir()
  await fs.writeFile(path.join(dir, 'b.md'), 'b')
  await fs.writeFile(path.join(dir, 'a.md'), 'a')
  await fs.writeFile(path.join(dir, '.hidden.md'), 'x')
  await fs.writeFile(path.join(dir, 'photo.png'), 'x')
  await fs.writeFile(path.join(dir, 'big.md'), 'x'.repeat(50))
  await fs.mkdir(path.join(dir, 'Added'))
  const old = new Date(Date.now() - 120_000)
  await fs.utimes(path.join(dir, 'b.md'), old, old)
  const accept = (name) => name.endsWith('.md')
  const ready = await settledFiles(dir, { now: later, accept, maxBytes: 10 })
  assert.deepEqual(ready.map((item) => [item.name, Boolean(item.tooBig)]), [['b.md', false], ['a.md', false], ['big.md', true]])
  assert.deepEqual((await settledFiles(dir, { accept })).map((item) => item.name), ['b.md'], 'just written: not yet')
  await assert.rejects(settledFiles(path.join(dir, 'gone')), { code: 'ENOENT' })
})

test('moving: a free name every time, the folder made if missing', async () => {
  const dir = await tempDir()
  await fs.writeFile(path.join(dir, 'x.md'), '1')
  const into = path.join(dir, 'Added')
  assert.equal(await moveInto(fs, path.join(dir, 'x.md'), into), path.join(into, 'x.md'))
  await fs.writeFile(path.join(dir, 'x.md'), '2')
  assert.equal(await moveInto(fs, path.join(dir, 'x.md'), into), path.join(into, 'x 2.md'))
  assert.equal(await uniqueTarget(fs, into, 'x.md'), path.join(into, 'x 3.md'))
  assert.deepEqual(await list(into), ['x 2.md', 'x.md'])
})

test('one look at a time; watching looks soon after a change and on the poll, while live', async () => {
  let runs = 0
  let release
  const look = oneAtATime(() => { runs += 1; return new Promise((resolve) => { release = resolve }) })
  const first = look()
  assert.equal(look(), first, 'asking again joins the look under way')
  await new Promise((resolve) => setImmediate(resolve))
  release()
  await first
  assert.equal(runs, 1)

  const timers = { queue: [], set(fn) { this.queue.push(fn); return fn }, clear(fn) { this.queue = this.queue.filter((item) => item !== fn) }, every(fn) { this.poll = fn; return 1 }, stop() { this.poll = null } }
  let changed = null
  let closed = false
  let looks = 0
  let live = true
  const watch = watchFolder({ dir: '/x', look: () => { looks += 1 }, live: () => live, timers, watch: (_dir, listener) => { changed = listener; return { close: () => { closed = true } } } })
  changed()
  changed()
  assert.equal(timers.queue.length, 1, 'changes close together make one look')
  timers.queue.shift()()
  timers.poll()
  timers.queue.shift()()
  assert.equal(looks, 2)
  live = false
  watch.soon()
  assert.equal(timers.queue.length, 0, 'nothing while it isn’t live')
  watch.stop()
  assert.deepEqual([closed, timers.poll], [true, null])
})

/* A drop folder over a real temp dir, putting nodes in a plain doc the way main does. */
async function setUp() {
  const dir = await tempDir()
  let doc = createEmptyDoc()
  let n = 0
  const statuses = []
  const drop = createDropFolder({
    dir,
    core,
    now: later,
    onStatus: (status) => statuses.push(status),
    take: (tree, { name, hash }) => {
      const result = core.arrivalOps(doc, tree, { hash, file: name, now: '2026-09-29T10:00:00.000Z', makeId: (prefix) => `${prefix}-${++n}` })
      if (result.ops) doc = applyOps(doc, result.ops).doc
      return result
    },
  })
  await drop.prepare()
  return { dir, drop, doc: () => doc, statuses }
}

test('the drop folder: a topic file becomes a New topic and moves to Added; nothing is deleted', async () => {
  const { dir, drop, doc } = await setUp()
  assert.match(await fs.readFile(path.join(dir, 'What lives here.txt'), 'utf8'), /Saving a topic for OSAT/)
  await fs.writeFile(path.join(dir, 'Garden.md'), '---\nsource: Muse\n---\n# Garden\nWhat grows where.\n## Beds\n- Tomatoes\n')
  await fs.writeFile(path.join(dir, 'Spring.txt'), 'Spring launch\nOnly a summary.')
  assert.equal(await drop.look(), 2)
  assert.deepEqual(await list(dir), ['Added', 'What lives here.txt'], 'the README is never taken')
  assert.deepEqual(await list(path.join(dir, 'Added')), ['Garden.md', 'Spring.txt'])
  const [garden, spring] = doc().folders.filter((folder) => !folder.parentId)
  assert.deepEqual([garden.name, garden.fresh, garden.packed, garden.from.source], ['Garden', true, undefined, 'Muse'])
  assert.deepEqual([spring.name, spring.packed, spring.from.file], ['Spring launch', true, 'Spring.txt'])
  const status = drop.status()
  assert.deepEqual(status.arrived.map((item) => [item.node, item.source, item.packed]), [['Spring launch', '', true], ['Garden', 'Muse', false]])
})

test('the drop folder: a broken file is set aside with a calm word, never lost; a repeat makes nothing new', async () => {
  const { dir, drop, doc } = await setUp()
  await fs.writeFile(path.join(dir, 'broken.json'), '{ "title": "Half')
  await fs.writeFile(path.join(dir, 'huge.md'), `# Huge\n${'x'.repeat(2 * 1024 * 1024)}`)
  assert.equal(await drop.look(), 0)
  assert.deepEqual(await list(path.join(dir, 'Set aside')), ['broken.json', 'huge.md'])
  assert.deepEqual(drop.status().setAside.map((item) => item.why).sort(), ['It’s bigger than a topic file can be (2 MB).', 'That file isn’t valid JSON.'])
  assert.equal(doc().folders.length, 0)

  const words = '# Garden\nA summary.'
  await fs.writeFile(path.join(dir, 'Garden.md'), words)
  await drop.look()
  await fs.writeFile(path.join(dir, 'Garden again.md'), `${words}\n`)
  assert.equal(await drop.look(), 0, 'the same words again make nothing new')
  assert.equal(doc().folders.length, 1)
  assert.equal(drop.status().arrived[0].same, true)
  assert.deepEqual(await list(path.join(dir, 'Added')), ['Garden again.md', 'Garden.md'], 'both files are kept')
  assert.equal(fingerprint('a\r\nb\n'), fingerprint('a\nb'))
})

test('the drop folder: a folder it can’t read says so in plain words', async () => {
  const drop = createDropFolder({ dir: path.join(await tempDir(), 'missing'), core, take: () => ({}) })
  assert.equal(await drop.look(), 0)
  assert.match(drop.status().error, /couldn’t look in the folder \(ENOENT\)/)
})
