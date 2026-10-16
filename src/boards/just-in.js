/* Just in (Phase 72): everything that came in and where OSAT put it, Undo on each, and for what
   has no home yet, the two boards it most looks like. On top, today's morning brief. Also the two
   stickies on a board that say the same thing, to merge. Pure. */

import { BRIEF_END, BRIEF_START, briefBlock } from '../../shared/brief-model.mjs'
import { dayKey } from '../../shared/mac-calendar-model.mjs'
import { wordsOf } from '../../shared/overnight-model.mjs'
import { whatOf } from '../../shared/what-model.mjs'
import { folderPath, folderSubtree, isActiveNote, isJustIn, isUnsorted, relatedNotes, trashNotes, updateNote } from '../notes-model.js'
import { nodesOf } from '../nodes-model.js'
import { COLUMN, JUST_IN, moveToBoard } from './boards-model.js'

const newest = (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
// Filed by the AI, or by you from Just in, and still there.
const filedHere = (note) => Boolean(note.filed && note.folderId && note.folderId === note.filed.into)
const onCalendar = (note) => Boolean(note.cal?.id)

/* Where a sticky went, as the parts of one line: "Calendar · Thu 2:00", "Questions", "OSAT → Ideas".
   Nothing: it waits for a home. */
export function whereTo(state, note, whenLine = () => '') {
  const what = whatOf(note)
  const board = note.folderId ? folderPath(state.folders, note.folderId)[0] : null
  return [
    onCalendar(note) ? `Calendar${whenLine(note) ? ` · ${whenLine(note)}` : ''}` : null,
    what === 'buy' ? 'To buy' : what === 'question' ? 'Questions' : null,
    board ? `${board} → ${COLUMN[what]}` : null,
  ].filter(Boolean)
}

/* What a row's Undo takes back: its filing (back to Just in), else the calendar, else nothing. */
export const undoOf = (note) => (filedHere(note) ? 'board' : onCalendar(note) ? 'calendar' : null)

/* Stickies onto a board. One that was waiting in Just in says it was filed (by you), so Just in keeps it
   on its list for the week, with where it went and Undo. */
export function placeFrom(state, ids, boardId, at = new Date().toISOString()) {
  const waiting = new Set(state.notes.filter((note) => ids.includes(note.id) && isUnsorted(note)).map((note) => note.id))
  const next = moveToBoard(state, ids, boardId)
  if (boardId === JUST_IN || !waiting.size) return next
  return { ...next, notes: next.notes.map((note) => (waiting.has(note.id) && note.folderId ? { ...note, filed: { by: 'you', at, into: note.folderId } } : note)) }
}

/* What came in: { waiting, days: [{ label, notes }] }. Waiting is everything with no home yet, newest
   first; the days are what OSAT put somewhere this week, by the day it came in. */
export function cameIn(state, now = Date.now()) {
  const notes = state.notes.filter((note) => isActiveNote(note) && !note.kind && isJustIn(note, now)).sort(newest)
  const waiting = notes.filter(isUnsorted)
  const days = []
  for (const note of notes.filter((item) => !isUnsorted(item))) {
    const label = dayLabel(note.createdAt, now)
    if (days.at(-1)?.label === label) days.at(-1).notes.push(note)
    else days.push({ label, notes: [note] })
  }
  return { waiting, days }
}

/* "Today", "Yesterday", "Monday", or "Oct 3" for longer ago. */
export function dayLabel(iso, now = Date.now()) {
  const day = new Date(iso)
  const start = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const ago = Math.round((start(new Date(now)) - start(day)) / 86400000)
  if (ago <= 0) return 'Today'
  if (ago === 1) return 'Yesterday'
  if (ago < 7) return day.toLocaleDateString('en-US', { weekday: 'long' })
  return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* The boards a sticky most looks like (by their names and what is on them), best first, at most `most`. */
export function guessBoards(state, note, most = 2) {
  const faces = nodesOf(state.folders).map(({ folder }) => {
    const on = folderSubtree(state.folders, folder.id)
    const words = state.notes.filter((item) => on.has(item.folderId) && isActiveNote(item)).map((item) => `${item.title}\n${item.markdown}`)
    return { id: folder.id, title: folder.name, markdown: words.join('\n').slice(0, 20000), updatedAt: '' }
  })
  return relatedNotes(faces, `${note.title}\n${note.markdown}`.slice(0, 600), most).map((face) => face.id)
}

/* Today's morning brief, as written in today's journal page, or ''. */
export function todaysBrief(state, now = new Date()) {
  const page = state.notes.find((note) => note.id === `day-${dayKey(new Date(now))}`)
  return briefBlock(page?.markdown).replace(BRIEF_START, '').replace(BRIEF_END, '').trim()
}

/* ---------- Two stickies that say the same thing ---------- */

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/* The two stickies here, of one kind, whose words nearly all match ("Call Jordan about the roof",
   "Call Jordan back about roof"), not waved away before: { a, b, key } with `a` the older, or null.
   ponytail: matching words only, so "n8n inside OSAT" and "visual automations" are missed; the
   overnight AI can name those pairs when that matters. Every pair is compared, fine for a board's few hundred. */
export function samePair(notes, kept = []) {
  const skip = new Set(kept)
  const items = notes.filter((note) => isActiveNote(note) && !note.doneAt)
    .map((note) => ({ note, what: whatOf(note), words: wordsOf(note.markdown) }))
    .filter((item) => item.words.size >= 2)
    .sort((x, y) => (Date.parse(x.note.createdAt) || 0) - (Date.parse(y.note.createdAt) || 0))
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const [x, y] = [items[i], items[j]]
      if (x.what !== y.what || skip.has(pairKey(x.note.id, y.note.id))) continue
      const shared = [...x.words].filter((word) => y.words.has(word)).length
      if (shared >= 2 && shared / Math.min(x.words.size, y.words.size) >= 0.8) return { a: x.note, b: y.note, key: pairKey(x.note.id, y.note.id) }
    }
  }
  return null
}

/* One sticky that holds both: the newer one's words go under the older one's, and the newer one goes
   to the Bin. Undo (the canvas's) brings both back as they were. */
export function mergeStickies(state, keepId, goneId) {
  const keep = state.notes.find((note) => note.id === keepId)
  const gone = state.notes.find((note) => note.id === goneId)
  if (!isActiveNote(keep) || !isActiveNote(gone)) return state
  return trashNotes(updateNote(state, keepId, { markdown: `${keep.markdown.trim()}\n\n${gone.markdown.trim()}` }), [goneId])
}
