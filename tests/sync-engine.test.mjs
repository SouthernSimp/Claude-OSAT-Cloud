import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyDoc, createHub, diffDocs } from '../shared/store-core.mjs'
import { createSyncEngine } from '../shared/sync-engine.mjs'

/* A folder in memory, standing in for iCloud Drive. */
function memoryFiles() {
  const map = new Map()
  return {
    map,
    async list(dir) {
      const names = new Set()
      for (const key of map.keys()) if (key.startsWith(`${dir}/`)) names.add(key.slice(dir.length + 1).split('/')[0])
      return [...names]
    },
    async read(path) { return map.has(path) ? map.get(path) : null },
    async write(path, text) { map.set(path, text) },
  }
}

const note = (id, extra = {}) => ({ id, title: id, markdown: '', tags: [], pinned: false, ...extra })
let time = 1000
const now = () => time

/* A device: its store and its sync engine, wired the way the app wires them. */
function peer(device, files, doc = createEmptyDoc(), state = null) {
  const hub = createHub(doc)
  const self = hub.connect(() => {})
  const engine = createSyncEngine({ device, files, now, state, snapshotEvery: 5, doc: () => hub.doc, apply: (ops) => hub.commit(self, ops) })
  return {
    engine,
    get doc() { return hub.doc },
    change(update) {
      const ops = diffDocs(hub.doc, update(hub.doc))
      if (!ops.length) return
      hub.commit(self, ops)
      engine.record(ops)
    },
    start: () => engine.start(),
    async sync() {
      await engine.flush()
      await engine.pull()
    },
  }
}

const titles = (doc) => doc.notes.map((n) => n.title).sort()

test('the Mac shares what it already has; a new iPhone catches up and both keep editing', async () => {
  const files = memoryFiles()
  const mac = peer('mac-1', files, { ...createEmptyDoc(), notes: [note('a', { title: 'Garden' }), note('b', { title: 'Taxes' })] })
  await mac.start()
  assert.ok(files.map.has('Sync/mac-1/snapshot.json'), 'the first device leaves a snapshot')

  const phone = peer('phone-1', files)
  await phone.start()
  assert.deepEqual(titles(phone.doc), ['Garden', 'Taxes'])

  time += 10
  phone.change((doc) => ({ ...doc, notes: [note('c', { title: 'From the phone' }), ...doc.notes] }))
  mac.change((doc) => ({ ...doc, notes: doc.notes.map((n) => (n.id === 'a' ? { ...n, markdown: 'Garlic in October' } : n)) }))
  await phone.sync()
  await mac.sync()
  await phone.sync()
  assert.deepEqual(titles(mac.doc), ['From the phone', 'Garden', 'Taxes'])
  assert.equal(phone.doc.notes.find((n) => n.id === 'a').markdown, 'Garlic in October')
  assert.ok(files.map.has('Sync/phone-1/00000001.json'))
})

test('a file that arrives out of order waits for the one before it', async () => {
  const files = memoryFiles()
  const mac = peer('mac-1', files)
  await mac.start()
  const phone = peer('phone-1', files)
  await phone.start()
  time += 10
  mac.change((doc) => ({ ...doc, notes: [note('a')] }))
  await mac.sync()
  mac.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, title: 'renamed' })) }))
  await mac.sync()
  // iCloud brought the second file first.
  const first = files.map.get('Sync/mac-1/00000001.json')
  files.map.delete('Sync/mac-1/00000001.json')
  await phone.sync()
  assert.equal(phone.doc.notes.length, 0)
  files.map.set('Sync/mac-1/00000001.json', first)
  await phone.sync()
  assert.equal(phone.doc.notes[0].title, 'renamed')
})

test('damaged files and invalid changes from elsewhere are ignored', async () => {
  const files = memoryFiles()
  const phone = peer('phone-1', files)
  await phone.start()
  files.map.set('Sync/evil/00000001.json', '{not json')
  files.map.set('Sync/mac-1/00000001.json', JSON.stringify({ entries: [
    ['0000000002000.000000.mac-1', { t: 'set', p: 'rev', v: 99 }],
    ['0000000002001.000000.mac-1', { t: 'add', c: 'passwords', v: { id: 'x' } }],
    ['not a stamp', { t: 'add', c: 'notes', v: note('bad') }],
    ['0000000002002.000000.mac-1', { t: 'add', c: 'notes', v: note('good') }],
  ] }))
  files.map.set('Sync/..%2F/00000001.json', '{}')
  await phone.sync()
  assert.deepEqual(phone.doc.notes.map((n) => n.id), ['good'])
  assert.equal(phone.doc.rev, 1, 'one commit: the good note; rev was never set from outside')
})

test('after a restart the engine carries on: changes waiting to be written are not lost', async () => {
  const files = memoryFiles()
  let mac = peer('mac-1', files)
  await mac.start()
  time += 10
  mac.change((doc) => ({ ...doc, notes: [note('a')] }))
  await mac.sync()
  mac.change((doc) => ({ ...doc, notes: [...doc.notes, note('b')] }))
  const saved = JSON.parse(JSON.stringify(mac.engine.state())) // quit before the flush
  const doc = mac.doc
  mac = peer('mac-1', files, doc, saved)
  await mac.start() // already started: nothing new
  mac.change((doc2) => ({ ...doc2, notes: [...doc2.notes, note('c')] }))
  await mac.sync()
  assert.ok(files.map.has('Sync/mac-1/00000002.json'))
  const phone = peer('phone-1', files)
  await phone.start()
  await phone.sync()
  assert.deepEqual(phone.doc.notes.map((n) => n.id).sort(), ['a', 'b', 'c'])
})

test('changes made before the very first start are shared too', async () => {
  const files = memoryFiles()
  const mac = peer('mac-1', files)
  mac.change((doc) => ({ ...doc, theme: 'dark' }))
  await mac.start()
  await mac.sync()
  const phone = peer('phone-1', files)
  await phone.start()
  await phone.sync()
  assert.equal(phone.doc.theme, 'dark')
})

test('a snapshot is left every few changes, so a new device reads little', async () => {
  const files = memoryFiles()
  const mac = peer('mac-1', files)
  await mac.start()
  for (let i = 0; i < 12; i += 1) {
    time += 1
    mac.change((doc) => ({ ...doc, notes: [note(`n${i}`), ...doc.notes] }))
    await mac.sync()
  }
  const snapshot = JSON.parse(files.map.get('Sync/mac-1/snapshot.json'))
  assert.ok(snapshot.seq >= 10, `snapshot at ${snapshot.seq}`)
  const phone = peer('phone-1', files)
  await phone.start()
  assert.ok(phone.engine.state().seen['mac-1'] >= 10, 'the phone skips what the snapshot already holds')
  await phone.sync()
  assert.equal(phone.doc.notes.length, 12)
})
