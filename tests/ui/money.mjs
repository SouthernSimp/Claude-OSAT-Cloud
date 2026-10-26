// Money (Phase 87) in the built preview, seeded with a few months of entries and a stand-in for the Mac app's Plaid
// bridge: the keys form (the Secret hidden), Connect a bank bringing Chase's accounts and the cash total, Spending by
// category (table and donut, transfers left out), picking a category narrowing the list, Set a budget, moving an
// entry to another category with Undo, Find, Cash flow's six months with a hover; light and dark. What you have and
// owe (Phase 100): the welcome's two questions, net worth below zero, the payoff line, a row changed, Esc, the trash
// with Undo, and the banks' totals first once Chase is in. Fails on page errors or a step that didn't happen;
// screenshots land in test-results/ui/money/. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { openRoom as openPlace } from './window.mjs'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/money`
const PORT = Number(process.env.OSAT_PORT || 4352)
const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
const now = new Date()
const MONTH = key(now)
const LAST = key(new Date(now.getFullYear(), now.getMonth() - 1, 1))
const day = (month, d) => `${month}-${String(d).padStart(2, '0')}`
const ENTRIES = [
  ['p1', 'CVS Pharmacy', -28100, 'Health & wellness', day(MONTH, 2), 'Chase'],
  ['p2', 'Blue Bottle', -450, 'Food & drink', day(MONTH, 3), 'Chase'],
  ['p3', 'Taqueria', -4050, 'Food & drink', day(MONTH, 4), 'Chase'],
  ['p4', 'Shell', -2650, 'Gas', day(MONTH, 5), 'Chase'],
  ['p5', 'Payroll', 250000, 'Income', day(MONTH, 1), 'Chase'],
  ['p6', 'Card payment', -50000, 'Transfers', day(MONTH, 6), 'Chase'],
  ['p7', 'Target', -3200, 'Shopping', day(MONTH, 7), 'Chase'],
  ['h1', 'Haircut', -3000, 'Personal', day(MONTH, 8), ''],
  ['l1', 'Payroll', 250000, 'Income', day(LAST, 1), 'Chase'],
  ['l2', 'Rent', -180000, 'Bills & utilities', day(LAST, 2), 'Chase'],
].map(([id, label, amountMinor, category, date, bank]) => ({ id: id.startsWith('h') ? `transaction-${id}` : `plaid-${id}`, label, amountMinor, category, date, ...(bank ? { bank } : {}) }))

let server
async function start() {
  if (process.env.OSAT_URL) return process.env.OSAT_URL
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
  const url = `http://127.0.0.1:${PORT}/`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(url)).ok) return url } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('The preview server did not start. Did you run npm run build?')
}

const problems = []
const check = (ok, what) => { if (!ok) problems.push(what) }

/* The Mac app's bridge, pretend: keys are taken, Connect a bank "signs in" at once and brings Chase's accounts. */
function fakeBank() {
  window.__bank = { keys: [], disconnected: [] }
  let state = { keys: false, env: '', busy: false, linking: false, problem: '', last: null, items: [] }
  const listeners = new Set()
  window.osatBank = {
    status: async () => state,
    setKeys: async (id, secret) => { window.__bank.keys.push([id, secret.length]); state = { ...state, keys: true, env: 'sandbox' }; return state },
    forgetKeys: async () => { state = { ...state, keys: false, env: '' }; return state },
    connect: async () => {
      state = { ...state, last: { at: Date.now(), added: 2 }, items: [{ id: 'item-1', bank: 'Chase', problem: '', at: Date.now(), accounts: [
        { id: 'a1', name: 'Total Checking', mask: '3523', type: 'checking', kind: 'depository', balanceMinor: 8235 },
        { id: 'a2', name: 'Savings', mask: '4068', type: 'savings', kind: 'depository', balanceMinor: 150001 },
        { id: 'a3', name: 'Freedom', mask: '9911', type: 'credit card', kind: 'credit', balanceMinor: 51240 },
      ] }] }
      for (const listener of listeners) listener(state)
      return state
    },
    cancel: async () => state,
    sync: async () => state,
    disconnect: async (id) => { window.__bank.disconnected.push(id); state = { ...state, items: [] }; return state },
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
}

const readDoc = (page) => page.evaluate(async () => {
  await new Promise((resolve) => setTimeout(resolve, 600))
  const db = await new Promise((resolve) => { const request = indexedDB.open('osat-preview', 1); request.onsuccess = () => resolve(request.result) })
  return new Promise((resolve) => { const request = db.transaction('workspace').objectStore('workspace').get('doc'); request.onsuccess = () => resolve(request.result) })
})

async function openRoom(browser, url, theme, entries = ENTRIES, recurring = []) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: theme })
  page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`))
  await page.addInitScript(fakeBank)
  await page.addInitScript(() => { for (const name of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(name, 'seen') })
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async ({ transactions, recurring }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 17, rev: 0, theme: 'system', notes: [], folders: [], habits: [], goals: [], canvases: [], reflections: [], focus: { status: 'idle' }, projects: [], sorter: null, calendar: { events: [] }, budget: { currency: 'USD', transactions, recurring }, settings: { autoFile: { on: false }, seeded: { direction: true } }, chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { transactions: entries, recurring })
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await openPlace(page, 'Money')
  await page.locator('.money-banks').waitFor({ timeout: 5000 })
  await sleep(400)
  return page
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  for (const theme of ['light', 'dark']) {
    const page = await openRoom(browser, url, theme)
    const banks = page.locator('.money-banks')
    check(await banks.getByRole('heading', { name: 'Connect your bank' }).count() === 1, `${theme}: no keys didn’t ask for them`)
    check(await banks.getByLabel('Plaid Secret').getAttribute('type') === 'password', `${theme}: the Secret wasn’t hidden`)
    check(await banks.getByRole('button', { name: 'Save keys' }).isDisabled(), `${theme}: Save keys was on with nothing typed`)
    await banks.getByLabel('Plaid Client ID').fill('6ada7df26456c1000da79c50')
    await banks.getByLabel('Plaid Secret').fill('pretend-secret-123')
    await banks.getByRole('button', { name: 'Save keys' }).click()
    await banks.getByRole('button', { name: 'Connect a bank' }).click()
    await banks.locator('.money-bank', { hasText: 'Chase' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: Chase didn’t show`))
    check((await banks.locator('.money-bank').innerText()).includes('Total Checking ••3523'), `${theme}: the account and its last four didn’t show`)
    const hero = await banks.locator('.money-balance').innerText()
    check(hero.includes('In your banks') && hero.includes('$1,582.36') && hero.includes('$512.40 owed'), `${theme}: the hero didn’t add up the banks: ${hero}`)
    // What you have and owe starts from the banks' two totals: $1,582.36 less $512.40.
    const worth = page.getByRole('region', { name: 'What you have and owe' })
    check((await worth.locator('li').allInnerTexts()).join(' | ').replace(/\s+/g, ' ') === 'In your banks $1,582.36 | Cards and loans at your banks $512.40', `${theme}: what you have and owe didn’t start from the banks`)
    check((await worth.locator('.money-balance').innerText()).includes('$1,069.96'), `${theme}: the net worth wasn’t the banks’ cash less what’s owed`)

    // Spending by category: transfers left out, largest first, five colours at most; the donut beside it.
    const card = page.getByRole('region', { name: 'Spending by category' })
    const rows = await card.locator('tbody th').allInnerTexts()
    check(JSON.stringify(rows) === '["Health & wellness","Food & drink","Shopping","Personal","Gas"]', `${theme}: the categories weren’t largest first without transfers: ${JSON.stringify(rows)}`)
    check((await card.locator('tbody tr').first().innerText()).includes('68%'), `${theme}: Health & wellness wasn’t 68%`)
    check(await card.locator('.money-donut path').count() === 5, `${theme}: the donut didn’t have five slices`)
    check((await card.locator('figcaption').innerText()).includes('$414.50'), `${theme}: the donut’s total was wrong`)
    check((await page.locator('.money-overview').innerText()).includes('$414.50'), `${theme}: Money out counted a transfer`)
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/${theme}-money.png`, fullPage: true })
    if (theme === 'dark') { await page.close(); continue }

    // A slice on hover says what it is.
    await card.locator('.money-donut path').nth(1).hover()
    check((await card.locator('figcaption').innerText()).includes('Food & drink'), 'hovering a slice didn’t name it')

    // Picking a category narrows the list.
    await card.getByRole('button', { name: 'Food & drink' }).click()
    check(await page.locator('.money-row').count() === 2, 'Food & drink didn’t narrow the list to its two entries')
    check(await page.getByText('Showing Food & drink').count() === 1, 'the list didn’t say what it shows')
    await page.locator('.money-only').getByRole('button', { name: 'Show everything' }).click()
    check(await page.locator('.money-row').count() === 8, 'Show everything didn’t bring every entry back')

    // A budget, written in the row.
    await card.locator('tbody tr', { hasText: 'Food & drink' }).getByRole('button', { name: 'Set a budget' }).click()
    await card.getByLabel('Monthly budget for Food & drink').fill('300')
    await card.getByLabel('Monthly budget for Food & drink').press('Enter')
    await card.locator('.money-limit', { hasText: '$255.00 left' }).waitFor({ timeout: 3000 }).catch(() => problems.push('the budget didn’t say what was left'))
    check(JSON.stringify((await readDoc(page)).budget.limits) === '{"Food & drink":30000}', 'the budget wasn’t saved')
    await page.screenshot({ path: `${OUT}/budget.png`, fullPage: true })

    // An entry moved to another category, with Undo.
    await page.getByLabel('Category of Target').selectOption('Groceries')
    check((await readDoc(page)).budget.transactions.find((entry) => entry.label === 'Target').category === 'Groceries', 'the new category wasn’t saved')
    await page.locator('.toast button', { hasText: 'Undo' }).click()
    check((await readDoc(page)).budget.transactions.find((entry) => entry.label === 'Target').category === 'Shopping', 'Undo didn’t put the category back')

    await page.getByRole('region', { name: 'Transactions' }).screenshot({ path: `${OUT}/transactions.png` })
    check(await page.getByRole('region', { name: 'Transactions' }).locator('.money-day h3').count() >= 6, 'the entries weren’t grouped by day')

    // The month stepper: back a month shows September's two entries, forward again comes back; never past this month.
    check(await page.getByRole('button', { name: 'Next month' }).isDisabled(), 'Next month went past this month')
    await page.getByRole('button', { name: 'Previous month' }).click()
    check(await page.locator('.money-row').count() === 2, 'Previous month didn’t show last month’s entries')
    await page.getByRole('button', { name: 'Next month' }).click()
    check(await page.locator('.money-row').count() === 8, 'Next month didn’t come back')

    // Find.
    await page.getByLabel('Find an entry').fill('blue')
    check(await page.locator('.money-row').count() === 1, 'Find didn’t narrow the list')
    await page.getByLabel('Find an entry').fill('')

    // Cash flow: six months; hovering one says its numbers.
    const flow = page.getByRole('region', { name: 'Cash flow' })
    check(await flow.locator('.money-flow-month').count() === 6, 'Cash flow didn’t show six months')
    await flow.locator('.money-flow-month').nth(4).hover()
    const tip = await flow.locator('.money-tip').innerText().catch(() => '')
    check(tip.includes('$2,500.00') && tip.includes('$1,800.00'), `the hover didn’t show last month’s numbers: ${tip}`)
    await page.screenshot({ path: `${OUT}/cash-flow.png`, fullPage: true })

    // Disconnect asks first.
    await banks.getByRole('button', { name: 'Disconnect' }).click()
    check(await banks.getByText('Disconnect Chase? What it brought stays.').count() === 1, 'Disconnect didn’t ask first')
    await banks.getByRole('button', { name: 'Keep' }).click()
    check(await banks.locator('.money-bank').count() === 1, 'Keep disconnected the bank')
    await page.close()
  }

  // Bills & subscriptions: Netflix each month and the gym each week are found, the rent plan joins them, soonest first;
  // Not a bill puts one away with Undo; Today names the bill due this week.
  const iso = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return `${key(date)}-${String(date.getDate()).padStart(2, '0')}` }
  const repeats = [
    ...[-62, -32, -2].map((days, index) => ({ id: `plaid-n${index}`, label: 'NETFLIX.COM', amountMinor: -1549, category: 'Entertainment', date: iso(days), bank: 'Chase' })),
    ...[-15, -8, -1].map((days, index) => ({ id: `plaid-g${index}`, label: 'Gym', amountMinor: -2500, category: 'Health & wellness', date: iso(days), bank: 'Chase' })),
  ]
  const page = await openRoom(browser, url, 'light', repeats, [{ id: 'recurring-rent', label: 'Rent', amountMinor: -180000, category: 'Bills & utilities', date: iso(20), cadence: 'monthly' }])
  const card = page.getByRole('region', { name: 'Bills and subscriptions' })
  await card.waitFor({ timeout: 3000 }).catch(() => problems.push('Bills & subscriptions didn’t show'))
  const names = await card.locator('li strong').allInnerTexts()
  check(JSON.stringify(names) === '["Gym","Rent","NETFLIX.COM"]', `the bills weren’t soonest first: ${JSON.stringify(names)}`)
  check((await card.locator('li').first().innerText()).includes('every week'), 'the gym wasn’t weekly')
  check((await card.locator('li', { hasText: 'Rent' }).innerText()).includes('your plan'), 'the plan didn’t say it was yours')
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/bills.png` })
  await card.locator('li', { hasText: 'NETFLIX.COM' }).getByRole('button', { name: 'Not a bill' }).click()
  check(await card.locator('li', { hasText: 'NETFLIX.COM' }).count() === 0, 'Not a bill didn’t put Netflix away')
  check(JSON.stringify((await readDoc(page)).budget.notBills) === '["netflix com"]', 'Not a bill wasn’t remembered')
  await page.locator('.toast button', { hasText: 'Undo' }).click()
  check(await card.locator('li', { hasText: 'NETFLIX.COM' }).count() === 1, 'Undo didn’t bring Netflix back')
  await page.locator('nav.side').getByRole('button', { name: 'Today' }).first().click()
  await page.getByText('Next bill: Gym, $25.00', { exact: false }).waitFor({ timeout: 3000 }).catch(() => problems.push('Today didn’t name the bill due this week'))
  await page.close()

  // A first visit with nothing yet: one welcome, Connect your bank inside it, no rows of $0.00.
  const empty = await openRoom(browser, url, 'light', [])
  const welcome = empty.getByRole('region', { name: 'Get started with Money' })
  check(await welcome.getByRole('heading', { name: 'Connect your bank' }).count() === 1, 'the welcome didn’t hold the bank card')
  check(await empty.locator('.money-overview').count() === 0, 'an empty Money showed the month’s totals')
  await welcome.getByRole('button', { name: 'add an entry by hand' }).click()
  check(await welcome.getByLabel('Description').count() === 1, 'add an entry by hand didn’t open the form')
  await empty.screenshot({ path: `${OUT}/welcome.png` })
  await empty.close()

  // What you have and owe (Phase 100), from the welcome: two plain questions, kept in cents; the net worth below zero is
  // a plain number, with one payoff line (the highest rate first); a row opens in the same form; Esc closes a question;
  // the trash has Undo; and answering doesn't start the month's rows. The bank card keeps the one primary action.
  for (const theme of ['light', 'dark']) {
    const page = await openRoom(browser, url, theme, [])
    const welcome = page.getByRole('region', { name: 'Get started with Money' })
    await welcome.getByRole('button', { name: 'say what you have and owe' }).click()
    const card = welcome.getByRole('region', { name: 'What you have and owe' })
    const have = card.getByRole('form', { name: 'What do you have?' })
    check(await have.getByText('Cash, and accounts your banks don’t show.').count() === 1, `${theme}: the first question didn’t say what it means`)
    check(await page.locator('.money-page .primary-button').count() === 1, `${theme}: the questions added a second primary action`)
    await have.getByLabel('Name').fill('Cash')
    await have.getByLabel('Amount').fill('300')
    await have.getByRole('button', { name: 'Next: what you owe' }).click()
    const owe = card.getByRole('form', { name: 'What do you owe?' })
    await owe.getByLabel('Name').fill('Car loan')
    await owe.getByLabel('Owed').fill('9,100')
    await owe.getByLabel('Rate %').fill('6.5')
    await owe.getByLabel('Least a month').fill('250')
    await owe.getByLabel('Least a month').press('Enter')
    check(await owe.getByLabel('Name').inputValue() === '', `${theme}: Add didn’t make room for another debt`)
    await owe.getByLabel('Name').fill('Store card')
    await owe.getByLabel('Owed').fill('1200')
    await owe.getByLabel('Rate %').fill('24.99%')
    await owe.getByLabel('Least a month').fill('35')
    await owe.getByRole('button', { name: 'Add' }).click()
    await page.screenshot({ path: `${OUT}/${theme}-worth-question.png` })
    await page.keyboard.press('Escape')
    check(await card.locator('form').count() === 0, `${theme}: Esc didn’t close the question`)
    const kept = (await readDoc(page)).budget.balances || []
    check(JSON.stringify(kept.map(({ id, ...rest }) => rest)) === '[{"label":"Cash","owe":false,"amountMinor":30000},{"label":"Car loan","owe":true,"amountMinor":910000,"rate":6.5,"minimumMinor":25000},{"label":"Store card","owe":true,"amountMinor":120000,"rate":24.99,"minimumMinor":3500}]', `${theme}: the answers weren’t kept in cents: ${JSON.stringify(kept)}`)
    const sum = await card.locator('.money-balance').innerText()
    check(sum.includes('Net worth') && sum.includes('-$10,000.00') && sum.includes('Pay at least $285.00 a month, and anything more to Store card first: at 24.99% it costs the most.'), `${theme}: the net worth or the payoff line was wrong: ${sum}`)
    check(await card.locator('.money-balance strong').evaluate((node) => getComputedStyle(node).color === getComputedStyle(document.body).color), `${theme}: a net worth below zero wasn’t in the plain ink`)
    check(await page.locator('.money-overview').count() === 0, `${theme}: answering started the month’s rows`)
    await card.screenshot({ path: `${OUT}/${theme}-worth.png` })

    // A row opens in the same form: the loan is $9,000 now.
    await card.getByRole('button', { name: /^Car loan/ }).click()
    check(await owe.getByLabel('Owed').inputValue() === '9100', `${theme}: the loan didn’t open in its question`)
    await owe.getByLabel('Owed').fill('9,000')
    await owe.getByRole('button', { name: 'Save' }).click()
    check(((await readDoc(page)).budget.balances || []).find((item) => item.label === 'Car loan')?.amountMinor === 900000, `${theme}: the change wasn’t kept`)
    check((await card.locator('.money-balance').innerText()).includes('-$9,900.00'), `${theme}: the net worth didn’t follow the change`)

    // The trash takes a row off at once; Undo puts it back where it was.
    await card.getByRole('button', { name: 'Delete Cash' }).click()
    check(await card.getByRole('button', { name: 'Delete Cash' }).count() === 0, `${theme}: the trash didn’t take Cash off`)
    check(!((await readDoc(page)).budget.balances || []).some((item) => item.label === 'Cash'), `${theme}: Cash wasn’t taken off`)
    await page.locator('.toast button', { hasText: 'Undo' }).click()
    check(((await readDoc(page)).budget.balances || [])[0]?.label === 'Cash', `${theme}: Undo didn’t put Cash back first`)
    await page.close()
  }
  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Money checked. Screenshots in ${OUT}/`)
  })
