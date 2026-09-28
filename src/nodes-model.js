/* Nodes: every folder is a node in the Sky, a folder inside one is a branch, and every
   note is a sticky. A node's own stickies (in no branch) are its pile still to sort; notes
   in no folder at all are Unsorted. Nodes, branches and stickies keep the order Nate ranks
   them in (`rank`, see rankOf). Folders can be linked to each other. Pure functions over
   the workspace, like notes-model.js. */

import { rankOf } from './note-core.js'
import { canMoveFolder, createFolder, createNote, deleteFolder, folderChildren, folderSubtree, isActiveNote, relatedNotes } from './notes-model.js'

export { rankOf }

const GAP = 1024

export const byRank = (a, b) => rankOf(a) - rankOf(b) || String(a.id).localeCompare(String(b.id))

/* A sticky left on the scratch page under the desk, until it is made into a node. */
export const isScratch = (note) => note?.kind === 'scratch'

/* The stickies whose home is exactly this folder (null: Unsorted), in their ranked order.
   Day pages live in Today; scratch stickies wait under the desk. */
export function pileOf(notes, folderId = null) {
  return notes
    .filter((note) => isActiveNote(note) && !note.kind && (note.folderId || null) === (folderId || null))
    .sort(byRank)
}

/* The nodes, left to right, each with its number (1 is the first). */
export const nodesOf = (folders) => folderChildren(folders, null).map((folder, index) => ({ folder, number: index + 1 }))

/* Every sticky anywhere in a node, its branches' included. */
export function stickiesIn(state, folderId) {
  const ids = folderSubtree(state.folders, folderId)
  return state.notes.filter((note) => isActiveNote(note) && !note.kind && ids.has(note.folderId))
}

/* The rank that puts something at `index` in `list` (ranked, without the thing being
   moved). When two neighbours have no room left between them, `renumber` spaces the whole
   list out again. */
export function rankAt(list, index = Infinity) {
  const at = Math.max(0, Math.min(Number.isFinite(index) ? index : list.length, list.length))
  const before = list[at - 1]
  const after = list[at]
  if (!before && !after) return { rank: GAP }
  if (!before) return { rank: rankOf(after) - GAP }
  if (!after) return { rank: rankOf(before) + GAP }
  const low = rankOf(before)
  const high = rankOf(after)
  const middle = (low + high) / 2
  if (middle > low && middle < high) return { rank: middle }
  return {
    rank: (at + 1) * GAP,
    renumber: list.map((item, i) => ({ id: item.id, rank: (i < at ? i + 1 : i + 2) * GAP })),
  }
}

const withRanks = (list, renumber) => {
  if (!renumber) return list
  const ranks = new Map(renumber.map((item) => [item.id, item.rank]))
  return list.map((item) => (ranks.has(item.id) ? { ...item, rank: ranks.get(item.id) } : item))
}

const folderExists = (state, id) => Boolean(id) && state.folders.some((folder) => folder.id === id)

/* Puts a sticky in a folder's pile (null: back to Unsorted) at `index` (the end when left
   out). Filing it clears Unsorted and takes it off the scratch page. */
export function moveSticky(state, noteId, folderId = null, index = Infinity) {
  const note = state.notes.find((item) => item.id === noteId)
  if (!note || note.kind === 'day') return state
  const target = folderExists(state, folderId) ? folderId : null
  const { rank, renumber } = rankAt(pileOf(state.notes, target).filter((item) => item.id !== noteId), index)
  const notes = withRanks(state.notes, renumber).map((item) => (item.id === noteId
    ? { ...item, folderId: target, unsorted: !target, kind: null, rank }
    : item))
  return { ...state, notes }
}

/* Moves a folder among its siblings, or under another folder (a node dropped on another
   node becomes one of its branches; a branch dropped between nodes becomes a node). */
export function moveFolder(state, folderId, parentId = null, index = Infinity) {
  if (!folderExists(state, folderId)) return state
  const parent = folderExists(state, parentId) ? parentId : null
  if (!canMoveFolder(state.folders, folderId, parent)) return state
  const { rank, renumber } = rankAt(folderChildren(state.folders, parent).filter((item) => item.id !== folderId), index)
  const folders = withRanks(state.folders, renumber).map((item) => (item.id === folderId ? { ...item, parentId: parent, rank } : item))
  return { ...state, folders }
}

/* A new node (or, with a parent, a new branch) at `index` among its siblings. */
export function addFolder(state, name, parentId = null, index = Infinity) {
  const parent = folderExists(state, parentId) ? parentId : null
  const made = createFolder(name, parent)
  if (!made) return { state, folder: null }
  const { rank, renumber } = rankAt(folderChildren(state.folders, parent), index)
  const folder = { ...made, rank }
  return { state: { ...state, folders: [...withRanks(state.folders, renumber), folder] }, folder }
}

/* A new sticky in a folder's pile (null: Unsorted), at the end or at `index`. */
export function addSticky(state, text, folderId = null, { source = 'Sky', index, color, kind = null } = {}) {
  const value = typeof text === 'string' ? text.trim().slice(0, 8000) : ''
  if (!value) return { state, note: null }
  const target = folderExists(state, folderId) ? folderId : null
  const title = value.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'A thought'
  let base = state
  let rank
  if (index !== undefined) {
    const placed = rankAt(pileOf(state.notes, target), index)
    base = { ...state, notes: withRanks(state.notes, placed.renumber) }
    rank = placed.rank
  }
  return createNote(base, { title, markdown: value, folderId: target, unsorted: !target && kind !== 'scratch', source, color, kind, rank })
}

/* Removing a node keeps its stickies: its branches go with it and everything in them lands
   in Unsorted (a branch's stickies go up to its node). */
export function removeFolder(state, folderId) {
  if (!folderExists(state, folderId)) return state
  const removed = folderSubtree(state.folders, folderId)
  const homeless = new Set(state.notes.filter((note) => removed.has(note.folderId)).map((note) => note.id))
  const next = deleteFolder(state, folderId)
  return {
    ...next,
    folders: next.folders.map((item) => (item.links?.some((id) => removed.has(id)) ? { ...item, links: item.links.filter((id) => !removed.has(id)) } : item)),
    notes: next.notes.map((note) => (homeless.has(note.id) && !note.folderId ? { ...note, unsorted: true } : note)),
  }
}

/* ---------- links between nodes ---------- */

/* Each link once, as { a, b }, between folders that exist. */
export function folderLinks(folders) {
  const ids = new Set(folders.map((folder) => folder.id))
  const seen = new Set()
  const pairs = []
  folders.forEach((folder) => (folder.links || []).forEach((other) => {
    const key = [folder.id, other].sort().join('|')
    if (!ids.has(other) || other === folder.id || seen.has(key)) return
    seen.add(key)
    pairs.push({ a: folder.id, b: other })
  }))
  return pairs
}

export const linkedWith = (folders, id) => folderLinks(folders).flatMap((pair) => (pair.a === id ? [pair.b] : pair.b === id ? [pair.a] : []))

export function linkFolders(state, a, b) {
  if (a === b || !folderExists(state, a) || !folderExists(state, b) || linkedWith(state.folders, a).includes(b)) return state
  return { ...state, folders: state.folders.map((folder) => (folder.id === a ? { ...folder, links: [...(folder.links || []), b] } : folder)) }
}

export function unlinkFolders(state, a, b) {
  const drop = (folder, other) => {
    const links = (folder.links || []).filter((id) => id !== other)
    const { links: _, ...rest } = folder
    return links.length ? { ...folder, links } : rest
  }
  return {
    ...state,
    folders: state.folders.map((folder) => (folder.id === a && folder.links?.includes(b) ? drop(folder, b) : folder.id === b && folder.links?.includes(a) ? drop(folder, a) : folder)),
  }
}

/* The stickies on the scratch page become one node, in the order given. */
export function nodeFrom(state, noteIds, name) {
  const made = addFolder(state, name || 'From the scratch page')
  if (!made.folder) return made
  let next = made.state
  noteIds.forEach((id) => { next = moveSticky(next, id, made.folder.id) })
  return { state: next, folder: made.folder }
}

/* ---------- sorting help ---------- */

const plainKey = (name) => String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/* Where each sticky still to sort in a node might go, without the AI: the branch named
   like one of its #tags first, then the branch whose name and stickies share the most
   words with it. Stickies with no good fit are left out. */
export function suggestBranches(state, nodeId) {
  const branches = folderChildren(state.folders, nodeId)
  if (!branches.length) return []
  const faces = branches.map((branch) => ({
    id: branch.id,
    title: branch.name,
    markdown: pileOf(state.notes, branch.id).map((note) => `${note.title}\n${note.markdown}`).join('\n').slice(0, 20000),
    updatedAt: '',
  }))
  return pileOf(state.notes, nodeId).flatMap((note) => {
    const tagged = branches.find((branch) => note.tags.some((tag) => plainKey(tag) === plainKey(branch.name)))
    if (tagged) return [{ noteId: note.id, folderId: tagged.id, why: 'tag' }]
    const [best] = relatedNotes(faces, `${note.title}\n${note.markdown}`, 1)
    return best ? [{ noteId: note.id, folderId: best.id, why: 'words' }] : []
  })
}

const oneLine = (note) => `${note.title}${note.markdown.trim() !== note.title.trim() ? ` — ${note.markdown.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`

/* What the AI on this Mac is asked, to sort a node's stickies into its branches. */
export function sortPrompt(branches, loose) {
  return [
    {
      role: 'system',
      content: 'You help sort sticky notes into branches (groups). Answer only with one line per sticky, like "3 -> 2" (sticky 3 goes in branch 2), "4 -> new: Groceries" (a new branch, a short name), or "5 -> none". No other words.',
    },
    {
      role: 'user',
      content: `Branches:\n${branches.length ? branches.map((branch, i) => `${i + 1}. ${branch.name}`).join('\n') : '(none yet)'}\n\nStickies:\n${loose.map((note, i) => `${i + 1}. ${oneLine(note)}`).join('\n')}`,
    },
  ]
}

/* The AI's answer as suggestions: { noteId, folderId } or { noteId, branch: 'New name' }.
   Lines it didn't follow are skipped; a sticky gets at most one suggestion. */
export function parseSortReply(text, branches, loose) {
  const out = new Map()
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^\W*(?:sticky\s*)?(\d+)\s*(?:->|→|=>|:|-)\s*(?:branch\s*)?(?:(\d+)|new\s*:?\s*(.+)|none)\s*$/i)
    if (!match) continue
    const note = loose[Number(match[1]) - 1]
    if (!note || out.has(note.id)) continue
    if (match[2]) {
      const branch = branches[Number(match[2]) - 1]
      if (branch) out.set(note.id, { noteId: note.id, folderId: branch.id })
    } else if (match[3]) {
      const name = match[3].replace(/["“”*_]/g, '').trim().slice(0, 40)
      const existing = branches.find((branch) => plainKey(branch.name) === plainKey(name))
      if (existing) out.set(note.id, { noteId: note.id, folderId: existing.id })
      else if (name) out.set(note.id, { noteId: note.id, branch: name })
    }
  }
  return [...out.values()]
}

/* Moves the accepted suggestions, making any new branches they name (once each). */
export function applySuggestions(state, nodeId, suggestions) {
  let next = state
  const made = new Map()
  for (const item of suggestions) {
    let folderId = item.folderId
    if (!folderId && item.branch) {
      const key = plainKey(item.branch)
      if (!made.has(key)) {
        const result = addFolder(next, item.branch, nodeId)
        next = result.state
        made.set(key, result.folder?.id)
      }
      folderId = made.get(key)
    }
    if (folderId) next = moveSticky(next, item.noteId, folderId)
  }
  return next
}
