/* What Ask reads, said in OSAT's words. Every source Ask is given has a kind (a sticky, a scan, a
   journal day) and a place (in Wedding / Cake, in Unsorted, on the Sky), so the model can say where an answer
   came from and the chips under it can show the same. Which notes a question is about is
   `relatedForAsk` (work-scope.js). Pure. */

import { folderPath } from '../notes-model.js'

export const noteKind = (note) => (note.kind === 'day' ? 'Journal' : note.source === 'Scan' ? 'Scan' : 'Sticky')

export function noteWhere(note, folders = []) {
  if (note.kind === 'day') return ''
  const path = note.folderId ? folderPath(folders, note.folderId) : []
  if (path.length) return `in ${path.join(' / ')}`
  return note.at ? 'on the Sky' : 'in Unsorted'
}

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/* "SCAN: Lease (in Home, edited Sep 28, 2026)" — the line the model reads above a note's words. */
export function noteHeading(note, folders = []) {
  const where = noteWhere(note, folders)
  const edited = Number.isNaN(Date.parse(note.updatedAt)) ? '' : `edited ${DAY.format(new Date(note.updatedAt))}`
  const detail = [where, edited].filter(Boolean).join(', ')
  return `${noteKind(note).toUpperCase()}: ${note.title || 'Untitled'}${detail ? ` (${detail})` : ''}`
}
