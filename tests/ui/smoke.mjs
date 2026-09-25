// Opens the built web preview in Chromium, visits every room, and fails on any
// page error. Screenshots land in test-results/ui/ (light, then dark) so each
// pull request shows what changed. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = process.env.OSAT_SHOTS || 'test-results/ui'
const PORT = Number(process.env.OSAT_PORT || 4317)
// The four spaces (⌃1–4), then every tool from the dock's Tools menu.
const SPACES = [['Notes', 2], ['Mindmap', 3], ['Assistant', 4]]
const TOOLS = [['Journal', 'Today’s page'], ['Calendar', 'Calendar'], ['Habits', 'Habits'], ['Reflection', 'Reflect'], ['Budget', 'Money'], ['Projects', 'Projects'], ['Files', 'Files'], ['Browser', 'Browser'], ['Terminal', 'Terminal'], ['Settings', 'Settings']]

let server
async function start() {
  if (process.env.OSAT_URL) return process.env.OSAT_URL
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
  const url = `http://127.0.0.1:${PORT}/`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(url)).ok) return url } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('The preview server did not start. Did you run npm run build?')
}

const problems = []
async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  let room = 'start'
  page.on('pageerror', (error) => problems.push(`${room}: ${error.message}`))
  page.on('console', (message) => {
    // The local AI runtime is not running in CI; a refused request is expected.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`${room}: ${message.text()}`)
  })

  await page.goto(`${url}?fresh=1`)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  const keep = page.getByRole('button', { name: 'Keep this room' })
  if (await keep.count()) await keep.first().click()
  await sleep(600)

  // A thought typed on home is saved, survives a reload, and waits in Unsorted.
  room = 'capture'
  await page.getByPlaceholder('Leave a thought here.').fill('Smoke test thought')
  await page.keyboard.press('Enter')
  await sleep(800)
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await page.keyboard.press('Control+2')
  await page.locator('.organizer-row', { hasText: 'Unsorted' }).first().click()
  await page.locator('.note-row', { hasText: 'Smoke test thought' }).first().waitFor({ timeout: 5000 })
    .catch(() => problems.push('capture: a thought typed on home was not in Unsorted after a reload'))

  // Each room opens as a sheet over the desk, and Esc takes you back to the desk.
  async function visit(view, go, theme) {
    room = view
    await go()
    await page.waitForSelector(`.sheet-body[data-view="${view}"]`, { timeout: 5000 })
      .catch(() => problems.push(`${view}: the room did not open`))
    await sleep(900)
    const empty = await page.$eval('.sheet-body', (node) => node.children.length === 0).catch(() => true)
    if (empty) problems.push(`${view}: rendered nothing`)
    await page.screenshot({ path: `${OUT}/${theme}-${view}.png` })
  }

  async function backToDesk(theme) {
    room = 'desk'
    await page.locator('.sheet-title').click()
    await page.keyboard.press('Escape')
    await page.waitForSelector('.room-sheet', { state: 'detached', timeout: 3000 })
      .catch(() => problems.push('desk: Esc did not close the room'))
    await sleep(500)
    await page.screenshot({ path: `${OUT}/${theme}-Desk.png` })
  }

  for (const theme of ['light', 'dark']) {
    for (const [view, key] of SPACES) await visit(view, () => page.keyboard.press(`Control+${key}`), theme)
    await visit('Sky', () => page.keyboard.press('Control+3').then(() => sleep(900)).then(() => page.getByRole('radio', { name: 'Sky' }).click()), theme)
    for (const [view, label] of TOOLS) {
      await visit(view, async () => {
        await page.locator('.app-dock [data-space="tools"]').click()
        await page.getByRole('menuitem', { name: label }).click()
      }, theme)
    }
    await backToDesk(theme)
    if (theme === 'light') {
      await page.locator('.app-dock .appearance > button').click()
      await page.getByRole('radio', { name: 'Dark' }).click()
      await page.keyboard.press('Escape')
      await sleep(300)
    }
  }

  // The ⌥Space layer over a stand-in desktop: a thought, a note pop-out, a room pop-out, Esc.
  room = 'layer'
  await page.goto(`${url}?surface=overlay`)
  await page.waitForSelector('#home-line', { timeout: 15000 })
  await page.fill('#home-line', 'Left on the layer')
  await page.press('#home-line', 'Enter')
  // Two loose thoughts now: they rest in one pile, which opens Unsorted.
  await page.getByRole('button', { name: /loose thoughts/ }).click()
  await page.getByRole('dialog', { name: 'Notes' }).waitFor({ timeout: 5000 })
    .catch(() => problems.push('layer: the pile of loose thoughts did not open Unsorted'))
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Open note The room' }).click()
  await page.getByRole('dialog', { name: 'The room' }).waitFor({ timeout: 5000 })
    .catch(() => problems.push('layer: a note did not open as a pop-out'))
  await page.getByRole('button', { name: 'Notes', exact: true }).click()
  await page.getByRole('dialog', { name: 'Notes' }).waitFor({ timeout: 5000 })
    .catch(() => problems.push('layer: Notes did not open as a pop-out'))
  await sleep(400)
  await page.screenshot({ path: `${OUT}/layer.png` })
  await page.keyboard.press('Escape')
  if (await page.getByRole('dialog', { name: 'Notes' }).count()) problems.push('layer: Esc did not close the top pop-out')
  await browser.close()
}

try {
  await main()
} catch (error) {
  problems.push(error.stack || String(error))
} finally {
  server?.kill()
}
if (problems.length) {
  console.error(`UI smoke test found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`UI smoke test passed. Screenshots are in ${OUT}/`)
