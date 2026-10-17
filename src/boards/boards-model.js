/* Boards (Phase 68). A board is a topic at the top (OSAT, Fortis, Home…): every sticky in it, its old
   branches' included, shows on it. One board, three views of the same stickies: the Map (one column
   per kind, so nothing tangles), the Board (Later, Next, Doing, Done, for what is to be done) and the
   List. Just in is a board of its own: what came in and has no home yet. Pure. */

import { WHAT_PAPER, WHATS, whatOf } from '../../shared/what-model.mjs'
import { folderChildren, folderSubtree, isActiveNote, isUnsorted } from '../notes-model.js'
import { addFolder, moveSticky, nodesOf, rankAt } from '../nodes-model.js'
import { PAPERS, rankOf } from '../note-core.js'

export const JUST_IN = 'justin'

// A column's name on the Map.
export const COLUMN = { idea: 'Ideas', question: 'Questions', problem: 'Problems', todo: 'To-dos', date: 'Dates', buy: 'To buy', note: 'Notes' }
// The Map always has these four, so there is a place to drop into; the rest show when they hold something.
const ALWAYS = ['idea', 'question', 'problem', 'todo']

export const STAGES = [['later', 'Later'], ['next', 'Next'], ['doing', 'Doing'], ['done', 'Done']]
const STAGE_IDS = ['later', 'next', 'doing']
// What goes on the Board: what is to be done.
const TO_DO = ['todo', 'problem', 'date']

const newest = (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)

/* Where a sticky came from, as you'd say it now: the desk and the canvas are gone (Phase 73). */
const SOURCE_NOW = { Home: 'Typed', Desk: 'Typed', Sky: 'Board', Canvas: 'Board' }
export const sourceWords = (source) => SOURCE_NOW[source] || source || ''

/* A sticky's words on a card: a picture in it reads as [Screenshot], never as its file's name. */
export const cardWords = (text) => String(text || '').replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => `[${alt || 'Picture'}]`)

/* A board's paper: its own colour, else one of the papers in turn. */
export const paperOf = (folder, index) => folder.color || PAPERS[index % PAPERS.length]

/* The boards, in their order, each with how many stickies are on it. */
export function boardsOf(state) {
  return nodesOf(state.folders).map(({ folder }) => ({ folder, count: stickiesOn(state, folder.id).length }))
}

/* Every sticky on a board (Just in: what has no home yet), newest first. Day pages are never stickies. */
export function stickiesOn(state, boardId) {
  if (boardId === JUST_IN) return state.notes.filter((note) => isActiveNote(note) && !note.kind && isUnsorted(note)).sort(newest)
  const ids = folderSubtree(state.folders, boardId)
  return state.notes.filter((note) => isActiveNote(note) && !note.kind && ids.has(note.folderId)).sort(newest)
}

/* The Map: [{ what, title, paper, notes }], in the kinds' order. */
export function mapColumns(notes) {
  return WHATS
    .map((what) => ({ what, title: COLUMN[what], paper: WHAT_PAPER[what], notes: notes.filter((note) => whatOf(note) === what) }))
    .filter((column) => column.notes.length || ALWAYS.includes(column.what))
}

/* Where a sticky is on the Board: done once ticked off (`doneAt`), else its stage, else Later. */
export const stageOf = (note) => (note.doneAt ? 'done' : STAGE_IDS.includes(note.stage) ? note.stage : 'later')
export const onBoard = (note) => TO_DO.includes(whatOf(note)) || STAGE_IDS.includes(note.stage)

/* The Board: [{ stage, title, notes }], each in its own order (rank). */
export function stageColumns(notes) {
  const shown = notes.filter(onBoard)
  return STAGES.map(([stage, title]) => ({
    stage,
    title,
    notes: shown.filter((note) => stageOf(note) === stage).sort((a, b) => rankOf(a) - rankOf(b)),
  }))
}

/* Moves stickies to a stage. Done ticks them off; leaving Done un-ticks them. */
export function setStage(state, ids, stage, at = new Date().toISOString()) {
  const set = new Set(ids)
  return {
    ...state,
    notes: state.notes.map((note) => {
      if (!set.has(note.id)) return note
      if (stage === 'done') return note.doneAt ? note : { ...note, doneAt: at }
      if (!STAGE_IDS.includes(stage)) return note
      const { doneAt, ...rest } = note
      return { ...rest, stage }
    }),
  }
}

/* A sticky dropped at `index` in a stage's list ranks between its neighbours there (all of them spaced
   out again when there is no room between two). */
export function rankIn(state, noteId, list, index) {
  const { rank, renumber } = rankAt(list.filter((note) => note.id !== noteId), index)
  const ranks = new Map([...(renumber || []).map((item) => [item.id, item.rank]), [noteId, rank]])
  return { ...state, notes: state.notes.map((note) => (ranks.has(note.id) ? { ...note, rank: ranks.get(note.id) } : note)) }
}

/* A new board, or the one already called that (never two of the same name). { state, folder } */
export function addBoard(state, name) {
  const key = (value) => String(value).trim().toLowerCase()
  const same = folderChildren(state.folders, null).find((folder) => key(folder.name) === key(name))
  if (same) return { state, folder: same }
  return addFolder(state, String(name).trim().slice(0, 80))
}

/* Stickies onto a board (Just in: back to no home). */
export function moveToBoard(state, ids, boardId) {
  return ids.reduce((next, id) => moveSticky(next, id, boardId === JUST_IN ? null : boardId), state)
}

/* Find on a board: stickies whose words have every word asked. */
export function findOn(notes, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return notes
  return notes.filter((note) => {
    const text = `${note.title}\n${note.markdown}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

/* Undo for one change on the canvas: what `before` and `after` differ in (stickies and boards, by id)
   goes back as it was before; everything else (the AI filing meanwhile, another window) is left alone. */
export function undoFrom(before, after) {
  const back = (was, now) => {
    const old = new Map(was.map((item) => [item.id, item]))
    const fresh = new Map(now.map((item) => [item.id, item]))
    const touched = new Set([...now.filter((item) => old.get(item.id) !== item), ...was.filter((item) => !fresh.has(item.id))].map((item) => item.id))
    if (!touched.size) return null
    return (current) => {
      const here = new Set(current.map((item) => item.id))
      const kept = current.flatMap((item) => (!touched.has(item.id) ? [item] : old.has(item.id) ? [old.get(item.id)] : []))
      return [...kept, ...[...touched].filter((id) => !here.has(id) && old.has(id)).map((id) => old.get(id))]
    }
  }
  const notes = back(before.notes, after.notes)
  const folders = back(before.folders, after.folders)
  return (state) => ({ ...state, ...(notes ? { notes: notes(state.notes) } : {}), ...(folders ? { folders: folders(state.folders) } : {}) })
}
