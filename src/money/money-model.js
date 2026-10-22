/* Money's numbers (Phase 87), pure: what came in and went out in a month, where it went by category (the donut and
   its table), six months of cash flow, each category against its budget, and what the banks hold. Transfers between
   your own accounts (and paying a card off) are neither: they would count the same dollar twice. Amounts are minor
   units (cents); an entry is { amountMinor, category, date: 'YYYY-MM-DD' }. */
import { TRANSFERS } from '../../shared/bank-model.mjs'

export const SLICES = 5 // the donut's own colours; the rest is "Everything else"
const counted = (entry) => entry && Number.isSafeInteger(entry.amountMinor) && entry.category !== TRANSFERS
const inMonth = (month) => (entry) => String(entry.date).startsWith(month)

/* { in, out, net } for a month. */
export function monthTotals(transactions, month) {
  let into = 0
  let out = 0
  for (const entry of (transactions || []).filter(inMonth(month))) {
    if (!counted(entry)) continue
    if (entry.amountMinor > 0) into += entry.amountMinor
    else out -= entry.amountMinor
  }
  return { in: into, out, net: into - out }
}

/* Spending by category: every category with money out this month, largest first, with its share (0–100, one
   decimal) and its budget when there is one. `slices` is the donut: the largest SLICES, then the rest as one. */
export function spending(transactions, month, limits = {}) {
  const totals = new Map()
  for (const entry of (transactions || []).filter(inMonth(month))) {
    if (!counted(entry) || entry.amountMinor >= 0) continue
    const name = entry.category || 'Miscellaneous'
    totals.set(name, (totals.get(name) || 0) - entry.amountMinor)
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0)
  const share = (value) => (total ? Math.round((value / total) * 1000) / 10 : 0)
  const rows = [...totals]
    .map(([category, spentMinor]) => ({ category, spentMinor, share: share(spentMinor), limitMinor: limits[category] || 0 }))
    .sort((a, b) => b.spentMinor - a.spentMinor || a.category.localeCompare(b.category))
  const rest = rows.slice(SLICES)
  const slices = [
    ...rows.slice(0, SLICES).map((row, index) => ({ category: row.category, spentMinor: row.spentMinor, share: row.share, slot: index + 1 })),
    ...(rest.length ? [{ category: 'Everything else', spentMinor: rest.reduce((sum, row) => sum + row.spentMinor, 0), share: share(rest.reduce((sum, row) => sum + row.spentMinor, 0)), slot: 0, rest: rest.map((row) => row.category) }] : []),
  ]
  return { total, rows, slices }
}

/* The donut's arcs: [{ ...slice, start, end }] in turns (0–1) from 12 o'clock, clockwise. */
export function arcs(slices) {
  const total = slices.reduce((sum, slice) => sum + slice.spentMinor, 0)
  let at = 0
  return slices.map((slice) => {
    const start = at
    at += total ? slice.spentMinor / total : 0
    return { ...slice, start, end: at }
  })
}

/* An SVG path for one ring segment, `gap` turns cut from each end so neighbours show the surface between them. */
export function ringPath({ start, end }, { size = 200, thickness = 28, gap = 0.004 } = {}) {
  const r = size / 2
  const inner = r - thickness
  const from = start + (end - start >= gap * 4 ? gap : 0)
  const to = end - (end - start >= gap * 4 ? gap : 0)
  // One category is the whole ring (drawn with fill-rule evenodd).
  if (end - start >= 0.9999) return `M ${r} 0 A ${r} ${r} 0 1 1 ${r} ${size} A ${r} ${r} 0 1 1 ${r} 0 Z M ${r} ${thickness} A ${inner} ${inner} 0 1 0 ${r} ${size - thickness} A ${inner} ${inner} 0 1 0 ${r} ${thickness} Z`
  const point = (radius, turn) => {
    const angle = turn * 2 * Math.PI - Math.PI / 2
    return `${(r + radius * Math.cos(angle)).toFixed(2)} ${(r + radius * Math.sin(angle)).toFixed(2)}`
  }
  const large = to - from > 0.5 ? 1 : 0
  return `M ${point(r, from)} A ${r} ${r} 0 ${large} 1 ${point(r, to)} L ${point(inner, to)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, from)} Z`
}

/* The last `count` months up to `month`, oldest first: [{ month, in, out }]. */
export function cashFlow(transactions, month, count = 6) {
  const [year, number] = month.split('-').map(Number)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, number - 1 - (count - 1 - index), 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const { in: into, out } = monthTotals(transactions, key)
    return { month: key, in: into, out }
  })
}

/* What the banks hold: cash in checking and savings, and what is owed on cards and loans. null when no bank. */
export function holdings(items) {
  const accounts = (items || []).flatMap((item) => item.accounts || []).filter((account) => Number.isSafeInteger(account.balanceMinor))
  if (!accounts.length) return null
  const sum = (kinds) => accounts.filter((account) => kinds.includes(account.kind)).reduce((total, account) => total + account.balanceMinor, 0)
  return { cash: sum(['depository', '']), owed: sum(['credit', 'loan']) }
}

/* A budget typed in Money: "300", "$1,250.50"; null for anything else, 0 to take it off. */
export function readLimit(text) {
  const value = String(text ?? '').trim().replace(/[$,\s]/g, '')
  if (value === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null
  const minor = Math.round(Number(value) * 100)
  return Number.isSafeInteger(minor) ? minor : null
}

/* The workspace with one category's budget set (or taken off at 0). */
export function setLimit(state, category, minor) {
  const limits = { ...(state.budget.limits || {}) }
  if (minor > 0) limits[category] = minor
  else delete limits[category]
  return { ...state, budget: { ...state.budget, limits } }
}

/* One entry moved to another category, by hand. */
export function recategorize(state, id, category) {
  const name = String(category || '').trim().slice(0, 60)
  if (!name) return state
  return { ...state, budget: { ...state.budget, transactions: state.budget.transactions.map((entry) => (entry.id === id ? { ...entry, category: name } : entry)) } }
}

/* Bills and subscriptions (Phase 88): the same merchant charging about the same amount every week, month or year,
   found in the entries; plus the plans kept by hand. Each with when it's next due, soonest first. A charge that
   stopped (none for half a cadence past when it was due) isn't listed; one Nate said isn't a bill (`ignore`, by key)
   neither. Amounts of a bill may wander a little (a phone bill); two charges only count when they match closely. */
const DAY = 86400000
const dayOf = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY)
const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10)
const middle = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
const CADENCES = [['weekly', 6, 8, 3], ['monthly', 25, 35, 2], ['yearly', 355, 375, 2]]
const PER_MONTH = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 }

/* "NETFLIX.COM 866-579", "Netflix.com #123" → "netflix com". */
export const billKey = (label) => String(label || '').toLowerCase().replace(/[#*]?\d[\d\-/.]*/g, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim()

/* The next date on or after `from` for a cadence, counted from `last` (a month keeps its day, clamped to the month). */
function nextDue(last, cadence, from) {
  let at = last
  for (let step = 1; step < 600; step += 1) {
    if (cadence === 'weekly') at = isoOf(dayOf(last) + 7 * step)
    else {
      const [year, month, day] = last.split('-').map(Number)
      const months = cadence === 'yearly' ? 12 * step : step
      const first = new Date(Date.UTC(year, month - 1 + months, 1))
      const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
      at = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, length)).padStart(2, '0')}`
    }
    if (at >= from) return at
  }
  return at
}

export function bills(transactions, today, { ignore = [], plans = [] } = {}) {
  const skip = new Set(ignore)
  const groups = new Map()
  for (const entry of transactions || []) {
    if (!counted(entry) || entry.amountMinor >= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || dayOf(today) - dayOf(entry.date) > 400) continue
    const key = billKey(entry.label)
    if (!key || skip.has(key)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  const found = []
  for (const [key, entries] of groups) {
    const byDay = [...new Map(entries.map((entry) => [entry.date, entry])).values()].sort((a, b) => a.date.localeCompare(b.date))
    if (byDay.length < 2) continue
    const gaps = byDay.slice(1).map((entry, index) => dayOf(entry.date) - dayOf(byDay[index].date))
    const gap = middle(gaps)
    const cadence = CADENCES.find(([, low, high, least]) => gap >= low && gap <= high && byDay.length >= least)?.[0]
    if (!cadence) continue
    const amounts = byDay.map((entry) => -entry.amountMinor)
    const usual = middle(amounts)
    const room = byDay.length === 2 ? 0.05 : 0.25
    if (amounts.some((amount) => Math.abs(amount - usual) > usual * room)) continue
    const last = byDay.at(-1)
    if (dayOf(today) - dayOf(last.date) > gap * 1.5 + 5) continue
    found.push({ key, label: last.label, amountMinor: -last.amountMinor, cadence, last: last.date, next: nextDue(last.date, cadence, isoOf(dayOf(today) - 3)), category: last.category, from: 'bank' })
  }
  for (const plan of plans || []) {
    if (!PER_MONTH[plan?.cadence] || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date) || !Number.isSafeInteger(plan.amountMinor)) continue
    found.push({ key: `plan:${plan.id}`, id: plan.id, label: plan.label, amountMinor: Math.abs(plan.amountMinor), cadence: plan.cadence, last: plan.date, next: plan.date >= today ? plan.date : nextDue(plan.date, plan.cadence, today), category: plan.category, from: 'plan' })
  }
  return found.sort((a, b) => a.next.localeCompare(b.next) || b.amountMinor - a.amountMinor)
}

/* About how much the bills come to in a month. */
export const billsPerMonth = (list) => Math.round(list.reduce((sum, bill) => sum + bill.amountMinor * PER_MONTH[bill.cadence], 0))

/* Days from today to a bill's date: 0 today, negative when it's late. */
export const daysUntil = (iso, today) => dayOf(iso) - dayOf(today)

/* A charge Nate says isn't a bill (by its key), or is one again. */
export function setNotBill(state, key, on) {
  const list = (state.budget.notBills || []).filter((item) => item !== key)
  return { ...state, budget: { ...state.budget, notBills: on ? [...list, key] : list } }
}
