/* Real windows and IPC, practice inference. All three catalog models are marked
   downloaded by OSAT_AI=mock; no downloads or everyday OSAT data are touched. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const folder = await mkdtemp(path.join(os.tmpdir(), 'osat-model-ui-'))
const data = path.join(folder, 'OSAT Test')
const env = { ...process.env, OSAT_DATA_DIR: data, OSAT_AI: 'mock', OSAT_ICLOUD_DIR: path.join(folder, 'iCloud'),
  OSAT_PLACES_DIR: path.join(folder, 'Mac'), OSAT_NODES_DIR: path.join(folder, 'Nodes'), OSAT_NO_SPOTLIGHT: '1', OSAT_KEYCHAIN: 'memory' }
let app
const errors = []
const out = path.join(root, 'test-results/ai-models')

async function launch() {
  app = await electron.launch({ cwd: root, args: [root, '--no-sandbox'], env })
  let page
  for (let attempt = 0; attempt < 100 && !page; attempt += 1) {
    page = app.windows().find((window) => !window.url().includes('surface='))
    if (!page) await sleep(100)
  }
  assert.ok(page, 'The desk window opened')
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.overlay-surface .workspace-content', { timeout: 20000 })
  return page
}
const status = (page) => page.evaluate(() => window.osatLocalAI.status())
const chats = (page) => page.evaluate(async () => (await window.osat.store.load()).doc.chats)
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return
    await sleep(50)
  }
  assert.fail('The expected state did not arrive')
}
async function pick(page, label) {
  await page.getByRole('button', { name: /^Model:/ }).click()
  await page.getByRole('menuitemradio', { name: new RegExp('^' + label) }).click()
}
async function ask(page, question) {
  await page.getByLabel('Ask the AI on this Mac').fill(question)
  await page.getByLabel('Ask the AI on this Mac').press('Enter')
  await until(async () => (await chats(page)).some((chat) => chat.messages[0]?.content === question && chat.messages.at(-1)?.role === 'assistant'))
}

try {
  await mkdir(out, { recursive: true })
  for (const place of ['Desktop', 'Documents', 'Downloads']) await mkdir(path.join(folder, 'Mac', place), { recursive: true })
  let page = await launch()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('radio', { name: /^Light/ }).click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.getByRole('dialog', { name: /One line for everything/ }).waitFor()
  await page.getByRole('button', { name: 'Skip the tour', exact: true }).click()
  assert.equal((await status(page)).startup, false)
  await page.keyboard.press('Control+4')
  await page.getByRole('button', { name: 'Model: Light', exact: true }).waitFor()
  await pick(page, 'Balanced')
  assert.ok((await status(page)).tiers.every((tier) => tier.state === 'idle'), 'Choosing a model does not load one')
  await ask(page, 'Everyday question')
  const first = (await chats(page)).find((chat) => chat.messages[0]?.content === 'Everyday question')
  assert.equal(first.modelId, 'osat:balanced')
  assert.equal(first.messages.at(-1).modelId, 'osat:balanced')
  assert.ok(first.messages.at(-1).modelName)
  await page.locator('.assistant').getByRole('button', { name: 'New', exact: true }).click()
  await pick(page, 'Deep')
  assert.equal((await status(page)).tiers.find((tier) => tier.id === 'deep').state, 'idle')
  await ask(page, 'Demanding question')
  const second = (await chats(page)).find((chat) => chat.messages[0]?.content === 'Demanding question')
  assert.equal(second.modelId, 'osat:deep')
  assert.equal(second.messages.at(-1).modelId, 'osat:deep')
  assert.equal((await status(page)).tiers.find((tier) => tier.id === 'balanced').state, 'idle', 'Switching replaces an unretained model')
  await page.locator('.rail-item').getByRole('button', { name: /^Everyday question Today/ }).click()
  await page.getByRole('button', { name: 'Model: Balanced', exact: true }).waitFor()
  await pick(page, 'Light')
  await until(async () => (await chats(page)).find((chat) => chat.id === first.id)?.modelId === 'osat:light')
  const selected = (await chats(page)).find((chat) => chat.id === first.id)
  assert.equal(selected.modelId, 'osat:light')
  assert.equal(selected.messages.at(-1).modelId, 'osat:balanced', 'Changing the next responder keeps prior attribution')
  assert.equal((await chats(page)).find((chat) => chat.id === second.id).modelId, 'osat:deep')
  await page.getByRole('button', { name: 'Model: Light', exact: true }).click()
  await page.locator('.assistant').screenshot({ path: path.join(out, 'model-menu.png') })
  await page.getByRole('menuitem', { name: 'AI settings', exact: true }).click()
  const settings = page.locator('.popout-body[data-view="Settings"]')
  await settings.locator('.ai-management').waitFor()
  const balanced = settings.locator('.setting-row', { hasText: 'Gemma 4 E4B' })
  await balanced.getByRole('button', { name: 'Use for new chats', exact: true }).click()
  await settings.getByRole('switch', { name: 'Load AI at startup', exact: true }).click()
  await until(async () => (await status(page)).startup)
  for (const label of ['Light', 'Balanced']) {
    await settings.getByRole('switch', { name: 'Keep ' + label + ' loaded', exact: true }).click()
    await until(async () => (await status(page)).tiers.find((tier) => tier.label === label)?.retained)
  }
  await until(async () => (await status(page)).tiers.every((tier) => tier.state === 'ready' && tier.retained))
  await settings.screenshot({ path: path.join(out, 'ai-settings.png') })
  await page.evaluate(() => window.osatChat.show())
  await until(() => app.windows().some((window) => window.url().includes('surface=search')))
  const quick = app.windows().find((window) => window.url().includes('surface=search'))
  quick.on('pageerror', (error) => errors.push(error.message))
  await quick.getByRole('button', { name: /^Model:/ }).click()
  await quick.getByRole('menuitem', { name: 'Free AI memory', exact: true }).click()
  await quick.locator('.toast', { hasText: 'AI memory released' }).waitFor()
  assert.ok((await status(page)).tiers.every((tier) => tier.state === 'idle'), 'Ask in the quick bar can release all three models')
  const saved = await chats(page)
  assert.equal(saved.length, 2, 'Releasing memory preserves chats')
  await until(async () => {
    const doc = JSON.parse(await readFile(path.join(data, 'store/workspace.json'), 'utf8'))
    return doc.chats.find((chat) => chat.id === first.id)?.modelId === 'osat:light'
  })
  await app.close()
  app = null
  page = await launch()
  await until(async () => (await status(page)).tiers.find((tier) => tier.id === 'balanced').state === 'ready')
  const after = await status(page)
  assert.equal(after.startup, true)
  assert.equal(after.chosen, 'balanced')
  assert.ok(after.tiers.filter((tier) => tier.id !== 'balanced').every((tier) => tier.state === 'idle' && !tier.retained), 'Startup loads only the default and retention ends at quit')
  assert.deepEqual(await chats(page), saved, 'Chat choices, content, and model attribution survive restart')
  await page.evaluate((chatId) => window.osatChat.show({ chatId }), first.id)
  await until(() => app.windows().some((window) => window.url().includes('surface=search')))
  const reopened = app.windows().find((window) => window.url().includes('surface=search'))
  await reopened.getByRole('button', { name: 'Model: Light', exact: true }).waitFor()
  await page.evaluate(() => window.osatLocalAI.startup(false))
  await app.close()
  app = null
  page = await launch()
  assert.equal((await status(page)).startup, false)
  assert.ok((await status(page)).tiers.every((tier) => tier.state === 'idle'), 'Startup stays off after restart')
  assert.deepEqual(errors, [])
  console.log('AI model UI passed: lazy selection, chat routing and attribution, three retained models, floating-chat unload, and restart persistence')
} catch (error) {
  await app?.windows().find((window) => !window.url().includes('surface='))?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app?.close().catch(() => {})
  await rm(folder, { recursive: true, force: true })
}
