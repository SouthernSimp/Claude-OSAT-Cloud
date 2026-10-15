// What a sticky is, and the lists OSAT keeps (Phase 67), in the built preview: a date written a
// minute ago goes on the calendar on its own (one line, Undo takes it off); Notes → Kept for you
// lists every open question, everything to buy and what's coming up; ticking a question off
// hides it (Undo brings it back); a sticky's kind chip changes what it is; Coming up puts a day
// back on the calendar. Fails on page errors or a step that didn't happen; screenshots land in
// test-results/ui/kept/. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/kept`
const PORT = Number(process.env.OSAT_PORT || 4320)

const minuteAgo = new Date(Date.now() - 60000).toISOString()
const hourAgo = new Date(Date.now() - 3600000).toISOString()
const folders = [{ id: 'osat', name: 'OSAT', rank: 1, at: { x: 0, y: 0 } }]
const sticky = (id, text, extra = {}) => ({ id, title: text.split('\n')[0].slice(0, 120), markdown: text, createdAt: minuteAgo, updatedAt: minuteAgo, ...extra })
const notes = [
  sticky('q', 'Can OSAT read Granola notes offline?', { folderId: 'osat' }),
  sticky('milk', 'milk, bread, turkey, swiss, mayo', { unsorted: true, source: 'iPhone' }),
  sticky('dentist', 'Dentist tomorrow 2pm', { unsorted: true, source: 'Quick bar' }),
  sticky('canvas', 'The canvas is hard to read', { folderId: 'osat' }),
  sticky('spot', 'Spotlight Search', { unsorted: true, source: 'Scan' }),
  sticky('old', 'Rent due in 3 days', { folderId: 'osat', createdAt: hourAgo, updatedAt: hourAgo }),
]

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

async function saved(page) {
  return page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    const db = await new Promise((resolve) => { const request = indexedDB.open('osat-preview', 1); request.onsuccess = () => resolve(request.result) })
    return new Promise((resolve) => { const request = db.transaction('workspace').objectStore('workspace').get('doc'); request.onsuccess = () => resolve(request.result) })
  })
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => problems.push(error.message))
  await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async ({ notes, folders, since }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 13, rev: 0, theme: 'dark', notes, folders, habits: [], reflections: [], focus: { status: 'idle' }, projects: [], sorter: null, calendar: { events: [] }, budget: { currency: 'USD', transactions: [], recurring: [] }, settings: { autoFile: { on: false }, dates: { since } }, chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { notes, folders, since: new Date(Date.now() - 1800000).toISOString() })
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })

  // The dentist goes on OSAT's calendar on its own (the preview has no Mac); the one from before doesn't.
  const toast = page.locator('.undo-toasts .toast').filter({ hasText: /on your calendar/ })
  await toast.waitFor({ timeout: 10000 }).catch(() => problems.push('no “Put … on your calendar” line appeared'))
  const said = await toast.textContent().catch(() => '')
  check(/Put “Dentist” on your calendar · .+2:00\sPM/.test(said), `the line said “${said}”`)
  let doc = await saved(page)
  check(doc.calendar.events.length === 1 && doc.calendar.events[0].title === 'Dentist', `the calendar held ${JSON.stringify(doc.calendar.events.map((event) => event.title))}`)
  check(doc.notes.find((note) => note.id === 'dentist')?.cal?.where === 'osat', 'the sticky didn’t remember its event')
  check(!doc.notes.find((note) => note.id === 'old')?.cal, 'a date written before it began went on the calendar by itself')
  await page.screenshot({ path: `${OUT}/date-line.png` })
  await toast.getByRole('button', { name: 'Undo' }).click()
  doc = await saved(page)
  check(doc.calendar.events.length === 0, 'Undo left the event on the calendar')
  check(doc.notes.find((note) => note.id === 'dentist')?.cal?.off === true, 'Undo didn’t remember it was taken off')

  // Notes → Kept for you.
  await page.getByRole('button', { name: 'Notes', exact: true }).first().click()
  const organizer = page.locator('.notes-organizer')
  await organizer.getByRole('button', { name: /^Questions/ }).click()
  await sleep(300)
  const rows = () => page.locator('.notes-list .note-row')
  check(await rows().count() === 1 && await rows().first().textContent().then((text) => text.includes('Granola')), 'Questions didn’t list the one open question')
  await page.screenshot({ path: `${OUT}/questions.png` })
  await rows().first().getByRole('checkbox').click()
  await sleep(300)
  check(await rows().count() === 0, 'an answered question stayed in Questions')
  await page.locator('.undo-toasts .toast', { hasText: 'Answered' }).getByRole('button', { name: 'Undo' }).click()
  await sleep(300)
  check(await rows().count() === 1, 'Undo didn’t bring the question back')

  await organizer.getByRole('button', { name: /^To buy/ }).click()
  await sleep(300)
  check(await rows().count() === 1 && await rows().first().textContent().then((text) => text.includes('milk')), 'To buy didn’t list the shopping list')
  await page.screenshot({ path: `${OUT}/to-buy.png` })

  // Just in: the kind chip says what each is, and changes it.
  await organizer.getByRole('button', { name: /^Just in/ }).click()
  await sleep(300)
  const spot = rows().filter({ hasText: 'Spotlight Search' })
  check(await spot.locator('.meta-kind', { hasText: 'Idea' }).count() === 1, 'Spotlight Search didn’t read as an idea')
  check(await rows().filter({ hasText: 'Needs a home' }).count() === 3, 'Just in didn’t say which stickies need a home')
  await page.screenshot({ path: `${OUT}/just-in.png` })
  await spot.locator('.meta-kind').click()
  await page.getByRole('menuitem', { name: 'Question' }).click()
  await organizer.getByRole('button', { name: /^Questions/ }).click()
  await sleep(300)
  check(await rows().filter({ hasText: 'Spotlight Search' }).count() === 1, 'a sticky made a question didn’t show in Questions')

  // Coming up: soonest first, and a day put back on the calendar by hand.
  await organizer.getByRole('button', { name: /^Coming up/ }).click()
  await sleep(300)
  const titles = await rows().locator('strong').allTextContents()
  check(JSON.stringify(titles) === JSON.stringify(['Dentist tomorrow 2pm', 'Rent due in 3 days']), `Coming up listed ${JSON.stringify(titles)}`)
  await page.screenshot({ path: `${OUT}/coming-up.png` })
  await rows().first().getByRole('button', { name: 'Put on calendar' }).click()
  await page.locator('.undo-toasts .toast', { hasText: 'On OSAT’s calendar' }).waitFor({ timeout: 3000 }).catch(() => problems.push('Put on calendar didn’t say so'))
  check(await rows().first().getByRole('button', { name: /Take off/ }).count() === 1, 'the row didn’t say it is on the calendar')
  doc = await saved(page)
  check(doc.calendar.events.length === 1, 'Put on calendar didn’t add the event')

  await browser.close()
  server?.kill()
  if (problems.length) {
    console.error(`Kept for you found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
  console.log(`What it is and Kept for you checked. Screenshots in ${OUT}/`)
}

main().catch((error) => { console.error(error); server?.kill(); process.exit(1) })
