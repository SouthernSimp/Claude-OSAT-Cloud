/* Bots in (Phase 16): everything that lets Muse, Grok Bot, Claude and other AI reach OSAT,
   in one place with one Settings section (Settings → Bots):
     the drop folder   node files saved in ~/Documents/OSAT Nodes become nodes (drop-folder.cjs)
   Main passes in what it owns (the store, IPC, Finder, the clipboard); this wires it up.
   Every change goes through the store, so the windows, Undo and sync see it. */
const { randomUUID } = require('node:crypto')
const { watchFolder } = require('../folder-watch.cjs')
const { createDropFolder } = require('./drop-folder.cjs')

async function createBots({ nodesDir, store, sharedModule, handle, fail, send, shell, clipboard }) {
  const core = await sharedModule('node-file.mjs')
  const client = store.connect(() => {})
  const makeId = (prefix) => `${prefix}-${randomUUID()}`
  const status = () => ({ nodes: drop.status() })
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

  return { start, stop, status }
}

module.exports = { createBots }
