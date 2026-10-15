import assert from 'node:assert/strict'
import test from 'node:test'
import {
  habitFace, habitStreak, keptWords, lastDays, moveHabit, normalizeHabits, renameHabit, shiftDay, streakWords, toggleHabit,
} from '../src/daily-practice.js'

// October 15, 2026 is a Thursday.
const TODAY = '2026-10-15'
const habit = (doneDates, type = 'build', id = 'h') => ({ id, name: 'Walk', type, doneDates })

test('days step on the calendar, across months, years and the clocks changing', () => {
  assert.equal(shiftDay('2026-10-01', -1), '2026-09-30')
  assert.equal(shiftDay('2025-12-31', 1), '2026-01-01')
  assert.equal(shiftDay('2028-02-28', 1), '2028-02-29')
  assert.equal(shiftDay('2026-11-01', 1), '2026-11-02', 'the day the clocks go back is still one day')
  assert.equal(shiftDay('2026-03-08', -1), '2026-03-07', 'and the day they go forward')
  assert.deepEqual(lastDays('2026-10-02', 7), ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
})

test('a run carries across the end of a month and a year', () => {
  assert.deepEqual(habitStreak(habit(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']), '2026-10-02'), { keptToday: true, current: 4, best: 4, last: '2026-10-02', total: 4 })
  assert.equal(habitStreak(habit(['2026-01-01', '2025-12-30', '2025-12-31']), '2026-01-01').current, 3, 'out of order is fine')
})

test('today not kept yet: the run still stands until the day is over', () => {
  const walk = habit(['2026-10-12', '2026-10-13', '2026-10-14'])
  assert.deepEqual(habitStreak(walk, TODAY), { keptToday: false, current: 3, best: 3, last: '2026-10-14', total: 3 })
  assert.equal(streakWords(walk, TODAY).run, '3 days in a row')
  const kept = toggleHabit([walk], 'h', TODAY)[0]
  assert.equal(habitStreak(kept, TODAY).current, 4, 'keeping today adds to it')
  // A whole day missed: the run is over, said calmly.
  assert.equal(habitStreak(walk, '2026-10-16').current, 0)
  assert.deepEqual(streakWords(walk, '2026-10-16'), { run: 'Last done Wednesday', best: 'Best: 3' })
  assert.deepEqual(streakWords(walk, '2026-10-30'), { run: 'Last done Oct 14', best: 'Best: 3' })
  assert.equal(streakWords(walk, '2027-01-04').run, 'Last done Oct 14, 2026')
})

test('the words for one day, a new habit, and the best run', () => {
  assert.deepEqual(streakWords(habit([]), TODAY), { run: 'New', best: '' })
  assert.equal(streakWords(habit([TODAY]), TODAY).run, 'Done today')
  assert.equal(streakWords(habit(['2026-10-14']), TODAY).run, 'Done yesterday')
  const comeback = habit(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-14', TODAY])
  assert.deepEqual(habitStreak(comeback, TODAY), { keptToday: true, current: 2, best: 5, last: TODAY, total: 7 })
  assert.deepEqual(streakWords(comeback, TODAY), { run: '2 days in a row', best: 'Best: 5' })
  assert.equal(streakWords(habit(['2026-10-13', '2026-10-14', TODAY]), TODAY).best, '', 'the best run is the one going now: said once')
})

test('Avoid habits: a kept day is a clean day', () => {
  const twelve = Array.from({ length: 12 }, (_, index) => shiftDay(TODAY, -1 - index))
  assert.equal(streakWords(habit(twelve, 'avoid'), TODAY).run, '12 days clean')
  assert.equal(streakWords(habit([TODAY], 'avoid'), TODAY).run, 'Clean today')
  assert.equal(streakWords(habit(['2026-10-14'], 'avoid'), TODAY).run, 'Clean yesterday')
  assert.equal(streakWords(habit(['2026-10-11'], 'avoid'), TODAY).run, 'Last clean day Sunday')
  // Data from before this room keeps its meaning: the same days, the same run.
  const [old] = normalizeHabits([{ id: 'p', name: 'No phone in bed', type: 'avoid', doneDates: twelve, archived: true }])
  assert.equal(habitStreak(old, TODAY).current, 12)
})

test('fixing a past day joins two runs; days after today never count', () => {
  const gap = habit(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-14', TODAY])
  assert.equal(habitStreak(gap, TODAY).current, 2)
  const fixed = toggleHabit([gap], 'h', '2026-10-13')[0]
  assert.deepEqual(habitStreak(fixed, TODAY), { keptToday: true, current: 6, best: 6, last: TODAY, total: 6 })
  assert.equal(habitStreak(toggleHabit([fixed], 'h', '2026-10-13')[0], TODAY).current, 2, 'and a second tap takes it back')
  assert.deepEqual(habitStreak(habit(['2026-10-16', '2026-10-17']), TODAY), { keptToday: false, current: 0, best: 0, last: null, total: 0 })
})

test('the day’s line counts what is kept, never what is left', () => {
  const list = [habit([TODAY], 'build', 'a'), habit([], 'build', 'b'), habit([TODAY], 'avoid', 'c')]
  assert.equal(keptWords([], TODAY), '')
  assert.equal(keptWords(list.slice(1, 2), TODAY), 'Tap a habit once it’s kept')
  assert.equal(keptWords(list, TODAY), '2 of 3 kept')
  assert.equal(keptWords([list[0], list[2]], TODAY), 'Both kept today')
  assert.equal(keptWords([list[0], list[2], list[0]], TODAY), 'All 3 kept today')
  assert.equal(keptWords([list[0]], TODAY), 'Kept today')
})

test('reordering moves a habit among its own kind and leaves the other kind in place', () => {
  const b = (id) => ({ id, name: id, type: 'build', doneDates: [] })
  const a = (id) => ({ id, name: id, type: 'avoid', doneDates: [] })
  const list = [b('b1'), a('a1'), b('b2'), a('a2'), b('b3')]
  const ids = (habits) => habits.map((item) => item.id)
  assert.deepEqual(ids(moveHabit(list, 'b3', 0)), ['b3', 'a1', 'b1', 'a2', 'b2'])
  assert.deepEqual(ids(moveHabit(list, 'b1', 9)), ['b2', 'a1', 'b3', 'a2', 'b1'], 'past the end is the end')
  assert.deepEqual(ids(moveHabit(list, 'a2', 0)), ['b1', 'a2', 'b2', 'a1', 'b3'])
  assert.equal(moveHabit(list, 'b2', 1), list, 'already there: the same list')
  assert.equal(moveHabit(list, 'nope', 0), list)
  assert.deepEqual(ids(moveHabit(list, 'b1', -3)), ids(list))
})

test('renaming trims; an empty name changes nothing', () => {
  const list = [habit([], 'build', 'a')]
  assert.equal(renameHabit(list, 'a', '  Walk the dog ')[0].name, 'Walk the dog')
  assert.equal(renameHabit(list, 'a', '   '), list)
})

test('an emoji at the front of a name is the habit’s picture', () => {
  assert.deepEqual(habitFace('💧 Drink water'), { emoji: '💧', text: 'Drink water' })
  assert.deepEqual(habitFace('🧘‍♀️ Stretch'), { emoji: '🧘‍♀️', text: 'Stretch' })
  assert.deepEqual(habitFace('Read 10 pages'), { emoji: '', text: 'Read 10 pages' })
  assert.deepEqual(habitFace('10 pushups'), { emoji: '', text: '10 pushups' })
  assert.deepEqual(habitFace('🌙'), { emoji: '', text: '🌙' }, 'only an emoji: it stays the name')
})
