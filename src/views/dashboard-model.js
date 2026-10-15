import { habitStreak, localDateKey, isHabitDone } from '../daily-practice.js'
import { nextSteps } from '../next-steps.js'
import { isActiveNote, isUnsorted } from '../notes-model.js'

/* The Dashboard's numbers (Dashboard.jsx), worked out from the workspace alone: nothing is asked of the Mac or the AI.
   Pure, so tests/dashboard.test.mjs can check it. `now` is passed in for the same reason. */

const DAY = 86400000
const dayKey = (date) => localDateKey(date)
const plural = (count, one, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`

/* A day's notes, for the last `days` days ending today: [{ key, label, count }], oldest first. */
export function writingByDay(notes, now = new Date(), days = 14) {
  const counts = new Map()
  for (const note of notes) {
    if (!isActiveNote(note) || note.kind === 'day') continue
    const at = new Date(note.createdAt)
    if (Number.isNaN(at.getTime())) continue
    const key = dayKey(at)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const list = []
  for (let back = days - 1; back >= 0; back -= 1) {
    const date = new Date(now.getTime() - back * DAY)
    const key = dayKey(date)
    list.push({ key, label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count: counts.get(key) || 0 })
  }
  return list
}

/* How a number moved against the week before, in words: "+40%", "−20%", "new" or "". */
export function change(now, before) {
  if (!before) return now ? 'new' : ''
  const pct = Math.round(((now - before) / before) * 100)
  return pct === 0 ? 'same' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}

export function dashboard(workspace, now = new Date()) {
  const notes = (workspace?.notes || []).filter(isActiveNote)
  const folders = workspace?.folders || []
  const stickies = notes.filter((note) => note.kind !== 'day')
  const unsorted = stickies.filter(isUnsorted)
  const today = dayKey(now)
  const addedToday = unsorted.filter((note) => dayKey(new Date(note.createdAt)) === today).length

  const topics = folders.filter((folder) => !folder.parentId)
  const branches = folders.length - topics.length
  // Which top-level topic a folder sits in, so a branch's stickies count for its topic.
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parentId || null]))
  const topOf = (id) => { let at = id; for (let hops = 0; at && parentOf.get(at) && hops < 50; hops += 1) at = parentOf.get(at); return at }
  const sizes = new Map()
  for (const note of stickies) if (note.folderId) { const top = topOf(note.folderId); sizes.set(top, (sizes.get(top) || 0) + 1) }
  const biggest = topics.map((folder) => ({ id: folder.id, name: folder.name || 'Untitled topic', count: sizes.get(folder.id) || 0, color: folder.color || null }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8)

  const week = writingByDay(notes, now, 14)
  const thisWeek = week.slice(7).reduce((sum, day) => sum + day.count, 0)
  const lastWeek = week.slice(0, 7).reduce((sum, day) => sum + day.count, 0)

  const steps = nextSteps(notes)
  const open = steps.filter((step) => !step.done)

  const habits = (workspace?.habits || []).filter((habit) => habit && !habit.archived)
  const habitsDone = habits.filter((habit) => isHabitDone(habit, today)).length
  // The longest run going: encouragement, where a count of what's left would nag.
  const streak = habits.reduce((longest, habit) => Math.max(longest, habitStreak(habit, today).current), 0)

  const sorted = stickies.length ? Math.round(((stickies.length - unsorted.length) / stickies.length) * 100) : 100

  const soon = (workspace?.calendar?.events || [])
    .map((event) => ({ ...event, when: new Date(event.start) }))
    .filter((event) => !Number.isNaN(event.when.getTime()) && event.when.getTime() >= now.getTime() - 3600000)
    .sort((a, b) => a.when - b.when).slice(0, 4)

  return {
    cards: [
      { id: 'unsorted', label: 'Waiting to sort', value: unsorted.length, note: addedToday ? `+${addedToday} today` : 'all calm', up: addedToday > 0, go: ['Mindmap'] },
      { id: 'topics', label: 'Topics', value: topics.length, note: plural(branches, 'branch', 'branches'), go: ['Mindmap'] },
      { id: 'written', label: 'Written this week', value: thisWeek, note: change(thisWeek, lastWeek), up: thisWeek >= lastWeek, go: ['Notes'] },
      { id: 'steps', label: 'Next steps', value: open.length, note: `${steps.length - open.length} done`, up: true, go: ['Journal'] },
    ],
    sorted,
    habits: { done: habitsDone, total: habits.length, streak },
    week,
    thisWeek,
    lastWeek,
    biggest,
    steps: open.slice(0, 5),
    soon,
    stickies: stickies.length,
  }
}

/* A smooth line through points (Catmull-Rom as cubic Béziers, held to each segment's heights), for the writing chart. */
export function smoothPath(points) {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : ''
  let path = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const [p0, p1, p2, p3] = [points[i - 1] || points[i], points[i], points[i + 1], points[i + 2] || points[i + 1]]
    // The handles stay between the two points' heights, so the line never dips below zero or past a peak.
    const low = Math.min(p1[1], p2[1])
    const high = Math.max(p1[1], p2[1])
    const hold = (value) => Math.min(Math.max(value, low), high)
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, hold(p1[1] + (p2[1] - p0[1]) / 6)]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, hold(p2[1] - (p3[1] - p1[1]) / 6)]
    path += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`
  }
  return path
}
