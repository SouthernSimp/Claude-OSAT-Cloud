import test from 'node:test'
import assert from 'node:assert/strict'
import { previewBridge } from '../src/store/bridges.js'

function browserStorage() {
  const writes = []
  let saved
  const db = {
    transaction(_store, mode) {
      const transaction = { error: null }
      transaction.objectStore = () => ({
        get() {
          const request = { result: saved }
          queueMicrotask(() => transaction.oncomplete?.())
          return request
        },
        put(value) {
          writes.push({
            finish() { saved = structuredClone(value); transaction.oncomplete?.() },
            abort() { transaction.onabort?.() },
          })
          return { result: 'doc' }
        },
      })
      assert.ok(['readonly', 'readwrite'].includes(mode))
      return transaction
    },
  }
  return {
    writes,
    indexedDB: { open() {
      const request = { result: db }
      queueMicrotask(() => request.onsuccess?.())
      return request
    } },
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
const ops = [{ t: 'add', c: 'notes', v: { id: 'review', title: 'Keep this', markdown: 'Final writing' } }]

test('the preview acknowledges saving only after its IndexedDB transaction completes', async () => {
  const original = globalThis.indexedDB
  const storage = browserStorage()
  globalThis.indexedDB = storage.indexedDB
  try {
    const bridge = previewBridge()
    await bridge.load()
    let acknowledged = false
    const saving = bridge.commit(ops).then(() => { acknowledged = true })
    await tick()
    assert.equal(acknowledged, false)
    storage.writes[0].finish()
    await saving
    assert.equal(acknowledged, true)
    const reopened = previewBridge()
    assert.equal((await reopened.load()).doc.notes[0].markdown, 'Final writing')
  } finally { globalThis.indexedDB = original }
})

test('an aborted preview save rejects and unload never claims an asynchronous write is durable', async () => {
  const original = globalThis.indexedDB
  const storage = browserStorage()
  globalThis.indexedDB = storage.indexedDB
  try {
    const bridge = previewBridge()
    await bridge.load()
    const saving = bridge.commit(ops)
    const rejected = assert.rejects(saving, /interrupted/)
    await tick()
    storage.writes[0].abort()
    await rejected
    const unload = bridge.commitSync([{ t: 'patch', c: 'notes', id: 'review', v: { markdown: 'Last words' } }])
    assert.equal(unload.durable, false)
    storage.writes[1].finish()
  } finally { globalThis.indexedDB = original }
})
