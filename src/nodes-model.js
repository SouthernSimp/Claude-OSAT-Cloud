/* Nodes: every folder is a node in the Sky, a folder inside one is a branch, and every
   note is a sticky. A node's own stickies (in no branch) are its pile still to sort; notes
   in no folder at all are Unsorted. Nodes, branches and stickies keep the order Nate ranks
   them in (`rank`, see rankOf). Pure functions over the workspace, like notes-model.js. */

import { freeNodeName, nodeRecords, nodeTree } from '../shared/node-file.mjs'
import { rankOf } from './note-core.js'
import { canMoveFolder, createFolder, createNote, deleteFolder, folderChildren, folderSubtree, isActiveNote, relatedNotes, uid } from './notes-model.js'

export { rankOf }

const GAP = 1024

export const byRank = (a, b) => rankOf(a) - rankOf(b) || String(a.id).localeCompare(String(b.id))

/* The stickies whose home is exactly this folder (null: Unsorted), in their ranked order.
   Day pages live in Today. */
export function pileOf(notes, folderId = null) {
  return notes
    .filter((note) => isActiveNote(note) && !note.kind && (note.folderId || null) === (folderId || null))
    .sort(byRank)
}

/* The nodes, left to right. */
export const nodesOf = (folders) => folderChildren(folders, null).map((folder) => ({ folder }))

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
   out). Filing it clears Unsorted. */
export function moveSticky(state, noteId, folderId = null, index = Infinity) {
  const note = state.notes.find((item) => item.id === noteId)
  if (!note || note.kind === 'day') return state
  const target = folderExists(state, folderId) ? folderId : null
  const { rank, renumber } = rankAt(pileOf(state.notes, target).filter((item) => item.id !== noteId), index)
  const notes = withRanks(state.notes, renumber).map((item) => (item.id === noteId
    ? { ...item, folderId: target, unsorted: !target, rank }
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

/* A new sticky in a folder's pile (null: Unsorted), at the end or at `index`. Its @s point
   at their nodes (linkMentions). */
export function addSticky(state, text, folderId = null, { source = 'Sky', index, color, ask } = {}) {
  const value = typeof text === 'string' ? text.trim().slice(0, 8000) : ''
  if (!value) return { state, note: null }
  const target = folderExists(state, folderId) ? folderId : null
  const title = value.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'A sticky'
  let base = state
  let rank
  if (index !== undefined) {
    const placed = rankAt(pileOf(state.notes, target), index)
    base = { ...state, notes: withRanks(state.notes, placed.renumber) }
    rank = placed.rank
  }
  const made = createNote(base, { title, markdown: value, folderId: target, unsorted: !target, source, color, rank, ask })
  const linked = linkMentions(made.state, made.note.id)
  return { state: linked, note: linked.notes.find((note) => note.id === made.note.id) }
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

/* The places a sticky can be moved to, as menu items: Unsorted, then each node with its
   branches under it (↳). `skip` leaves out where it is now. */
export function moveToItems(folders, onPick, { skip, unsorted = true } = {}) {
  const items = [
    unsorted && skip !== null ? { label: 'Unsorted', onSelect: () => onPick(null) } : null,
    ...nodesOf(folders).flatMap(({ folder }) => [
      folder.id === skip ? null : { label: folder.name, onSelect: () => onPick(folder.id) },
      ...folderChildren(folders, folder.id).filter((branch) => branch.id !== skip).map((branch) => ({ label: `↳ ${branch.name}`, onSelect: () => onPick(branch.id) })),
    ]),
  ].filter(Boolean)
  return items.length ? items : [{ note: 'No nodes yet.' }]
}

/* ---------- sorting help ---------- */

const plainKey = (name) => String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/* Where each sticky still to sort in a node might go: the branch named like one of its
   #tags first, then the branch whose name and stickies share the most words with it.
   Stickies with no good fit are left out. */
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
    if (tagged) return [{ noteId: note.id, folderId: tagged.id }]
    const [best] = relatedNotes(faces, `${note.title}\n${note.markdown}`, 1)
    return best ? [{ noteId: note.id, folderId: best.id }] : []
  })
}

/* The same suggestions, one group per branch, in the branches' order:
   [{ folderId, noteIds }]. */
export function suggestionGroups(state, nodeId) {
  const found = suggestBranches(state, nodeId)
  return folderChildren(state.folders, nodeId)
    .map((branch) => ({ folderId: branch.id, noteIds: found.filter((item) => item.folderId === branch.id).map((item) => item.noteId) }))
    .filter((group) => group.noteIds.length)
}

/* ---------- @ in a note ---------- */

const NAME_CHAR = /[\p{L}\p{N}_]/u
const NOT_AFTER = /[\p{L}\p{N}_.@/:+-]/u

/* The longest of `entries` ([name in lowercase, id]) that `rest` starts with, as a whole word. */
function longest(entries, rest) {
  const low = rest.toLowerCase()
  let best = null
  for (const [name, id] of entries) {
    if (name && low.startsWith(name) && !NAME_CHAR.test(rest[name.length] || '') && (!best || name.length > best.length)) best = { id, length: name.length }
  }
  return best
}

const namesUnder = (folders, parentId) => folderChildren(folders, parentId).map((folder) => [folder.name.toLowerCase(), folder.id])

/* "@Garden" in a note points at that node, "@Garden/Ideas" at a branch in it. The longest
   name that fits wins, so "@Project Direction" works. Once written, a note keeps which
   node each @ meant, by id (`refs`, see linkMentions), so a renamed node still answers to
   the words that were written and the words are never changed. A name that matches no
   node is only words. An @ right after a letter, digit or dot (an email) is not one.
   Each mention where it is: { start, end, folderId, name (as written, lowercase) }. */
export function findMentions(text, folders, refs) {
  const value = String(text || '')
  const ids = new Set(folders.map((folder) => folder.id))
  const kept = Object.entries(refs || {}).filter(([, id]) => ids.has(id))
  const out = []
  for (let at = value.indexOf('@'); at >= 0; at = value.indexOf('@', at + 1)) {
    if (at > 0 && NOT_AFTER.test(value[at - 1])) continue
    const rest = value.slice(at + 1)
    // By name as the nodes are called now: a node, then a branch after each slash.
    let byName = null
    for (let folderId = null, length = 0; ;) {
      const next = longest(namesUnder(folders, folderId), rest.slice(length))
      if (!next) break
      folderId = next.id
      length += next.length
      byName = { id: folderId, length }
      if (rest[length] !== '/') break
      length += 1
    }
    const known = longest(kept, rest)
    const hit = known && (!byName || known.length >= byName.length) ? known : byName
    if (!hit) continue
    out.push({ start: at, end: at + 1 + hit.length, folderId: hit.id, name: rest.slice(0, hit.length).toLowerCase() })
  }
  return out
}

/* The nodes a note mentions, each once, in the order written. */
export const nodesMentioned = (note, folders) => [...new Set(findMentions(note?.markdown, folders, note?.refs).map((mention) => mention.folderId))]

/* Words and mentions, in order, for showing a note with its @s as links:
   ['plain words', { folderId, text: '@Garden' }, …]. */
export function splitMentions(text, folders, refs) {
  const value = String(text || '')
  const parts = []
  let last = 0
  for (const mention of findMentions(value, folders, refs)) {
    if (mention.start > last) parts.push(value.slice(last, mention.start))
    parts.push({ folderId: mention.folderId, text: value.slice(mention.start, mention.end) })
    last = mention.end
  }
  if (last < value.length) parts.push(value.slice(last))
  return parts
}

/* After a note is written, it remembers which node each of its @s means (by id). That
   is all an @ does: nothing moves and nothing is made. */
export function linkMentions(state, noteId) {
  const note = state.notes.find((item) => item.id === noteId)
  if (!note) return state
  const refs = Object.fromEntries(findMentions(note.markdown, state.folders, note.refs).map((mention) => [mention.name, mention.folderId]))
  const had = note.refs || {}
  const keys = Object.keys(refs)
  if (keys.length === Object.keys(had).length && keys.every((key) => had[key] === refs[key])) return state
  const { refs: _, ...rest } = note
  return { ...state, notes: state.notes.map((item) => (item.id === noteId ? (keys.length ? { ...rest, refs } : rest) : item)) }
}

/* The notes that @mention a folder but live somewhere else, by folder id. */
export function mentionedIn(state) {
  const map = new Map()
  state.notes.forEach((note) => {
    if (!isActiveNote(note) || !note.markdown?.includes('@')) return
    nodesMentioned(note, state.folders).forEach((folderId) => {
      if (folderSubtree(state.folders, folderId).has(note.folderId)) return
      map.set(folderId, [...(map.get(folderId) || []), note])
    })
  })
  return map
}

/* A new name for a folder. Notes that @mention it keep their words and still point at it. */
export function renameFolder(state, id, name) {
  const folder = state.folders.find((item) => item.id === id)
  const clean = String(name || '').trim().slice(0, 80)
  if (!folder || !clean || clean === folder.name) return state
  return { ...state, folders: state.folders.map((item) => (item.id === id ? { ...item, name: clean } : item)) }
}

/* ---------- a node from a file ---------- */

export { freeNodeName }

const textOf = (value) => (typeof value === 'string' ? value.trim() : '')

/* A node file (JSON: { title, summary, branches: [{ title, summary, leaves: [{ text,
   done }], sub_branches: [...] }] }, or the tree readNodeFile makes of Markdown) becomes
   one new node at the end of the Sky, never merged into one that's there: branches and
   sub-branches become branches, leaves become stickies (a finished one as "- [x] …"), and
   a summary becomes the first sticky where it is (shared/node-file.mjs, which the drop
   folder uses too). A leaf's `event` ({ title, date, time }) is kept on its sticky, to
   offer to the Calendar. `options` is { source, node } or just the source ('Scan').
   Returns { state, folder, branches (how many were made) }, or throws when the file
   isn't a node file. */
export function importNode(state, data, options = {}) {
  const { source = 'Import', node } = typeof options === 'string' ? { source: options } : options
  const made = nodeRecords(state.folders, nodeTree(data), { makeId: uid, source, node })
  let next = { ...state, folders: [...state.folders, ...made.folders], notes: [...made.notes.slice().reverse(), ...state.notes] }
  for (const note of made.notes) next = linkMentions(next, note.id)
  return { state: next, folder: made.folder, branches: made.folders.length - 1 }
}

/* A node that arrived from outside (the drop folder, the connector) is New until
   it is first opened, and packed (only a summary) until it is unpacked: by hand, when it
   gets its first branch, or with the AI. Nothing else about it changes. */
const without = (state, id, key) => (state.folders.some((folder) => folder.id === id && key in folder)
  ? { ...state, folders: state.folders.map((folder) => { if (folder.id !== id) return folder; const { [key]: _, ...rest } = folder; return rest }) }
  : state)
export const markOpened = (state, id) => without(state, id, 'fresh')
export const markUnpacked = (state, id) => without(state, id, 'packed')

/* A packed node unpacked with the AI: the branches and stickies it suggested go into the
   node after what's there (its summary stays first), and it is no longer packed. Returns
   { state, folders, notes } (the ids made, for Undo). */
export function unpackInto(state, nodeId, tree, { source = 'AI' } = {}) {
  if (!folderExists(state, nodeId)) return { state, folders: [], notes: [] }
  let next = markUnpacked(state, nodeId)
  const folders = []
  const notes = []
  const sticky = (text, folderId) => {
    const made = addSticky(next, text, folderId, { source, index: Infinity })
    next = made.state
    if (made.note) notes.push(made.note.id)
  }
  const fill = (part, folderId) => {
    if (part.summary) sticky(part.summary, folderId)
    for (const leaf of part.leaves) sticky(leaf.done ? `- [x] ${leaf.text}` : leaf.text, folderId)
    for (const branch of part.branches) {
      const made = addFolder(next, branch.title, folderId)
      if (!made.folder) continue
      next = made.state
      folders.push(made.folder.id)
      fill(branch, made.folder.id)
    }
  }
  fill({ leaves: tree.leaves || [], branches: tree.branches || [] }, nodeId)
  return { state: next, folders, notes }
}

/* A scan (a node file sorted from it): one sticky alone is just a sticky in Unsorted;
   more is a node to open. Returns { state, folder } or { state, note }. */
export function importScan(state, data) {
  const leaves = Array.isArray(data?.leaves) ? data.leaves : []
  const branched = [data?.branches, data?.sub_branches].some((list) => Array.isArray(list) && list.length)
  if (leaves.length === 1 && !branched && !textOf(data?.summary)) {
    const leaf = leaves[0]
    return addSticky(state, textOf(typeof leaf === 'string' ? leaf : leaf?.text), null, { source: 'Scan', ask: leaf?.event ? { event: leaf.event } : undefined })
  }
  return importNode(state, data, 'Scan')
}

/* ---------- a day a sticky names ---------- */

/* When the asked-about event starts: its day at its time, or 9 in the morning when the
   scan gave none. */
export function askStart({ date, time }) {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = (time || '09:00').split(':').map(Number)
  return new Date(y, m - 1, d, h, min)
}

/* The stickies in a node (and its branches) with a day to offer to the Calendar. */
export function asksIn(state, nodeId) {
  const ids = folderSubtree(state.folders, nodeId)
  return state.notes.filter((note) => note.ask?.event && ids.has(note.folderId) && isActiveNote(note))
}

/* Add to Calendar: the event goes in and the sticky stops asking. */
export function addAskedEvent(state, noteId) {
  const note = state.notes.find((item) => item.id === noteId)
  if (!note?.ask?.event) return { state, event: null }
  const event = { id: `event-${globalThis.crypto.randomUUID()}`, title: note.ask.event.title, start: askStart(note.ask.event).toISOString(), end: '', notes: note.markdown.slice(0, 1000) }
  const events = [...state.calendar.events, event].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return { state: { ...skipAsk(state, noteId), calendar: { ...state.calendar, events } }, event }
}

/* Not now: the sticky stops asking. */
export function skipAsk(state, noteId) {
  return { ...state, notes: state.notes.map((note) => (note.id === noteId && note.ask ? (({ ask, ...rest }) => rest)(note) : note)) }
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
   nothing else jumps, and their order follows them left to right. */
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
