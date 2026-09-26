/* How a window reaches the store.
   - Mac app: the main process, through window.osat.store (preload.cjs).
   - iPhone app: a hub in the page, saved by the app, and kept in step with the Mac
     by the sync engine over the app's iCloud folder (phoneBridge).
   - Browser preview and tests: a hub living in the page, saved to IndexedDB so
     the preview keeps its notes between reloads. It never touches the Mac app's data. */
import { createEmptyDoc, createHub, migrate } from '../../shared/store-core.mjs'
import { createSyncEngine } from '../../shared/sync-engine.mjs'

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

/* ---------- the iPhone app ---------- */

/* The Swift side, through WKWebView's message handler. Each call gets an id and the
   app answers with window.osatNative.reply(id, result, error); it also sends events
   (cloud.changed when iCloud brings files, app.active when the app comes forward). */
export function nativeBridge(handler = globalThis.window?.webkit?.messageHandlers?.osat) {
  if (!handler) return null
  let seq = 0
  const waiting = new Map()
  const listeners = new Map()
  window.osatNative = {
    reply(id, result, error) {
      const call = waiting.get(id)
      if (!call) return
      waiting.delete(id)
      if (error) call.reject(new Error(error))
      else call.resolve(result)
    },
    event(name, detail) {
      for (const listener of listeners.get(name) || []) listener(detail)
    },
  }
  return {
    call(type, args = {}) {
      const id = ++seq
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        handler.postMessage({ id, type, ...args })
      })
    },
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(listener)
      return () => listeners.get(name).delete(listener)
    },
  }
}

/* How the phone's sync is doing, for its Settings. */
export const phoneSync = (() => {
  let status = { mode: 'preview', devices: 0, lastArrival: null, error: '' }
  const listeners = new Set()
  return {
    get status() { return status },
    set(patch) {
      status = { ...status, ...patch }
      for (const listener of listeners) listener(status)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    pull: () => {},
  }
})()

const parse = (text) => {
  try { return text ? JSON.parse(text) : null } catch { return null }
}

export function phoneBridge(native, { saveDelay = 300, flushDelay = 1200, pullDelay = 500, pollEvery = 15000 } = {}) {
  let hub = null
  let windowId = null
  let engine = null
  let saveTimer = null
  let flushTimer = null
  let pullTimer = null
  let chain = Promise.resolve()
  let windowListener = () => {}

  const save = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      native.call('local.write', { name: 'workspace.json', text: JSON.stringify(hub.doc) }).catch(() => {})
      if (engine) native.call('local.write', { name: 'sync.json', text: JSON.stringify(engine.state()) }).catch(() => {})
    }, saveDelay)
  }
  // One sync task at a time, like the Mac (desktop/sync.cjs).
  const run = (task) => {
    chain = chain.then(task).then(() => { if (phoneSync.status.error) phoneSync.set({ error: '' }) }, (error) => {
      phoneSync.set({ error: `Couldn't reach iCloud (${error?.message || error}). It will try again.` })
    }).finally(save)
    return chain
  }
  const flushSoon = () => {
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => run(() => engine.flush()), flushDelay)
  }
  const pull = () => run(async () => {
    const arrived = await engine.pull()
    phoneSync.set({ devices: Object.keys(engine.state().seen).length, ...(arrived ? { lastArrival: new Date().toISOString() } : {}) })
  })
  const pullSoon = () => {
    clearTimeout(pullTimer)
    pullTimer = setTimeout(pull, pullDelay)
  }

  const ready = (async () => {
    hub = createHub(migrate(parse(await native.call('local.read', { name: 'workspace.json' })) || createEmptyDoc()))
    windowId = hub.connect((message) => queueMicrotask(() => windowListener(message)))
    const syncId = hub.connect(() => save())
    const cloud = await native.call('cloud.status').catch(() => ({ available: false }))
    if (!cloud?.available) {
      phoneSync.set({ mode: 'local' })
      return
    }
    const state = parse(await native.call('local.read', { name: 'sync.json' }))
    const files = {
      list: (path) => native.call('cloud.list', { path }),
      read: (path) => native.call('cloud.read', { path }),
      write: (path, text) => native.call('cloud.write', { path, text }),
    }
    engine = createSyncEngine({
      device: state?.device || `iphone-${crypto.randomUUID().slice(0, 8)}`,
      files,
      state,
      doc: () => hub.doc,
      apply: (ops) => hub.commit(syncId, ops),
    })
    phoneSync.set({ mode: 'icloud' })
    phoneSync.pull = pullSoon
    native.on('cloud.changed', pullSoon)
    native.on('app.active', pullSoon)
    const poll = setInterval(() => { if (globalThis.document?.visibilityState !== 'hidden') pullSoon() }, pollEvery)
    poll?.unref?.()
    await run(() => engine.start())
    pullSoon()
  })()

  // Every change made on the phone is saved and handed to sync.
  const commit = (ops) => {
    const result = hub.commit(windowId, ops)
    if (engine) {
      engine.record(ops)
      flushSoon()
    }
    save()
    return result
  }
  return {
    load: async () => { await ready; return { rev: hub.rev, doc: hub.doc } },
    commit: async (ops) => { await ready; return commit(ops) },
    commitSync: (ops) => commit(ops),
    replace: async (doc) => { await ready; const result = hub.replace(doc); save(); return result },
    onChange(listener) { windowListener = listener; return () => { windowListener = () => {} } },
    onStatus: () => () => {},
  }
}

export function pickBridge() {
  if (typeof window !== 'undefined' && window.osat?.store) return window.osat.store
  const native = typeof window !== 'undefined' ? nativeBridge() : null
  if (native) return phoneBridge(native)
  const fresh = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fresh')
  return previewBridge({ fresh })
}
