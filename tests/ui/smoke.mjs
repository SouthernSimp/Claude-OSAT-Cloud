// Opens the built web preview in Chromium, visits every room, and fails on any
// page error. Screenshots land in test-results/ui/ (light, then dark) so each
// pull request shows what changed. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = process.env.OSAT_SHOTS || 'test-results/ui'
const PORT = Number(process.env.OSAT_PORT || 4317)
const TABS = [['Today', 1], ['Notes', 2], ['Mindmap', 3], ['Journal', 4], ['Calendar', 5], ['Assistant', 6]]
const MORE = [['Browser', 'Browser'], ['Terminal', 'Terminal'], ['Sky', 'Sky'], ['Projects', 'Projects'], ['Habits', 'Habits'], ['Reflection', 'Reflect'], ['Budget', 'Money'], ['Files', 'Files'], ['Inbox', 'Inbox'], ['Obsidian', 'Obsidian'], ['Settings', 'Settings']]

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

  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  const keep = page.getByRole('button', { name: 'Keep this room' })
  if (await keep.count()) await keep.first().click()
  await sleep(600)

  async function visit(view, go, theme) {
    room = view
    await go()
    await page.waitForSelector(`.workspace-content[data-view="${view}"]`, { timeout: 5000 })
      .catch(() => problems.push(`${view}: the room did not open`))
    await sleep(500)
    const empty = await page.$eval('.workspace-content', (node) => node.children.length === 0).catch(() => true)
    if (empty) problems.push(`${view}: rendered nothing`)
    await page.screenshot({ path: `${OUT}/${theme}-${view}.png` })
  }

  for (const theme of ['light', 'dark']) {
    for (const [view, key] of TABS) await visit(view, () => page.keyboard.press(`Control+${key}`), theme)
    for (const [view, label] of MORE) {
      await visit(view, async () => {
        await page.locator('.topbar-more > button').click()
        await page.getByRole('menuitem', { name: label, exact: true }).click()
      }, theme)
    }
    if (theme === 'light') {
      await page.keyboard.press('Control+2')
      await page.getByRole('button', { name: 'Switch light or dark appearance' }).first().click()
      await sleep(300)
    }
  }
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
