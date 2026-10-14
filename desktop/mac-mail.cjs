/* Your Mac's own Mail app, read from OSAT's Mail room (Phase 59). Mail is reached through `osascript -l
   JavaScript`, the way mac-calendar.cjs reaches EventKit: Nate's accounts are already signed in there, so
   OSAT never holds a mail password, token or sign-in of its own. It reads (the inbox of every account, one
   message, a search), starts a reply in Mail's own compose window and opens a message in Mail. It never
   sends, deletes, moves or marks anything, and never asks Mail to fetch. macOS asks once whether OSAT may
   control Mail (Automation); `allow` is the only thing that asks, and it is the button's job.
   Safety: execFile (no shell); the script is one fixed text and the command and its JSON travel as
   arguments, never joined into the script; ids and search words are checked here first; what comes
   back is data. Nothing here is offered to the AI, the agent, the brief or the connector.
   The window's side (shapes, cleaning, words) is shared/mail-model.mjs. */
const fs = require('node:fs')
const { execFile } = require('node:child_process')

/* One script, one command per run: argv[0] is the command, argv[1] its JSON. It always prints one JSON
   line: the answer, or { error }. Messages are found by their number in the combined inbox; the list is
   the newest ones, a search reads Mail's own matching. */
const SCRIPT = `const LIST = 50
const Mail = Application("Mail")
const fail = (code) => { throw new Error(code) }
const attempt = (fn, otherwise) => { try { const v = fn(); return v === null || v === undefined ? otherwise : v } catch (e) { return otherwise } }

function accounts() {
  if (Mail.accounts.length === 0) fail("noAccounts")
}

function find(id) {
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

/* The newest few of a set of messages, whatever order Mail keeps them in. The dates come in one request;
   a snippet needs the body, so those stop after twenty seconds and the rest show without one. */
function newest(found) {
  const n = found.length
  if (n === 0) return []
  const dates = found.dateReceived()
  const order = dates.map((d, i) => [d ? d.getTime() : 0, i]).sort((a, b) => b[0] - a[0]).slice(0, LIST)
  const end = Date.now() + 20000
  return order.map((pair) => row(found[pair[1]], Date.now() < end))
}

function run(argv) {
  try {
    const cmd = argv[0]
    const a = JSON.parse(argv[1] || "{}")
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
      const m = find(a.id)
      const out = row(m, false)
      out.body = attempt(() => String(m.content()).slice(0, 30000), "")
      return JSON.stringify(out)
    }
    if (cmd === "reply") {
      const m = find(a.id)
      Mail.reply(m, { openingWindow: true })
      Mail.activate()
      return JSON.stringify({ ok: true })
    }
    if (cmd === "open") {
      const m = find(a.id)
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

/* `run` and `installed` are passed in so tests can answer as the Mac would. Off the Mac nothing is asked. */
async function createMacMail({ sharedModule, handle, fail, run = osascript, platform = process.platform, installed = there }) {
  const model = await sharedModule('mail-model.mjs')

  async function ask(command, args = {}, options) {
    let answer
    try {
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

module.exports = { SCRIPT, osascriptArgs, createMacMail }
