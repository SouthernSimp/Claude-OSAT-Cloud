import assert from 'node:assert/strict'
import test from 'node:test'

import { byWords, createGoal, progressOf, sortGoals } from '../src/goals/goals-model.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const iso = (day) => new Date(`${day}T12:00:00`).toISOString()
const sticky = (id, extra) => ({ id, title: id, markdown: id, tags: [], createdAt: iso('2026-10-10'), updatedAt: iso('2026-10-10'), ...extra })
const state = normalizeWorkspace({
  ...createDefaultWorkspace(),
  folders: [{ id: 'osat', name: 'OSAT', rank: 1, createdAt: iso('2026-10-01') }],
  notes: [
    sticky('a', { folderId: 'osat', what: 'todo', doneAt: iso('2026-10-12') }),
    sticky('b', { folderId: 'osat', what: 'todo' }),
    sticky('c', { folderId: 'osat', what: 'todo' }),
    sticky('idea', { folderId: 'osat', what: 'idea' }),
  ],
  habits: [{ id: 'gym', name: 'Gym', type: 'build', doneDates: ['2026-10-13', '2026-10-15', '2026-10-17', '2026-10-01'] }],
})
const TODAY = '2026-10-19'

test('a goal moves with its board (to-dos done), its habit (days kept in the last seven) or a tick', () => {
  const board = createGoal({ name: 'Ship the new OSAT', fed: { kind: 'board', id: 'osat' } }, iso(TODAY), 'g1')
  assert.deepEqual(progressOf(board, state, TODAY), { pct: 1 / 3, words: '1 of 3 to-dos done', fed: 'Fed by the OSAT board' })
  const habit = createGoal({ name: 'Gym four times a week', fed: { kind: 'habit', id: 'gym' }, perWeek: 4 }, iso(TODAY), 'g2')
  assert.deepEqual(progressOf(habit, state, TODAY), { pct: 0.75, words: '3 of 4 days this week', fed: 'Fed by Gym' })
  const plain = createGoal({ name: 'Read 12 books' }, iso(TODAY), 'g3')
  assert.equal(progressOf(plain, state, TODAY).words, 'Open')
  assert.deepEqual(progressOf({ ...plain, doneAt: iso(TODAY) }, state, TODAY), { pct: 1, words: 'Done', fed: '' })
  assert.equal(progressOf({ ...board, fed: { kind: 'board', id: 'gone' } }, state, TODAY).fed, 'What fed it is gone')
  assert.equal(createGoal({ name: '   ' }), null)
  assert.equal(createGoal({ name: 'x', perWeek: 12 }, iso(TODAY), 'g4').perWeek, 7)
})

test('when a goal is for, calmly; open goals first, the soonest first', () => {
  const goal = (id, by, doneAt = '') => ({ id, name: id, by, doneAt, createdAt: iso('2026-10-01') })
  assert.equal(byWords(goal('a', '2026-12-31'), TODAY), 'By Dec 31')
  assert.equal(byWords(goal('a', TODAY), TODAY), 'Today')
  assert.equal(byWords(goal('a', '2026-10-01'), TODAY), 'Was for Oct 1')
  assert.equal(byWords(goal('a', ''), TODAY), '')
  assert.deepEqual(sortGoals([goal('later', '2026-12-31'), goal('none', ''), goal('done', '2026-10-20', iso(TODAY)), goal('soon', '2026-11-01')]).map((g) => g.id), ['soon', 'later', 'none', 'done'])
})

test('goals are kept as they were saved, cleaned', () => {
  const kept = normalizeWorkspace({ ...createDefaultWorkspace(), goals: [
    { id: 'g1', name: '  Win three clients ', by: '2026-12-31', fed: { kind: 'board', id: 'osat' }, perWeek: 3 },
    { id: 'g1', name: 'Twice' },
    { id: 'g2', name: '' },
    { id: 'g3', name: 'Odd', by: 'soon', fed: { kind: 'planet', id: 'x' }, perWeek: 40 },
  ] }).goals
  assert.deepEqual(kept.map((g) => [g.id, g.name, g.by, g.fed, g.perWeek]), [['g1', 'Win three clients', '2026-12-31', { kind: 'board', id: 'osat' }, 3], ['g3', 'Odd', '', null, 7]])
})
