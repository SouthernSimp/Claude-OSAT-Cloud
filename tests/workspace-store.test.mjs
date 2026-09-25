import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultWorkspace } from '../src/osat-data.js'
import { loadCanonicalWorkspace } from '../src/osat-store.js'

function fakeIndexedDB(record, failPut = false) {
  const store = new Map(record ? [['primary', record]] : [])
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    transaction() {
      const transaction = { error: null }
      transaction.objectStore = () => ({
        get(key) {
          const request = { result: store.get(key) }
          queueMicrotask(() => request.onsuccess?.())
          return request
        },
        put(value, key) {
          queueMicrotask(() => {
            if (failPut) {
              transaction.error = new Error('write-failed')
              transaction.onerror?.()
              return
            }
            store.set(key, value)
            transaction.oncomplete?.()
          })
        },
      })
      return transaction
    },
    close() {},
  }
  return {
    indexedDB: {
      open() {
        const request = { result: database }
        queueMicrotask(() => request.onsuccess?.())
        return request
      },
    },
    store,
  }
}

function workspace(updatedAt, note = null) {
  const state = createDefaultWorkspace(updatedAt)
  if (note) state.notes = [note]
  return state
}

async function loadWith({ canonical = null, pending = null, storage = {} } = {}) {
  const prior = globalThis.indexedDB
  const fake = fakeIndexedDB(canonical)
  globalThis.indexedDB = fake.indexedDB
  try {
    const result = await loadCanonicalWorkspace({
      getItem(key) {
        if (storage.throwOnGet) throw new Error('storage-unavailable')
        return key === 'osat.field.pending-workspace.v1' ? pending : null
      },
      length: 0,
      key: () => null,
    })
    return { result, fake }
  } finally {
    globalThis.indexedDB = prior
  }
}

test('keeps a valid canonical workspace when recovery JSON is malformed', async () => {
  const canonical = workspace('2026-09-14T12:00:00.000Z', { id: 'note-real', title: 'Keep me', markdown: 'Canonical' })
  for (const pending of ['{broken', 'null', '42', '{}', JSON.stringify({ ...canonical, updatedAt: undefined })]) {
    const { result } = await loadWith({ canonical, pending })
    assert.equal(result.state.notes[0].id, 'note-real')
    assert.equal(result.state.updatedAt, canonical.updatedAt)
  }
})

test('recovers a newer valid pending workspace and preserves its note', async () => {
  const canonical = workspace('2026-09-14T12:00:00.000Z')
  const pending = workspace('2026-09-15T12:00:00.000Z', { id: 'note-pending', title: 'Recovered', markdown: 'Pending text' })
  const { result } = await loadWith({ canonical, pending: JSON.stringify(pending) })
  assert.equal(result.state.notes[0].id, 'note-pending')
  assert.equal(result.state.notes[0].markdown, 'Pending text')
})

test('compares parsed timestamps and lets valid recovery replace an invalid canonical timestamp', async () => {
  const canonical = workspace('2026-09-15T04:00:00.000Z')
  const pending = workspace('2026-09-15T00:30:00-05:00', { id: 'note-pending', title: 'Recovered', markdown: 'Pending text' })
  const parsedDate = workspace('not-a-timestamp')
  const first = await loadWith({ canonical, pending: JSON.stringify(pending) })
  assert.equal(first.result.state.notes[0].id, 'note-pending')
  const second = await loadWith({ canonical: parsedDate, pending: JSON.stringify(pending) })
  assert.equal(second.result.state.notes[0].id, 'note-pending')
})

test('fails closed for primitive, incomplete, untimestamped, or malformed recovery without canonical data', async () => {
  const values = ['42', JSON.stringify({}), JSON.stringify({ ...workspace('2026-09-15T12:00:00.000Z'), updatedAt: undefined }), '{broken']
  for (const pending of values) {
    await assert.rejects(() => loadWith({ pending }), /recovery data is invalid/i)
  }
})

test('uses canonical data when localStorage recovery cannot be read', async () => {
  const canonical = workspace('2026-09-14T12:00:00.000Z', { id: 'note-real', title: 'Keep me', markdown: 'Canonical' })
  const { result } = await loadWith({ canonical, storage: { throwOnGet: true } })
  assert.equal(result.state.notes[0].id, 'note-real')
})

test('does not swallow a failed write while recovering valid pending data', async () => {
  const prior = globalThis.indexedDB
  const fake = fakeIndexedDB(null, true)
  globalThis.indexedDB = fake.indexedDB
  try {
    const pending = workspace('2026-09-15T12:00:00.000Z', { id: 'note-pending', title: 'Recovered', markdown: 'Pending text' })
    await assert.rejects(() => loadCanonicalWorkspace({
      getItem: () => JSON.stringify(pending),
      length: 0,
      key: () => null,
    }), /write-failed/)
  } finally {
    globalThis.indexedDB = prior
  }
})
