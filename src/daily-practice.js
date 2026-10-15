const datePattern = /^\d{4}-\d{2}-\d{2}$/
const habitTypes = ['build', 'avoid']
const answerKeys = ['win', 'hard', 'tomorrow']

export function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function calendarMonthDays(year, month) {
  const first = new Date(year, month, 1, 12)
  const start = new Date(year, month, 1 - first.getDay(), 12)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return { date, key: localDateKey(date), inMonth: date.getMonth() === month }
  })
}

export function createHabit(name, type, id = crypto.randomUUID()) {
  const cleanName = typeof name === 'string' ? name.trim() : ''
  if (!cleanName || !habitTypes.includes(type) || typeof id !== 'string' || !id) return null
  return { id, name: cleanName, type, doneDates: [] }
}

export function normalizeHabits(value) {
  if (!Array.isArray(value)) return []
  const habits = new Map()
  value.forEach((habit) => {
    if (!habit || typeof habit.id !== 'string' || typeof habit.name !== 'string' || !habit.name.trim() || !habitTypes.includes(habit.type)) return
    habits.set(habit.id, {
      id: habit.id,
      name: habit.name.trim(),
      type: habit.type,
      doneDates: [...new Set(Array.isArray(habit.doneDates) ? habit.doneDates.filter((date) => datePattern.test(date)) : [])],
    })
  })
  return [...habits.values()]
}

export function isHabitDone(habit, date = localDateKey()) {
  return Array.isArray(habit?.doneDates) && habit.doneDates.includes(date)
}

export function toggleHabit(habits, id, date = localDateKey()) {
  if (!datePattern.test(date)) return habits
  return habits.map((habit) => {
    if (habit.id !== id) return habit
    const doneDates = Array.isArray(habit.doneDates) ? habit.doneDates : []
    return {
      ...habit,
      doneDates: doneDates.includes(date) ? doneDates.filter((item) => item !== date) : [...doneDates, date],
    }
  })
}

/* ---- Habits over time --------------------------------------------------------------------------------------------
   Everything below is worked out from `doneDates` alone: the days a habit was kept. For a Build habit that is a day
   it was done; for an Avoid habit, a day kept clean (both have always been "kept" in the room, the widget and the
   Dashboard). A run isn't over until a whole day passes without it: this morning, yesterday's run still stands. */

/* The day `count` days after `key` (before it when negative), counted on the calendar, so a 23-hour day is a day. */
export function shiftDay(key, count) {
  const [year, month, day] = key.split('-').map(Number)
  return localDateKey(new Date(year, month - 1, day + count, 12))
}

/* The last `count` days up to and including `today`, oldest first. */
export function lastDays(today, count = 7) {
  return Array.from({ length: count }, (_, index) => shiftDay(today, index - count + 1))
}

/* Where a habit stands on `today`: is today kept, the run still going (`current`, through yesterday until today is
   kept), the longest run ever (`best`), the last day kept (`last`) and how many days in all. Days after today don't count. */
export function habitStreak(habit, today = localDateKey()) {
  const kept = new Set((Array.isArray(habit?.doneDates) ? habit.doneDates : []).filter((day) => datePattern.test(day) && day <= today))
  const keptToday = kept.has(today)
  let current = 0
  for (let day = keptToday ? today : shiftDay(today, -1); kept.has(day); day = shiftDay(day, -1)) current += 1
  let best = 0
  let run = 0
  let last = null
  for (const day of [...kept].sort()) {
    run = last && shiftDay(last, 1) === day ? run + 1 : 1
    best = Math.max(best, run)
    last = day
  }
  return { keptToday, current, best, last, total: kept.size }
}

/* "Tuesday" within the last week, else "Oct 5" ("Oct 5, 2025" in another year). */
function dayWords(key, today) {
  const date = new Date(`${key}T12:00`)
  if (new Date(`${today}T12:00`) - date < 6.5 * 86400000) return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) })
}

/* The line under a habit, in plain words and never a scold: the run going now ("4 days in a row", "12 days clean"),
   or when it was last kept, or "New". `best` is said only when it is longer than the run going now. */
export function streakWords(habit, today = localDateKey()) {
  const { keptToday, current, best, last } = habitStreak(habit, today)
  const avoid = habit?.type === 'avoid'
  let run = 'New'
  if (current > 1) run = avoid ? `${current} days clean` : `${current} days in a row`
  else if (current === 1) run = `${avoid ? 'Clean' : 'Done'} ${keptToday ? 'today' : 'yesterday'}`
  else if (last) run = `${avoid ? 'Last clean day' : 'Last done'} ${dayWords(last, today)}`
  return { run, best: best > current && best > 1 ? `Best: ${best}` : '' }
}

/* The day at the top of the room: how many are kept, never how many are left. */
export function keptWords(habits, today = localDateKey()) {
  const kept = habits.filter((habit) => isHabitDone(habit, today)).length
  if (!habits.length) return ''
  if (kept === habits.length) return habits.length === 1 ? 'Kept today' : habits.length === 2 ? 'Both kept today' : `All ${habits.length} kept today`
  return kept ? `${kept} of ${habits.length} kept` : 'Tap a habit once it’s kept'
}

/* Moves a habit to `index` among the habits of its own kind (Build or Avoid), counted without it; the other kind
   keeps its places in the list. The same list back when nothing moves. */
export function moveHabit(habits, id, index) {
  const moving = habits.find((habit) => habit.id === id)
  if (!moving) return habits
  const kind = habits.filter((habit) => habit.type === moving.type && habit.id !== id)
  kind.splice(Math.max(0, Math.min(index, kind.length)), 0, moving)
  let next = 0
  const moved = habits.map((habit) => (habit.type === moving.type ? kind[next++] : habit))
  return moved.some((habit, at) => habit !== habits[at]) ? moved : habits
}

export function renameHabit(habits, id, name) {
  const clean = typeof name === 'string' ? name.trim() : ''
  return clean ? habits.map((habit) => (habit.id === id && habit.name !== clean ? { ...habit, name: clean } : habit)) : habits
}

/* A habit named with an emoji first ("💧 Drink water") wears the emoji as its picture. */
export function habitFace(name = '') {
  const first = new Intl.Segmenter().segment(name)[Symbol.iterator]().next().value?.segment || ''
  const rest = name.slice(first.length).trim()
  return /\p{Extended_Pictographic}/u.test(first) && rest ? { emoji: first, text: rest } : { emoji: '', text: name }
}

function normalizeAnswers(answers) {
  return Object.fromEntries(answerKeys.map((key) => [key, typeof answers?.[key] === 'string' ? answers[key] : '']))
}

export function normalizeReflections(value) {
  if (!Array.isArray(value)) return []
  const reflections = new Map()
  value.forEach((reflection) => {
    if (!reflection || typeof reflection.date !== 'string' || !datePattern.test(reflection.date)) return
    const answers = normalizeAnswers(reflection.answers)
    reflections.set(reflection.date, {
      id: typeof reflection.id === 'string' ? reflection.id : `reflection-${reflection.date}`,
      date: reflection.date,
      answers,
      createdAt: typeof reflection.createdAt === 'string' ? reflection.createdAt : '',
      updatedAt: typeof reflection.updatedAt === 'string' ? reflection.updatedAt : '',
    })
  })
  return [...reflections.values()]
}

export function upsertReflection(reflections, date, answers, now = new Date().toISOString()) {
  if (!datePattern.test(date)) return reflections
  const cleanAnswers = normalizeAnswers(answers)
  if (!Object.values(cleanAnswers).some((answer) => answer.trim())) return reflections
  const existing = reflections.find((reflection) => reflection.date === date)
  const next = {
    id: existing?.id || `reflection-${date}`,
    date,
    answers: cleanAnswers,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  return [next, ...reflections.filter((reflection) => reflection.date !== date)]
}
