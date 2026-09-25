export const HABITS_STORAGE_KEY = 'nateos.habits.v1'
export const REFLECTIONS_STORAGE_KEY = 'nateos.reflections.v1'

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
