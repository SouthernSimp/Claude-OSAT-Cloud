import {
  CANONICAL_DB_NAME,
  CANONICAL_RECORD_KEY,
  CANONICAL_STORE_NAME,
  importLegacyStorage,
  normalizeWorkspace,
  readWorkspaceBackup,
} from './osat-data.js'

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Local database request failed.'))
  })
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is unavailable in this browser.'))
      return
    }
    const request = indexedDB.open(CANONICAL_DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CANONICAL_STORE_NAME)) request.result.createObjectStore(CANONICAL_STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open the local database.'))
  })
}

async function readRecord(database) {
  const transaction = database.transaction(CANONICAL_STORE_NAME, 'readonly')
  return requestResult(transaction.objectStore(CANONICAL_STORE_NAME).get(CANONICAL_RECORD_KEY))
}

async function writeRecord(database, state) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CANONICAL_STORE_NAME, 'readwrite')
    transaction.objectStore(CANONICAL_STORE_NAME).put(state, CANONICAL_RECORD_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Could not save the local workspace.'))
    transaction.onabort = () => reject(transaction.error || new Error('Local workspace save was aborted.'))
  })
}

const RECOVERY_KEY = 'osat.field.pending-workspace.v1';
let writes = Promise.resolve();

const validTimestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))

function parsePendingWorkspace(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const raw = JSON.parse(value)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !validTimestamp(raw.updatedAt)) return null
    return readWorkspaceBackup({ format: 'osat-local-backup', version: 1, workspace: raw })
  } catch {
    return null
  }
}

export function stageWorkspace(state) {
  const next = { ...state, updatedAt: new Date().toISOString() };
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(next));
  return next;
}

export async function loadCanonicalWorkspace(storage = localStorage) {
  const database = await openDatabase()
  try {
    const existing = await readRecord(database)
    let pending = null
    try {
      pending = storage.getItem(RECOVERY_KEY)
    } catch {
      // A healthy IndexedDB record remains the source of truth if recovery storage is unavailable.
    }
    if (pending) {
      const recovered = parsePendingWorkspace(pending)
      if (recovered && (!existing || !validTimestamp(existing.updatedAt) || Date.parse(recovered.updatedAt) >= Date.parse(existing.updatedAt))) {
        await writeRecord(database, recovered)
        return { state: recovered, imported: false }
      }
      if (!existing) throw new Error('Local recovery data is invalid and no canonical workspace is available.')
    }
    if (existing) return { state: normalizeWorkspace(existing), imported: false }
    const imported = importLegacyStorage(storage)
    await writeRecord(database, imported)
    return { state: imported, imported: true }
  } finally {
    database.close()
  }
}

export function saveCanonicalWorkspace(state) {
  const normalized = normalizeWorkspace(state)
  writes = writes.catch(() => {}).then(async () => {
    const database = await openDatabase()
    try {
      await writeRecord(database, normalized)
      return normalized
    } finally {
      database.close()
    }
  })
  return writes
}
