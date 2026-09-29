import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { addAskedEvent, asksIn, importScan, pileOf, skipAsk } from '../src/nodes-model.js'

const require = createRequire(import.meta.url)
const { createScans, nameFor, plainNode, scanMessages, toNode } = require('../desktop/scans.cjs')

const TEXT = 'Wedding date 10/5/26\nCall the florist about roses\nBuy stamps for invitations'

/* A folder in memory: name → { data, mtimeMs }. */
function memoryFs(files, clock) {
  const disk = new Map()
  return {
    disk,
    readdir: async () => Object.keys(files).map((name) => ({ name, isFile: () => true })),
    stat: async (file) => {
      const entry = files[file.split('/').at(-1)]
      if (!entry) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return { size: entry.data.length, mtimeMs: entry.mtimeMs ?? 1000 }
    },
    readFile: async (file) => {
      if (disk.has(file)) return disk.get(file)
      const entry = files[file.split('/').at(-1)]
      if (!entry) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return entry.data
    },
    writeFile: async (file, data) => { disk.set(file, data) },
  }
}

test('the AI is told today, the nodes there are, and the scan', () => {
  const [system, user] = scanMessages({ text: TEXT, names: ['Wedding', 'Garden'], now: new Date(2026, 8, 28) })
  assert.match(system.content, /Monday, 2026-09-28/)
  assert.match(system.content, /Wedding, Garden/)
  assert.equal(user.content, TEXT)
})

test('an answer becomes a node file: duplicates and empty branches go, dates must be real', () => {
  const node = toNode({
    name: 'Wedding plans',
    branches: [
      { name: 'Dates', stickies: [{ text: 'Wedding date 10/5/26', event: { title: 'Wedding', date: '2026-10-05', time: '' } }], branches: [] },
      { name: 'To do', stickies: [{ text: 'Call the florist about roses', event: { title: 'X', date: '2026-02-31', time: '' } }, { text: 'Call florist re: roses!!', event: null }], branches: [{ name: 'Post', stickies: [{ text: 'Buy stamps for invitations', event: null }] }] },
      { name: 'Empty', stickies: [], branches: [] },
    ],
    stickies: [],
  }, TEXT)
  assert.equal(node.title, 'Wedding plans')
  assert.deepEqual(node.branches.map((branch) => branch.title), ['Dates', 'To do'])
  assert.deepEqual(node.branches[0].leaves, [{ text: 'Wedding date 10/5/26', event: { title: 'Wedding', date: '2026-10-05', time: '' } }])
  assert.deepEqual(node.branches[1].leaves, [{ text: 'Call the florist about roses' }], 'a second wording of the same sticky goes, and Feb 31 is no date')
  assert.deepEqual(node.branches[1].sub_branches[0].leaves, [{ text: 'Buy stamps for invitations' }])
  assert.equal(toNode({ name: 'Lost', stickies: [{ text: 'Stamps' }] }, TEXT), null, 'an answer that drops most of the scan is not trusted')
  assert.equal(toNode({ name: 'Nothing' }, TEXT), null)
  const misread = toNode({ name: 'X', stickies: [{ text: TEXT, event: { title: 'Dentist', date: '2006-10-14', time: '15:00' } }] }, TEXT, new Date(2026, 8, 28))
  assert.equal(misread.leaves[0].event.date, '2026-10-14', 'a year long gone was misread')
  const january = toNode({ name: 'X', stickies: [{ text: TEXT, event: { title: 'Party', date: '2019-01-03', time: '' } }] }, TEXT, new Date(2026, 8, 28))
  assert.equal(january.leaves[0].event.date, '2027-01-03')
})

test('without the AI: a sticky per paragraph, or per line; a name from the file or the day', () => {
  assert.deepEqual(plainNode('One\ntwo\n\nThree', 'X').leaves.map((leaf) => leaf.text), ['One\ntwo', 'Three'])
  assert.deepEqual(plainNode('One\ntwo', 'X').leaves.map((leaf) => leaf.text), ['One', 'two'])
  assert.equal(nameFor('Wedding_plans.pdf', 0), 'Wedding plans')
  assert.equal(nameFor('Scan_20260928_1432.pdf', new Date(2026, 8, 28)), 'Scan Sep 28')
  assert.equal(nameFor('IMG_0042.jpg', new Date(2026, 8, 28)), 'Scan Sep 28')
})

test('the watcher: old scans stay, a new one is read and sorted once, done only when the desk says', async () => {
  let clock = 1_000_000
  const files = { 'old.pdf': { data: 'old' } }
  const fs = memoryFs(files, () => clock)
  const asked = []
  const scans = createScans({
    seenPath: '/data/scans.json', fs, now: () => clock,
    read: async (file) => { asked.push(file); return TEXT },
    organize: async () => ({ name: 'Wedding plans', branches: [], stickies: TEXT.split('\n').map((text) => ({ text, event: null })) }),
  })
  await scans.use('/drive/From_BrotherDevice')
  assert.equal(await scans.scan(), 0, 'what was there before is left alone')

  files['new.pdf'] = { data: 'a new scan', mtimeMs: clock - 1000 }
  assert.equal(await scans.scan(), 0, 'still arriving')
  clock += 10000
  assert.equal(await scans.scan(), 1)
  assert.deepEqual(asked, ['/drive/From_BrotherDevice/new.pdf'])
  const [item] = scans.take()
  assert.equal(item.node.title, 'Wedding plans')
  assert.equal(await scans.scan(), 0, 'waiting for the desk, not read again')
  await scans.done(item.id)
  assert.deepEqual(scans.take(), [])
  assert.equal(await scans.scan(), 0, 'done is remembered')
  assert.ok(scans.status().last)

  const again = createScans({ seenPath: '/data/scans.json', fs, now: () => clock, read: async () => { throw new Error('read twice') }, organize: async () => null })
  await again.load()
  assert.equal(await again.scan(), 0, 'after a restart too')
})

test('the watcher: a node file goes straight in, a scan without words says so, the AI failing falls back', async () => {
  const files = {
    'a.json': { data: JSON.stringify({ title: 'From the agent', leaves: ['x'] }), mtimeMs: 2000 },
    'b.jpg': { data: 'blank', mtimeMs: 2001 },
    'c.pdf': { data: 'words', mtimeMs: 2002 },
    'd.json': { data: '{"not":"a node"}', mtimeMs: 2003 },
  }
  const fs = memoryFs({}, () => 0)
  await fs.writeFile('/s.json', JSON.stringify({ dir: '/scans', files: {} }))
  const scans = createScans({
    seenPath: '/s.json', fs: { ...memoryFs(files, () => 0), readFile: async (file) => fs.disk.get(file) ?? files[file.split('/').at(-1)].data, writeFile: fs.writeFile },
    now: () => 1_000_000,
    read: async (file) => { if (file.endsWith('b.jpg')) throw new Error('EMPTY'); return 'One\n\nTwo' },
    organize: async () => { throw new Error('The AI is not set up yet.') },
  })
  await scans.scan()
  const byName = Object.fromEntries(scans.take().map((item) => [item.name, item.node]))
  assert.deepEqual(Object.keys(byName), ['a.json', 'b.jpg', 'c.pdf'])
  assert.equal(byName['a.json'].title, 'From the agent')
  assert.match(byName['b.jpg'].leaves[0].text, /couldn’t find any words/)
  assert.deepEqual(byName['c.pdf'].leaves.map((leaf) => leaf.text), ['One', 'Two'])
  await scans.scan()
  await scans.scan()
  assert.equal(JSON.parse(fs.disk.get('/s.json')).files['16-2003'].skipped, true, 'a file that is no scan is left alone after three tries')
})

test('a scan of one sticky is a sticky in Unsorted; more is a node, its days offered to the Calendar', () => {
  const base = normalizeWorkspace(createDefaultWorkspace())
  const one = importScan(base, { title: 'Scan', leaves: [{ text: 'Wedding date 10/5/26', event: { title: 'Wedding', date: '2026-10-05', time: '' } }] })
  assert.equal(one.folder, undefined)
  assert.deepEqual([one.note.unsorted, one.note.source, one.note.ask.event.title], [true, 'Scan', 'Wedding'])

  const many = importScan(base, toNode({ name: 'Wedding plans', branches: [{ name: 'Dates', stickies: [{ text: 'Wedding date 10/5/26', event: { title: 'Wedding', date: '2026-10-05', time: '14:30' } }] }], stickies: [{ text: 'Call the florist about roses' }, { text: 'Buy stamps for invitations' }] }, TEXT))
  assert.equal(many.folder.name, 'Wedding plans')
  assert.equal(pileOf(many.state.notes, many.folder.id).length, 2)
  const [asking] = asksIn(many.state, many.folder.id)
  assert.equal(asking.ask.event.time, '14:30')

  const added = addAskedEvent(many.state, asking.id)
  assert.equal(added.event.title, 'Wedding')
  assert.equal(new Date(added.event.start).getHours(), 14)
  assert.ok(added.state.calendar.events.some((event) => event.id === added.event.id))
  assert.deepEqual(asksIn(added.state, many.folder.id), [], 'it stops asking')
  assert.deepEqual(asksIn(skipAsk(many.state, asking.id), many.folder.id), [], 'Not now too')
})
