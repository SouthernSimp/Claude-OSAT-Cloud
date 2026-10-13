/* Put the desk away (Phase 56): every sticky and stack on the desk goes into one topic on the canvas,
   "Put away · Oct 12", and the desk is clear. Each stack becomes a branch of that topic with its name.
   A sticky with no home yet (Unsorted) moves in; one already in a topic stays home and is connected
   instead, so nothing that was sorted gets unsorted and the grouping still shows. Pure: FieldDesk
   commits the workspace, clears the places, and its Undo puts both back. */

import { connect, folderKey, noteKey } from '../links-model.js'
import { addFolder, moveSticky } from '../nodes-model.js'
import { isStack } from './stacks.js'

/* "Put away · Oct 12", or "… 2" when that name is taken. */
export function putAwayName(state, day = new Date()) {
  const base = `Put away · ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(day)}`
  const taken = new Set((state.folders || []).filter((folder) => !folder.parentId).map((folder) => String(folder.name).toLowerCase()))
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base} ${n}`
  return name
}

/* → { state, places (the desk's places with no sticky or stack left), folder, count }, or null when the desk is clear. */
export function putAway(state, places, { name }) {
  const notes = new Map((state.notes || []).map((note) => [note.id, note]))
  const usable = (id) => { const note = notes.get(id); return Boolean(note && note.kind !== 'day' && !note.trashedAt) }
  const loose = Object.keys(places).filter((key) => key.startsWith('note:')).map((key) => key.slice(5)).filter(usable)
  const stacks = Object.entries(places)
    .filter(([key, spot]) => isStack(key) && Array.isArray(spot?.ids))
    .map(([, spot]) => ({ name: typeof spot.name === 'string' && spot.name.trim() ? spot.name.trim() : 'Stack', ids: spot.ids.filter(usable) }))
    .filter((stack) => stack.ids.length)
  if (!loose.length && !stacks.length) return null

  const made = addFolder(state, name)
  if (!made.folder) return null
  let next = made.state
  const into = (folderId, id) => {
    next = notes.get(id).folderId ? connect(next, folderKey(folderId), noteKey(id)) : moveSticky(next, id, folderId)
  }
  loose.forEach((id) => into(made.folder.id, id))
  for (const stack of stacks) {
    const branch = addFolder(next, stack.name, made.folder.id)
    if (!branch.folder) continue
    next = branch.state
    stack.ids.forEach((id) => into(branch.folder.id, id))
  }
  const cleared = Object.fromEntries(Object.entries(places).filter(([key]) => !key.startsWith('note:') && !isStack(key)))
  return { state: next, places: cleared, folder: made.folder, count: loose.length + stacks.reduce((sum, stack) => sum + stack.ids.length, 0) }
}
