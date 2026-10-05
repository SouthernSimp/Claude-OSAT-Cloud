import { applyOps, diffDocs, same } from '../../shared/store-core.mjs'
import { canMoveFolder, isActiveNote } from '../notes-model.js'
import { recordOf } from '../links-model.js'

const placement = { notes: ['folderId', 'unsorted', 'at', 'rank'], folders: ['parentId', 'kind', 'at', 'rank'] }
const pick = (record, fields) => Object.fromEntries(fields.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]))

// Only existing records' canvas fields. Writing, creation and deletion have their
// own workflows; a canvas Undo must never replace a record or a whole workspace.
export function canvasChange(before, after, label) {
  const changes = diffDocs(before, after).flatMap((op) => {
    if (op.t !== 'patch' || !placement[op.c]) return []
    const old = before[op.c].find((item) => item.id === op.id)
    const next = after[op.c].find((item) => item.id === op.id)
    return [placement[op.c], ['links']].flatMap((fields) => {
      const a = pick(old, fields), b = pick(next, fields)
      return same(a, b) ? [] : [{ c: op.c, id: op.id, fields, before: a, after: b }]
    })
  })
  return changes.length ? { label, changes } : null
}

export function replayCanvas(state, entry, direction) {
  let next = state, skipped = 0
  const placedNotes = new Set()
  for (const change of entry.changes) {
    const record = next[change.c].find((item) => item.id === change.id)
    const expected = direction === 'undo' ? change.after : change.before
    const target = direction === 'undo' ? change.before : change.after
    const home = change.c === 'notes' ? target.folderId : target.parentId
    if (!record || (change.c === 'notes' && !isActiveNote(record)) || !same(pick(record, change.fields), expected)
      || (home && !next.folders.some((item) => item.id === home))
      || (change.c === 'folders' && change.fields.includes('parentId') && !canMoveFolder(next.folders, change.id, home || null))
      || target.links?.some((key) => !recordOf(next, key))) { skipped += 1; continue }
    next = applyOps(next, [{ t: 'patch', c: change.c, id: change.id, v: target, unset: change.fields.filter((key) => !Object.hasOwn(target, key)) }]).doc
    if (change.c === 'notes' && change.fields.includes('folderId')) placedNotes.add(change.id)
  }
  return { state: next, skipped, placedNotes: [...placedNotes] }
}
