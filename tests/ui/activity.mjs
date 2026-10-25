// Power tools → Activity (Phase 93) in the built preview, with the Mac's Activity bridge faked: the three meters,
// the apps using the most memory with Quit then Force quit, and the specs. Light, then dark, then narrow.
// Fails on page errors or a step that didn't happen; screenshots land in test-results/ui/activity/. Run `npm run build` first.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { openRoom, roomOf } from './window.mjs'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/activity`
const PORT = Number(process.env.OSAT_PORT || 4351)

function fakeActivity() {
  const GB = 1024 ** 3
  window.__quit = []
  let apps = [
    { path: '/Applications/Google Chrome.app', name: 'Google Chrome', count: 24, bytes: 5.2 * GB, cpu: 18.4 },
    { path: '/Applications/ChatGPT.app', name: 'ChatGPT', count: 6, bytes: 3.1 * GB, cpu: 2 },
    { path: '/Applications/OSAT.app', name: 'Figma', count: 4, bytes: 1.4 * GB, cpu: 6.6 },
    { path: '/System/Library/CoreServices/Finder.app', name: 'Finder', count: 1, bytes: 0.25 * GB, cpu: 0.1 },
  ]
  window.osatActivity = {
    now: async () => ({
      mac: true,
      memory: { total: 64 * GB, used: 26.3 * GB, app: 18 * GB, wired: 5 * GB, compressed: 2.3 * GB, cached: 24 * GB, pressure: 'normal' },
      cpu: { busy: 0.23, cores: 18 },
      disk: { total: 994 * GB, free: 277 * GB },
      specs: { name: 'MacBook Pro', model: 'Mac17,8', chip: 'Apple M5 Pro', macos: '27.2', memory: 64 * GB, cores: 18, uptime: 1043691 },
      apps,
    }),
    quit: async (path, force) => { window.__quit.push([path, force]); if (force) apps = apps.filter((app) => app.path !== path); return 1 },
  }
}

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

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  const errors = []
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
      page.on('pageerror', (error) => errors.push(`${theme}: ${error.message}`))
      await page.addInitScript(fakeActivity)
      await page.addInitScript(() => localStorage.setItem('osat.tour.v1', 'seen'))
      await page.goto(`${url}?fresh=1`)
      await page.waitForSelector('.workspace-content', { timeout: 15000 })
      await openRoom(page, 'Activity')
      const room = roomOf(page, 'Activity')
      await room.getByText('26.3 GB', { exact: true }).waitFor()
      await room.getByText('Plenty of room').waitFor()
      await room.getByText('Apple M5 Pro · macOS 27.2 · on for 12 days, 1 hour').waitFor()
      assert.equal(await room.getByRole('meter', { name: 'Processor: 23%' }).count(), 1)
      await room.getByRole('button', { name: 'CPU', exact: true }).click()
      assert.equal(await room.locator('.activity-apps li').nth(1).locator('.activity-app-name').innerText().then((text) => text.startsWith('Figma')), true, 'CPU puts Figma (7%) above ChatGPT (2%)')
      await room.getByRole('button', { name: 'Memory', exact: true }).click()
      const chrome = room.locator('.activity-apps li', { hasText: 'Google Chrome' })
      await sleep(400)
      await page.screenshot({ path: `${OUT}/${theme}.png` })
      await chrome.getByRole('button', { name: 'Quit', exact: true }).click()
      await chrome.getByRole('button', { name: 'Force quit', exact: true }).click()
      await chrome.waitFor({ state: 'detached' })
      assert.deepEqual(await page.evaluate(() => window.__quit), [['/Applications/Google Chrome.app', false], ['/Applications/Google Chrome.app', true]])
      await page.setViewportSize({ width: 820, height: 760 })
      assert.equal(await room.evaluate((el) => el.scrollWidth <= el.clientWidth), true, 'no sideways scroll when narrow')
      await page.screenshot({ path: `${OUT}/${theme}-narrow.png` })
      await page.close()
    }
    assert.deepEqual(errors, [])
    console.log(`Activity checked. Screenshots in ${OUT}/`)
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => server?.kill())
