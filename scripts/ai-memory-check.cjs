/* Run with Electron and a downloaded catalog model:
   npx electron scripts/ai-memory-check.cjs /absolute/path/to/model.gguf
   Uses a temporary folder and a read-only link to the model; never opens OSAT's
   store or downloads anything. Checks the real Metal engine, exit, and reload. */
const { app, utilityProcess } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createAi } = require('../desktop/ai/index.cjs')
const { TIERS } = require('../desktop/ai/catalog.cjs')
const { estimateResources } = require('../desktop/ai/resources.cjs')

let ai
let folder
let watchdog
const children = []

app.whenReady().then(async () => {
  const modelPath = path.resolve(process.argv[2] || '')
  const tier = TIERS.find((item) => item.file === path.basename(modelPath))
  assert.ok(tier, 'Pass the absolute path of a downloaded OSAT catalog model.')
  assert.equal((await fs.stat(modelPath)).size, tier.size)
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-ai-memory-'))
  app.setPath('userData', folder)
  await fs.symlink(modelPath, path.join(folder, tier.file))
  watchdog = setTimeout(() => { ai?.dispose(); console.error('AI memory check timed out'); app.exit(1) }, 240000)
  const fork = () => {
    const child = utilityProcess.fork(path.join(__dirname, '../desktop/ai/runtime.cjs'), [], { serviceName: 'OSAT AI memory check' })
    const record = { child, exited: false }
    child.on('exit', () => { record.exited = true })
    children.push(record)
    return child
  }
  ai = createAi({ dir: folder, totalMemory: os.totalmem(), chosen: tier.id, fork,
    estimate: (file) => estimateResources(fork, file), confirmLoad: async () => 'replace', confirmUnload: async () => true })
  assert.equal(ai.status().startup, false)
  const estimated = await ai.preflight(tier.id)
  assert.ok(estimated.estimatedMemory > 0, 'GGUF/context memory estimate must be available')
  console.log('Estimate:', JSON.stringify({ tier: tier.id, bytes: estimated.estimatedMemory, contextSize: estimated.estimate.contextSize }))
  const request = { model: 'osat:' + tier.id, messages: [{ role: 'user', content: 'Reply with just the word hello.' }] }
  const first = await ai.chatStream(request, () => {}, undefined, { interactive: true })
  assert.ok(first.trim(), 'The model must answer')
  assert.equal(ai.status().tiers.find((item) => item.id === tier.id).state, 'ready')
  const engine = children.at(-1)
  console.log('Loaded and answered:', JSON.stringify(first.trim()))
  await ai.unload(tier.id)
  assert.ok(engine.exited, 'Unload must wait for the real process to exit')
  assert.equal(ai.status().tiers.find((item) => item.id === tier.id).state, 'idle')
  assert.equal((await fs.stat(modelPath)).size, tier.size)
  const count = children.length
  await assert.rejects(ai.chatStream(request, () => {}), /unloaded/)
  assert.equal(children.length, count, 'A background question cannot wake a manually unloaded model')
  console.log('Unloaded: process exited; download preserved; background reload blocked')
  const second = await ai.chatStream(request, () => {}, undefined, { interactive: true })
  assert.ok(second.trim())
  assert.notEqual(children.at(-1).child, engine.child, 'The next interactive question creates a new engine')
  await ai.unloadAll()
  console.log('Reloaded and answered:', JSON.stringify(second.trim()))
  console.log('AI memory check passed')
}).then(async () => {
  clearTimeout(watchdog)
  ai?.dispose()
  if (folder) await fs.rm(folder, { recursive: true, force: true })
  app.exit(0)
}).catch(async (error) => {
  clearTimeout(watchdog)
  ai?.dispose()
  console.error(error)
  if (folder) await fs.rm(folder, { recursive: true, force: true })
  app.exit(1)
})
