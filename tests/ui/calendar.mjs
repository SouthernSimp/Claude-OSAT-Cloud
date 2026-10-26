// The Calendar room (Phase 96) in the built preview, with the Mac's Calendar faked: a new event starts on the calendar
// new dates go to (Settings → Soul and memory → Calendar for new dates) once the Mac offers it, the menu names each
// calendar's account ("Work · Google"), and Add event puts it there. With no calendars on the Mac it stays in OSAT.
// Light, then dark.
// Fails on page errors or a step that didn't happen; screenshots land in test-results/ui/calendar/.
// Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { openRoom as openPlace } from './window.mjs'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/calendar`
const PORT = Number(process.env.OSAT_PORT || 4353)

const CALENDARS = [
  { id: 'home-cal', title: 'Home', source: 'iCloud', color: '#34c759', writable: true },
  { id: 'work-cal', title: 'Work', source: 'Google', color: '#0a84ff', writable: true },
]

// The Mac answers as desktop/mac-calendar.cjs does. Its calendars come a moment late, like osascript's, so the form
// may already be open when they arrive.
function fakeMac({ calendars }) {
  window.__mac = { added: [] }
  window.osatMacCalendar = {
    status: async () => ({ events: 'allowed', reminders: 'notAsked' }),
    allow: async () => 'allowed',
    calendars: () => new Promise((resolve) => setTimeout(() => { window.__mac.listed = true; resolve(calendars) }, 300)),
    events: async () => [],
    addEvent: async (event) => { window.__mac.added.push(event); return { id: `mac-${window.__mac.added.length}` } },
    removeEvent: async () => ({ ok: true }),
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

const problems = []
const check = (ok, what) => { if (!ok) problems.push(what) }

// New dates go to Work, as if picked in Settings.
async function openRoom(browser, url, { theme, calendars }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
  page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`))
  await page.addInitScript(fakeMac, { calendars })
  await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 15, notes: [], folders: [], calendar: { events: [] }, settings: { autoFile: { on: false }, dates: { calendar: 'work-cal' } }, budget: { transactions: [] }, habits: [], goals: [], chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  })
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await openPlace(page, 'Calendar')
  return page
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  for (const theme of ['light', 'dark']) {
    const page = await openRoom(browser, url, { theme, calendars: CALENDARS })
    // Straight in, before the Mac has answered: the form still starts on Work once Work shows up.
    await page.getByRole('button', { name: 'Add an event on this day', exact: true }).click()
    const composer = page.locator('.agenda-composer')
    const keep = composer.getByLabel('Keep it')
    await keep.waitFor({ timeout: 5000 }).catch(() => problems.push(`${theme}: no Keep it menu`))
    check(await keep.inputValue().catch(() => '') === 'work-cal', `${theme}: a new event didn’t start on Work, where new dates go`)
    const menu = await keep.innerText().catch(() => '')
    check(menu.includes('Work · Google') && menu.includes('Home · iCloud'), `${theme}: the menu didn’t name each calendar’s account (${menu})`)
    await sleep(300)
    await page.screenshot({ path: `${OUT}/${theme}-new-event.png` })
    if (theme === 'dark') { await page.close(); continue }

    await composer.getByLabel('Title').fill('Lunch with Sam')
    await composer.getByRole('button', { name: 'Add event', exact: true }).click()
    await page.getByText('Put “Lunch with Sam” on Work').waitFor({ timeout: 3000 }).catch(() => problems.push('the line didn’t say it went on Work'))
    const added = await page.evaluate(() => window.__mac.added)
    check(added.length === 1 && added[0].calendar === 'work-cal' && added[0].title === 'Lunch with Sam', `the Mac was asked for ${JSON.stringify(added)}`)
    await sleep(600) // the toast fades in
    await page.screenshot({ path: `${OUT}/on-work.png` })
    await page.close()
  }

  // No calendars on the Mac: no menu, and the event stays in OSAT (its own, with Download .ics and Delete).
  const none = await openRoom(browser, url, { theme: 'light', calendars: [] })
  await none.getByText('Your Mac’s calendars are read on this Mac', { exact: false }).waitFor({ timeout: 5000 }).catch(() => problems.push('the Mac’s calendars were never allowed'))
  // Wait for the Mac's (empty) list itself: there is no menu before it comes either, so a fixed wait couldn't tell.
  await none.waitForFunction(() => window.__mac.listed, null, { timeout: 5000 }).catch(() => problems.push('the Mac never listed its calendars'))
  await none.getByRole('button', { name: 'Add an event on this day', exact: true }).click()
  const composer = none.locator('.agenda-composer')
  check(await composer.getByLabel('Keep it').count() === 0, 'a Keep it menu showed with no calendars to offer')
  await composer.getByLabel('Title').fill('Dentist')
  await composer.getByRole('button', { name: 'Add event', exact: true }).click()
  await none.getByRole('button', { name: 'Actions for Dentist' }).waitFor({ timeout: 3000 }).catch(() => problems.push('the event didn’t stay in OSAT'))
  check((await none.evaluate(() => window.__mac.added)).length === 0, 'the Mac was asked to keep an event with no calendars')
  await none.screenshot({ path: `${OUT}/in-osat.png` })
  await none.close()
  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Calendar room checked. Screenshots in ${OUT}/`)
  })
