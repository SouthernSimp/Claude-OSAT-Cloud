/* Gmail, signed in directly (Phase 86): Connect Gmail in the Mail room opens Google's own sign-in in Nate's browser
   (bots/mcp-signin.cjs `authorize`: PKCE, the answer on 127.0.0.1), for read-only mail (gmail.readonly). Once
   connected, the Mail room, its search and To-dos from email read Gmail here instead of through the Mac's Mail app,
   which was slow on a big Gmail inbox. Read-only: nothing is sent, moved, labelled or marked read; Reply and Open in
   Gmail open the message in Gmail itself. The refresh token is in the Keychain (`gmail-refresh`), the access token
   only in memory; gmail.json in the data folder says which addresses are connected. Every request goes through main's
   fetch, so Offline refuses it. OSAT's Google client (a "Desktop app" client, whose secret Google says isn't one) is
   google-client.json beside this file, written by CI from repository secrets and never committed (the repo is public).
   Several accounts (Phase 108): Connect Gmail adds one; each has its own refresh token (`gmail-refresh-<tag>`, the tag is
   8 hex digits of the address's hash) and its own session. The list and a search read every account at once and merge;
   one that fails (signed out) is reported on its row of `status().accounts` and the others still answer. A message id
   is the Gmail id, with the account's tag in front for every account but the first (so ids from before this stay valid,
   and To-dos from email doesn't read the same mail twice).
     gmail:status · gmail:connect (adds) · gmail:disconnect (one address, or all) */
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { authorize, refreshed } = require('./bots/mcp-signin.cjs')

const GOOGLE = { authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth', token_endpoint: 'https://oauth2.googleapis.com/token' }
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const REVOKE = 'https://oauth2.googleapis.com/revoke'
const ACCOUNT = 'gmail-refresh'
const AT_ONCE = 8
const MAX_ACCOUNTS = 5
const tagOf = (email) => createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 8)
const keyOf = (account) => `${ACCOUNT}-${account.tag}`

function readClient(dir = __dirname) {
  try {
    const { id, secret } = JSON.parse(require('node:fs').readFileSync(path.join(dir, 'google-client.json'), 'utf8'))
    return typeof id === 'string' && id && typeof secret === 'string' ? { id, secret } : null
  } catch {
    return null
  }
}

async function createGmail({ dataDir, keychain, fetch, open, sharedModule, handle, fail, client = readClient(), send = () => {}, now = () => Date.now() }) {
  const model = await sharedModule('gmail-model.mjs')
  const mail = await sharedModule('mail-model.mjs')
  const file = path.join(dataDir, 'gmail.json')
  let saved = {}
  try { saved = JSON.parse(await fs.readFile(file, 'utf8')) } catch { /* not connected yet */ }
  // gmail.json was { email } until Phase 108: that address is the first account, and keeps its sign-in.
  const accounts = (Array.isArray(saved.accounts) ? saved.accounts : saved.email ? [{ email: saved.email }] : [])
    .map((item) => String(item?.email || '').slice(0, 120))
    .filter(Boolean)
    .slice(0, MAX_ACCOUNTS)
    .map((email) => ({ email, tag: tagOf(email) }))
  const sessions = new Map() // tag → { access, expiresAt }
  const problems = new Map() // tag → why the last ask of that account failed
  let busy = false

  const save = () => fs.writeFile(file, JSON.stringify({ accounts: accounts.map(({ email }) => ({ email })) }), { mode: 0o600 })
  const on = () => accounts.length > 0
  const status = () => ({
    ready: Boolean(client), connected: on(), email: accounts[0]?.email || '', busy,
    accounts: accounts.map((account) => ({ email: account.email, problem: problems.get(account.tag) || '' })),
  })
  const changed = () => send('gmail:changed', status())

  /* The first account keeps the Keychain entry it had before there could be several; it moves to its own name the first time it is used. */
  async function refreshToken(account) {
    const own = await keychain.get(keyOf(account))
    if (own || account !== accounts[0]) return own
    const old = await keychain.get(ACCOUNT)
    if (old) { await keychain.set(keyOf(account), old); await keychain.remove(ACCOUNT) }
    return old
  }

  async function access(account) {
    const held = sessions.get(account.tag)
    if (held && held.expiresAt - now() > 60000) return held.access
    const refresh = await refreshToken(account)
    if (!refresh || !client) fail(`Connect Gmail again in Mail (${account.email}).`)
    try {
      const next = await refreshed({ refresh, tokenUrl: GOOGLE.token_endpoint, clientId: client.id, clientSecret: client.secret }, { fetch })
      sessions.set(account.tag, next)
      return next.access
    } catch (error) {
      fail(String(error?.message || '').includes('ran out') ? `Google signed OSAT out of ${account.email}. Connect Gmail again in Mail.` : explain(error))
    }
  }

  function explain(error) {
    if (error?.code === 'OFFLINE') return 'Gmail waits until you’re back online.'
    return 'Gmail couldn’t be reached just now. Try again in a moment.'
  }

  async function call(token, where, search = {}, account = null) {
    const url = new URL(`${API}/${where}`)
    for (const [name, value] of Object.entries(search)) for (const one of [].concat(value)) url.searchParams.append(name, one)
    let response
    try {
      response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
    } catch (error) {
      fail(explain(error))
    }
    if (response.status === 401) { if (account) sessions.delete(account.tag); fail(`Google signed OSAT out of ${account?.email || 'Gmail'}. Connect Gmail again in Mail.`) }
    if (response.status === 404) fail(mail.GONE)
    if (!response.ok) fail(explain())
    return response.json()
  }
  const api = async (account, where, search) => call(await access(account), where, search, account)

  /* The Mail room's id for one of an account's messages, and back. */
  const idFor = (account, id) => (account === accounts[0] ? id : `${account.tag}${id}`)
  function locate(id) {
    const text = String(id)
    const wide = text.length > 16
    const account = wide ? accounts.find((item) => item.tag === text.slice(0, 8)) : accounts[0]
    const hex = wide ? text.slice(8) : text
    if (!account || !mail.validMessageId(text) || !model.GMAIL_ID.test(hex)) fail('That isn’t a message in your inbox.')
    return { account, hex }
  }

  /* One account's newest messages (the inbox, or what a search finds anywhere in it), each with its sender, subject and date. */
  async function rows(account, search) {
    const found = await api(account, 'messages', { maxResults: mail.LIST_MAX, ...search })
    const ids = (found.messages || []).map((item) => item.id).filter((id) => model.GMAIL_ID.test(id))
    const out = []
    for (let at = 0; at < ids.length; at += AT_ONCE) {
      out.push(...await Promise.all(ids.slice(at, at + AT_ONCE).map((id) => api(account, `messages/${id}`, { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }).catch(() => null))))
    }
    return out.map(model.gmailRaw).filter(Boolean).map((raw) => ({ ...raw, id: idFor(account, raw.id), account: account.email }))
  }
  /* Every account at once, merged newest first. An account that fails is set down on its row of the status; only when none answers is it an error. */
  async function everyAccount(search) {
    if (!accounts.length) fail('Connect Gmail again in Mail.')
    const asked = [...accounts]
    const results = await Promise.allSettled(asked.map((account) => rows(account, search)))
    let different = false
    results.forEach((result, at) => {
      const was = problems.get(asked[at].tag) || ''
      const latest = result.status === 'fulfilled' ? '' : String(result.reason?.message || explain()).slice(0, 200)
      if (latest) problems.set(asked[at].tag, latest); else problems.delete(asked[at].tag)
      different ||= was !== latest
    })
    if (different) changed()
    const failed = results.find((result) => result.status === 'rejected')
    if (failed && results.every((result) => result.status === 'rejected')) throw failed.reason
    return mail.messageRows(results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])))
  }
  const list = () => everyAccount({ labelIds: 'INBOX' })
  const search = (words) => everyAccount({ q: words })
  const decode = (data) => Buffer.from(String(data), 'base64url').toString('utf8')
  async function read(id) {
    const { account, hex } = locate(id)
    const full = model.gmailFull(await api(account, `messages/${hex}`, { format: 'full' }), decode)
    return mail.messageFull(full && { ...full, id: String(id), account: account.email }) || fail(mail.GONE)
  }
  const openMessage = async (id) => { const { account, hex } = locate(id); await open(model.gmailLink(hex, account.email)); return true }

  /* Adds an account: Google's account chooser (so a second address can be picked), then the address Google says it is. Signing in an address already here only renews it. */
  async function connect() {
    if (!client) fail('Gmail sign-in isn’t set up in this build of OSAT yet.')
    if (busy) return status()
    busy = true
    changed()
    try {
      const tokens = await authorize({ meta: GOOGLE, client, scope: SCOPE, extra: { access_type: 'offline', prompt: 'select_account consent', include_granted_scopes: 'true' } }, { fetch, open })
      if (!tokens.refresh) fail('Google didn’t let OSAT stay signed in. Try Connect Gmail again.')
      const email = String((await call(tokens.access, 'profile')).emailAddress || '').slice(0, 120)
      if (!email) fail('Google didn’t say which address that was. Try Connect Gmail again.')
      let account = accounts.find((item) => item.tag === tagOf(email))
      if (!account && accounts.length >= MAX_ACCOUNTS) fail(`OSAT reads up to ${MAX_ACCOUNTS} Gmail accounts. Disconnect one first.`)
      if (!account) accounts.push(account = { email, tag: tagOf(email) })
      await keychain.set(keyOf(account), tokens.refresh)
      sessions.set(account.tag, { access: tokens.access, expiresAt: tokens.expiresAt || now() + 3000000 })
      problems.delete(account.tag)
      await save()
    } catch (error) {
      fail(String(error?.message || '') || 'The sign-in didn’t finish. Try again.')
    } finally {
      busy = false
      changed()
    }
    return status()
  }

  /* Signs OSAT out of one address (or, with none named, all of them): Google is told to forget OSAT's access, the token leaves the Keychain. */
  async function disconnect(email = '') {
    for (const account of accounts.filter((item) => !email || item.email === email)) {
      const refresh = await refreshToken(account).catch(() => null)
      if (refresh) await fetch(REVOKE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }) }).catch(() => {})
      await keychain.remove(keyOf(account)).catch(() => {})
      sessions.delete(account.tag)
      problems.delete(account.tag)
      accounts.splice(accounts.indexOf(account), 1)
    }
    await save().catch(() => {})
    changed()
    return status()
  }

  handle('gmail:status', () => status(), { from: 'app' })
  handle('gmail:connect', () => connect(), { from: 'app' })
  handle('gmail:disconnect', (email) => disconnect(typeof email === 'string' ? email : ''), { from: 'app' })

  return { on, status, list, search, read, open: openMessage }
}

module.exports = { createGmail, readClient, GOOGLE, SCOPE }
