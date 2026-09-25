/* How a window reaches the store.
   - Mac app: the main process, through window.osat.store (preload.cjs).
   - Browser preview and tests: a hub living in the page, saved to IndexedDB so
     the preview keeps its notes between reloads. It never touches the Mac app's data. */
import { createEmptyDoc, createHub, migrate } from '../../shared/store-core.mjs'

export function memoryBridge(hub) {
  let listener = () => {}
  const id = hub.connect((message) => queueMicrotask(() => listener(message)))
  return {
    load: async () => ({ rev: hub.rev, doc: hub.doc }),
    commit: async (ops) => hub.commit(id, ops),
    commitSync: (ops) => hub.commit(id, ops),
    replace: async (doc) => hub.replace(doc),
    onChange(fn) { listener = fn; return () => { listener = () => {} } },
    onStatus: () => () => {},
    close: () => hub.disconnect(id),
  }
}

const PREVIEW_DB = 'osat-preview'
const PREVIEW_STORE = 'workspace'

function openPreviewDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PREVIEW_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(PREVIEW_STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('The preview database could not be opened.'))
  })
}

function previewRequest(db, mode, work) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PREVIEW_STORE, mode)
    const request = work(transaction.objectStore(PREVIEW_STORE))
    transaction.oncomplete = () => resolve(request?.result)
    transaction.onerror = () => reject(transaction.error)
  })
}

export function previewBridge({ fresh = false } = {}) {
  let inner = null
  let db = null
  let saveTimer = null
  const statusListeners = new Set()
  const save = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      previewRequest(db, 'readwrite', (store) => store.put(hub.doc, 'doc')).catch((error) => {
        for (const listener of statusListeners) listener({ state: 'error', message: `The preview couldn't save: ${error?.message || error}` })
      })
    }, 200)
  }
  let hub = null
  const ready = (async () => {
    let saved = null
    try {
      db = await openPreviewDb()
      saved = fresh ? null : await previewRequest(db, 'readonly', (store) => store.get('doc'))
    } catch {
      db = null // private browsing: the preview still works, it just forgets on reload
    }
    hub = createHub(migrate(saved || createEmptyDoc()))
    inner = memoryBridge(hub)
  })()
  const persist = (result) => { if (db) save(); return result }
  let pendingListener = null
  return {
    load: async () => { await ready; if (pendingListener) inner.onChange(pendingListener); return inner.load() },
    commit: async (ops) => { await ready; return persist(await inner.commit(ops)) },
    commitSync: (ops) => persist(inner.commitSync(ops)),
    replace: async (doc) => { await ready; return persist(await inner.replace(doc)) },
    onChange(fn) { pendingListener = fn; inner?.onChange(fn); return () => {} },
    onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn) },
  }
}

export function pickBridge() {
  if (typeof window !== 'undefined' && window.osat?.store) return window.osat.store
  const fresh = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fresh')
  return previewBridge({ fresh })
}
