/* Banks in Money (Phase 85): what Plaid's /transactions/sync sends, as Money's own ledger entries. Plaid counts money
   out as positive; the ledger counts it as negative, in minor units. A pending charge is left out: Plaid sends it again,
   with a new id, once it posts. An entry from a bank keeps its id (`plaid-<transaction_id>`), so syncing twice never
   adds it twice, and Nate's own category on it is kept when the bank changes the entry. */

export const PREFIX = 'plaid-'

/* Plaid's categories (personal_finance_category: primary, detailed) as the ones people know from their bank's own app.
   Moving money between your own accounts, and paying a card off, is "Transfers": never spending, never income. */
export const TRANSFERS = 'Transfers'
const DETAILED = {
  FOOD_AND_DRINK_GROCERIES: 'Groceries',
  TRANSPORTATION_GAS: 'Gas',
  TRANSPORTATION_PARKING: 'Automotive',
  TRANSPORTATION_TOLLS: 'Automotive',
  GENERAL_SERVICES_AUTOMOTIVE: 'Automotive',
  GENERAL_SERVICES_EDUCATION: 'Education',
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: 'Health & wellness',
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: 'Gifts & donations',
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: 'Gifts & donations',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: TRANSFERS,
}
const PRIMARY = {
  INCOME: 'Income',
  TRANSFER_IN: TRANSFERS,
  TRANSFER_OUT: TRANSFERS,
  LOAN_PAYMENTS: 'Loan payments',
  BANK_FEES: 'Fees',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Food & drink',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Home',
  MEDICAL: 'Health & wellness',
  PERSONAL_CARE: 'Personal',
  GENERAL_SERVICES: 'Professional services',
  GOVERNMENT_AND_NON_PROFIT: 'Taxes & government',
  TRANSPORTATION: 'Travel',
  TRAVEL: 'Travel',
  RENT_AND_UTILITIES: 'Bills & utilities',
}
// Every name a bank entry can have, for picking a category by hand.
export const CATEGORIES = [...new Set([...Object.values(PRIMARY), ...Object.values(DETAILED), 'Miscellaneous'])].sort((a, b) => a.localeCompare(b))

export function categoryName(pfc) {
  return DETAILED[pfc?.detailed] || PRIMARY[pfc?.primary] || 'Miscellaneous'
}

export function fromPlaid(t, bank) {
  if (!t?.transaction_id || t.pending || !Number.isFinite(t.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) return null
  return {
    id: PREFIX + t.transaction_id,
    label: String(t.merchant_name || t.name || 'Bank entry').slice(0, 120),
    amountMinor: -Math.round(t.amount * 100),
    category: categoryName(t.personal_finance_category),
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


/* An account from Plaid, as Money shows it: no numbers beyond the last four. */
export function accountRow(a) {
  // A card or a loan: what is owed (current); checking and savings: what can be spent (available).
  const owed = a?.type === 'credit' || a?.type === 'loan'
  const balance = owed ? a?.balances?.current : a?.balances?.available ?? a?.balances?.current
  return {
    id: String(a?.account_id || ''),
    name: String(a?.name || 'Account').slice(0, 60),
    mask: String(a?.mask || '').slice(-4),
    type: String(a?.subtype || a?.type || ''),
    // depository (cash), credit (owed), loan, investment: what the total in Money adds up.
    kind: String(a?.type || ''),
    balanceMinor: Number.isFinite(balance) ? Math.round(balance * 100) : null,
  }
}

/* The accounts after one page of /transactions/sync (Phase 100). Plaid lists only the accounts with entries in that
   page ("Only accounts that have associated transactions will be shown"), so a quiet hour would drop savings and
   cards: each account listed is brought up to date, the others are kept, and the order stays as it was. */
export function mergeAccounts(kept, listed) {
  const rows = new Map((kept || []).map((row) => [row.id, row]))
  for (const row of (Array.isArray(listed) ? listed : []).map(accountRow)) rows.set(row.id, row)
  return [...rows.values()]
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
