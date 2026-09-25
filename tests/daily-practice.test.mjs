import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calendarMonthDays,
  createHabit,
  isHabitDone,
  localDateKey,
  normalizeHabits,
  normalizeReflections,
  toggleHabit,
  upsertReflection,
} from '../src/daily-practice.js'

test('calendar month includes six complete local weeks', () => {
  const days = calendarMonthDays(2026, 8)
  assert.equal(days.length, 42)
  assert.equal(days[0].key, '2026-08-30')
  assert.equal(days.at(-1).key, '2026-10-10')
  assert.equal(days.filter((day) => day.inMonth).length, 30)
})

test('daily practice state keeps one local-date check and reflection', () => {
  const date = '2026-08-24'
  assert.equal(localDateKey(new Date(2026, 7, 24, 23, 30)), date)

  const habit = createHabit('  End-of-day reflection  ', 'build', 'reflection-habit')
  assert.equal(habit.name, 'End-of-day reflection')
  const checked = toggleHabit([habit], habit.id, date)
  assert.equal(isHabitDone(checked[0], date), true)
  assert.equal(isHabitDone(toggleHabit(checked, habit.id, date)[0], date), false)
  assert.deepEqual(normalizeHabits([checked[0], { nope: true }]), checked)

  const first = upsertReflection([], date, { win: 'Focused.', hard: '', tomorrow: 'Walk.' }, '2026-08-25T01:00:00.000Z')
  const edited = upsertReflection(first, date, { win: 'Finished.', hard: 'Tired.', tomorrow: 'Rest.' }, '2026-08-25T02:00:00.000Z')
  assert.equal(edited.length, 1)
  assert.equal(edited[0].createdAt, first[0].createdAt)
  assert.equal(edited[0].updatedAt, '2026-08-25T02:00:00.000Z')
  assert.deepEqual(Object.keys(edited[0].answers), ['win', 'hard', 'tomorrow'])
  assert.deepEqual(normalizeReflections([...edited, { date: 'not-a-date' }]), edited)
})
