/* Bots in (Phase 16): everything that lets Muse, Grok Bot, Claude and other AI reach OSAT,
   and OSAT reach them, in one place with one Settings section (Settings → Bots):
     the drop folder   node files saved in ~/Documents/OSAT Nodes become nodes (drop-folder.cjs)
     cloud models      any provider with a key, next to the AI on this Mac (cloud.cjs)
     the connector     an MCP server on this Mac only, off until turned on (connector.cjs); each app
                       has its own key and may only read or also change (Phase 44)
     apps OSAT uses    the MCP servers Claude uses (Gmail, Notion…), each off until turned on (ask-apps.cjs)
   Every model and privacy setting lives here, so what leaves the Mac is said in one place.
   Main passes in what it owns (the store, IPC, Finder, the clipboard); this wires it up.
   Every change goes through the store, so the windows, Undo and sync see it. */
const path = require('node:path')
const { randomBytes, randomUUID } = require('node:crypto')
const { watchFolder } = require('../folder-watch.cjs')
const { createAskApps } = require('./ask-apps.cjs')
const { createCloud } = require('./cloud.cjs')
const { appWithKey, createConnector } = require('./connector.cjs')
const { createDropFolder } = require('./drop-folder.cjs')
const { createKeychain } = require('./keychain.cjs')
const { createSettings } = require('./settings.cjs')

/* Where keys are kept. The e2e test runs with a temp HOME, where the real Keychain can't be found
   and macOS pops a dialog, so it sets OSAT_KEYCHAIN=memory. As with OSAT_NODES_DIR, only from source:
   main gives the packaged app the service name 'OSAT' and source runs 'OSAT-Dev'. */
function keychainFor({ service, env = process.env, platform = process.platform }) {
  const memory = service !== 'OSAT' && env.OSAT_KEYCHAIN === 'memory'
  return createKeychain({ service, platform: memory ? 'memory' : platform })
}

async function createBots({ dataDir, nodesDir, service, store, sharedModule, handle, fail, send, shell, clipboard, findFiles, version = '0', offline = () => false, keychain = keychainFor({ service }), now = Date.now }) {
  const core = await sharedModule('node-file.mjs')
  const providers = await sharedModule('providers.mjs')
  const tools = await sharedModule('connector-tools.mjs')
  const { applyOps } = await sharedModule('store-core.mjs')
  const settings = createSettings({ file: path.join(dataDir, 'bots.json'), clean: providers.cleanBotSettings })
  await settings.load()
  const cloud = createCloud({ core: providers, settings, keychain, offline })
  const askApps = createAskApps({ file: path.join(dataDir, 'ask-apps.json'), keychain, offline, version, ownPort: () => settings.get().connector.port || tools.CONNECTOR_PORT })
  await askApps.load()
  const client = store.connect(() => {})
  const makeId = (prefix) => `${prefix}-${randomUUID()}`
  const status = () => ({
    nodes: drop.status(),
    cloud: cloud.status(),
    connector: connectorStatus(),
    askApps: askApps.status().apps,
    offline: offline(),
  })
  const changed = () => {
    // Main calls this when OSAT goes offline too: every app's connection and command closes then.
    if (offline()) askApps.closeAll()
    send('bots:status', status())
  }

  /* A node file's tree becomes a New node (packed when it is only a summary). */
  function take(tree, { name, hash, source = '' }) {
    const result = core.arrivalOps(store.load().doc, tree, { hash, file: name, source, now: new Date().toISOString(), makeId })
    if (result.ops) store.commit(client, result.ops)
    return result
  }

  const drop = createDropFolder({ dir: nodesDir, core, take, onStatus: changed })
  let watch = null

  /* ---- the connector: each app has its own key, in the Keychain as `connector-key-<id>`, and its
     own access (read, or read and change); settings.connector.apps lists them, never a key ---- */
  const OLD_KEY = 'connector-key' // the one key every app shared before Phase 44
  const keyAccount = (id) => `connector-key-${id}`
  const newKey = () => randomBytes(24).toString('base64url')
  const keys = new Map() // app id → its key, read from the Keychain once
  let keysRead = null
  let removed = null // the last app removed, with its key, so Undo can put it back
  let connectorPort = 0
  let connectorError = ''
  let recent = [] // what apps did through it lately, each with its Undo: { at, text, inverse }
  const apps = () => settings.get().connector.apps
  const saveApps = (list) => settings.save({ connector: { ...settings.get().connector, apps: list } })
  const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1)

  // Used a moment ago: saved at most once a minute per app.
  function used(app) {
    if (now() - Date.parse(app.usedAt || '') < 60000) return
    const usedAt = new Date(now()).toISOString()
    saveApps(apps().map((item) => (item.id === app.id ? { ...item, usedAt } : item))).then(changed, () => {})
  }

  const connector = createConnector({
    tools: tools.TOOLS,
    version,
    appFor(given) {
      const app = appWithKey(given, apps().map((item) => ({ app: item, key: keys.get(item.id) })))
      if (app) used(app)
      return app
    },
    // A tool's changes go through the store in one commit, marked with the app's name; what undoes them is kept for Undo.
    async call(name, args, app) {
      const result = await tools.runTool(name, args, { doc: store.load().doc, now: new Date().toISOString(), makeId, source: app.name, findFiles })
      if (result.ops?.length) {
        const { inverse } = applyOps(store.load().doc, result.ops)
        store.commit(client, result.ops)
        recent = [{ at: new Date().toISOString(), text: `${app.name} ${lowerFirst(result.text.replace(/ \((?:note|folder|event)-[^)]+\)/g, ''))}`, inverse }, ...recent].slice(0, 5)
        changed()
      }
      return { text: result.text }
    },
  })
  const connectorUrl = () => (connectorPort ? `http://127.0.0.1:${connectorPort}/mcp` : '')
  function connectorStatus() {
    return {
      on: settings.get().connector.on,
      running: connector.running(),
      url: connectorUrl(),
      error: connectorError,
      apps: apps(),
      removed: removed ? { id: removed.app.id, name: removed.app.name } : null,
      recent: recent.map(({ at, text }) => ({ at, text })),
    }
  }

  async function makeApp(name, access, key = newKey()) {
    const app = { id: randomUUID(), name, access: access === 'write' ? 'write' : 'read', createdAt: new Date(now()).toISOString() }
    await keychain.set(keyAccount(app.id), key)
    keys.set(app.id, key)
    await saveApps([...apps(), app])
    return app
  }

  /* Every app's key, from the Keychain, once. The single key from before becomes "First app",
     able to change things as it was, with the same key, so an app set up with it keeps working. */
  function readKeys() {
    keysRead ||= (async () => {
      const old = await keychain.get(OLD_KEY)
      if (old && !apps().length) await makeApp('First app', 'write', old)
      if (old) await keychain.remove(OLD_KEY) // else a removed First app would come back
      for (const app of apps()) {
        if (keys.has(app.id)) continue
        let key = await keychain.get(keyAccount(app.id))
        if (!key) {
          key = newKey()
          await keychain.set(keyAccount(app.id), key)
        }
        keys.set(app.id, key)
      }
    })().catch((error) => {
      keysRead = null
      throw error
    })
    return keysRead
  }

  function appOrSay(id) {
    const app = apps().find((item) => item.id === id)
    if (!app) throw new Error('That app isn’t connected any more.')
    return app
  }

  async function startConnector() {
    await readKeys()
    try {
      connectorPort = await connector.start(settings.get().connector.port || tools.CONNECTOR_PORT)
      connectorError = ''
    } catch (error) {
      connectorError = `The connector couldn’t start (${error.code || error.message}).`
      throw new Error(connectorError)
    }
    if (connectorPort !== settings.get().connector.port) await settings.save({ connector: { ...settings.get().connector, port: connectorPort } })
  }

  /* For OSAT's own features (Siri and Shortcuts, webhooks): the key of the app with this exact
     name, made the first time with `access`. Never through IPC: the key stays in main. */
  async function appKey(name, access) {
    await readKeys()
    const wanted = providers.cleanAppName(name)
    if (!wanted) throw new Error('An app needs a name.')
    const app = apps().find((item) => item.name === wanted) || await makeApp(wanted, access)
    changed()
    return { id: app.id, key: keys.get(app.id) }
  }

  async function start() {
    try {
      await drop.prepare()
    } catch (error) {
      console.error('The drop folder could not be made:', error)
    }
    watch = watchFolder({ dir: nodesDir, look: drop.look })
    if (settings.get().connector.on) startConnector().catch((error) => console.error('The connector could not start:', error.message)).finally(changed)
    await drop.look()
  }

  function stop() {
    watch?.stop()
    connector.stop()
    askApps.closeAll()
    watch = null
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
  // The connector: on, off, the apps that may reach it (each its own key), and what to paste where.
  handle('bots:connector-on', plain(async () => {
    await settings.save({ connector: { ...settings.get().connector, on: true } })
    await startConnector()
    return connectorStatus()
  }), { from: 'app' })
  handle('bots:connector-off', plain(async () => {
    connector.stop()
    await settings.save({ connector: { ...settings.get().connector, on: false } })
    return connectorStatus()
  }), { from: 'app' })
  handle('bots:app-add', plain(async ({ name, access } = {}) => {
    await readKeys()
    const wanted = providers.cleanAppName(name)
    if (!wanted) throw new Error('Give the app a name, like Claude Code.')
    if (apps().some((app) => app.name.toLowerCase() === wanted.toLowerCase())) throw new Error(`“${wanted}” is already here. Copy its setup below, or give this one another name.`)
    await makeApp(wanted, access)
    return connectorStatus()
  }), { from: 'app' })
  handle('bots:app-access', plain(async (id, access) => {
    appOrSay(id)
    await saveApps(apps().map((app) => (app.id === id ? { ...app, access: access === 'write' ? 'write' : 'read' } : app)))
    return connectorStatus()
  }), { from: 'app' })
  // Its key stops working at once; Undo puts the app back with the same key.
  handle('bots:app-remove', plain(async (id) => {
    await readKeys()
    const app = appOrSay(id)
    removed = { app, key: keys.get(id) }
    keys.delete(id)
    await saveApps(apps().filter((item) => item.id !== id))
    await keychain.remove(keyAccount(id))
    return connectorStatus()
  }), { from: 'app' })
  handle('bots:app-undo-remove', plain(async () => {
    if (!removed) throw new Error('There’s nothing to put back.')
    const { app, key } = removed
    await keychain.set(keyAccount(app.id), key)
    keys.set(app.id, key)
    await saveApps([...apps().filter((item) => item.id !== app.id), app])
    removed = null
    return connectorStatus()
  }), { from: 'app' })
  // The old key stops working at once; the app needs its setup again.
  handle('bots:app-reset', plain(async (id) => {
    appOrSay(id)
    const key = newKey()
    await keychain.set(keyAccount(id), key)
    keys.set(id, key)
    return connectorStatus()
  }), { from: 'app' })
  handle('bots:copy-setup', plain((which, id) => {
    appOrSay(id)
    if (!connector.running() || !keys.get(id)) throw new Error('Turn the connector on first.')
    clipboard.writeText(tools.connectorSetup(String(which), { url: connectorUrl(), key: keys.get(id) }))
    return true
  }), { from: 'app' })
  handle('bots:undo-connector', plain((at) => {
    const done = recent.find((item) => item.at === at)
    if (!done) throw new Error('That can’t be undone any more.')
    store.commit(client, done.inverse)
    recent = recent.filter((item) => item !== done)
    return true
  }), { from: 'app' })

  /* Apps OSAT can use (ask-apps.cjs): keys and env values go to the Keychain, never back here.
     Using one waits while offline (under.cjs). Ask in the quick bar lists and calls them too. */
  handle('askapps:status', () => askApps.status(), { from: 'app' })
  handle('askapps:add', plain((input) => askApps.add(input && typeof input === 'object' ? input : {})), { from: 'app' })
  handle('askapps:remove', plain((id) => askApps.remove(String(id))), { from: 'app' })
  handle('askapps:undo-remove', plain(() => askApps.undoRemove()), { from: 'app' })
  handle('askapps:toggle', plain((id, on) => askApps.toggle(String(id), on === true)), { from: 'app' })
  handle('askapps:check', plain((id) => askApps.check(String(id))), { from: 'app' })
  handle('askapps:claude-config', plain(() => askApps.claudeOffers()), { from: 'app' })
  handle('askapps:import', plain((names) => askApps.importClaude(Array.isArray(names) ? names : [])), { from: 'app' })
  handle('askapps:tools', plain(() => askApps.tools()), { from: 'any' })
  handle('askapps:call', plain((id, name, args) => askApps.call(String(id), String(name), args)), { from: 'any' })

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
    appKey,
    // For Ask in main: what the apps that are on can do (never throws; a failing app is left out
    // and its reason shows in Settings → Bots), and one of them doing it.
    askApps: { tools: () => askApps.tools(), call: (id, name, args) => askApps.call(String(id), String(name), args) },
  }
}

module.exports = { createBots, keychainFor }
