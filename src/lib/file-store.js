// Browser copies stay separate from the Electron file bridge and workspace backups.
const DB = 'osat-file-shelf';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export function validateShelfFile(file) {
  if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size)) throw new Error('Choose a file to keep.');
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 25 MB. Keep a smaller copy here.`);
}
async function transact(mode, action) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Your file shelf could not be opened.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('files', mode);
      const request = action(transaction.objectStore('files'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('The file could not be saved. Your original is unchanged.'));
    });
  } finally { db.close(); }
}
export const listShelfFiles = () => transact('readonly', (store) => store.getAll());
export const removeShelfFile = (id) => transact('readwrite', (store) => store.delete(id));
export async function saveShelfFile(file) {
  validateShelfFile(file);
  const record = { id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type, addedAt: new Date().toISOString(), blob: file };
  await transact('readwrite', (store) => store.put(record));
  return record;
}
