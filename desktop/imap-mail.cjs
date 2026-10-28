/* Mail straight from the provider (Phase 104): iCloud, Gmail, Yahoo or any IMAP server, signed in with an app password.
   Picked in the Mail room's "Where's your mail?"; once connected, Mail, its search and To-dos from email read here
   instead of through the Mac's Mail app (which was slow on a big inbox). Read only: messages are fetched with
   BODY.PEEK, so nothing is marked read, and nothing is sent, moved or deleted. Reply and Open go to the provider's own
   mail page (or a mailto: link for a server with none). The app password is in the Keychain (`imap-password`);
   imap.json in the data folder says which provider, address and server. Offline refuses every connection here.
     imap:status · imap:connect · imap:disconnect */
const fs = require('node:fs/promises')
const path = require('node:path')

const ACCOUNT = 'imap-password'
const IDLE_MS = 5 * 60 * 1000

/* `connectTo` is passed in so tests can answer as a server would. */
async function createImapMail({
  dataDir, keychain, sharedModule, handle, fail, open, offline = () => false, send = () => {},
  connectTo = (options) => { const { ImapFlow } = require('imapflow'); return new ImapFlow(options) },
  parse = (source) => require('mailparser').simpleParser(source),
}) {
  const model = await sharedModule('imap-model.mjs')
  const mail = await sharedModule('mail-model.mjs')
  const gmailModel = await sharedModule('gmail-model.mjs')
  const file = path.join(dataDir, 'imap.json')
  let state = { provider: '', email: '', host: '' }
  try { state = { ...state, ...JSON.parse(await fs.readFile(file, 'utf8')) } } catch { /* not connected yet */ }
  let client = null
  let idle = null

  const on = () => Boolean(state.email && state.host)
  const status = () => ({ connected: on(), provider: state.provider, email: state.email, label: model.PROVIDERS[state.provider]?.label || 'Your mail' })
  const changed = () => send('imap:changed', status())

  function drop() {
    clearTimeout(idle)
    const old = client
    client = null
    old?.logout().catch(() => old.close?.())
  }

  async function connection(sign = null) {
    if (offline()) fail('Your mail waits until you’re back online.')
    clearTimeout(idle)
    idle = setTimeout(drop, IDLE_MS)
    if (!sign && client?.usable) return client
    drop()
    const who = sign || { ...state, password: await keychain.get(ACCOUNT) }
    if (!who.password) fail('Connect your mail again in Mail.')
    const next = connectTo({ host: who.host, port: 993, secure: true, auth: { user: who.email, pass: who.password }, logger: false, emitLogs: false })
    next.on?.('error', () => { if (client === next) client = null })
    try {
      await next.connect()
    } catch (error) {
      fail(model.explainImap(error, who.provider))
    }
    if (!sign) client = next
    return next
  }

  /* One look at the inbox; a dropped connection is tried once more. */
  async function inbox(work) {
    for (let tries = 0; ; tries++) {
      const imap = await connection()
      let lock
      try {
        lock = await imap.getMailboxLock('INBOX')
        return await work(imap)
      } catch (error) {
        if (error?.authenticationFailed) fail(model.explainImap(error, state.provider))
        if (tries === 0 && !imap.usable) { drop(); continue }
        fail(model.explainImap(error, state.provider))
      } finally {
        lock?.release()
      }
    }
  }

  const FIELDS = { uid: true, envelope: true, flags: true, internalDate: true }
  async function fetchRows(imap, range, byUid) {
    const out = []
    for await (const message of imap.fetch(range, FIELDS, byUid ? { uid: true } : undefined)) out.push(model.imapRaw(message))
    return mail.messageRows(out)
  }

  /* The newest LIST_MAX messages: one request for all of them, by their place at the end of the inbox. */
  const list = () => inbox(async (imap) => {
    const total = imap.mailbox?.exists || 0
    if (!total) return []
    return fetchRows(imap, `${Math.max(1, total - mail.LIST_MAX + 1)}:*`)
  })

  const search = (words, inside = false) => inbox(async (imap) => {
    const any = [{ subject: words }, { from: words }]
    if (inside) any.push({ body: words })
    const uids = (await imap.search({ or: any }, { uid: true })) || []
    if (!uids.length) return []
    return fetchRows(imap, uids.slice(-mail.LIST_MAX).join(','), true)
  })

  // `work` never calls fail itself, so anything it throws is the server's.
  async function read(id) {
    if (typeof id !== 'number' || !mail.validMessageId(id)) fail('That isn’t a message in your inbox.')
    const full = await inbox(async (imap) => {
      const message = await imap.fetchOne(String(id), { ...FIELDS, source: true }, { uid: true })
      if (!message?.source) return null
      const parsed = await parse(message.source)
      return mail.messageFull({ ...model.imapRaw(message), body: parsed.text || gmailModel.htmlText(parsed.html || '') })
    })
    return full || fail(mail.GONE)
  }

  async function openMessage() {
    const web = model.PROVIDERS[state.provider]?.web
    if (!web) fail('Your mail server has no web page OSAT knows. Open your mail app to see it.')
    await open(web)
    return true
  }
  async function reply(id) {
    const message = await read(id)
    await open(model.replyLink(state.provider, message.from.address, message.subject))
    return true
  }

  /* Checks the address and app password by signing in and opening the inbox, then keeps them. */
  async function connect(raw) {
    const sign = model.cleanSignIn(raw)
    if (sign.error) fail(sign.error)
    const trial = await connection(sign)
    try {
      const lock = await trial.getMailboxLock('INBOX')
      lock.release()
    } catch (error) {
      fail(model.explainImap(error, sign.provider))
    } finally {
      trial.logout().catch(() => {})
    }
    await keychain.set(ACCOUNT, sign.password)
    drop()
    state = { provider: sign.provider, email: sign.email, host: sign.host }
    await fs.writeFile(file, JSON.stringify(state), { mode: 0o600 })
    changed()
    return status()
  }

  async function disconnect() {
    drop()
    await keychain.remove(ACCOUNT).catch(() => {})
    state = { provider: '', email: '', host: '' }
    await fs.writeFile(file, JSON.stringify(state), { mode: 0o600 }).catch(() => {})
    changed()
    return status()
  }

  handle('imap:status', () => status(), { from: 'app' })
  handle('imap:connect', (raw) => connect(raw), { from: 'app' })
  handle('imap:disconnect', () => disconnect(), { from: 'app' })

  return { on, status, list, search, read, open: openMessage, reply, disconnect, stop: drop }
}

module.exports = { createImapMail }
