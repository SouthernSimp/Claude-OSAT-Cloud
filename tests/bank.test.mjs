import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { accountRow, bankOps, CATEGORIES, categoryName, finishedLink, fromPlaid } from '../shared/bank-model.mjs'
import { normalizeWorkspace } from '../src/osat-data.js'
import { applyOps, createEmptyDoc, validateOps } from '../shared/store-core.mjs'

const require = createRequire(import.meta.url)
const { createBank, HOSTS } = require('../desktop/bank.cjs')
const sharedModule = (name) => import(`../shared/${name}`)

const coffee = { transaction_id: 'tx1', amount: 4.5, date: '2026-10-20', merchant_name: 'Blue Bottle', name: 'BLUE BOTTLE #12', personal_finance_category: { primary: 'FOOD_AND_DRINK' }, pending: false }
const pay = { transaction_id: 'tx2', amount: -2500, date: '2026-10-15', name: 'Payroll', personal_finance_category: { primary: 'INCOME' }, pending: false }

test('a Plaid transaction is a Money entry: out is negative, in minor units, with the bank and a readable category', () => {
  assert.deepEqual(fromPlaid(coffee, 'Chase'), { id: 'plaid-tx1', label: 'Blue Bottle', amountMinor: -450, category: 'Food & drink', date: '2026-10-20', bank: 'Chase' })
  assert.equal(fromPlaid(pay, 'Chase').amountMinor, 250000)
  assert.equal(fromPlaid({ ...coffee, pending: true }, 'Chase'), null, 'a pending charge waits until it posts')
  assert.equal(fromPlaid({ ...coffee, amount: NaN }), null)
  assert.equal(fromPlaid({ ...coffee, date: 'soon' }), null)
  assert.equal(categoryName(undefined), 'Miscellaneous')
  assert.equal(categoryName({ primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' }), 'Groceries')
  assert.equal(categoryName({ primary: 'TRANSPORTATION', detailed: 'TRANSPORTATION_GAS' }), 'Gas')
  assert.equal(categoryName({ primary: 'MEDICAL', detailed: 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS' }), 'Health & wellness')
  assert.equal(categoryName({ primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' }), 'Transfers', 'paying a card off is not spending')
  assert.equal(categoryName({ primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER' }), 'Transfers')
  assert.equal(categoryName({ primary: 'RENT_AND_UTILITIES' }), 'Bills & utilities')
  assert.ok(CATEGORIES.includes('Shopping') && CATEGORIES.includes('Miscellaneous'))
})

test('syncing twice never adds twice; a bank change keeps Nate’s own category; a removed one goes', () => {
  let doc = createEmptyDoc()
  const commit = (ops) => { doc = applyOps(doc, validateOps(ops)).doc }
  commit(bankOps(doc.budget.transactions, { added: [coffee, pay] }, 'Chase'))
  commit(bankOps(doc.budget.transactions, { added: [coffee] }, 'Chase'))
  assert.equal(doc.budget.transactions.length, 2)
  doc = { ...doc, budget: { ...doc.budget, transactions: doc.budget.transactions.map((entry) => (entry.id === 'plaid-tx1' ? { ...entry, category: 'Treats' } : entry)) } }
  commit(bankOps(doc.budget.transactions, { modified: [{ ...coffee, amount: 5 }] }, 'Chase'))
  const changed = doc.budget.transactions.find((entry) => entry.id === 'plaid-tx1')
  assert.equal(changed.amountMinor, -500)
  assert.equal(changed.category, 'Treats')
  commit(bankOps(doc.budget.transactions, { removed: [{ transaction_id: 'tx2' }, { transaction_id: 'never-here' }] }, 'Chase'))
  assert.deepEqual(doc.budget.transactions.map((entry) => entry.id), ['plaid-tx1'])
  assert.equal(normalizeWorkspace(doc).budget.transactions[0].bank, 'Chase', 'the bank survives opening the workspace')
})

test('an account shows its name, last four and balance, and no more', () => {
  assert.deepEqual(accountRow({ account_id: 'a1', name: 'Total Checking', mask: '3523', type: 'depository', subtype: 'checking', balances: { available: 82.35, current: 90 } }), { id: 'a1', name: 'Total Checking', mask: '3523', type: 'checking', kind: 'depository', balanceMinor: 8235 })
  assert.equal(accountRow({ type: 'credit', balances: { available: 4500, current: 512.4 } }).balanceMinor, 51240, 'a card shows what is owed, not the credit left')
  assert.equal(accountRow({ balances: {} }).balanceMinor, null)
  assert.deepEqual(finishedLink({ link_sessions: [{ results: { item_add_results: [{ public_token: 'public-1', institution: { name: 'Chase' } }] } }] }), { publicToken: 'public-1', bank: 'Chase' })
  assert.equal(finishedLink({ link_sessions: [{ results: {} }] }), null)
})

/* A pretend Plaid: production refuses the keys (they are Sandbox ones), the Sandbox takes them; a Hosted Link session
   finishes on the second look. */
function pretendPlaid({ sessionDoneAfter = 2, syncPages = null } = {}) {
  const seen = { calls: [], opened: [], removed: [] }
  let looks = 0
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const pages = syncPages || [
    { added: [coffee], modified: [], removed: [], next_cursor: 'c1', has_more: true, accounts: [] },
    { added: [pay], modified: [], removed: [], next_cursor: 'c2', has_more: false, accounts: [{ account_id: 'a1', name: 'Total Checking', mask: '3523', balances: { available: 82.35 } }] },
  ]
  const fetch = async (url, init) => {
    const where = new URL(url)
    const body = JSON.parse(init.body)
    seen.calls.push({ host: where.origin, path: where.pathname, body })
    if (body.client_id !== 'clientid1234' || body.secret !== 'sandboxsecret99') return json({ error_code: 'INVALID_API_KEYS', error_message: 'invalid' }, 400)
    if (where.origin === HOSTS.production) return json({ error_code: 'INVALID_API_KEYS', error_message: 'wrong environment' }, 400)
    switch (where.pathname) {
      case '/institutions/get': return json({ institutions: [] })
      case '/link/token/create': return json({ link_token: 'link-1', hosted_link_url: 'https://hosted.plaid.com/link/abc' })
      case '/link/token/get':
        looks += 1
        return json({ link_sessions: looks >= sessionDoneAfter ? [{ results: { item_add_results: [{ public_token: 'public-1', institution: { name: 'Chase' } }] } }] : [{}] })
      case '/item/public_token/exchange': return json({ access_token: 'access-sandbox-1', item_id: 'item-1' })
      case '/transactions/sync': return json(body.cursor === 'c2' ? { added: [], modified: [], removed: [], next_cursor: 'c2', has_more: false, accounts: [] } : pages[body.cursor === 'c1' ? 1 : 0])
      case '/item/remove': seen.removed.push(body.access_token); return json({})
      default: return json({}, 404)
    }
  }
  return { fetch, seen, open: async (url) => { seen.opened.push(url) } }
}

class Plain extends Error {}
const fail = (message) => { throw new Plain(message) }
const memoryKeychain = () => { const held = new Map(); return { held, get: async (a) => held.get(a) ?? null, set: async (a, s) => { held.set(a, s) }, remove: async (a) => { held.delete(a) } } }
// The Hosted Link polling (pollMs 0) runs at once; the hourly look and the look a minute after a new bank never do here.
const instant = { setTimeout: (run, ms) => { if (!ms) queueMicrotask(run); return 0 }, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} }

async function setUp(plaid = pretendPlaid()) {
  let doc = createEmptyDoc()
  const handlers = new Map()
  const keychain = memoryKeychain()
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'osat-bank-'))
  const bank = await createBank({
    dataDir, keychain, fetch: plaid.fetch, open: plaid.open, sharedModule, fail, timers: instant, pollMs: 0,
    readDoc: () => doc, commitOps: (ops) => { doc = applyOps(doc, validateOps(ops)).doc },
    handle: (channel, run) => handlers.set(channel, run),
  })
  return { bank, plaid, keychain, dataDir, doc: () => doc, call: (channel, ...args) => handlers.get(channel)(...args) }
}

test('keys: tried on production, then the Sandbox; kept in the Keychain, never in a file', async () => {
  const { call, keychain, dataDir } = await setUp()
  await assert.rejects(call('bank:keys', 'clientid1234', 'wrongsecret00'), /didn’t take those keys/)
  await assert.rejects(call('bank:keys', 'id', 'x'), /Paste the Client ID/)
  const status = await call('bank:keys', ' clientid1234 ', 'sandboxsecret99')
  assert.equal(status.keys, true)
  assert.equal(status.env, 'sandbox')
  assert.equal(keychain.held.get('plaid-secret'), 'sandboxsecret99')
  const saved = await readFile(path.join(dataDir, 'bank.json'), 'utf8')
  assert.ok(!saved.includes('sandboxsecret99') && !saved.includes('clientid1234'), saved)
})

test('Connect a bank: Plaid’s page in the browser, then its transactions and accounts come into Money', async () => {
  const { call, plaid, keychain, doc, dataDir } = await setUp()
  await call('bank:keys', 'clientid1234', 'sandboxsecret99')
  const status = await call('bank:connect')
  assert.deepEqual(plaid.seen.opened, ['https://hosted.plaid.com/link/abc'])
  const made = plaid.seen.calls.find((item) => item.path === '/link/token/create').body
  assert.deepEqual(made.products, ['transactions'])
  assert.deepEqual(made.hosted_link, {})
  assert.equal(status.linking, false)
  assert.equal(status.items[0].bank, 'Chase')
  assert.deepEqual(status.items[0].accounts, [{ id: 'a1', name: 'Total Checking', mask: '3523', type: '', kind: '', balanceMinor: 8235 }])
  assert.deepEqual(doc().budget.transactions.map((entry) => entry.id).sort(), ['plaid-tx1', 'plaid-tx2'])
  assert.equal(status.last.added, 2)
  assert.equal([...keychain.held.values()].includes('access-sandbox-1'), true)
  const saved = JSON.parse(await readFile(path.join(dataDir, 'bank.json'), 'utf8'))
  assert.equal(saved.items[0].cursor, 'c2')
  assert.ok(!JSON.stringify(saved).includes('access-sandbox-1'), 'the bank’s token is never in a file')
  // The next look starts from the cursor and adds nothing twice.
  await call('bank:sync')
  assert.equal(doc().budget.transactions.length, 2)
  assert.equal(plaid.seen.calls.filter((item) => item.path === '/transactions/sync').at(-1).body.cursor, 'c2')
})

test('Disconnect: Plaid forgets the bank, the token leaves the Keychain, its entries stay', async () => {
  const { call, plaid, keychain, doc } = await setUp()
  await call('bank:keys', 'clientid1234', 'sandboxsecret99')
  await call('bank:connect')
  await assert.rejects(call('bank:forget-keys'), /Disconnect your banks first/)
  const status = await call('bank:disconnect', 'item-1')
  assert.deepEqual(status.items, [])
  assert.deepEqual(plaid.seen.removed, ['access-sandbox-1'])
  assert.ok(![...keychain.held.values()].includes('access-sandbox-1'))
  assert.equal(doc().budget.transactions.length, 2)
  assert.equal((await call('bank:forget-keys')).keys, false)
  assert.equal(keychain.held.size, 0)
})

test('a bank that wants a new sign-in says so on its own row; offline says the bank waits', async () => {
  const plaid = pretendPlaid()
  const { call, keychain } = await setUp(plaid)
  await call('bank:keys', 'clientid1234', 'sandboxsecret99')
  await call('bank:connect')
  for (const key of [...keychain.held.keys()].filter((name) => name.startsWith('plaid-item-'))) keychain.held.delete(key)
  const status = await call('bank:sync')
  assert.match(status.items[0].problem, /sign in again/)

  const away = pretendPlaid()
  const offline = await setUp({ ...away, fetch: async (url, init) => { if (String(url).endsWith('/link/token/create')) throw Object.assign(new Error('offline'), { code: 'OFFLINE' }); return away.fetch(url, init) } })
  await offline.call('bank:keys', 'clientid1234', 'sandboxsecret99')
  await assert.rejects(offline.call('bank:connect'), /waits until you’re back online/)
})
