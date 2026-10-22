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
