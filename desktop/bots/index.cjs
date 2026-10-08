/* Bots in (Phase 16): everything that lets Muse, Grok Bot, Claude and other AI reach OSAT,
   and OSAT reach them, in one place with one Settings section (Settings → Bots):
     the drop folder   node files saved in ~/Documents/OSAT Nodes become nodes (drop-folder.cjs)
     cloud models      any provider with a key, next to the AI on this Mac (cloud.cjs)
     the connector     an MCP server on this Mac only, with a key, off until turned on (connector.cjs)
     webhooks          moments sent to other services, stickies from them through ntfy (webhooks.cjs)
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
const { createSettings } = require('./settings.cjs')
const { createWebhooks } = require('./webhooks.cjs')

/* Where keys are kept. The e2e test runs with a temp HOME, where the real Keychain can't be found
   and macOS pops a dialog, so it sets OSAT_KEYCHAIN=memory. As with OSAT_NODES_DIR, only from source:
   main gives the packaged app the service name 'OSAT' and source runs 'OSAT-Dev'. */
function keychainFor({ service, env = process.env, platform = process.platform }) {
  const memory = service !== 'OSAT' && env.OSAT_KEYCHAIN === 'memory'
  return createKeychain({ service, platform: memory ? 'memory' : platform })
}

async function createBots({ dataDir, nodesDir, service, store, sharedModule, handle, fail, send, shell, clipboard, version = '0', offline = () => false }) {
  const core = await sharedModule('node-file.mjs')
  const providers = await sharedModule('providers.mjs')
  const tools = await sharedModule('connector-tools.mjs')
  const { applyOps } = await sharedModule('store-core.mjs')
  const settings = createSettings({ file: path.join(dataDir, 'bots.json'), clean: providers.cleanBotSettings })
  await settings.load()
  const keychain = keychainFor({ service })
  const cloud = createCloud({ core: providers, settings, keychain, offline })
  const client = store.connect(() => {})
  const makeId = (prefix) => `${prefix}-${randomUUID()}`
  const status = () => ({
    nodes: drop.status(),
    cloud: cloud.status(),
    connector: connectorStatus(),
    offline: offline(),
  })
  const changed = () => send('bots:status', status())

  /* A node file's tree becomes a New node (packed when it is only a summary). */
  function take(tree, { name, hash, source = '' }) {
    const result = core.arrivalOps(store.load().doc, tree, { hash, file: name, source, now: new Date().toISOString(), makeId })
    if (result.ops) store.commit(client, result.ops)
    return result
  }

  const drop = createDropFolder({ dir: nodesDir, core, take, onStatus: changed })
  let watch = null

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

  async function start() {
    try {
      await drop.prepare()
    } catch (error) {
      console.error('The drop folder could not be made:', error)
    }
    watch = watchFolder({ dir: nodesDir, look: drop.look })
    if (settings.get().connector.on) startConnector().catch((error) => console.error('The connector could not start:', error.message)).finally(changed)
    hooks.start().catch((error) => console.error('Webhooks could not start:', error.message))
    await drop.look()
  }

  function stop() {
    watch?.stop()
    connector.stop()
    hooks.stop()
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

  /* ---- webhooks (Phase 46): moments out to other services, stickies in through ntfy ---- */
  const hooks = createWebhooks({
    file: path.join(dataDir, 'webhooks.json'),
    model: await sharedModule('webhook-model.mjs'),
    store,
    // The main process's fetch, so Offline holds every delivery and every read.
    fetch: (...args) => globalThis.fetch(...args),
    offline,
    addSticky(text, source) {
      const result = tools.runTool('add_sticky', { text, source }, { doc: store.load().doc, now: new Date().toISOString(), makeId })
      if (result.ops?.length) store.commit(client, result.ops)
    },
    onStatus: (value) => send('hooks:status', value),
  })
  handle('hooks:status', () => hooks.status())
  handle('hooks:add', plain((input) => hooks.add(input)))
  handle('hooks:change', plain((id, patch) => hooks.change(String(id), patch)))
  handle('hooks:remove', plain((id) => hooks.remove(String(id))))
  handle('hooks:test', plain((id) => hooks.test(String(id))))
  handle('hooks:inbox-on', plain(() => hooks.inboxOn()))
  handle('hooks:inbox-off', plain(() => hooks.inboxOff()))
  handle('hooks:inbox-reset', plain(() => hooks.inboxReset()))
  handle('hooks:inbox-server', plain((server) => hooks.inboxServer(String(server || ''))))
  handle('hooks:copy-address', plain(() => {
    if (!hooks.address()) throw new Error('Turn it on first.')
    clipboard.writeText(hooks.address())
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
    // Main calls this when Offline changes; the webhooks send what waited and read again.
    changed: () => { hooks.nudge(); changed() },
    // The chosen cloud model, first in every list of models (Ask, the line).
    models: () => cloud.models(),
    chatStream: (payload, onDelta, signal) => cloud.chatStream(payload, onDelta, signal),
  }
}

module.exports = { createBots, keychainFor }
