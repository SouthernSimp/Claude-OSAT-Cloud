/* Bots in (Phase 16): everything that lets Muse, Grok Bot, Claude and other AI reach OSAT,
   and OSAT reach them, in one place with one Settings section (Settings → Bots):
     the drop folder   node files saved in ~/Documents/OSAT Nodes become nodes (drop-folder.cjs)
     cloud models      any provider with a key, next to the AI on this Mac (cloud.cjs)
     scans             new scans in a folder (Google Drive's) become named nodes (scans.cjs)
     the connector     an MCP server on this Mac only, with a key, off until turned on (connector.cjs)
   Every model and privacy setting lives here, so what leaves the Mac is said in one place.
   Main passes in what it owns (the store, IPC, Finder, the clipboard); this wires it up.
   Every change goes through the store, so the windows, Undo and sync see it. */
const path = require('node:path')
const { randomBytes, randomUUID } = require('node:crypto')
const { watchFolder } = require('../folder-watch.cjs')
const { createCloud } = require('./cloud.cjs')
const { createConnector } = require('./connector.cjs')
const { createDropFolder } = require('./drop-folder.cjs')
const { createKeychain } = require('./keychain.cjs')
const { createScans } = require('./scans.cjs')
const { createSettings } = require('./settings.cjs')

/* Main passes `ask(messages)` (the model chosen here, else the AI on this Mac), `read(file)`
   (a scan's words, on this Mac), `preview(file)` (Quick Look) and `chooseFolder(options)`. */
async function createBots({ dataDir, nodesDir, service, store, sharedModule, handle, fail, send, shell, clipboard, ask, read, preview, chooseFolder, driveDir = '', version = '0', offline = () => false }) {
  const core = await sharedModule('node-file.mjs')
  const providers = await sharedModule('providers.mjs')
  const tasks = await sharedModule('ai-tasks.mjs')
  const tools = await sharedModule('connector-tools.mjs')
  const { applyOps } = await sharedModule('store-core.mjs')
  const { normalizeNote } = await sharedModule('note-core.mjs')
  const settings = createSettings({ file: path.join(dataDir, 'bots.json'), clean: providers.cleanBotSettings })
  await settings.load()
  const keychain = createKeychain({ service })
  const cloud = createCloud({ core: providers, settings, keychain, offline })
  const client = store.connect(() => {})
  const makeId = (prefix) => `${prefix}-${randomUUID()}`
  const status = () => ({
    nodes: drop.status(),
    cloud: cloud.status(),
    scans: { ...scans.status(), dir: settings.get().scanDir, drive: driveDir },
    connector: connectorStatus(),
    offline: offline(),
  })
  const changed = () => send('bots:status', status())

  /* A node file's tree (or a scan) becomes a New node (packed when it is only a summary). */
  function take(tree, { name, hash, source = '', scan }) {
    const result = core.arrivalOps(store.load().doc, tree, { hash, file: name, source, scan, now: new Date().toISOString(), makeId })
    if (result.ops) store.commit(client, result.ops)
    return result
  }

  const folderOf = (id) => store.load().doc.folders.find((folder) => folder.id === id) || null

  const drop = createDropFolder({ dir: nodesDir, core, take, onStatus: changed })
  const scans = createScans({
    dataDir,
    folder: () => settings.get().scanDir,
    take,
    read,
    // The words on the scan: a sticky in its node, so ⌘K finds it and Unpack has it to work with.
    addText(folderId, text) {
      if (!folderOf(folderId)) return
      const now = new Date().toISOString()
      const note = normalizeNote({ id: makeId('note'), markdown: text, folderId, source: 'Scan', createdAt: now, updatedAt: now, rank: 2048 })
      store.commit(client, [{ t: 'add', c: 'notes', v: note, at: 0 }])
    },
    // A name and a summary from the chosen model, waiting on the node for one click.
    async propose(folderId, text, name) {
      const proposal = tasks.readNameAnswer(await ask(tasks.nameMessages({ text, file: name })))
      const folder = folderOf(folderId)
      if (folder) store.commit(client, [{ t: 'patch', c: 'folders', id: folderId, v: { from: core.fromOf({ ...folder.from, proposal }) } }])
    },
    onStatus: changed,
  })
  let watch = null
  let scanWatch = null

  /* ---- the connector ---- */
  const KEY_ACCOUNT = 'connector-key'
  let connectorKey = null
  let connectorPort = 0
  let connectorError = ''
  let recent = [] // what bots did through it lately, each with its Undo: { at, text, inverse }
  const connector = createConnector({
    tools: tools.TOOLS,
    key: () => connectorKey,
    version,
    // A tool's changes go through the store in one commit; what undoes them is kept for Undo.
    async call(name, args) {
      const doc = store.load().doc
      const result = tools.runTool(name, args, { doc, now: new Date().toISOString(), makeId })
      if (result.ops?.length) {
        const { inverse } = applyOps(doc, result.ops)
        store.commit(client, result.ops)
        recent = [{ at: new Date().toISOString(), text: result.text, inverse }, ...recent].slice(0, 5)
        changed()
      }
      return { text: result.text }
    },
  })
  const connectorUrl = () => (connectorPort ? `http://127.0.0.1:${connectorPort}/mcp` : '')
  function connectorStatus() {
    return { on: settings.get().connector.on, running: connector.running(), url: connectorUrl(), error: connectorError, recent: recent.map(({ at, text }) => ({ at, text })) }
  }
  async function startConnector() {
    connectorKey = await keychain.get(KEY_ACCOUNT)
    if (!connectorKey) {
      connectorKey = randomBytes(24).toString('base64url')
      await keychain.set(KEY_ACCOUNT, connectorKey)
    }
    try {
      connectorPort = await connector.start(settings.get().connector.port || tools.CONNECTOR_PORT)
      connectorError = ''
    } catch (error) {
      connectorError = `The connector couldn’t start (${error.code || error.message}).`
      throw new Error(connectorError)
    }
    if (connectorPort !== settings.get().connector.port) await settings.save({ connector: { ...settings.get().connector, port: connectorPort } })
  }

  function watchScans() {
    scanWatch?.stop()
    scanWatch = null
    const dir = settings.get().scanDir
    if (!dir) return
    scanWatch = watchFolder({ dir, look: scans.look })
    scans.look().catch(() => {})
  }

  async function start() {
    try {
      await drop.prepare()
    } catch (error) {
      console.error('The drop folder could not be made:', error)
    }
    watch = watchFolder({ dir: nodesDir, look: drop.look })
    watchScans()
    if (settings.get().connector.on) startConnector().catch((error) => console.error('The connector could not start:', error.message)).finally(changed)
    await drop.look()
  }

  function stop() {
    watch?.stop()
    scanWatch?.stop()
    connector.stop()
    watch = null
    scanWatch = null
  }

  // Messages from here are written for Nate, so they pass through as they are.
  const plain = (work) => async (...args) => {
    try {
      const result = await work(...args)
      changed()
      return result
    } catch (error) {
      fail(error.message)
    }
  }

  handle('bots:status', () => status(), { from: 'app' })
  handle('bots:show-nodes', async () => {
    await drop.prepare().catch(() => {})
    if (await shell.openPath(nodesDir)) fail('Finder couldn’t open the folder.')
    return true
  }, { from: 'app' })
  handle('bots:copy-instructions', () => {
    clipboard.writeText(core.botInstructions(nodesDir))
    return true
  }, { from: 'app' })
  handle('bots:connect', plain((input) => cloud.connect(input)), { from: 'app' })
  handle('bots:remove-provider', plain((id) => cloud.remove(String(id))), { from: 'app' })
  handle('bots:choose-model', plain((model) => cloud.choose(String(model))), { from: 'app' })
  // The scan folder: picking one notes what's already in it (brought in only when asked).
  handle('bots:choose-scan-folder', plain(async () => {
    const result = await chooseFolder({ title: 'The folder your scans arrive in', buttonLabel: 'Watch this folder', properties: ['openDirectory'], defaultPath: driveDir || undefined })
    const dir = result.canceled ? '' : result.filePaths[0]
    if (!dir) return false
    if (dir === nodesDir) throw new Error('That’s the folder for node files. Pick the folder your scans arrive in.')
    await settings.save({ scanDir: dir })
    await scans.baseline(dir)
    watchScans()
    return true
  }))
  handle('bots:stop-scans', plain(async () => {
    await settings.save({ scanDir: '' })
    watchScans()
    return true
  }))
  handle('bots:bring-scans', plain(() => scans.bringWaiting()))
  handle('bots:show-scan', (scan) => {
    const file = scans.copyPath(String(scan))
    if (!file) fail('That scan isn’t one of OSAT’s.')
    preview(file)
    return true
  }, { from: 'app' })

  // The connector: on (a key is made the first time), off, a new key, and what to paste where.
  handle('bots:connector-on', plain(async () => {
    await settings.save({ connector: { ...settings.get().connector, on: true } })
    await startConnector()
    return connectorStatus()
  }))
  handle('bots:connector-off', plain(async () => {
    connector.stop()
    await settings.save({ connector: { ...settings.get().connector, on: false } })
    return connectorStatus()
  }))
  // The old key stops working at once; apps need the new setup lines.
  handle('bots:connector-reset', plain(async () => {
    const key = randomBytes(24).toString('base64url')
    await keychain.set(KEY_ACCOUNT, key)
    connectorKey = key
    return connectorStatus()
  }))
  handle('bots:copy-setup', plain((which) => {
    if (!connector.running() || !connectorKey) throw new Error('Turn the connector on first.')
    clipboard.writeText(tools.connectorSetup(String(which), { url: connectorUrl(), key: connectorKey }))
    return true
  }))
  handle('bots:undo-connector', plain((at) => {
    const done = recent.find((item) => item.at === at)
    if (!done) throw new Error('That can’t be undone any more.')
    store.commit(client, done.inverse)
    recent = recent.filter((item) => item !== done)
    return true
  }))

  // Only a provider's own pages (its keys, its usage), in the browser Nate already uses.
  handle('bots:open-page', async (url) => {
    const known = providers.PRESETS.flatMap((preset) => [preset.keys, preset.usage])
    if (!known.includes(url)) fail('OSAT only opens a provider’s own pages from here.')
    if (offline()) fail('That page waits until you’re back online.')
    // Refused offline: the check sits on the same line (tests/under.test.mjs).
    if (!offline() && /^https:\/\//i.test(url)) await shell.openExternal(url)
    return true
  }, { from: 'app' })

  return {
    start,
    stop,
    status,
    changed,
    // The chosen cloud model, first in every list of models (Ask, the line).
    models: () => cloud.models(),
    chatStream: (payload, onDelta, signal) => cloud.chatStream(payload, onDelta, signal),
  }
}

module.exports = { createBots }
