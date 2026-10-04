import { validateOps } from '../../shared/store-core.mjs'

// A temporary recovery copy, removed only when the store confirms the changes.
// Each surface keeps its own copy so the floating chat cannot overwrite the desk.
export function draftJournal(storage, key) {
  return {
    read() {
      const value = JSON.parse(storage.getItem(key) || 'null')
      if (!value?.ops?.length) return null
      validateOps(value.ops)
      return value
    },
    write(value) { storage.setItem(key, JSON.stringify(value)) },
    clear() { storage.removeItem(key) },
  }
}
