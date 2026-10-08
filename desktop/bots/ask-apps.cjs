/* Apps OSAT can use (Phase 48, Settings → Bots): the MCP servers Claude uses (Google Calendar,
   Gmail, Notion…), added by Nate or imported from Claude Desktop, each one off until he turns it on.
   The list is <data folder>/ask-apps.json, written whole like bots.json. Keys and env values never
   go there or to the window: they sit in the Keychain as 'ask-app-<id>' (base64 JSON
   { headers, env }); the file keeps only their names. What each app can do (its tools) is kept
   there too, refreshed on Check, so listing them never has to start anything.
   A connection starts on first use and closes after 10 idle minutes; all close at quit and when
   OSAT goes offline (closeAll), and offline, using one says it waits. A command only ever runs
   because Nate added it, or imported and then turned it on, having seen its whole command line. */
const os = require('node:os')
const path = require('node:path')
const nodeFs = require('node:fs/promises')
const { randomBytes } = require('node:crypto')
const { connect: mcpConnect } = require('./mcp-client.cjs')

const IDLE = 10 * 60 * 1000
const WAITS = 'Apps OSAT uses wait until you’re back online.'
const CLAUDE_CONFIG = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
// keychain.cjs takes a secret of up to 400 safe letters; base64 is safe.
// ponytail: one Keychain item per app caps keys at about 290 letters; split it if a real key is longer.
const MAX_SECRET = 400
const MAX_TOOLS = 200

const plain = (text) => new Error(text)
const account = (id) => `ask-app-${id}`
const strings = (value) => (value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([key, text]) => typeof text === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(key)))
  : {})

/* A command line as Nate would type it: quotes and backslashes group words; NAME=value words in
   front are its env (kept in the Keychain), as in Terminal. */
function splitCommandLine(line) {
  const words = []
  let word = null
  let quote = ''
  const text = String(line || '')
  for (let at = 0; at < text.length; at += 1) {
    const letter = text[at]
    if (quote) {
      if (letter === quote) quote = ''
      else if (letter === '\\' && quote === '"' && at + 1 < text.length) word += text[++at]
      else word += letter
    } else if (letter === '"' || letter === '\'') {
      quote = letter
      word ??= ''
    } else if (letter === '\\' && at + 1 < text.length) {
      word = (word ?? '') + text[++at]
    } else if (/\s/.test(letter)) {
      if (word !== null) words.push(word)
      word = null
    } else {
      word = (word ?? '') + letter
    }
  }
  if (quote) throw plain('A quote in the command isn’t closed.')
  if (word !== null) words.push(word)
  const env = {}
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
    const [name, ...value] = words.shift().split('=')
    env[name] = value.join('=')
  }
  if (!words.length) throw plain('Write the command that starts it, for example npx -y @notionhq/notion-mcp-server.')
  return { command: words[0], args: words.slice(1), env }
}

const quote = (word) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, '\'\\\'\'')}'`)

/* The whole command line, shown before it is turned on; env values are dots. */
const commandLine = (command, args = [], secrets = []) => [...secrets.map((name) => `${name}=••••`), quote(command), ...args.map(quote)].join(' ')

/* A key as typed: "Name: value" is that header; "Bearer …" or a bare key is Authorization. */
function headerFrom(text) {
  const key = String(text || '').trim()
  if (!key) return {}
  if (/[\r\n]/.test(key)) throw plain('A key is one line.')
  const named = /^([A-Za-z0-9-]+):\s*(\S.*)$/.exec(key)
  if (named && !/^(bearer|basic|token)$/i.test(named[1])) return { [named[1]]: named[2] }
  return { Authorization: /^(bearer|basic|token)\s/i.test(key) ? key : `Bearer ${key}` }
}

/* A web address: https, or http only on this Mac (a key must never cross the network unlocked). */
function webAddress(text) {
  let url
  try {
    url = new URL(String(text || '').trim())
  } catch {
    throw plain('Give its full web address, starting with https://.')
  }
  const here = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && here)) throw plain('Give its full web address, starting with https://.')
  if (url.username || url.password) throw plain('Put the key in the key box, not in the address.')
  return url.href
}

const cleanName = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60)
const nameFor = (app) => (app.kind === 'http' ? new URL(app.url).hostname.replace(/^(www|mcp|api)\./, '') : path.basename(app.args.find((arg) => !arg.startsWith('-')) || app.command))

const cleanTool = (tool) => ({
  name: String(tool.name),
  description: String(tool.description || '').slice(0, 1000),
  inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object' },
  readOnly: tool.annotations?.readOnlyHint === true,
})

function createAskApps({
  file,
  keychain,
  offline = () => false,
  version = '0',
  ownPort = () => 0,
  claudeConfig = CLAUDE_CONFIG,
  connect = mcpConnect,
  fs = nodeFs,
  idle = IDLE,
  timers = { setTimeout, clearTimeout },
  now = () => new Date().toISOString(),
  makeId = () => randomBytes(6).toString('hex'),
} = {}) {
  let apps = []
  let writing = Promise.resolve()
  let removed = null // the last app removed, with its secret, for Undo
  const live = new Map() // id → { ready: Promise<client>, timer }
  const errors = new Map() // id → the last plain error, until it works again

  function save() {
    const list = apps.map((app) => ({ ...app }))
    writing = writing.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      await fs.writeFile(temp, `${JSON.stringify(list, null, 1)}\n`, { mode: 0o600 })
      await fs.rename(temp, file)
    })
    return writing
  }

  function find(id) {
    const app = apps.find((item) => item.id === id)
    if (!app) throw plain('That app isn’t in OSAT any more.')
    return app
  }

  const whereOf = (app) => (app.kind === 'http' ? app.url : commandLine(app.command, app.args, app.secrets))

  const row = (app) => ({
    id: app.id,
    name: app.name,
    kind: app.kind,
    on: app.on,
    where: whereOf(app),
    withKey: app.secrets.length > 0,
    from: app.from || '',
    tools: app.tools ? app.tools.length : null,
    toolNames: (app.tools || []).map((tool) => tool.name),
    // "It waits until you're back online" no longer holds once OSAT is.
    error: errors.get(app.id) === WAITS && !offline() ? '' : errors.get(app.id) || '',
    checkedAt: app.checkedAt || null,
  })

  async function keep(id, secret) {
    const encoded = Buffer.from(JSON.stringify(secret)).toString('base64')
    if (encoded.length > MAX_SECRET) throw plain('That key is too long for OSAT to keep.')
    await keychain.set(account(id), encoded)
  }

  async function secretOf(app) {
    if (!app.secrets.length) return {}
    try {
      return JSON.parse(Buffer.from(await keychain.get(account(app.id)) || '', 'base64').toString('utf8'))
    } catch {
      return {}
    }
  }

  /* ---- connections ---- */

  function close(id) {
    const entry = live.get(id)
    if (!entry) return
    live.delete(id)
    timers.clearTimeout(entry.timer)
    entry.ready.then((client) => client.close(), () => {})
  }

  function closeAll() {
    for (const id of [...live.keys()]) close(id)
  }

  async function start(app) {
    const secret = await secretOf(app)
    // Offline may have come on while the Keychain answered.
    if (offline()) throw plain(WAITS)
    return connect(app.kind === 'command'
      ? { kind: 'command', command: app.command, args: app.args, env: strings(secret.env) }
      : { kind: 'http', url: app.url, headers: strings(secret.headers) }, { version })
  }

  /* The app's connection, started on first use; each use starts its 10 idle minutes again. */
  function use(id) {
    if (offline()) return Promise.reject(plain(WAITS))
    const app = find(id)
    let entry = live.get(id)
    if (!entry) {
      entry = { ready: start(app), timer: null }
      live.set(id, entry)
      entry.ready.then(() => errors.delete(id), (error) => {
        errors.set(id, error.message)
        if (live.get(id) === entry) close(id)
      })
    }
    timers.clearTimeout(entry.timer)
    entry.timer = timers.setTimeout(() => close(id), idle)
    entry.timer?.unref?.()
    return entry.ready
  }

  /* Connects and lists what it can do; a problem is kept on its row, not thrown. */
  async function check(id) {
    const app = find(id)
    try {
      const client = await use(id)
      app.tools = (await client.tools()).filter((tool) => tool && typeof tool.name === 'string').slice(0, MAX_TOOLS).map(cleanTool)
      app.checkedAt = now()
      errors.delete(id)
      await save()
    } catch (error) {
      errors.set(id, error.message)
      close(id)
    }
    return row(app)
  }

  /* ---- the list ---- */

  async function add(input = {}, { from = '' } = {}) {
    const app = { id: makeId(), name: '', kind: input.kind === 'command' ? 'command' : 'http', on: !from, addedAt: now(), secrets: [] }
    const secret = {}
    if (app.kind === 'http') {
      app.url = webAddress(input.url)
      const headers = { ...strings(input.headers), ...headerFrom(input.header) }
      if (Object.values(headers).some((value) => /[\r\n]/.test(value))) throw plain('A key is one line.')
      if (Object.keys(headers).length) secret.headers = headers
    } else {
      // A command line as one string, or (imported) the command, its words and its env.
      const given = Array.isArray(input.args)
        ? { command: String(input.command || '').trim(), args: input.args.map(String), env: {} }
        : splitCommandLine(input.command)
      given.env = { ...given.env, ...strings(input.env) }
      if (!given.command || /[\r\n\0]/.test([given.command, ...given.args].join(' '))) throw plain('Write the command that starts it.')
      app.command = given.command
      app.args = given.args.slice(0, 100)
      if (Object.keys(given.env).length) secret.env = given.env
    }
    app.secrets = [...Object.keys(secret.headers || {}), ...Object.keys(secret.env || {})]
    app.name = cleanName(input.name) || nameFor(app)
    if (from) app.from = from
    if (app.secrets.length) await keep(app.id, secret)
    apps.push(app)
    await save()
    // Added by hand, it is on: Nate wrote it. Imported, it waits until he turns it on.
    return app.on && !offline() ? check(app.id) : row(app)
  }

  async function toggle(id, on) {
    const app = find(id)
    app.on = on === true
    await save()
    if (!app.on) {
      close(id)
      errors.delete(id)
      return row(app)
    }
    return offline() ? row(app) : check(id)
  }

  async function remove(id) {
    const index = apps.findIndex((item) => item.id === id)
    if (index < 0) throw plain('That app isn’t in OSAT any more.')
    const app = apps[index]
    const secret = app.secrets.length ? await keychain.get(account(id)) : null
    apps.splice(index, 1)
    close(id)
    errors.delete(id)
    removed = { app, index, secret }
    await save()
    if (secret) await keychain.remove(account(id))
    return { name: app.name }
  }

  async function undoRemove() {
    if (!removed) throw plain('There’s nothing to put back.')
    const { app, index, secret } = removed
    removed = null
    if (secret) await keychain.set(account(app.id), secret)
    apps.splice(Math.min(index, apps.length), 0, app)
    await save()
    return row(app)
  }

  /* ---- Claude Desktop ---- */

  // OSAT's own connector, set up in Claude Desktop through mcp-remote, is never offered back.
  const isOwn = (where) => {
    const port = ownPort()
    return Boolean(port) && new RegExp(`(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}/mcp\\b`).test(where)
  }

  async function readClaude() {
    let config
    try {
      config = JSON.parse(await fs.readFile(claudeConfig, 'utf8'))
    } catch (error) {
      throw plain(error.code === 'ENOENT' ? 'Claude Desktop’s settings aren’t on this Mac.' : 'OSAT couldn’t read Claude Desktop’s settings.')
    }
    const servers = config?.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {}
    return Object.entries(servers).flatMap(([name, server]) => {
      if (typeof server?.url === 'string') return [{ name, kind: 'http', url: server.url, headers: strings(server.headers), where: server.url }]
      if (typeof server?.command !== 'string' || !server.command.trim()) return []
      const args = Array.isArray(server.args) ? server.args.map(String) : []
      const env = strings(server.env)
      return [{ name, kind: 'command', command: server.command, args, env, where: commandLine(server.command, args, Object.keys(env)) }]
    }).filter((item) => !isOwn(item.where))
  }

  const already = (item) => apps.some((app) => app.name === cleanName(item.name) && whereOf(app) === item.where)

  /* What could come over: names and the whole command line, never an env value. */
  async function claudeOffers() {
    return { apps: (await readClaude()).map((item) => ({ name: item.name, kind: item.kind, where: item.where, withKey: Object.keys(item.env || item.headers).length > 0, added: already(item) })) }
  }

  /* Only names come from the window; what runs is read again from Claude Desktop's file. */
  async function importClaude(names) {
    const wanted = new Set([].concat(names || []).map(String))
    const added = []
    const skipped = []
    for (const item of await readClaude()) {
      if (!wanted.has(item.name) || already(item)) continue
      try {
        added.push(await add(item, { from: 'Claude Desktop' }))
      } catch (error) {
        skipped.push({ name: item.name, why: error.message })
      }
    }
    return { added, skipped }
  }

  /* ---- for Ask ---- */

  /* What the apps that are on can do; one never checked is checked now. Never throws: an app
     that fails is left out, its reason on its row. Offline, nothing. */
  async function tools() {
    if (offline()) return []
    await Promise.all(apps.filter((app) => app.on && !app.tools).map((app) => check(app.id).catch(() => {})))
    return apps.filter((app) => app.on).flatMap((app) => (app.tools || []).map((tool) => ({ app: app.id, appName: app.name, ...tool })))
  }

  async function call(id, name, args) {
    const app = find(id)
    if (!app.on) throw plain(`${app.name} is off. Turn it on in Settings → Bots first.`)
    const client = await use(id)
    try {
      return await client.call(String(name), args && typeof args === 'object' && !Array.isArray(args) ? args : {})
    } catch (error) {
      close(id) // a fresh start next time
      throw error
    }
  }

  return {
    async load() {
      try {
        const saved = JSON.parse(await fs.readFile(file, 'utf8'))
        apps = (Array.isArray(saved) ? saved : []).filter((app) => typeof app?.id === 'string' && (app.kind === 'http' ? typeof app.url === 'string' : app.kind === 'command' && typeof app.command === 'string'))
          .map((app) => ({ ...app, on: app.on === true, secrets: Array.isArray(app.secrets) ? app.secrets.map(String) : [], args: app.kind === 'command' ? (Array.isArray(app.args) ? app.args.map(String) : []) : undefined }))
      } catch {
        apps = [] // none yet, or unreadable
      }
      return apps.length
    },
    status: () => ({ apps: apps.map(row), offline: offline() }),
    add: (input) => add(input),
    toggle,
    remove,
    undoRemove,
    check,
    claudeOffers,
    importClaude,
    tools,
    call,
    closeAll,
    running: () => [...live.keys()],
  }
}

module.exports = { createAskApps, splitCommandLine, commandLine, headerFrom, webAddress, WAITS }
