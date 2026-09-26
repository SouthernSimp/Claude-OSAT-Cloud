import test from 'node:test'
import assert from 'node:assert/strict'
import { applyOps, compactOps, createEmptyDoc, createHub, diffDocs, migrate, SCHEMA, validateOps } from '../shared/store-core.mjs'

const note = (id, extra = {}) => ({ id, title: id, markdown: '', tags: [], ...extra })

test('diffing then applying reproduces the new document, and the inverse restores the old one', () => {
  const before = { ...createEmptyDoc(), notes: [note('a'), note('b'), note('c')], sorter: { activeId: 'desk', boards: [{ id: 'desk', notes: [] }] } }
  const after = {
    ...before,
    theme: 'dark',
    notes: [note('n'), { ...before.notes[0], title: 'A!' }, before.notes[2]],
    sorter: { ...before.sorter, activeId: 'desk', boards: [{ ...before.sorter.boards[0], notes: [{ id: 'a', x: 1 }] }] },
  }
  const ops = diffDocs(before, after)
  const { doc, inverse } = applyOps(before, ops)
  assert.deepEqual(doc, after)
  assert.deepEqual(applyOps(doc, inverse).doc, before)
  assert.deepEqual(ops.map((op) => op.t).sort(), ['add', 'del', 'patch', 'patch', 'set'])
})

test('an unchanged document produces no operations, and one keystroke produces exactly one patch', () => {
  const base = { ...createEmptyDoc(), notes: [note('a', { markdown: 'hi' }), note('b')] }
  assert.deepEqual(diffDocs(base, base), [])
  const typed = { ...base, notes: base.notes.map((n) => n.id === 'a' ? { ...n, markdown: 'hi!' } : n) }
  assert.deepEqual(diffDocs(base, typed), [{ t: 'patch', c: 'notes', id: 'a', v: { markdown: 'hi!' } }])
})

test('reordering and removed fields are captured', () => {
  const base = { ...createEmptyDoc(), folders: [{ id: 'x', name: 'X', color: 'red' }, { id: 'y', name: 'Y' }] }
  const next = { ...base, folders: [base.folders[1], { id: 'x', name: 'X' }] }
  const ops = diffDocs(base, next)
  assert.deepEqual(applyOps(base, ops).doc.folders, next.folders)
  assert.ok(ops.some((op) => op.t === 'order'))
  assert.ok(ops.some((op) => op.t === 'patch' && op.unset?.includes('color')))
})

test('adds are idempotent and patches to missing records are ignored', () => {
  const doc = { ...createEmptyDoc(), notes: [note('a')] }
  assert.equal(applyOps(doc, [{ t: 'add', c: 'notes', v: note('a', { title: 'other' }) }]).doc, doc)
  assert.equal(applyOps(doc, [{ t: 'patch', c: 'notes', id: 'zzz', v: { title: 'x' } }]).doc, doc)
  assert.equal(applyOps(doc, [{ t: 'del', c: 'notes', id: 'zzz' }]).doc, doc)
})

test('compacting folds a burst of keystrokes into one patch without changing the result', () => {
  const doc = { ...createEmptyDoc(), notes: [note('a')] }
  const ops = [
    { t: 'add', c: 'notes', v: note('b') },
    { t: 'patch', c: 'notes', id: 'b', v: { markdown: 'h' } },
    { t: 'patch', c: 'notes', id: 'a', v: { markdown: 'x' } },
    { t: 'patch', c: 'notes', id: 'a', v: { markdown: 'xy', pinned: true } },
    { t: 'patch', c: 'notes', id: 'a', v: {}, unset: ['pinned'] },
    { t: 'set', p: 'theme', v: 'dark' },
    { t: 'set', p: 'theme', v: 'light' },
  ]
  const compacted = compactOps(ops)
  assert.equal(compacted.length, 3)
  assert.deepEqual(applyOps(doc, compacted).doc, applyOps(doc, ops).doc)
})

test('validation rejects anything a window should not be able to do', () => {
  assert.doesNotThrow(() => validateOps([{ t: 'set', p: 'sorter.activeId', v: 'x' }, { t: 'add', c: 'sorter.boards', v: { id: 'b' } }]))
  for (const bad of [
    'nope',
    [{ t: 'set', p: 'rev', v: 9 }],
    [{ t: 'set', p: '__proto__.polluted', v: 1 }],
    [{ t: 'set', p: 'notes.0.title', v: 'x' }],
    [{ t: 'add', c: 'passwords', v: { id: 'x' } }],
    [{ t: 'add', c: 'notes', v: { title: 'no id' } }],
    [{ t: 'patch', c: 'notes', id: 'a', v: { id: 'b' } }],
    [{ t: 'patch', c: 'notes', id: 'a', v: [] }],
    [{ t: 'explode', c: 'notes' }],
  ]) assert.throws(() => validateOps(bad), /INVALID_OPS/)
  assert.throws(() => validateOps([{ t: 'add', c: 'notes', v: JSON.parse('{"id":"x","__proto__":{"a":1}}') }]), /INVALID_OPS/)
})

test('the hub orders commits, tells the other windows, and never echoes to the sender', () => {
  const hub = createHub()
  const heard = { a: [], b: [] }
  const a = hub.connect((message) => heard.a.push(message))
  const b = hub.connect((message) => heard.b.push(message))
  assert.deepEqual(hub.commit(a, [{ t: 'add', c: 'notes', v: note('n1') }]), { rev: 1 })
  assert.deepEqual(hub.commit(b, [{ t: 'set', p: 'theme', v: 'dark' }]), { rev: 2 })
  assert.deepEqual(heard.a.map((m) => m.rev), [2])
  assert.deepEqual(heard.b.map((m) => m.rev), [1])
  assert.equal(hub.doc.notes[0].id, 'n1')
  assert.throws(() => hub.commit(a, [{ t: 'set', p: 'rev', v: 0 }]), /INVALID_OPS/)
  assert.equal(hub.rev, 2)
  hub.replace({ ...createEmptyDoc(), theme: 'light' })
  assert.equal(heard.a.at(-1).reset, true)
  assert.equal(heard.b.at(-1).doc.rev, 3)
})

test('migration refuses data from a newer OSAT and fills in schema and rev', () => {
  assert.deepEqual(migrate({ theme: 'dark' }), { theme: 'dark', schema: SCHEMA, rev: 0 })
  assert.throws(() => migrate({ schema: SCHEMA + 1 }), /newer OSAT/)
  const steps = [{ from: SCHEMA, run: (doc) => ({ ...doc, upgraded: true }) }]
  assert.equal(migrate({ schema: SCHEMA }, steps).upgraded, undefined, 'no step runs past the current schema')
})

test('a workspace from before Ask moved in gains an empty list of chats', () => {
  const old = { ...createEmptyDoc(), schema: 1, rev: 7, notes: [note('a')] }
  delete old.chats
  const upgraded = migrate(old)
  assert.deepEqual(upgraded.chats, [])
  assert.equal(upgraded.schema, SCHEMA)
  assert.equal(upgraded.rev, 7)
  assert.equal(upgraded.notes[0].id, 'a')
})
