/* Banks in Money (Phase 87), through Plaid. Nate's own Plaid keys (dashboard.plaid.com → Developers → Keys) are pasted
   once in Money and go to the Keychain (`plaid-client-id`, `plaid-secret`); OSAT tries them on Plaid's production
   servers, then its Sandbox (pretend banks), and keeps whichever answers. Connect a bank opens Plaid's own Hosted Link
   page in Nate's browser (OSAT never sees a bank password); OSAT asks /link/token/get every few seconds until the
   sign-in is done, trades the public token for the bank's access token (Keychain, `plaid-item-<hash>`), and syncs.
   /transactions/sync brings what changed since the last cursor; bank-model.mjs turns it into Money's own entries
   (`plaid-<id>`, so nothing is added twice) and the store commits them. Accounts and balances come with each sync.
   Every hour, and a minute after a new bank (Plaid takes a moment to gather its history). Disconnect tells Plaid to
   forget the bank; its entries stay in Money. Every request goes through main's fetch, so Offline refuses it.
   bank.json in the data folder: { env, items: [{ id, key, bank, cursor, accounts, problem, at }] }, never a token.
     bank:status · bank:keys · bank:forget-keys · bank:connect · bank:sync · bank:disconnect */
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')

const HOSTS = { production: 'https://production.plaid.com', sandbox: 'https://sandbox.plaid.com' }
const HOUR = 60 * 60 * 1000
const POLL_MS = 3000
const LINK_MS = 30 * 60 * 1000
const KEY_ID = 'plaid-client-id'
const KEY_SECRET = 'plaid-secret'
const CLEAN = /^[A-Za-z0-9_-]{8,80}$/

class PlaidError extends Error {
  constructor(body, status) {
    super(String(body?.error_message || `Plaid answered ${status}`))
    this.code = String(body?.error_code || '')
    this.type = String(body?.error_type || '')
    this.display = String(body?.display_message || '')
  }
}

async function createBank({ dataDir, keychain, fetch, open, sharedModule, readDoc, commitOps, handle, fail, send = () => {}, now = () => Date.now(), timers = { setTimeout, clearTimeout, setInterval, clearInterval }, pollMs = POLL_MS }) {
  const model = await sharedModule('bank-model.mjs')
  const file = path.join(dataDir, 'bank.json')
  let state = { env: '', items: [] }
  try { state = { ...state, ...JSON.parse(await fs.readFile(file, 'utf8')) } } catch { /* nothing connected yet */ }
  let busy = false
  let linking = false
  let problem = ''
  let last = null
  let every = null
  let soon = null

  const save = () => fs.writeFile(file, JSON.stringify(state), { mode: 0o600 })
  const status = () => ({
    keys: Boolean(state.env),
    env: state.env,
    busy,
    linking,
    problem,
    last,
    items: state.items.map(({ id, bank, accounts, problem: trouble, at }) => ({ id, bank, accounts: accounts || [], problem: trouble || '', at: at || 0 })),
  })
  const changed = () => send('bank:changed', status())

  function plain(error) {
    if (error?.code === 'OFFLINE') return 'Your bank waits until you’re back online.'
    if (error instanceof PlaidError) {
      if (error.code === 'INVALID_API_KEYS') return 'Plaid didn’t take those keys. Copy the Client ID and the Secret again from dashboard.plaid.com → Developers → Keys.'
      if (error.code === 'ITEM_LOGIN_REQUIRED') return 'Your bank wants you to sign in again: Disconnect it, then connect it again.'
      if (error.display) return error.display.slice(0, 200)
      return `Plaid said: ${error.message.slice(0, 160)}`
    }
    return 'Plaid couldn’t be reached just now. Try again in a moment.'
  }

  async function keys() {
    const [id, secret] = await Promise.all([keychain.get(KEY_ID), keychain.get(KEY_SECRET)])
    if (!id || !secret || !state.env) fail('Paste your Plaid keys in Money first.')
    return { client_id: id, secret }
  }

  async function plaid(where, body, env = state.env, given = null) {
    const auth = given || await keys()
    let response
    try {
      response = await fetch(`${HOSTS[env]}${where}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...auth, ...body }) })
    } catch (error) {
      throw Object.assign(new Error('unreachable'), { code: error?.code === 'OFFLINE' ? 'OFFLINE' : 'UNREACHABLE' })
    }
    const answer = await response.json().catch(() => null)
    if (!response.ok || !answer) throw new PlaidError(answer, response.status)
    return answer
  }

  /* The keys, tried on production and then the Sandbox; the first that takes them is kept. */
  async function setKeys(clientId, secret) {
    const id = String(clientId || '').trim()
    const key = String(secret || '').trim()
    if (!CLEAN.test(id) || !CLEAN.test(key)) fail('Paste the Client ID and the Secret from dashboard.plaid.com → Developers → Keys.')
    let found = ''
    let lastError = null
    for (const env of ['production', 'sandbox']) {
      try {
        await plaid('/institutions/get', { count: 1, offset: 0, country_codes: ['US'] }, env, { client_id: id, secret: key })
        found = env
        break
      } catch (error) {
        lastError = error
        if (error.code !== 'INVALID_API_KEYS') break
      }
    }
    if (!found) fail(plain(lastError))
    await keychain.set(KEY_ID, id)
    await keychain.set(KEY_SECRET, key)
    state = { ...state, env: found }
    await save()
    changed()
    return status()
  }

  async function forgetKeys() {
    if (state.items.length) fail('Disconnect your banks first.')
    await Promise.all([keychain.remove(KEY_ID), keychain.remove(KEY_SECRET)]).catch(() => {})
    state = { env: '', items: [] }
    await save()
    changed()
    return status()
  }

  /* Plaid's own page in the browser; OSAT waits for it to say the bank is connected. */
  async function connect() {
    if (linking) return status()
    linking = true
    problem = ''
    changed()
    try {
      const made = await plaid('/link/token/create', {
        client_name: 'OSAT', language: 'en', country_codes: ['US'], user: { client_user_id: 'osat-this-mac' },
        products: ['transactions'], transactions: { days_requested: 180 }, hosted_link: {},
      })
      if (!/^https:\/\//.test(made.hosted_link_url || '')) fail('Plaid didn’t give OSAT its sign-in page. Check that Hosted Link is on for your Plaid account.')
      await open(made.hosted_link_url)
      const until = now() + LINK_MS
      let done = null
      while (!done && now() < until && linking) {
        await new Promise((resolve) => timers.setTimeout(resolve, pollMs))
        done = model.finishedLink(await plaid('/link/token/get', { link_token: made.link_token }))
      }
      if (!done) fail(linking ? 'The bank sign-in took too long. Try Connect a bank again.' : 'Connecting the bank was stopped.')
      const traded = await plaid('/item/public_token/exchange', { public_token: done.publicToken })
      const key = `plaid-item-${createHash('sha256').update(String(traded.item_id)).digest('hex').slice(0, 16)}`
      await keychain.set(key, traded.access_token)
      state = { ...state, items: [...state.items.filter((item) => item.id !== traded.item_id), { id: traded.item_id, key, bank: String(done.bank).slice(0, 60), cursor: '', accounts: [], problem: '', at: 0 }] }
      await save()
      linking = false
      await sync()
      // Plaid gathers a new bank's history for a minute or so; look again then.
      timers.clearTimeout(soon)
      soon = timers.setTimeout(() => sync().catch(() => {}), 60 * 1000)
    } catch (error) {
      // OSAT's own sentences (fail) as they are; Plaid's and the network's in plain words.
      problem = error instanceof PlaidError || error?.code ? plain(error) : String(error?.message || '') || plain(error)
      fail(problem)
    } finally {
      linking = false
      changed()
    }
    return status()
  }

  function cancel() {
    linking = false
    changed()
    return status()
  }

  /* What changed at each bank since the last look, into Money. */
  async function sync() {
    if (busy || !state.items.length) return status()
    busy = true
    problem = ''
    changed()
    let added = 0
    try {
      for (const item of state.items) {
        try {
          const access = await keychain.get(item.key)
          if (!access) throw new PlaidError({ error_code: 'ITEM_LOGIN_REQUIRED' }, 400)
          let cursor = item.cursor || ''
          let more = true
          let accounts = item.accounts || []
          for (let page = 0; more && page < 50; page += 1) {
            const answer = await plaid('/transactions/sync', { access_token: access, count: 500, ...(cursor ? { cursor } : {}) })
            const ops = model.bankOps(readDoc().budget?.transactions || [], answer, item.bank)
            if (ops.length) commitOps(ops)
            added += ops.filter((op) => op.t === 'add').length
            if (Array.isArray(answer.accounts) && answer.accounts.length) accounts = answer.accounts.map(model.accountRow)
            cursor = String(answer.next_cursor || cursor)
            more = answer.has_more === true
          }
          Object.assign(item, { cursor, accounts, problem: '', at: now() })
        } catch (error) {
          if (error?.code === 'OFFLINE' || error?.code === 'UNREACHABLE') throw error
          item.problem = plain(error)
        }
      }
      last = { at: now(), added }
      await save()
    } catch (error) {
      problem = plain(error)
    } finally {
      busy = false
      changed()
    }
    return status()
  }

  /* Plaid forgets the bank and its token leaves the Keychain; what it brought stays in Money. */
  async function disconnect(id) {
    const item = state.items.find((one) => one.id === id)
    if (!item) fail('That bank isn’t connected.')
    const access = await keychain.get(item.key).catch(() => null)
    if (access) await plaid('/item/remove', { access_token: access }).catch(() => {})
    await keychain.remove(item.key).catch(() => {})
    state = { ...state, items: state.items.filter((one) => one.id !== id) }
    await save()
    changed()
    return status()
  }

  function start() {
    every = timers.setInterval(() => sync().catch(() => {}), HOUR)
    if (state.items.length) soon = timers.setTimeout(() => sync().catch(() => {}), 2 * 60 * 1000)
  }
  function stop() {
    timers.clearInterval(every)
    timers.clearTimeout(soon)
  }

  handle('bank:status', () => status(), { from: 'app' })
  handle('bank:keys', (clientId, secret) => setKeys(clientId, secret), { from: 'app' })
  handle('bank:forget-keys', () => forgetKeys(), { from: 'app' })
  handle('bank:connect', () => connect(), { from: 'app' })
  handle('bank:cancel', () => cancel(), { from: 'app' })
  handle('bank:sync', () => sync(), { from: 'app' })
  handle('bank:disconnect', (id) => disconnect(String(id || '')), { from: 'app' })

  return { status, setKeys, connect, cancel, sync, disconnect, start, stop }
}

module.exports = { createBank, HOSTS }
