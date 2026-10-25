/* Today (Phase 73): the first screen, the one answer to "what do I need to do?". What to do (open to-dos,
   the ones being done first), what's on the day (the Mac's calendars, OSAT's own, and dated stickies not on a
   calendar yet), and one plain line that says it all. Pure. */

import { whatOf, whenOf } from '../../shared/what-model.mjs'
import { boardsOf, clientName, clientTouch, isClient, onBoard, stageOf, stickiesOn } from '../boards/boards-model.js'
import { folderPath, folderSubtree, isActiveNote } from '../notes-model.js'

const STAGE_FIRST = { doing: 0, next: 1, later: 2 }
const startOfDay = (time) => { const day = new Date(time); return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() }
const DAY = 86400000

/* The same steps as each board, including branches, in the user's board order. */
export function dashboardBoards(state) {
  return boardsOf(state).map(({ folder, count }) => {
    const steps = stickiesOn(state, folder.id).filter(onBoard)
    return { folder, count, total: steps.length, done: steps.filter((note) => stageOf(note) === 'done').length }
  })
}

/* The notes touched last; to-dos are left to the To do card beside it. */
export function recentWork(state) {
  return state.notes.filter((note) => isActiveNote(note) && !note.kind && whatOf(note) !== 'todo')
    .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0))
    .slice(0, 4)
}

/* Open to-dos as [{ note, when, board }]: Doing, then Next, then the soonest day, then the newest. */
export function openTodos(state, now = Date.now()) {
  return state.notes
    .filter((note) => isActiveNote(note) && !note.kind && !note.doneAt && whatOf(note) === 'todo')
    .map((note) => ({ note, when: whenOf(note), board: note.folderId ? folderPath(state.folders, note.folderId)[0] || '' : '' }))
    .sort((a, b) => STAGE_FIRST[stageOf(a.note)] - STAGE_FIRST[stageOf(b.note)]
      || (a.when?.start.getTime() ?? Infinity) - (b.when?.start.getTime() ?? Infinity)
      || (Date.parse(b.note.createdAt) || 0) - (Date.parse(a.note.createdAt) || 0))
    .map((item) => ({ ...item, late: Boolean(item.when) && item.when.start.getTime() < startOfDay(now) }))
}

/* What is on the day of `now`, in order, all-day first: [{ id, title, start, end, allDay, color, from }].
   `from` is 'mac' (the Mac's calendars, minus the ones switched off), 'osat' (OSAT's own) or 'sticky' (a dated
   sticky that isn't on a calendar yet). */
export function dayPlan({ mac = [], hidden = [], own = [], notes = [] }, now = Date.now()) {
  const from = startOfDay(now)
  const to = from + DAY
  const onDay = (start, end) => {
    const a = Date.parse(start)
    const b = Date.parse(end) || a
    return Number.isFinite(a) && a < to && (b > from || a >= from)
  }
  const items = [
    ...mac.filter((event) => !hidden.includes(event.calendarId) && onDay(event.start, event.end))
      .map((event) => ({ id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay, color: event.color, from: 'mac' })),
    ...own.filter((event) => onDay(event.start, event.end))
      .map((event) => ({ id: event.id, title: event.title, start: event.start, end: event.end, allDay: !/T\d/.test(event.start), color: '', from: 'osat' })),
    ...notes.filter((note) => isActiveNote(note) && !note.doneAt && !note.cal?.id && whatOf(note) !== 'question')
      .flatMap((note) => {
        const when = whenOf(note)
        if (!when || when.start.getTime() < from || when.start.getTime() >= to) return []
        return [{ id: `note:${note.id}`, title: note.title || when.title, start: when.start.toISOString(), end: '', allDay: !when.time, color: '', from: 'sticky', noteId: note.id }]
      }),
  ]
  return items.sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start))
}

export function greeting(now = new Date()) {
  const hour = new Date(now).getHours()
  return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const join = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

/* The line under the greeting, when there is no morning brief: what the day holds, never a scold. */
export function dayLine({ todos = 0, late = 0, events = 0, waiting = 0, habitsLeft = 0 }) {
  const parts = [
    events ? `${count(events, 'thing')} on your calendar` : '',
    todos ? `${count(todos, 'to-do')}${late ? ` (${late} from before today)` : ''}` : '',
    waiting ? `${count(waiting, 'sticky', 'stickies')} waiting in Just in` : '',
    habitsLeft ? `${count(habitsLeft, 'habit')} to keep` : '',
  ].filter(Boolean)
  if (!parts.length) return 'A clear day. Write anything in the bar above and OSAT puts it where it goes.'
  const line = join(parts)
  return `${line[0].toUpperCase()}${line.slice(1)}.`
}

/* Money this month, in minor units: { spent, income } from the ledger's entries dated in `month` (YYYY-MM). Transfers
   between your own accounts are neither (Phase 87). */
export function monthMoney(budget, month) {
  const entries = (budget?.transactions || []).filter((entry) => String(entry.date).startsWith(month) && entry.category !== 'Transfers')
  return {
    spent: entries.filter((entry) => entry.amountMinor < 0).reduce((sum, entry) => sum - entry.amountMinor, 0),
    income: entries.filter((entry) => entry.amountMinor > 0).reduce((sum, entry) => sum + entry.amountMinor, 0),
  }
}

/* Before a client meeting (Phase 92): the next thing on the day, not over yet, whose title names a client board
   ("Fortis kickoff"). { item, folder, lastMeeting, todos, notes }: the last time you met, the open to-dos on that
   board or naming them (theirs read "Sam: send the price list"), and the two newest notes that name them. null
   when nothing today is with a client. */
export function meetingPrep(state, plan, now = Date.now()) {
  const clients = state.folders.filter(isClient).map((folder) => ({ folder, names: clientName(folder) })).filter((client) => client.names)
  if (!clients.length) return null
  for (const item of plan) {
    const end = Date.parse(item.end) || Date.parse(item.start) + 3600000
    if (end <= now) continue
    const client = clients.find(({ names }) => names.test(item.title))
    if (!client) continue
    const { folder, names } = client
    const on = folderSubtree(state.folders, folder.id)
    const touch = clientTouch(state, folder).items.filter((touched) => touched.at < Date.parse(item.start) || item.allDay)
    const todos = openTodos(state, now).filter(({ note }) => on.has(note.folderId) || names.test(note.title))
    const listed = new Set(todos.map(({ note }) => note.id))
    return {
      item,
      folder,
      lastMeeting: touch.find((touched) => touched.from === 'meeting' || touched.from === 'granola') || null,
      todos,
      notes: touch.filter((touched) => touched.from !== 'meeting' && touched.from !== 'granola' && !listed.has(touched.noteId)).slice(0, 2),
    }
  }
  return null
}
