/* The AI files stickies for Nate (like Mem): write as many as you like, and once you stop for a
   moment the model chosen in Bots puts each where it belongs. Only its own picks move (a place,
   or a new node two or more of them share); what it isn't sure of stays in Unsorted for Nate.
   Each filed sticky says so (`filed`), so "Filed for you" in Notes lists them and Undo takes
   the whole run back. A long sticky first gets a short title and a gist in the AI's words; its
   own words never change. Pure: the runner is useAutoFile.js. */

import { BATCH, modelSuggestions, sortRequests, stillToSort } from './sort-unsorted.js'
import { fileUnsorted, placementChanges } from './sort-review.js'
import { pileOf } from '../nodes-model.js'
import { folderPath } from '../notes-model.js'

/* Filing waits this long after the newest sticky was written or changed, so a pile being
   written is filed in one go and a sticky is never moved from under your fingers. */
export const QUIET_MS = 15000
/* A sticky longer than this gets a short title and a gist first. At most GISTS per run. */
export const LONG = 280
export const GISTS = 12
/* At most this many stickies in one run; the rest go in the next. */
export const MOST = 100

const stamp = (note) => Math.max(Date.parse(note.createdAt) || 0, Date.parse(note.updatedAt) || 0)

/* What filing on its own is set to (`settings.autoFile`): on unless turned off, and only for
   stickies written since `since` (when it first ran), so a pile from before waits until
   Nate says "File them too". */
export function autoFileSettings(settings) {
  const own = settings?.autoFile || {}
  return { on: own.on !== false, since: typeof own.since === 'string' ? own.since : null }
}

/* A sticky that arrived without a home (the line, the quick bar, the iPhone, the Sky's
   Unsorted…) and still has none: not set free on the Sky, not pinned. A note written in the
   Notes room is never one: that is Nate writing, not dumping. */
const dumped = (note) => note.unsorted === true && !note.at && !note.pinned

/* The dumped stickies written since `since` and not already tried. { ready, wait }: `ready`
   once they've all been quiet for QUIET_MS, else `wait` ms until they will be (0: nothing to do). */
export function readyToFile(state, { since, tried = new Set(), now = Date.now() }) {
  const from = Date.parse(since) || Infinity
  const pending = pileOf(state.notes, null).filter((note) => dumped(note) && !tried.has(note.id) && (Date.parse(note.createdAt) || 0) >= from)
  if (!pending.length) return { ready: [], wait: 0 }
  const newest = Math.max(...pending.map(stamp))
  const wait = newest + QUIET_MS - now
  return wait > 0 ? { ready: [], wait } : { ready: pending.slice(0, MOST), wait: 0 }
}

/* How many from before `since` still wait in Unsorted (for "File them too"). */
export function waitingFromBefore(state, since) {
  const from = Date.parse(since) || Infinity
  return pileOf(state.notes, null).filter((note) => dumped(note) && (Date.parse(note.createdAt) || 0) < from).length
}

/* ---------- long stickies ---------- */

const firstLine = (markdown) => (String(markdown).split('\n').find((line) => line.trim()) || '').replace(/^#+\s*/, '').trim()

export const needsGist = (note) => !note.gist && String(note.markdown || '').trim().length > LONG

/* The AI's short version on a sticky: its gist, and its title too when the title is only the
   first line of what was written (a title Nate wrote himself is kept). */
export function withGist(state, id, { title = '', gist = '' } = {}) {
  let changed = false
  const notes = state.notes.map((note) => {
    if (note.id !== id || (!title && !gist)) return note
    const own = note.title.trim() && !firstLine(note.markdown).startsWith(note.title.trim())
    changed = true
    return { ...note, ...(gist ? { gist } : {}), ...(title && !own ? { title } : {}) }
  })
  return changed ? { ...state, notes } : state
}

/* What the model reads for a sticky: its gist in place of a long text. */
const asRead = (note) => (note.gist ? { ...note, markdown: note.gist } : note)

/* ---------- filing ---------- */

/* The questions for these stickies (as sortRequests, reading gists). */
export const fileRequests = (state, stickies) => sortRequests(state, stickies.map(asRead))

/* The model's answers as groups to file: only its own picks, only stickies still waiting. */
export function filingGroups(state, stickies, places, answers) {
  return stillToSort(modelSuggestions(state, stickies, places, answers, { words: false }), state)
}

/* Files every group, marks each sticky that went into a place as filed for you, and returns
   what undoFiling needs to take the whole run back: { state, changes, made, moved }. */
export function fileForYou(state, groups, at = new Date().toISOString()) {
  const made = []
  const moved = new Set()
  let next = state
  for (const group of groups) {
    const result = fileUnsorted(next, group.noteIds, group.kind === 'make' ? null : group.folderId, group.kind === 'make' ? group.name : '')
    next = result.state
    if (result.made) made.push(result.made)
    result.moved.forEach((id) => moved.add(id))
  }
  if (!moved.size) return { state, changes: [], made: [], moved: [] }
  next = { ...next, notes: next.notes.map((note) => (moved.has(note.id) && note.folderId ? { ...note, filed: { by: 'ai', at, into: note.folderId } } : note)) }
  return { state: next, changes: placementChanges(state, next), made, moved: [...moved] }
}

/* "Filed 12 stickies into Jordan, OSAT ideas and 2 more": one calm line about a run. */
export function filedLine(state, moved) {
  const ids = new Set(moved)
  const places = [...new Set(state.notes.filter((note) => ids.has(note.id) && note.folderId).map((note) => note.folderId))]
  const names = places.map((id) => folderPath(state.folders, id).at(-1)).filter(Boolean)
  const count = `${ids.size} ${ids.size === 1 ? 'sticky' : 'stickies'}`
  if (!names.length) return `Filed ${count} for you`
  const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} more`] : names
  return `Filed ${count} into ${shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0]}`
}

export { BATCH }
