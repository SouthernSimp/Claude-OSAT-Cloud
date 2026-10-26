import assert from 'node:assert/strict'
import test from 'node:test'

import { arcs, cashFlow, holdings, monthTotals, payoff, readLimit, readRate, recategorize, ringPath, setLimit, SLICES, spending, worth } from '../src/money/money-model.js'
import { normalizeWorkspace } from '../src/osat-data.js'
import { monthMoney } from '../src/today/today-model.js'
import { applyOps, createEmptyDoc, diffDocs, validateOps } from '../shared/store-core.mjs'

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

const cash = { id: 'balance-1', label: 'Cash', owe: false, amountMinor: 30000 }
const car = { id: 'balance-2', label: 'Car loan', owe: true, amountMinor: 900000, rate: 6.5, minimumMinor: 25000 }
const card = { id: 'balance-3', label: 'Store card', owe: true, amountMinor: 120000, rate: 24.99, minimumMinor: 3500 }

test('what you have and owe: the banks plus what you keep by hand; net worth can go below zero; nothing without either', () => {
  assert.equal(worth(null, []), null)
  assert.deepEqual(worth({ cash: 158236, owed: 51240 }, []), { have: 158236, owe: 51240, net: 106996 })
  assert.deepEqual(worth(null, [cash, car]), { have: 30000, owe: 900000, net: -870000 })
  assert.deepEqual(worth({ cash: 158236, owed: 51240 }, [cash, car]), { have: 188236, owe: 951240, net: -763004 })
})

test('paying debts down: the minimums added up, anything extra to the highest rate first; a debt at $0 doesn’t count', () => {
  assert.equal(payoff([cash]), null)
  assert.equal(payoff([{ ...car, amountMinor: 0 }]), null)
  assert.deepEqual(payoff([car]), { leastMinor: 25000, first: null }, 'one debt has no order')
  assert.deepEqual(payoff([car, card, { ...card, id: 'paid', amountMinor: 0, rate: 30 }, cash]), { leastMinor: 28500, first: card })
  assert.deepEqual(payoff([{ ...car, rate: undefined }, { ...card, rate: undefined, minimumMinor: undefined }]), { leastMinor: 25000, first: null }, 'no rates, no order')
  assert.equal(readRate('24.99%'), 24.99)
  assert.equal(readRate(' 6.5 '), 6.5)
  assert.equal(readRate(''), 0)
  for (const bad of ['abc', '-2', '101', '6.5.1']) assert.equal(readRate(bad), null, bad)
})

test('what you have and owe survives opening the workspace and saves through the store; a rate stays on a debt', () => {
  const before = { ...createEmptyDoc(), schema: 18 }
  const after = { ...before, budget: { ...before.budget, balances: [cash, car] } }
  const { doc } = applyOps(before, validateOps(diffDocs(before, after)))
  assert.deepEqual(normalizeWorkspace(doc).budget.balances, [cash, car])
  const kept = normalizeWorkspace({ budget: { balances: [
    { ...cash, rate: 3, minimumMinor: 100 }, { ...car, rate: 140, minimumMinor: -5 }, { ...cash, label: '  ' }, { ...cash, amountMinor: -100 }, { ...cash, amountMinor: 1.5 }, 'x',
  ] } }).budget.balances
  assert.deepEqual(kept, [cash, { id: 'balance-2', label: 'Car loan', owe: true, amountMinor: 900000 }], 'no label, below zero or not whole cents goes; a rate only on a debt, 0–100')
  assert.equal('balances' in normalizeWorkspace({ budget: { balances: [] } }).budget, false)
})

test('an entry moves to another category by hand; a blank name changes nothing', () => {
  const state = { budget: { transactions: [entry(-450, 'Shopping', '2026-10-01', 'a')] } }
  assert.equal(recategorize(state, 'a', 'Groceries').budget.transactions[0].category, 'Groceries')
  assert.equal(recategorize(state, 'a', '  '), state)
})

const charge = (label, amountMinor, date, category = 'Entertainment') => ({ id: `${label}-${date}`, label, amountMinor, category, date })

test('bills: the same charge each month or week is found, with when it’s next due; one-offs and stopped ones aren’t', async () => {
  const { bills, billKey, billsPerMonth, daysUntil } = await import('../src/money/money-model.js')
  const today = '2026-10-22'
  const entries = [
    charge('NETFLIX.COM 866-579', -1549, '2026-08-05'), charge('Netflix.com 866-579', -1549, '2026-09-05'), charge('NETFLIX.COM #12', -1549, '2026-10-05'),
    charge('Verizon', -8512, '2026-08-20', 'Bills & utilities'), charge('Verizon', -9230, '2026-09-20', 'Bills & utilities'), charge('Verizon', -8811, '2026-10-20', 'Bills & utilities'),
    charge('Gym', -2500, '2026-10-01'), charge('Gym', -2500, '2026-10-08'), charge('Gym', -2500, '2026-10-15'),
    charge('Blue Bottle', -450, '2026-09-21', 'Food & drink'), charge('Blue Bottle', -1220, '2026-10-21', 'Food & drink'),
    charge('Old Streaming', -999, '2026-05-01'), charge('Old Streaming', -999, '2026-06-01'), charge('Old Streaming', -999, '2026-07-01'),
    charge('Card payment', -50000, '2026-09-10', 'Transfers'), charge('Card payment', -50000, '2026-10-10', 'Transfers'),
    charge('Target', -3200, '2026-10-07', 'Shopping'),
  ]
  const found = bills(entries, today, { plans: [{ id: 'recurring-1', label: 'Rent', amountMinor: -180000, cadence: 'monthly', date: '2026-01-01', category: 'Bills & utilities' }] })
  assert.deepEqual(found.map((bill) => [bill.label, bill.cadence, bill.next, bill.from]), [
    ['Gym', 'weekly', '2026-10-22', 'bank'],
    ['Rent', 'monthly', '2026-11-01', 'plan'],
    ['NETFLIX.COM #12', 'monthly', '2026-11-05', 'bank'],
    ['Verizon', 'monthly', '2026-11-20', 'bank'],
  ])
  assert.equal(billKey('NETFLIX.COM 866-579'), 'netflix com')
  assert.deepEqual(bills(entries, today, { ignore: ['gym'] }).map((bill) => bill.label), ['NETFLIX.COM #12', 'Verizon'])
  assert.equal(billsPerMonth([{ amountMinor: 1200, cadence: 'monthly' }, { amountMinor: 1200, cadence: 'yearly' }, { amountMinor: 1000, cadence: 'weekly' }]), 1200 + 100 + 4333)
  assert.equal(daysUntil('2026-11-05', today), 14)
  assert.equal(daysUntil('2026-10-20', today), -2)
})

test('a month keeps its day, clamped to a short month', async () => {
  const { bills } = await import('../src/money/money-model.js')
  const found = bills([charge('Rent', -1000, '2026-11-30'), charge('Rent', -1000, '2026-12-31'), charge('Rent', -1000, '2027-01-31')], '2027-02-10')
  assert.equal(found[0].next, '2027-02-28')
})

test('“Not a bill” is remembered by key, can be taken back, and survives opening the workspace', async () => {
  const { setNotBill } = await import('../src/money/money-model.js')
  const state = { budget: { transactions: [], recurring: [] } }
  const off = setNotBill(state, 'gym', true)
  assert.deepEqual(off.budget.notBills, ['gym'])
  assert.deepEqual(setNotBill(off, 'gym', true).budget.notBills, ['gym'], 'never twice')
  assert.deepEqual(setNotBill(off, 'gym', false).budget.notBills, [])
  assert.deepEqual(normalizeWorkspace({ budget: { notBills: ['gym', '', 7, 'x'.repeat(81)] } }).budget.notBills, ['gym'])
})
