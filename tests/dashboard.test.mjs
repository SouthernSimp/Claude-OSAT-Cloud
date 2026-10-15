import test from 'node:test'
import assert from 'node:assert/strict'
import { change, dashboard, smoothPath, writingByDay } from '../src/views/dashboard-model.js'

const now = new Date(2026, 9, 14, 18, 0)
const at = (daysAgo) => new Date(now.getTime() - daysAgo * 86400000).toISOString()
const note = (id, extra = {}) => ({ id, title: id, markdown: '', createdAt: at(0), updatedAt: at(0), folderId: null, ...extra })

test('the dashboard counts what waits, the topics, this week against last, and next steps', () => {
  const workspace = {
    folders: [{ id: 'f1', name: 'House' }, { id: 'f2', name: 'Work' }, { id: 'b1', name: 'Kitchen', parentId: 'f1' }],
    notes: [
      note('a', { unsorted: true }),
      note('b', { unsorted: true, createdAt: at(3) }),
      note('c', { folderId: 'b1', createdAt: at(9) }),
      note('d', { folderId: 'f2', markdown: '- [ ] Call Jordan\n- [x] Send the quote' }),
      note('gone', { trashedAt: at(1) }),
      note('day-2026-10-14', { kind: 'day', date: '2026-10-14', markdown: '- [ ] Water the plants' }),
    ],
    habits: [{ id: 'h1', name: 'Walk', type: 'build', doneDates: ['2026-10-14'] }, { id: 'h2', name: 'Read', type: 'build', doneDates: [] }],
    calendar: { events: [{ id: 'e1', title: 'Dentist', start: at(-1) }, { id: 'e0', title: 'Past', start: at(2) }] },
  }
  const board = dashboard(workspace, now)
  const card = (id) => board.cards.find((item) => item.id === id)
  assert.equal(card('unsorted').value, 2)
  assert.equal(card('unsorted').note, '+1 today')
  assert.equal(card('topics').value, 2)
  assert.equal(card('topics').note, '1 branch')
  assert.equal(card('written').value, 3, 'this week: a, b and d; c was nine days ago; the day page and the Bin do not count')
  assert.equal(card('written').note, '+200%')
  assert.equal(card('steps').value, 2)
  assert.equal(board.sorted, 50, 'two of four stickies have a home')
  assert.deepEqual(board.habits, { done: 1, total: 2 })
  assert.deepEqual(board.biggest.map(({ name, count }) => [name, count]), [['House', 1], ['Work', 1]], 'a branch counts for its topic')
  assert.deepEqual(board.soon.map((event) => event.title), ['Dentist'])
})

test('an empty workspace is calm, never broken', () => {
  const board = dashboard({}, now)
  assert.equal(board.sorted, 100)
  assert.equal(board.week.length, 14)
  assert.deepEqual(board.cards.map((item) => item.value), [0, 0, 0, 0])
})

test('writing by day ends today, oldest first', () => {
  const days = writingByDay([note('x'), note('y', { createdAt: at(1) }), note('z', { createdAt: at(1) })], now, 3)
  assert.deepEqual(days.map((day) => day.count), [0, 2, 1])
})

test('a change is said in words', () => {
  assert.equal(change(5, 0), 'new')
  assert.equal(change(0, 0), '')
  assert.equal(change(3, 4), '−25%')
  assert.equal(change(4, 4), 'same')
})

test('a smooth path goes through every point', () => {
  const path = smoothPath([[0, 10], [10, 0], [20, 10]])
  assert.match(path, /^M0,10 C.* 10,0 C.* 20,10$/)
})

test('the smooth line never dips below its lowest point', () => {
  const path = smoothPath([[0, 100], [10, 100], [20, 100], [30, 0]])
  const ys = [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((match) => Number(match[2]))
  assert.ok(Math.max(...ys) <= 100, path)
})
