/* Your Mac's own Mail app, read from OSAT's Mail room (Phase 59). Mail is reached through `osascript -l
   JavaScript`, the way mac-calendar.cjs reaches EventKit: Nate's accounts are already signed in there, so
   OSAT never holds a mail password, token or sign-in of its own. It reads (the inbox of every account, one
   message, a search), starts a reply in Mail's own compose window and opens a message in Mail. It never
   sends, deletes, moves or marks anything, and never asks Mail to fetch. macOS asks once whether OSAT may
   control Mail (Automation); `allow` is the only thing that asks, and it is the button's job. Gmail is a
   Google account added to the Mac (Internet Accounts), which Mail then reads like any other.
   Safety: execFile (no shell); the script is one fixed text and the command and its JSON travel as
   arguments, never joined into the script; ids and search words are checked here first; what comes
   back is data. Nothing here is offered to the AI, the agent, the brief or the connector.
   The window's side (shapes, cleaning, words) is shared/mail-model.mjs. */
const fs = require('node:fs')
const { execFile } = require('node:child_process')

/* One script, one command per run: argv[0] is the command, argv[1] its JSON. It always prints one JSON
   line: the answer, or { error }. Messages are found by their id in the combined inbox; the list is the
   newest ones, a search reads Mail's own matching. */
const SCRIPT = `const LIST = 50
const Mail = Application("Mail")
const fail = (code) => { throw new Error(code) }
const attempt = (fn, otherwise) => { try { const v = fn(); return v === null || v === undefined ? otherwise : v } catch (e) { return otherwise } }
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

function accounts() {
  if (Mail.accounts.length === 0) fail("noAccounts")
}

/* One message by its id: Mail's own lookup (one request), else a search of the inbox for it. */
function byId(id) {
  const direct = Mail.inbox.messages.byId(id)
  if (attempt(() => direct.id(), null) === id) return direct
  const found = Mail.inbox.messages.whose({ id: id })
  if (found.length === 0) fail("gone")
  return found[0]
}

function row(m, snippet) {
  const d = attempt(() => m.dateReceived(), null)
  const out = {
    id: m.id(), subject: attempt(() => String(m.subject()), ""), sender: attempt(() => String(m.sender()), ""),
    date: d ? d.toISOString() : "", unread: attempt(() => m.readStatus() === false, false), snippet: "",
  }
  if (snippet) out.snippet = attempt(() => String(m.content()).slice(0, 800), "")
  return out
}

/* The newest few of a set of messages. Each field comes for the whole set in one request (asking a filtered
   set for one message's subject made Mail filter it all again: on a big Gmail inbox that took minutes). The
   ids are asked again last, so mail that arrived in between can't pair one message's subject with another's
   date; then it reads them again. A snippet needs the body, so those come by id for twelve seconds at most. */
function newest(found) {
  for (let tries = 0; tries < 3; tries++) {
    const ids = attempt(() => found.id(), [])
    if (ids.length === 0) return []
    const dates = attempt(() => found.dateReceived(), [])
    const subjects = attempt(() => found.subject(), [])
    const senders = attempt(() => found.sender(), [])
    const reads = attempt(() => found.readStatus(), [])
    if (!same(ids, attempt(() => found.id(), []))) continue
    const end = Date.now() + 12000
    return ids.map((id, i) => [dates[i] ? dates[i].getTime() : 0, i]).sort((a, b) => b[0] - a[0]).slice(0, LIST).map((pair) => {
      const i = pair[1]
      const out = { id: ids[i], subject: String(subjects[i] || ""), sender: String(senders[i] || ""), date: pair[0] ? new Date(pair[0]).toISOString() : "", unread: reads[i] === false, snippet: "" }
      if (Date.now() < end) out.snippet = attempt(() => String(byId(ids[i]).content()).slice(0, 800), "")
      return out
    })
  }
  fail("slow")
}

/* The accounts Mail reads, so the room can say which (and offer Gmail when it isn't one of them). */
function accountList() {
  const all = Mail.accounts
  const names = attempt(() => all.name(), [])
  const kinds = attempt(() => all.accountType(), [])
  const emails = attempt(() => all.emailAddresses(), [])
  const servers = attempt(() => all.serverName(), [])
  const on = attempt(() => all.enabled(), [])
  return names.map((name, i) => ({ name: String(name), kind: String(kinds[i] || ""), emails: (emails[i] || []).map(String), server: String(servers[i] || ""), enabled: on[i] !== false }))
}

function run(argv) {
  try {
    const cmd = argv[0]
    const a = JSON.parse(argv[1] || "{}")
    if (cmd === "accounts") return JSON.stringify(accountList())
    if (cmd === "allow") { accounts(); return JSON.stringify({ status: "allowed" }) }
    accounts()
    if (cmd === "list") {
      const since = new Date(Date.now() - 60 * 86400000)
      const recent = Mail.inbox.messages.whose({ dateReceived: { _greaterThan: since } })
      return JSON.stringify(newest(recent.length > 0 ? recent : Mail.inbox.messages))
    }
    if (cmd === "search") {
      const q = String(a.query)
      const any = [{ subject: { _contains: q } }, { sender: { _contains: q } }]
      if (a.inside === true) any.push({ content: { _contains: q } })
      return JSON.stringify(newest(Mail.inbox.messages.whose({ _or: any })))
    }
    if (cmd === "read") {
      const m = byId(a.id)
      const out = row(m, false)
      out.body = attempt(() => String(m.content()).slice(0, 30000), "")
      return JSON.stringify(out)
    }
    if (cmd === "reply") {
      Mail.reply(byId(a.id), { openingWindow: true })
      Mail.activate()
      return JSON.stringify({ ok: true })
    }
    if (cmd === "open") {
      const m = byId(a.id)
      const wanted = String(m.messageId()).replace(/^<|>$/g, "")
      const me = Application.currentApplication()
      me.includeStandardAdditions = true
      me.openLocation("message://" + encodeURIComponent("<" + wanted + ">"))
      Mail.activate()
      return JSON.stringify({ ok: true })
    }
    return JSON.stringify({ error: "unknown" })
  } catch (e) {
    return JSON.stringify({ error: String((e && e.message) || e) })
  }
}`

/* The whole command line: the script is always the same text; what varies travels after it, as data. */
const osascriptArgs = (command, args) => ['-l', 'JavaScript', '-e', SCRIPT, command, JSON.stringify(args)]

function osascript(command, args, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('osascript', osascriptArgs(command, args), { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.killed ? 'timed out ' : ''}${stderr || error.message}`))
      else resolve(String(stdout))
    })
  })
}

const MAIL_APPS = ['/System/Applications/Mail.app', '/Applications/Mail.app']
const there = () => MAIL_APPS.some((file) => { try { return fs.statSync(file).isDirectory() } catch { return false } })
const quiet = (file, args) => new Promise((resolve) => execFile(file, args, { timeout: 8000 }, (error) => resolve(!error)))
// Internet Accounts in System Settings: where a Google account is added to the Mac (Mail, Calendar, Contacts).
const ACCOUNTS_PANE = 'x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension'

/* `run`, `installed`, `running`, `launch` and `openPane` are passed in so tests can answer as the Mac would.
   Off the Mac nothing is asked. */
async function createMacMail({
  sharedModule, handle, fail, run = osascript, platform = process.platform, installed = there,
  running = () => quiet('pgrep', ['-x', 'Mail']),
  launch = () => quiet('open', ['-g', '-j', '-b', 'com.apple.mail']),
  openPane = () => quiet('open', [ACCOUNTS_PANE]),
  settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const model = await sharedModule('mail-model.mjs')

  /* Asking Mail something starts it when it isn't running, and then its window jumps out over whatever Nate
     was doing. So OSAT starts it first, hidden and in the background, and gives it a moment. */
  async function wake() {
    if (await running()) return
    if (await launch()) await settle(1500)
  }

  async function ask(command, args = {}, options) {
    let answer
    try {
      await wake()
      answer = JSON.parse(await run(command, args, options))
    } catch (error) {
      console.error(`Mail (${command}) failed:`, String(error.message).slice(0, 200))
      fail(model.explainMail(error))
    }
    if (answer && answer.error) fail(model.explainMail(answer.error))
    return answer
  }
  const need = (id) => (model.validMessageId(id) ? id : fail('That isn’t a message in your inbox.'))

  handle('mail:status', async () => ({ available: platform === 'darwin' && installed() === true }), { from: 'app' })
  handle('mail:allow', async () => ask('allow', {}, { timeout: 130000 }), { from: 'app' })
  handle('mail:accounts', async () => model.accountRows(await ask('accounts', {}, { timeout: 30000 })), { from: 'app' })
  // Adding Gmail: the Mac signs in to Google itself (OSAT never sees a password or a token), then Mail reads it.
  handle('mail:add-account', async () => (platform === 'darwin' ? openPane() : false), { from: 'app' })
  handle('mail:list', async () => model.messageRows(await ask('list', {}, { timeout: 90000 })), { from: 'app' })
  handle('mail:search', async (query, inside) => {
    const words = model.cleanQuery(query)
    if (!words) fail('Type a word to look for.')
    return model.messageRows(await ask('search', { query: words, inside: inside === true }, { timeout: inside === true ? 180000 : 90000 }))
  }, { from: 'app' })
  handle('mail:read', async (id) => model.messageFull(await ask('read', { id: need(id) }, { timeout: 40000 })) || fail(model.GONE), { from: 'app' })
  handle('mail:reply', async (id) => { await ask('reply', { id: need(id) }, { timeout: 40000 }); return true }, { from: 'app' })
  handle('mail:open', async (id) => { await ask('open', { id: need(id) }, { timeout: 40000 }); return true }, { from: 'app' })
}

module.exports = { SCRIPT, osascriptArgs, createMacMail, ACCOUNTS_PANE }
