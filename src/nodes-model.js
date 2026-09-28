/* Nodes: every folder is a node in the Sky, a folder inside one is a branch, and every
   note is a sticky. A node's own stickies (in no branch) are its pile still to sort; notes
   in no folder at all are Unsorted. Nodes, branches and stickies keep the order Nate ranks
   them in (`rank`, see rankOf). Folders can be linked to each other. Pure functions over
   the workspace, like notes-model.js. */

import { rankOf } from './note-core.js'
import { canMoveFolder, createFolder, createNote, deleteFolder, folderChildren, folderPath, folderSubtree, isActiveNote, relatedNotes } from './notes-model.js'

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

/* A new sticky in a folder's pile (null: Unsorted), at the end or at `index`. An @node in
   its words files it there (fileByMentions), wherever it was written. */
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
  const made = createNote(base, { title, markdown: value, folderId: target, unsorted: !target && kind !== 'scratch', source, color, kind, rank })
  const filed = fileByMentions(made.state, made.note.id)
  return { state: filed, note: filed.notes.find((note) => note.id === made.note.id) }
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

/* ---------- @ in a note ---------- */

const NAME_CHAR = /[\p{L}\p{N}_]/u
const NOT_AFTER = /[\p{L}\p{N}_.@/:+-]/u
const WORD = /^\p{L}[\p{L}\p{N}_-]*/u

function longestName(list, rest) {
  const low = rest.toLowerCase()
  let best = null
  for (const folder of list) {
    const name = folder.name.toLowerCase()
    if (low.startsWith(name) && !NAME_CHAR.test(rest[name.length] || '') && (!best || name.length > best.length)) best = { id: folder.id, length: name.length }
  }
  return best
}

/* "@Garden" in a note names a node. The longest node name that fits wins, so
   "@Project Direction" works; "@Garden/Ideas" names a branch. A name that matches nothing
   (one word, starting with a letter) is a node still to make. Each mention once, in the
   order written: { folderId (the deepest that exists, or null), missing (names to make
   under it), key }. An @ right after a letter, digit or dot (an email) is not one. */
export function parseMentions(text, folders) {
  const value = String(text || '')
  const out = []
  const seen = new Set()
  for (let at = value.indexOf('@'); at >= 0; at = value.indexOf('@', at + 1)) {
    if (at > 0 && NOT_AFTER.test(value[at - 1])) continue
    let rest = value.slice(at + 1)
    let folderId = null
    const missing = []
    for (;;) {
      const known = missing.length ? null : longestName(folderChildren(folders, folderId), rest)
      if (known) {
        folderId = known.id
        rest = rest.slice(known.length)
      } else {
        const word = rest.match(WORD)?.[0]
        if (!word) break
        missing.push(word)
        rest = rest.slice(word.length)
      }
      if (rest[0] !== '/' || !rest[1]) break
      rest = rest.slice(1)
    }
    if (!folderId && !missing.length) continue
    const key = `${folderId || ''}/${missing.join('/').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ folderId, missing, key })
  }
  return out
}

/* How a mention reads: "Garden › Ideas", with a new name as written. */
export const mentionName = (folders, mention) => [...(mention.folderId ? folderPath(folders, mention.folderId) : []), ...mention.missing].join(' › ')

/* After a note is written (`before` is what it said until then): nodes named with a new @
   are made, and when the first @ in it is new, the note moves there. Any other @ only
   links it (see mentionedIn). Nothing happens for mentions that were already there. */
export function fileByMentions(state, noteId, before = '') {
  const note = state.notes.find((item) => item.id === noteId)
  if (!note || !isActiveNote(note) || !note.markdown?.includes('@')) return state
  const old = new Set(parseMentions(before, state.folders).map((mention) => mention.key))
  const mentions = parseMentions(note.markdown, state.folders)
  let next = state
  let home = null
  mentions.forEach((mention, index) => {
    if (old.has(mention.key)) return
    let id = mention.folderId
    for (const name of mention.missing) {
      const made = addFolder(next, name, id)
      next = made.state
      id = made.folder?.id || null
      if (!id) break
    }
    if (index === 0) home = id
  })
  return home && home !== note.folderId ? moveSticky(next, noteId, home) : next
}

/* The folder at a path like "Garden/Big ideas", made (with any folders above it) when it
   isn't there yet. */
export function ensureFolderPath(state, path) {
  let next = state
  let folder = null
  for (const name of String(path || '').split('/').map((part) => part.trim()).filter(Boolean)) {
    const found = folderChildren(next.folders, folder?.id || null).find((item) => item.name.toLowerCase() === name.toLowerCase())
    if (found) { folder = found; continue }
    const made = addFolder(next, name, folder?.id || null)
    if (!made.folder) break
    next = made.state
    folder = made.folder
  }
  return { state: next, folder }
}

/* What an @ did between two states: where the note went ("Garden › Ideas", or null when
   it stayed put) and the folders it made. */
export function filedAs(before, after, noteId) {
  const was = before.notes.find((note) => note.id === noteId)?.folderId || null
  const now = after.notes.find((note) => note.id === noteId)?.folderId || null
  const had = new Set(before.folders.map((folder) => folder.id))
  return {
    where: now && now !== was ? folderPath(after.folders, now).join(' › ') : null,
    made: after.folders.filter((folder) => !had.has(folder.id)).map((folder) => folder.id),
  }
}

/* Undoing an @: the folders it made go again, if nothing has been put in them since. */
export function forgetEmptyFolders(state, ids) {
  let next = state
  for (const id of [...ids].reverse()) {
    const used = next.notes.some((note) => note.folderId === id) || next.folders.some((folder) => folder.parentId === id)
    if (!used) next = { ...next, folders: next.folders.filter((folder) => folder.id !== id) }
  }
  return next
}

/* The notes that @mention a folder but live somewhere else, by folder id. */
export function mentionedIn(state) {
  const map = new Map()
  state.notes.forEach((note) => {
    if (!isActiveNote(note) || note.kind === 'scratch' || !note.markdown?.includes('@')) return
    parseMentions(note.markdown, state.folders).forEach(({ folderId, missing }) => {
      if (!folderId || missing.length || folderSubtree(state.folders, folderId).has(note.folderId)) return
      map.set(folderId, [...(map.get(folderId) || []), note])
    })
  })
  return map
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/* A new name for a folder; notes that @mention it (or a branch in it) follow. */
export function renameFolder(state, id, name) {
  const folder = state.folders.find((item) => item.id === id)
  const clean = String(name || '').trim().slice(0, 80)
  if (!folder || !clean || clean === folder.name) return state
  const before = folderPath(state.folders, id).join('/')
  const folders = state.folders.map((item) => (item.id === id ? { ...item, name: clean } : item))
  const after = folderPath(folders, id).join('/')
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_.@/:+-])@${escapeRegExp(before)}(?![\\p{L}\\p{N}_])`, 'giu')
  const notes = state.notes.map((note) => {
    if (!note.markdown?.includes('@')) return note
    const markdown = note.markdown.replace(pattern, (whole, lead) => `${lead}@${after}`)
    return markdown === note.markdown ? note : { ...note, markdown }
  })
  return { ...state, folders, notes }
}

/* ---------- the whiteboard ---------- */

export const CARD = { w: 240, h: 150, gap: 64 }

/* Where each node sits on the Sky's board ({ x, y } of its top-left corner, by id): where
   it was put, or else on the ground row after everything before it in rank order. `sizes`
   are the cards as last measured. Unsorted (key null) waits left of the leftmost node. */
export function boardSpots(folders, sizes = new Map()) {
  const spots = new Map()
  let right = null
  let left = 0
  nodesOf(folders).forEach(({ folder }) => {
    const size = sizes.get(folder.id) || CARD
    const spot = folder.at || { x: right === null ? 0 : right + CARD.gap, y: 0 }
    spots.set(folder.id, spot)
    right = Math.max(right ?? -Infinity, spot.x + size.w)
    left = Math.min(left, spot.x)
  })
  spots.set(null, { x: left - (sizes.get(null) || CARD).w - CARD.gap, y: 0 })
  return spots
}

/* Nodes set down on the board (`changes`, by id): every node keeps where it shows now, so
   nothing else jumps, and the numbers follow them left to right. */
export function placeNodes(state, spots, changes) {
  const order = nodesOf(state.folders).map(({ folder }) => folder.id)
  const at = new Map(order.map((id) => [id, changes.get(id) || spots.get(id) || { x: 0, y: 0 }]))
  const sorted = [...order].sort((a, b) => at.get(a).x - at.get(b).x || at.get(a).y - at.get(b).y)
  const renumber = sorted.some((id, index) => id !== order[index])
  const folders = state.folders.map((folder) => {
    if (!at.has(folder.id)) return folder
    const point = { x: Math.round(at.get(folder.id).x), y: Math.round(at.get(folder.id).y) }
    const rank = renumber ? (sorted.indexOf(folder.id) + 1) * GAP : folder.rank
    if (folder.at?.x === point.x && folder.at?.y === point.y && rank === folder.rank) return folder
    return { ...folder, at: point, ...(rank === undefined ? {} : { rank }) }
  })
  return { ...state, folders }
}

/* Back into one row, in rank order. */
export function tidyBoard(state) {
  if (!state.folders.some((folder) => folder.at)) return state
  return { ...state, folders: state.folders.map(({ at, ...folder }) => folder) }
}

const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

/* A card grew (a node opened): the cards it now covers slide right, and so do the ones
   they then cover. `boxes` are { x, y, w, h } by id; returns the new spots by id. */
export function makeRoom(boxes, id, gap = 40) {
  const moved = new Map()
  const box = (key) => ({ ...boxes.get(key), ...moved.get(key) })
  const queue = [id]
  // ponytail: n² per push, fine for dozens of nodes; a sweep line if it ever reaches thousands
  for (let guard = 0; queue.length && guard < 2000; guard += 1) {
    const key = queue.shift()
    const pusher = box(key)
    for (const other of boxes.keys()) {
      if (other === key || other === id) continue
      const next = box(other)
      if (next.x < pusher.x || !overlaps(pusher, next, gap)) continue
      moved.set(other, { x: pusher.x + pusher.w + gap, y: next.y })
      queue.push(other)
    }
  }
  return moved
}
