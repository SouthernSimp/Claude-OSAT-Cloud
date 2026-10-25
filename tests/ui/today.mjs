// CI only: real dashboard actions against an isolated browser store. No native accounts or windows.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { openRoom } from './window.mjs'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/today`
const PORT = Number(process.env.OSAT_PORT || 4350)
let server
async function start() {
  if (process.env.OSAT_URL) return process.env.OSAT_URL
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
  const url = `http://127.0.0.1:${PORT}/`
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).ok) return url } catch { /* starting */ } await sleep(250) }
  throw new Error('The isolated preview did not start.')
}
const dashboard = (page) => page.locator('.today-dashboard')
async function seeded(browser, url, theme, empty = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
  await page.addInitScript(() => localStorage.setItem('osat.tour.v1', 'seen'))
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async (empty) => {
    const now = new Date()
    const iso = now.toISOString()
    const note = (id, title, folderId, what = 'note', extra = {}) => ({ id, title, markdown: title, folderId, what, tags: [], createdAt: iso, updatedAt: iso, ...extra })
    const db = await new Promise((resolve) => { const r = indexedDB.open('osat-preview', 1); r.onupgradeneeded = () => r.result.createObjectStore('workspace'); r.onsuccess = () => resolve(r.result) })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite')
      tx.objectStore('workspace').put({ schema: 15, notes: empty ? [] : [
        note('quote', 'Send the revised quote', 'welding', 'todo', { stage: 'doing' }),
        note('measure', 'Confirm site measurements', 'welding', 'todo', { stage: 'next' }),
        note('steel', 'Order hinges and steel', 'welding', 'todo'),
        note('done', 'Visit the site', 'welding', 'todo', { doneAt: iso }),
        note('demo', 'Prepare the demo', 'fortis', 'todo'),
        note('finish', 'Finish and materials', 'welding', 'note', { updatedAt: new Date(now.getTime() + 1000).toISOString() }),
        note('loose', 'A new customer enquiry', null),
        note('met', 'Fortis call', 'fortis', 'note', { tags: ['meeting'], source: 'Meeting', createdAt: new Date(now.getTime() - 3 * 86400000).toISOString() }),
      ], folders: empty ? [] : ['Jackalope Welding', 'Fortis', 'OSAT', 'Home'].map((name, i) => ({ id: ['welding', 'fortis', 'osat', 'home'][i], name, rank: i, ...(name === 'Fortis' ? { client: true } : {}) })),
      calendar: { events: empty ? [] : [{ id: 'visit', title: 'Site visit', start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14).toISOString(), end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15).toISOString() },
        { id: 'fortis-demo', title: 'Fortis demo', start: iso, end: new Date(now.getTime() + 3600000).toISOString() }] },
      settings: { seeded: { direction: true }, autoFile: { on: false }, dates: { on: false } }, budget: { transactions: [] }, habits: [], goals: [], chats: [],
      }, 'doc')
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, empty)
  await page.goto(url)
  await page.waitForSelector('.workspace-content')
  await openRoom(page, 'Today')
  await dashboard(page).waitFor()
  return page
}
async function exercise(page) {
  const root = dashboard(page)
  const prep = root.locator('.today-card[aria-label^="Before Fortis demo"]')
  await prep.getByRole('button', { name: 'Done: Prepare the demo', exact: true }).waitFor()
  await prep.getByRole('button', { name: 'Fortis call', exact: true }).waitFor()
  await prep.getByRole('button', { name: 'Open Fortis', exact: true }).click()
  await page.locator('.boards-title h1', { hasText: 'Fortis' }).waitFor()
  await openRoom(page, 'Today')
  assert.equal(await root.locator('.today-board').count(), 3)
  assert.equal(await root.getByRole('progressbar', { name: 'Jackalope Welding: steps done' }).getAttribute('value'), '1')
  await root.getByRole('button', { name: 'All 4', exact: true }).click()
  assert.equal(await root.locator('.today-board').count(), 4)
  await root.getByRole('button', { name: 'Show fewer', exact: true }).click()
  await root.locator('.today-board').filter({ hasText: 'Jackalope Welding' }).click()
  await page.locator('.boards-title h1', { hasText: 'Jackalope Welding' }).waitFor()
  await openRoom(page, 'Today')
  await dashboard(page).locator('.today-card[aria-label="Recent work"]').getByRole('button', { name: /Finish and materials/ }).click()
  await page.getByRole('textbox', { name: 'Note title', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: 'Note title', exact: true }).inputValue(), 'Finish and materials')
  await openRoom(page, 'Today')
  await root.getByRole('button', { name: 'Done: Send the revised quote', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.today-board progress')?.value === 2)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.today-board progress')?.value === 1)
  await root.locator('.today-card[aria-label="To do"]').getByRole('button', { name: 'All', exact: true }).click()
  await page.locator('.today.is-list').waitFor()
  await openRoom(page, 'Today')
  await root.locator('.today-card[aria-label="Waiting in Just in"]').getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator('.justin').waitFor()
  await openRoom(page, 'Today')
  await root.locator('.today-agenda').getByRole('button', { name: 'Site visit', exact: true }).click()
  await page.locator('.app-room[data-view="Calendar"]').waitFor()
}
async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  const errors = []
  try {
    for (const theme of ['light', 'dark']) {
      const page = await seeded(browser, url, theme)
      page.on('pageerror', (error) => errors.push(error.message))
      await sleep(500)
      await page.screenshot({ path: `${OUT}/${theme}-overview.png` })
      await exercise(page)
      await openRoom(page, 'Today')
      await page.setViewportSize({ width: 820, height: 760 })
      assert.equal(await dashboard(page).evaluate((el) => el.scrollWidth <= el.clientWidth), true)
      await page.screenshot({ path: `${OUT}/${theme}-narrow.png` })
      await page.close()
    }
    const empty = await seeded(browser, url, 'light', true)
    assert.equal(await dashboard(empty).locator('.today-board').count(), 0)
    await dashboard(empty).getByText('Nothing to do.', { exact: false }).waitFor()
    await empty.close()
    assert.deepEqual(errors, [])
    console.log(`Today checked. Screenshots in ${OUT}/`)
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => server?.kill())
