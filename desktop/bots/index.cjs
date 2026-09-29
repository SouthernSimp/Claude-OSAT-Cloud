/* Bots in (Phase 16): everything that lets Muse, Grok Bot, Claude and other AI reach OSAT,
   and OSAT reach them, in one place with one Settings section (Settings → Bots):
     the drop folder   node files saved in ~/Documents/OSAT Nodes become nodes (drop-folder.cjs)
     cloud models      any provider with a key, next to the AI on this Mac (cloud.cjs)
   Every model and privacy setting lives here, so what leaves the Mac is said in one place.
   Main passes in what it owns (the store, IPC, Finder, the clipboard); this wires it up.
   Every change goes through the store, so the windows, Undo and sync see it. */
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { watchFolder } = require('../folder-watch.cjs')
const { createCloud } = require('./cloud.cjs')
const { createDropFolder } = require('./drop-folder.cjs')
const { createKeychain } = require('./keychain.cjs')
const { createSettings } = require('./settings.cjs')

async function createBots({ dataDir, nodesDir, service, store, sharedModule, handle, fail, send, shell, clipboard, offline = () => false }) {
  const core = await sharedModule('node-file.mjs')
  const providers = await sharedModule('providers.mjs')
  const settings = createSettings({ file: path.join(dataDir, 'bots.json'), clean: providers.cleanBotSettings })
  await settings.load()
  const cloud = createCloud({ core: providers, settings, keychain: createKeychain({ service }), offline })
  const client = store.connect(() => {})
  const makeId = (prefix) => `${prefix}-${randomUUID()}`
  const status = () => ({ nodes: drop.status(), cloud: cloud.status(), offline: offline() })
  const changed = () => send('bots:status', status())

  /* A node file's tree becomes a New node (packed when it is only a summary). */
  function take(tree, { name, hash, source = '' }) {
    const result = core.arrivalOps(store.load().doc, tree, { hash, file: name, source, now: new Date().toISOString(), makeId })
    if (result.ops) store.commit(client, result.ops)
    return result
  }

  const drop = createDropFolder({ dir: nodesDir, core, take, onStatus: changed })
  let watch = null

  async function start() {
    try {
      await drop.prepare()
    } catch (error) {
      console.error('The drop folder could not be made:', error)
    }
    watch = watchFolder({ dir: nodesDir, look: drop.look })
    await drop.look()
  }

  function stop() {
    watch?.stop()
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
