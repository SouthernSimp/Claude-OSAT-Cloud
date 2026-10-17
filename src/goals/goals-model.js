/* Goals (Phase 75): the few big things, each fed by a board or a habit, so it moves when you do. A goal is
   { id, name, by ('YYYY-MM-DD' or ''), fed: { kind: 'board' | 'habit', id } | null, perWeek (a habit's days in 7),
   doneAt, createdAt } (src/osat-data.js normalizes it). How far along it is comes from what feeds it, worked out each
   time and never stored. Pure. */

import { onBoard, stickiesOn } from '../boards/boards-model.js'
import { isHabitDone, lastDays, localDateKey } from '../daily-practice.js'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const dayWords = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

export function createGoal({ name, by = '', fed = null, perWeek = 7 }, at = new Date().toISOString(), id = globalThis.crypto.randomUUID()) {
  const words = String(name || '').trim()
  if (!words) return null
  return { id, name: words.slice(0, 120), by: /^\d{4}-\d{2}-\d{2}$/.test(by) ? by : '', fed, perWeek: Math.min(Math.max(Math.round(perWeek) || 7, 1), 7), doneAt: '', createdAt: at }
}

/* Where a goal stands: { pct (0–1), words, fed (what feeds it, in words) }. A board feeds it with its to-dos done; a
   habit with the days kept in the last seven, of the days it wants. Ticked done, it's done whatever feeds it. */
export function progressOf(goal, state, today = localDateKey()) {
  const board = goal.fed?.kind === 'board' ? state.folders.find((folder) => folder.id === goal.fed.id && !folder.parentId) : null
  const habit = goal.fed?.kind === 'habit' ? (state.habits || []).find((item) => item.id === goal.fed.id) : null
  const fed = board ? `Fed by the ${board.name} board` : habit ? `Fed by ${habit.name}` : goal.fed ? 'What fed it is gone' : ''
  if (goal.doneAt) return { pct: 1, words: 'Done', fed }
  if (board) {
    const work = stickiesOn(state, board.id).filter(onBoard)
    const done = work.filter((note) => note.doneAt).length
    return work.length ? { pct: done / work.length, words: `${done} of ${plural(work.length, 'to-do')} done`, fed } : { pct: 0, words: `Nothing to do on ${board.name} yet`, fed }
  }
  if (habit) {
    const kept = lastDays(today, 7).filter((day) => isHabitDone(habit, day)).length
    return { pct: Math.min(1, kept / goal.perWeek), words: `${kept} of ${plural(goal.perWeek, 'day')} this week`, fed }
  }
  return { pct: 0, words: 'Open', fed }
}

/* When it is for, calmly: "By Dec 31", "Today", or "Was for Oct 1" once that day has gone. */
export function byWords(goal, today = localDateKey()) {
  if (!goal.by) return ''
  if (goal.by === today) return 'Today'
  return goal.by < today && !goal.doneAt ? `Was for ${dayWords(goal.by)}` : `By ${dayWords(goal.by)}`
}

/* Open goals first (the soonest day first, then the oldest), then the done ones. */
export function sortGoals(goals) {
  return [...goals].sort((a, b) => Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt))
    || (a.by || '9999') .localeCompare(b.by || '9999')
    || String(a.createdAt).localeCompare(String(b.createdAt)))
}
