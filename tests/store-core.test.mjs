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

test('schema 11 preserves existing notes and chats with their selected and responding models', () => {
  const chat = { id: 'chat-kept', title: 'A question', modelId: 'osat:balanced', messages: [
    { id: 'answer-kept', role: 'assistant', content: 'Saved answer', modelId: 'osat:light', modelName: 'Gemma 4 E2B · Light' },
  ] }
  const old = { ...createEmptyDoc(), schema: 10, rev: 19, notes: [note('kept')], chats: [chat] }
  const upgraded = migrate(old)
  assert.equal(upgraded.schema, SCHEMA)
  assert.equal(upgraded.rev, 19)
  assert.deepEqual(upgraded.notes, old.notes)
  assert.deepEqual(upgraded.chats, old.chats)
})

test('schema 5: stickies left on the scratch page land in Unsorted, nothing else changes', () => {
  const scratch = { ...note('s'), kind: 'scratch', color: 'sky', unsorted: false }
  const filed = { ...note('f'), kind: 'scratch', folderId: 'x' }
  const day = { ...note('day-2026-09-28'), kind: 'day', date: '2026-09-28' }
  const doc = migrate({ ...createEmptyDoc(), schema: 4, notes: [scratch, filed, day] })
  assert.deepEqual(doc.notes, [{ ...scratch, kind: null, unsorted: true }, { ...filed, kind: null, unsorted: false }, day])
})

test('schema 4: every project becomes a node holding what it said, once, and the projects stay', async () => {
  const { projectNodes } = await import('../shared/store-core.mjs')
  const projects = [
    { id: 'project-1', title: 'Garden', summary: 'Beds by the fence', status: 'done', url: 'https://example.com', folder: 'Garden plans', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'project-2', title: 'Taxes', summary: '', status: 'active', url: '', folder: '' },
  ]
  const old = { ...createEmptyDoc(), schema: 3, projects, folders: [{ id: 'f', name: 'Garden', parentId: null, createdAt: '2026-01-01T00:00:00.000Z' }] }
  const doc = migrate(old)
  assert.equal(doc.schema, SCHEMA)
  assert.deepEqual(doc.projects, projects, 'nothing is taken away')
  assert.deepEqual(doc.folders.map((folder) => [folder.id, folder.name]), [['f', 'Garden'], ['folder-project-1', 'Garden 2'], ['folder-project-2', 'Taxes']])
  assert.deepEqual(doc.notes.map((note) => [note.folderId, note.markdown]), [
    ['folder-project-1', 'Beds by the fence'],
    ['folder-project-1', 'Website: https://example.com'],
    ['folder-project-1', 'Folder on this Mac: Garden plans'],
    ['folder-project-1', 'Status: done'],
  ])
  assert.deepEqual(projectNodes(doc), doc, 'twice (or on another Mac) makes the same nodes once')
})

test('schema 6: a sticky keeps a real day it names to ask about; nothing else changes', async () => {
  const { normalizeNote } = await import('../shared/note-core.mjs')
  const doc = migrate({ ...createEmptyDoc(), schema: 5, notes: [note('a')] })
  assert.deepEqual(doc.notes, [note('a')])
  const asked = normalizeNote({ ...note('b'), ask: { event: { title: ' Wedding ', date: '2026-10-05', time: '9am' } } })
  assert.deepEqual(asked.ask, { event: { title: 'Wedding', date: '2026-10-05', time: '' } })
  assert.equal('ask' in normalizeNote({ ...note('c'), ask: { event: { title: 'X', date: 'Oct 5' } } }), false)
})
