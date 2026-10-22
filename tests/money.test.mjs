import assert from 'node:assert/strict'
import test from 'node:test'

import { arcs, cashFlow, holdings, monthTotals, readLimit, recategorize, ringPath, setLimit, SLICES, spending } from '../src/money/money-model.js'
import { normalizeWorkspace } from '../src/osat-data.js'
import { monthMoney } from '../src/today/today-model.js'
import { createEmptyDoc, diffDocs, validateOps } from '../shared/store-core.mjs'

const entry = (amountMinor, category, date = '2026-10-10', id = `t-${Math.random()}`) => ({ id, label: category, amountMinor, category, date })
const OCTOBER = [
  entry(-4500, 'Food & drink'), entry(-1500, 'Food & drink'), entry(-28100, 'Health & wellness'), entry(-2650, 'Gas'),
  entry(250000, 'Income'), entry(-50000, 'Transfers'), entry(50000, 'Transfers'), entry(-900, 'Gas', '2026-09-30'),
]

test('a month’s in and out leave transfers between your own accounts out; Today agrees', () => {
  assert.deepEqual(monthTotals(OCTOBER, '2026-10'), { in: 250000, out: 36750, net: 213250 })
  assert.deepEqual(monthMoney({ transactions: OCTOBER }, '2026-10'), { spent: 36750, income: 250000 })
})

test('spending by category: largest first, each with its share; the donut is five slices and everything else', () => {
  const { total, rows, slices } = spending(OCTOBER, '2026-10', { Gas: 5000 })
  assert.equal(total, 36750)
  assert.deepEqual(rows.map((row) => [row.category, row.share]), [['Health & wellness', 76.5], ['Food & drink', 16.3], ['Gas', 7.2]])
  assert.equal(rows.find((row) => row.category === 'Gas').limitMinor, 5000)
  assert.deepEqual(slices.map((slice) => [slice.category, slice.slot]), [['Health & wellness', 1], ['Food & drink', 2], ['Gas', 3]])
  const many = Array.from({ length: 8 }, (_, index) => entry(-(index + 1) * 100, `C${index}`))
  const folded = spending(many, '2026-10').slices
  assert.equal(folded.length, SLICES + 1)
  assert.deepEqual(folded.at(-1), { category: 'Everything else', spentMinor: 600, share: 16.7, slot: 0, rest: ['C2', 'C1', 'C0'] })
  assert.deepEqual(spending([], '2026-10'), { total: 0, rows: [], slices: [] })
})

test('the donut’s arcs go once round, and every ring segment is a closed path', () => {
  const ring = arcs([{ category: 'a', spentMinor: 3 }, { category: 'b', spentMinor: 1 }])
  assert.deepEqual(ring.map(({ start, end }) => [start, end]), [[0, 0.75], [0.75, 1]])
  for (const arc of ring) assert.match(ringPath(arc), /^M [\d.]+ [\d.]+ A .* Z$/)
  assert.match(ringPath({ start: 0, end: 1 }), /Z M .* Z$/, 'one category is the whole ring, with its hole')
})

test('six months of cash flow, oldest first, across a new year', () => {
  const flow = cashFlow([entry(1000, 'Income', '2026-01-05'), entry(-300, 'Food', '2025-12-24'), entry(-200, 'Transfers', '2026-01-02')], '2026-02')
  assert.deepEqual(flow.map((row) => row.month), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
  assert.deepEqual(flow.slice(3, 5), [{ month: '2025-12', in: 0, out: 300 }, { month: '2026-01', in: 1000, out: 0 }])
})

test('what the banks hold: cash, and what is owed on cards; nothing without a bank', () => {
  assert.equal(holdings([]), null)
  assert.deepEqual(holdings([{ accounts: [{ kind: 'depository', balanceMinor: 8235 }, { kind: 'depository', balanceMinor: 150001 }, { kind: 'credit', balanceMinor: 51240 }, { kind: 'investment', balanceMinor: 999 }, { kind: 'depository', balanceMinor: null }] }]), { cash: 158236, owed: 51240 })
})

test('a budget is typed in plain money, kept per category, taken off at 0, and survives opening the workspace', () => {
  assert.equal(readLimit('300'), 30000)
  assert.equal(readLimit('$1,250.50'), 125050)
  assert.equal(readLimit(''), 0)
  for (const bad of ['-5', 'abc', '1.234']) assert.equal(readLimit(bad), null, bad)
  const before = { ...createEmptyDoc(), schema: 17 }
  const set = setLimit(before, 'Food & drink', 30000)
  assert.deepEqual(set.budget.limits, { 'Food & drink': 30000 })
  assert.deepEqual(setLimit(set, 'Food & drink', 0).budget.limits, {})
  validateOps(diffDocs(before, set))
  assert.deepEqual(normalizeWorkspace(set).budget.limits, { 'Food & drink': 30000 })
  assert.equal('limits' in normalizeWorkspace({ budget: { limits: { Gas: -5, '': 10, Food: 1.5 } } }).budget, false)
})

test('an entry moves to another category by hand; a blank name changes nothing', () => {
  const state = { budget: { transactions: [entry(-450, 'Shopping', '2026-10-01', 'a')] } }
  assert.equal(recategorize(state, 'a', 'Groceries').budget.transactions[0].category, 'Groceries')
  assert.equal(recategorize(state, 'a', '  '), state)
})
