import { addFolder, moveSticky, nodesOf, pileOf, placeSticky } from '../nodes-model.js'
import { trashNotes } from '../notes-model.js'

// `filed` too: Undo of what the AI filed takes its mark away with it.
const fields = ['folderId', 'unsorted', 'rank', 'at', 'trashedAt', 'archived', 'pinned', 'filed']
const placement = (note) => Object.fromEntries(fields.filter((key) => Object.hasOwn(note, key)).map((key) => [key, note[key]]))
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const key = (text) => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

// Recheck membership at commit time. A stale review never moves an already filed,
// archived, trashed or deleted note, and a missing destination is never Unsorted.
export function fileUnsorted(state, ids, folderId, name = '', { at, trash = false } = {}) {
  const wanted = new Set(ids)
  const waiting = pileOf(state.notes, null).filter((note) => wanted.has(note.id) && !note.at)
  if (!waiting.length) return { state, changes: [], moved: [] }
  let next = state
  let made = null
  if (!trash && at === undefined && name.trim()) {
    // A node of that name already there is used, never a second one made.
    const same = nodesOf(state.folders).find(({ folder }) => key(folder.name) === key(name))?.folder
    if (same) folderId = same.id
    else {
      const result = addFolder(state, name)
      next = result.state
      folderId = made = result.folder?.id || null
    }
  }
  if (trash) next = trashNotes(next, waiting.map((note) => note.id))
  else if (at !== undefined) {
    if (!Number.isFinite(at?.x) || !Number.isFinite(at?.y)) return { state, changes: [], moved: [] }
    for (const note of waiting) next = placeSticky(next, note.id, at)
  } else {
    if (!next.folders.some((folder) => folder.id === folderId)) return { state, changes: [], moved: [] }
    for (const note of waiting) next = moveSticky(next, note.id, folderId)
  }
  return { state: next, changes: placementChanges(state, next), moved: waiting.map((note) => note.id), folderId: trash || at ? null : folderId, made }
}

/* Where each note that moved between two states was and is now, for undoFiling. */
export function placementChanges(state, next) {
  const before = new Map(state.notes.map((note) => [note.id, note]))
  return next.notes.flatMap((note) => {
    const old = before.get(note.id)
    return old && !equal(placement(old), placement(note)) ? [{ id: note.id, before: placement(old), after: placement(note) }] : []
  })
}

// Restore only placement fields while retaining later writing and relationships.
// A subsequent move wins. A node made for them (`made`) goes too, but only while it is
// empty: anything put in it since keeps it.
export function undoFiling(state, changes, made = []) {
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
  const used = new Set([...notes.map((note) => note.folderId), ...state.folders.map((folder) => folder.parentId)].filter(Boolean))
  const gone = new Set(made.filter((id) => id && !used.has(id)))
  const folders = gone.size ? state.folders.filter((folder) => !gone.has(folder.id)) : state.folders
  return { state: { ...state, notes, folders }, restored: restoredIds.length, restoredIds }
}
