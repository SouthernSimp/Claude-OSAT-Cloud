/* Banks in Money (Phase 85): what Plaid's /transactions/sync sends, as Money's own ledger entries. Plaid counts money
   out as positive; the ledger counts it as negative, in minor units. A pending charge is left out: Plaid sends it again,
   with a new id, once it posts. An entry from a bank keeps its id (`plaid-<transaction_id>`), so syncing twice never
   adds it twice, and Nate's own category on it is kept when the bank changes the entry. */

export const PREFIX = 'plaid-'

/* FOOD_AND_DRINK → "Food and drink". */
export function categoryName(code) {
  const words = String(code || '').toLowerCase().replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'General'
}

export function fromPlaid(t, bank) {
  if (!t?.transaction_id || t.pending || !Number.isFinite(t.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) return null
  return {
    id: PREFIX + t.transaction_id,
    label: String(t.merchant_name || t.name || 'Bank entry').slice(0, 120),
    amountMinor: -Math.round(t.amount * 100),
    category: categoryName(t.personal_finance_category?.primary),
    date: t.date,
    bank: String(bank || 'Bank').slice(0, 60),
  }
}

/* Store ops for one page of /transactions/sync, against the ledger as it is now. */
export function bankOps(transactions, { added = [], modified = [], removed = [] }, bank) {
  const have = new Map((transactions || []).map((entry) => [entry.id, entry]))
  const ops = []
  for (const t of [...added, ...modified]) {
    const entry = fromPlaid(t, bank)
    if (!entry) continue
    const before = have.get(entry.id)
    if (!before) {
      ops.push({ t: 'add', c: 'budget.transactions', v: entry, at: 0 })
      have.set(entry.id, entry)
    } else {
      const { category, ...rest } = entry
      ops.push({ t: 'patch', c: 'budget.transactions', id: entry.id, v: rest })
    }
  }
  for (const gone of removed) {
    const id = PREFIX + gone?.transaction_id
    if (have.delete(id)) ops.push({ t: 'del', c: 'budget.transactions', id })
  }
  return ops
}

/* Where the month's money went: money out by category, largest first. */
export function spentByCategory(transactions, month) {
  const totals = new Map()
  for (const entry of transactions || []) {
    if (!String(entry.date).startsWith(month) || !(entry.amountMinor < 0)) continue
    totals.set(entry.category || 'General', (totals.get(entry.category || 'General') || 0) - entry.amountMinor)
  }
  return [...totals].map(([category, spentMinor]) => ({ category, spentMinor })).sort((a, b) => b.spentMinor - a.spentMinor)
}

/* An account from Plaid, as Money shows it: no numbers beyond the last four. */
export function accountRow(a) {
  const balance = a?.balances?.available ?? a?.balances?.current
  return {
    id: String(a?.account_id || ''),
    name: String(a?.name || 'Account').slice(0, 60),
    mask: String(a?.mask || '').slice(-4),
    type: String(a?.subtype || a?.type || ''),
    balanceMinor: Number.isFinite(balance) ? Math.round(balance * 100) : null,
  }
}

/* The public token from a finished Hosted Link session (/link/token/get), with the bank's name. */
export function finishedLink(response) {
  for (const session of response?.link_sessions || []) {
    for (const result of session.results?.item_add_results || []) {
      if (result.public_token) return { publicToken: result.public_token, bank: result.institution?.name || 'Bank' }
    }
    if (session.on_success?.public_token) return { publicToken: session.on_success.public_token, bank: session.on_success.metadata?.institution?.name || 'Bank' }
  }
  return null
}
