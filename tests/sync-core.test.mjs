import assert from 'node:assert/strict'
import test from 'node:test'
import { applyOps, createEmptyDoc, createHub, diffDocs } from '../shared/store-core.mjs'
import { baseStamp, createClock, emptyMeta, mergeEntries, snapshotEntries, stampLocal, stampWorkspace } from '../shared/sync-core.mjs'

const note = (id, extra = {}) => ({ id, title: id, markdown: '', tags: [], pinned: false, trashedAt: null, ...extra })

/* A device: its own store, meta, clock and the log of what it changed. */
function device(name, time, doc = createEmptyDoc()) {
  const hub = createHub(doc)
  const self = hub.connect(() => {})
  const meta = emptyMeta()
  const clock = createClock(name, time)
  stampWorkspace(hub.doc, meta, baseStamp(name))
  const log = []
  const seen = new Map()
  return {
    name, hub, meta, clock, log, seen,
    get doc() { return hub.doc },
    change(update) {
      const ops = diffDocs(hub.doc, update(hub.doc))
      if (!ops.length) return
      hub.commit(self, ops)
      log.push(...stampLocal(meta, ops, clock))
    },
    /* Takes whatever the other device logged since last time. */
    hear(other, from = seen.get(other) || 0) {
      const entries = other.log.slice(from)
      seen.set(other, other.log.length)
      for (const [stamp] of entries) clock.observe(stamp)
      const ops = mergeEntries(hub.doc, meta, entries)
      if (ops.length) hub.commit(self, ops)
      if (ops.share.length) log.push(...stampLocal(meta, ops.share, clock))
    },
  }
}

const byId = (list) => [...(list || [])].sort((a, b) => a.id.localeCompare(b.id))
const content = (doc) => ({ theme: doc.theme, notes: byId(doc.notes), folders: byId(doc.folders), settings: doc.settings })

test('the clock only moves forward, and a change made after seeing another device’s is newer', () => {
  let now = 1000
  const a = createClock('mac', () => now)
  const b = createClock('phone', () => now - 500) // the phone's clock runs behind
  const first = a.tick()
  const second = a.tick()
  assert.ok(second > first)
  b.observe(second)
  assert.ok(b.tick() > second, 'after hearing the Mac, the phone stamps later even with a slow clock')
  now = 2000
  assert.ok(a.tick().startsWith('0000000002000.000000.'))
  assert.equal(createClock('mac', () => 5, a.last).tick() > a.last, true, 'a restored clock continues after its last stamp')
  assert.throws(() => createClock('bad id!'), /device id/)
})

test('edits to different fields of one note both survive', () => {
  let now = 10
  const time = () => now
  const mac = device('mac', time)
  mac.change((doc) => ({ ...doc, notes: [note('n1', { title: 'Garden' })] }))
  const phone = device('phone', time)
  phone.hear(mac)
  now = 20
  mac.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, markdown: 'Plant garlic' })) }))
  phone.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, pinned: true })) }))
  mac.hear(phone)
  phone.hear(mac)
  assert.deepEqual(content(mac.doc), content(phone.doc))
  assert.equal(mac.doc.notes[0].markdown, 'Plant garlic')
  assert.equal(mac.doc.notes[0].pinned, true)
})

test('the same field changed on both: the later change wins everywhere', () => {
  let now = 10
  const mac = device('mac', () => now)
  mac.change((doc) => ({ ...doc, notes: [note('n1')] }))
  const phone = device('phone', () => now)
  phone.hear(mac)
  now = 20
  phone.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, title: 'From the phone' })) }))
  now = 30
  mac.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, title: 'From the Mac' })) }))
  phone.hear(mac)
  mac.hear(phone)
  assert.equal(mac.doc.notes[0].title, 'From the Mac')
  assert.equal(phone.doc.notes[0].title, 'From the Mac')
})

test('a delete wins over earlier edits, and Undo (adding it back later) brings the note back', () => {
  let now = 10
  const mac = device('mac', () => now)
  mac.change((doc) => ({ ...doc, notes: [note('n1'), note('n2')] }))
  const phone = device('phone', () => now)
  phone.hear(mac)
  now = 20
  phone.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, title: 'edited' })) }))
  now = 30
  mac.change((doc) => ({ ...doc, notes: doc.notes.filter((n) => n.id !== 'n1') }))
  phone.hear(mac)
  mac.hear(phone)
  assert.deepEqual(phone.doc.notes.map((n) => n.id), ['n2'])
  assert.deepEqual(content(mac.doc), content(phone.doc))
  now = 40
  const gone = { ...note('n1'), title: 'back' }
  mac.change((doc) => ({ ...doc, notes: [gone, ...doc.notes] }))
  phone.hear(mac)
  assert.equal(phone.doc.notes.find((n) => n.id === 'n1')?.title, 'back')
})

test('an edit that arrives before its note waits for it', () => {
  let now = 10
  const mac = device('mac', () => now)
  const ipad = device('ipad', () => now)
  const phone = device('phone', () => now)
  mac.change((doc) => ({ ...doc, notes: [note('n1', { title: 'first' })] }))
  ipad.hear(mac)
  now = 20
  ipad.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, title: 'renamed on the iPad' })) }))
  phone.hear(ipad) // the iPad's change arrives before the Mac's add
  assert.equal(phone.doc.notes.length, 0)
  phone.hear(mac)
  assert.equal(phone.doc.notes[0].title, 'renamed on the iPad')
})

test('a new device catches up from a snapshot and keeps what it already had', () => {
  let now = 10
  const mac = device('mac', () => now)
  mac.change((doc) => ({ ...doc, theme: 'dark', notes: [note('n1'), note('n2')] }))
  now = 20
  mac.change((doc) => ({ ...doc, notes: doc.notes.filter((n) => n.id !== 'n2').map((n) => ({ ...n, title: 'kept' })) }))
  const second = device('mac2', () => now)
  second.change((doc) => ({ ...doc, notes: [note('mine')] }))
  const entries = snapshotEntries(mac.doc, mac.meta)
  for (const [stamp] of entries) second.clock.observe(stamp)
  second.hub.commit(0, mergeEntries(second.doc, second.meta, entries))
  mac.hear(second)
  assert.deepEqual(byId(second.doc.notes).map((n) => [n.id, n.title]), [['mine', 'mine'], ['n1', 'kept']])
  assert.equal(second.doc.theme, 'dark')
  assert.deepEqual(content(mac.doc), content(second.doc))
})

/* Many random changes on three devices, heard in random orders: all end the same.
   Run with many seeds; a fourth device joins late from a snapshot. */
test('devices making random changes always end up the same', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    let state = seed
    const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 }
    const pick = (list) => list[Math.floor(random() * list.length)]
    let now = 1000
    const time = () => now
    const devices = [device('mac', time), device('phone', time), device('ipad', time)]
    for (let round = 0; round < 300; round += 1) {
      now += Math.floor(random() * 3)
      const d = pick(devices)
      const ids = d.doc.notes.map((n) => n.id)
      const folders = d.doc.folders.map((f) => f.id)
      const roll = random()
      if (roll < 0.15 || !ids.length) d.change((doc) => ({ ...doc, notes: [note(`n${round}${d.name}`), ...doc.notes] }))
      else if (roll < 0.4) { const id = pick(ids); d.change((doc) => ({ ...doc, notes: doc.notes.map((n) => (n.id === id ? { ...n, title: `${d.name} ${round}` } : n)) })) }
      else if (roll < 0.5) { const id = pick(ids); d.change((doc) => ({ ...doc, notes: doc.notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned, folderId: folders.length ? pick(folders) : null } : n)) })) }
      else if (roll < 0.58) { const id = pick(ids); d.change((doc) => ({ ...doc, notes: doc.notes.filter((n) => n.id !== id) })) }
      else if (roll < 0.63) d.change((doc) => ({ ...doc, folders: [...doc.folders, { id: `f${round}`, name: `Folder ${round}` }] }))
      else if (roll < 0.67 && folders.length) { const id = pick(folders); d.change((doc) => ({ ...doc, folders: doc.folders.map((f) => (f.id === id ? { ...f, name: `${f.name}!` } : f)) })) }
      else if (roll < 0.7) d.change((doc) => ({ ...doc, theme: pick(['light', 'dark', 'system']) }))
      else if (roll < 0.73) d.change((doc) => ({ ...doc, settings: { ...doc.settings, blur: Math.floor(random() * 100) } }))
      else { const other = pick(devices.filter((x) => x !== d)); d.hear(other) }
    }
    // A fourth device, with a note of its own, joins from the Mac's snapshot.
    const late = device('mac2', time)
    late.change((doc) => ({ ...doc, notes: [note('late-note'), ...doc.notes] }))
    const entries = snapshotEntries(devices[0].doc, devices[0].meta)
    for (const [stamp] of entries) late.clock.observe(stamp)
    const ops = mergeEntries(late.doc, late.meta, entries)
    if (ops.length) late.hub.commit(0, ops)
    // The snapshot holds all of the Mac's own changes and what it had heard from the others.
    for (const d of devices) late.hear(d, d === devices[0] ? d.log.length : devices[0].seen.get(d) || 0)
    devices.push(late)
    for (let pass = 0; pass < 2; pass += 1) for (const d of devices) for (const other of devices) if (other !== d) d.hear(other)
    for (const d of devices.slice(1)) assert.deepEqual(content(d.doc), content(devices[0].doc), `seed ${seed}: ${d.name} differs from the Mac`)
    assert.ok(devices[0].doc.notes.some((n) => n.id === 'late-note'), `seed ${seed}: the late device's own note was lost`)
  }
})

test('two devices adding to the same page without seeing each other keep both', () => {
  let now = 10
  const mac = device('mac', () => now)
  mac.change((doc) => ({ ...doc, notes: [note('day', { markdown: '- [ ] Water the plants\n' })] }))
  const phone = device('phone', () => now)
  phone.hear(mac)
  now = 20
  mac.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, markdown: `${n.markdown}- [ ] Call the vet\n` })) }))
  now = 21
  phone.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, markdown: `${n.markdown.replace('[ ] Water', '[x] Water')}- [ ] Buy milk\n` })) }))
  mac.hear(phone)
  phone.hear(mac)
  const text = mac.doc.notes[0].markdown
  assert.equal(phone.doc.notes[0].markdown, text)
  assert.match(text, /\[x\] Water the plants/, 'the newer version of a shared line wins')
  assert.match(text, /Buy milk/)
  assert.match(text, /Call the vet/)
  assert.equal(text.match(/Water the plants/g).length, 1)
})

test('an edit made after seeing the other version replaces it (removing a line works)', () => {
  let now = 10
  const mac = device('mac', () => now)
  mac.change((doc) => ({ ...doc, notes: [note('n', { markdown: 'one\ntwo\n' })] }))
  const phone = device('phone', () => now)
  phone.hear(mac)
  now = 20
  phone.change((doc) => ({ ...doc, notes: doc.notes.map((n) => ({ ...n, markdown: 'one\n' })) }))
  mac.hear(phone)
  assert.equal(mac.doc.notes[0].markdown, 'one\n')
})

test('the same day page made on two devices before they ever met is merged', () => {
  let now = 10
  const mac = device('mac', () => now)
  const phone = device('phone', () => now)
  mac.change((doc) => ({ ...doc, notes: [note('day-2026-09-25', { markdown: '- [ ] From the Mac\n' })] }))
  now = 11
  phone.change((doc) => ({ ...doc, notes: [note('day-2026-09-25', { markdown: '- [ ] From the phone\n' })] }))
  mac.hear(phone)
  phone.hear(mac)
  assert.equal(mac.doc.notes.length, 1)
  assert.equal(mac.doc.notes[0].markdown, phone.doc.notes[0].markdown)
  assert.match(mac.doc.notes[0].markdown, /From the Mac/)
  assert.match(mac.doc.notes[0].markdown, /From the phone/)
})

test('three devices writing into the same notes at random still end up the same, losing no line', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    let state = seed
    const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 }
    const pick = (list) => list[Math.floor(random() * list.length)]
    let now = 1000
    const time = () => now
    const devices = [device('mac', time), device('phone', time), device('ipad', time)]
    devices[0].change((doc) => ({ ...doc, notes: [note('a', { markdown: 'start\n' }), note('b', { markdown: '' })] }))
    for (const d of devices.slice(1)) d.hear(devices[0])
    const written = new Set(['start'])
    for (let round = 0; round < 200; round += 1) {
      now += Math.floor(random() * 2)
      const d = pick(devices)
      const id = pick(['a', 'b'])
      const roll = random()
      if (roll < 0.55) {
        const line = `${d.name} ${round}`
        written.add(line)
        d.change((doc) => ({ ...doc, notes: doc.notes.map((n) => (n.id === id ? { ...n, markdown: `${n.markdown}${line}\n` } : n)) }))
      } else {
        d.hear(pick(devices.filter((x) => x !== d)))
      }
    }
    for (let pass = 0; pass < 4; pass += 1) for (const d of devices) for (const other of devices) if (other !== d) d.hear(other)
    for (const d of devices.slice(1)) assert.deepEqual(content(d.doc), content(devices[0].doc), `seed ${seed}: ${d.name} differs`)
    const all = devices[0].doc.notes.map((n) => n.markdown).join('\n')
    for (const line of written) assert.ok(all.includes(line), `seed ${seed}: the line "${line}" was lost`)
  }
})
