/* Gmail, signed in directly (Phase 86): Connect Gmail in the Mail room opens Google's own sign-in in Nate's browser
   (bots/mcp-signin.cjs `authorize`: PKCE, the answer on 127.0.0.1), for read-only mail (gmail.readonly). Once
   connected, the Mail room, its search and To-dos from email read Gmail here instead of through the Mac's Mail app,
   which was slow on a big Gmail inbox. Read-only: nothing is sent, moved, labelled or marked read; Reply and Open in
   Gmail open the message in Gmail itself. The refresh token is in the Keychain (`gmail-refresh`), the access token
   only in memory; gmail.json in the data folder says which address is connected. Every request goes through main's
   fetch, so Offline refuses it. OSAT's Google client (a "Desktop app" client, whose secret Google says isn't one) is
   google-client.json beside this file, written by CI from repository secrets and never committed (the repo is public).
     gmail:status · gmail:connect · gmail:disconnect */
const fs = require('node:fs/promises')
const path = require('node:path')
const { authorize, refreshed } = require('./bots/mcp-signin.cjs')

const GOOGLE = { authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth', token_endpoint: 'https://oauth2.googleapis.com/token' }
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const REVOKE = 'https://oauth2.googleapis.com/revoke'
const ACCOUNT = 'gmail-refresh'
const AT_ONCE = 8

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
  let state = { email: '' }
  try { state = { ...state, ...JSON.parse(await fs.readFile(file, 'utf8')) } } catch { /* not connected yet */ }
  let session = null // { access, expiresAt }
  let busy = false

  const save = () => fs.writeFile(file, JSON.stringify(state), { mode: 0o600 })
  const on = () => Boolean(state.email)
  const status = () => ({ ready: Boolean(client), connected: on(), email: state.email, busy })
  const changed = () => send('gmail:changed', status())
  const saved = async () => ({ refresh: await keychain.get(ACCOUNT), tokenUrl: GOOGLE.token_endpoint, clientId: client?.id, clientSecret: client?.secret })

  async function access() {
    if (session && session.expiresAt - now() > 60000) return session.access
    const refresh = await keychain.get(ACCOUNT)
    if (!refresh || !client) fail('Connect Gmail again in Mail.')
    try {
      session = await refreshed(await saved(), { fetch })
    } catch (error) {
      fail(String(error?.message || '').includes('ran out') ? 'Google signed OSAT out of Gmail. Connect Gmail again in Mail.' : explain(error))
    }
    return session.access
  }

  function explain(error) {
    if (error?.code === 'OFFLINE') return 'Gmail waits until you’re back online.'
    return 'Gmail couldn’t be reached just now. Try again in a moment.'
  }

  async function api(where, search = {}) {
    const url = new URL(`${API}/${where}`)
    for (const [name, value] of Object.entries(search)) for (const one of [].concat(value)) url.searchParams.append(name, one)
    const token = await access()
    let response
    try {
      response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
    } catch (error) {
      fail(explain(error))
    }
    if (response.status === 401) { session = null; fail('Google signed OSAT out of Gmail. Connect Gmail again in Mail.') }
    if (response.status === 404) fail(mail.GONE)
    if (!response.ok) fail(explain())
    return response.json()
  }

  /* The newest messages (the inbox, or what a search finds anywhere in Gmail), each with its sender, subject and date. */
  async function rows(search) {
    const found = await api('messages', { maxResults: mail.LIST_MAX, ...search })
    const ids = (found.messages || []).map((item) => item.id).filter((id) => model.GMAIL_ID.test(id))
    const out = []
    for (let at = 0; at < ids.length; at += AT_ONCE) {
      out.push(...await Promise.all(ids.slice(at, at + AT_ONCE).map((id) => api(`messages/${id}`, { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }).catch(() => null))))
    }
    return mail.messageRows(out.map(model.gmailRaw))
  }
  const list = () => rows({ labelIds: 'INBOX' })
  const search = (words) => rows({ q: words })
  const decode = (data) => Buffer.from(String(data), 'base64url').toString('utf8')
  async function read(id) {
    if (!model.GMAIL_ID.test(String(id))) fail('That isn’t a message in your inbox.')
    return mail.messageFull(model.gmailFull(await api(`messages/${id}`, { format: 'full' }), decode)) || fail(mail.GONE)
  }
  const openMessage = async (id) => { await open(model.gmailLink(String(id), state.email)); return true }

  async function connect() {
    if (!client) fail('Gmail sign-in isn’t set up in this build of OSAT yet.')
    if (busy) return status()
    busy = true
    changed()
    try {
      const tokens = await authorize({ meta: GOOGLE, client, scope: SCOPE, extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' } }, { fetch, open })
      if (!tokens.refresh) fail('Google didn’t let OSAT stay signed in. Try Connect Gmail again.')
      await keychain.set(ACCOUNT, tokens.refresh)
      session = { access: tokens.access, expiresAt: tokens.expiresAt || now() + 3000000 }
      const profile = await api('profile')
      state = { email: String(profile.emailAddress || '').slice(0, 120) }
      await save()
    } catch (error) {
      fail(String(error?.message || '') || 'The sign-in didn’t finish. Try again.')
    } finally {
      busy = false
      changed()
    }
    return status()
  }

  /* Signs OSAT out of Gmail: Google is told to forget OSAT's access, the token leaves the Keychain. */
  async function disconnect() {
    const refresh = await keychain.get(ACCOUNT).catch(() => null)
    if (refresh) await fetch(REVOKE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }) }).catch(() => {})
    await keychain.remove(ACCOUNT).catch(() => {})
    session = null
    state = { email: '' }
    await save().catch(() => {})
    changed()
    return status()
  }

  handle('gmail:status', () => status(), { from: 'app' })
  handle('gmail:connect', () => connect(), { from: 'app' })
  handle('gmail:disconnect', () => disconnect(), { from: 'app' })

  return { on, status, list, search, read, open: openMessage }
}

module.exports = { createGmail, readClient, GOOGLE, SCOPE }
