import { wordHomes, wordNodes, sortGroups } from './sort-unsorted.js'
import { addFolder, moveSticky, pileOf } from '../nodes-model.js'

const fields = ['folderId', 'unsorted', 'rank', 'at']
const placement = (note) => Object.fromEntries(fields.filter((key) => Object.hasOwn(note, key)).map((key) => [key, note[key]]))
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Recheck membership at commit time. A stale review never moves an already filed,
// archived, trashed or deleted note, and a missing destination is never Unsorted.
export function fileUnsorted(state, ids, folderId, name = '') {
  const wanted = new Set(ids)
  const waiting = pileOf(state.notes, null).filter((note) => wanted.has(note.id) && !note.at)
  if (!waiting.length) return { state, changes: [], moved: [] }
  let next = state
  if (name.trim()) {
    const made = addFolder(state, name)
    next = made.state
    folderId = made.folder?.id
  }
  if (!next.folders.some((folder) => folder.id === folderId)) return { state, changes: [], moved: [] }
  for (const note of waiting) next = moveSticky(next, note.id, folderId)
  const before = new Map(state.notes.map((note) => [note.id, note]))
  const changes = next.notes.flatMap((note) => {
    const old = before.get(note.id)
    return old && !equal(placement(old), placement(note)) ? [{ id: note.id, before: placement(old), after: placement(note) }] : []
  })
  return { state: next, changes, moved: waiting.map((note) => note.id), folderId }
}

// Restore only placement fields while retaining later writing and relationships.
// A subsequent move wins. New topics remain so later work in them cannot be lost.
export function undoFiling(state, changes) {
  const byId = new Map(changes.map((change) => [change.id, change]))
  const restoredIds = []
  const notes = state.notes.map((note) => {
    const change = byId.get(note.id)
    if (!change || !equal(placement(note), change.after)) return note
    if (change.before.folderId && !state.folders.some((folder) => folder.id === change.before.folderId)) return note
    const kept = { ...note }
    fields.forEach((key) => delete kept[key])
    restoredIds.push(note.id)
    return { ...kept, ...change.before }
  })
  return { state: { ...state, notes }, restored: restoredIds.length, restoredIds }
}

// Conservative word hints: the destination's own name or an exact tag must
// match. Shared boilerplate in existing notes is not enough to recommend a home.
export function reviewSuggestions(state, notes) {
  const key = (value) => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const homes = wordHomes(state, notes).filter(({ noteId, folderId }) => {
    const note = notes.find((item) => item.id === noteId)
    const folder = state.folders.find((item) => item.id === folderId)
    if (!note || !folder) return false
    if ((note.tags || []).some((tag) => key(tag) === key(folder.name))) return true
    const words = new Set(`${note.title} ${note.markdown}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])
    const name = folder.name.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []
    return name.length > 0 && name.every((word) => words.has(word))
  })
  const placed = new Set(homes.map((home) => home.noteId))
  return sortGroups({ homes, made: wordNodes(notes.filter((note) => !placed.has(note.id))) })
}
