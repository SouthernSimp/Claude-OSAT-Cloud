// Just in (Phase 72) in the built preview, with the AI on this Mac faked: today's morning brief on top; what waits
// for a home, with the board it looks like one tap away; what came in today and yesterday, where each went, and Undo
// on a row; a date taken off the calendar and put back; To buy ticked off; a photo of paper stickies read into one
// sticky each; and on a board, two stickies that say the same thing merged into one, with Undo. Light, dark, narrow.
// Fails on page errors or a step that didn't happen; screenshots land in test-results/ui/just-in/. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { openRoom as openPlace } from './window.mjs'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/just-in`
const PORT = Number(process.env.OSAT_PORT || 4335)

const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString()
const pad = (n) => String(n).padStart(2, '0')
const today = new Date()
const DAY = `day-${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 14).toISOString()
// Yesterday at noon, whatever the time now.
const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12).toISOString()
// Earlier today (or a minute ago, just after midnight), and yesterday.
const earlier = (hours) => ago(Math.min(hours, today.getHours() + today.getMinutes() / 60 - 0.02))
const filed = (into, at) => ({ folderId: into, filed: { by: 'ai', at, into } })
const FOLDERS = [
  { id: 'osat', name: 'OSAT', createdAt: ago(900) },
  { id: 'fortis', name: 'Fortis', createdAt: ago(800) },
  { id: 'home', name: 'Home', createdAt: ago(700) },
]
const sticky = (id, markdown, what, at, extra = {}) => ({ id, title: markdown, markdown, what, createdAt: at, updatedAt: at, ...extra })
const NOTES = [
  sticky('pitch', 'Fortis pitch deck for the payments team', 'todo', ago(300), { folderId: 'fortis' }),
  sticky('w1', 'Fortis demo slides need the new logo', 'todo', earlier(0.5), { unsorted: true, source: 'Meeting' }),
  sticky('w2', 'Is a Mac mini enough for five people?', 'question', earlier(1), { unsorted: true, source: 'Quick bar' }),
  sticky('w3', 'Dentist tomorrow 2pm', 'date', earlier(1.5), { unsorted: true, source: 'iPhone', cal: { id: 'event-1', where: 'osat', start: tomorrow } }),
  sticky('f1', 'The canvas is hard to read', 'problem', earlier(2), { ...filed('osat', earlier(1.9)), source: 'Quick bar' }),
  sticky('f2', 'Integrate n8n inside OSAT', 'idea', yesterday, { ...filed('osat', yesterday), source: 'Quick bar' }),
  sticky('milk', 'milk, bread, turkey', 'buy', ago(40), { folderId: 'home' }),
  sticky('j1', 'Call Jordan about the roof estimate', 'todo', ago(50), { folderId: 'osat' }),
  sticky('j2', 'Call Jordan back about the roof estimate', 'todo', ago(49), { folderId: 'osat' }),
  { id: DAY, kind: 'day', date: DAY.slice(4), title: 'Today', markdown: '**Morning brief**\nGood morning. The dentist is tomorrow at 2:00, already on your calendar. Three things wait in Just in.\n*Written for you by OSAT’s AI.*', createdAt: ago(1), updatedAt: ago(1) },
]
// A 1×1 PNG: the faked AI "reads" three stickies from it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

function fakeAi() {
  window.__pictures = 0
  window.osatLocalAI = {
    status: async () => ({ chosen: 'balanced', tiers: [], download: null }),
    onStatus: () => () => {},
    models: async () => ({ models: [{ id: 'osat:balanced', name: 'Gemma 4 · Balanced', label: 'Balanced', runtime: 'osat', offline: true, state: 'ready', sees: true }] }),
    chatStream: (payload, onDelta) => {
      if (payload.messages.some((message) => message.images?.length)) window.__pictures += 1
      const text = 'Here are the stickies:\n- Spotlight Search for OSAT\n- Audio player?\n- eggs, butter'
      onDelta(text)
      return { done: Promise.resolve(text), cancel() {} }
    },
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

const readDoc = (page) => page.evaluate(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500))
  const db = await new Promise((resolve) => { const request = indexedDB.open('osat-preview', 1); request.onsuccess = () => resolve(request.result) })
  return new Promise((resolve) => { const request = db.transaction('workspace').objectStore('workspace').get('doc'); request.onsuccess = () => resolve(request.result) })
})
const stored = async (page, id) => (await readDoc(page)).notes.find((note) => note.id === id)

async function openCanvas(browser, url, theme, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport, colorScheme: theme })
  page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`))
  await page.addInitScript(fakeAi)
  await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async ({ notes, folders }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 14, rev: 0, theme: 'system', notes, folders, habits: [], reflections: [], focus: { status: 'idle' }, projects: [], sorter: null, calendar: { events: [{ id: 'event-1', title: 'Dentist', start: notes.find((note) => note.id === 'w3').cal.start, end: notes.find((note) => note.id === 'w3').cal.start }] }, budget: { currency: 'USD', transactions: [], recurring: [] }, settings: { autoFile: { on: false }, dates: { on: false }, seeded: { direction: true } }, chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { notes: NOTES, folders: FOLDERS })
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await openPlace(page, 'Just in')
  await page.locator('.justin').waitFor({ timeout: 5000 })
  return page
}

const section = (page, name) => page.locator('.justin-main').getByRole('region', { name, exact: true })
const row = (page, words) => page.locator('.justin-row', { hasText: words })
const toastUndo = (page) => page.locator('.toast').getByRole('button', { name: 'Undo', exact: true })

async function light(page) {
  // On top, today's brief.
  check((await page.locator('.justin-brief').innerText()).includes('The dentist is tomorrow at 2:00'), 'today’s morning brief wasn’t on top')
  // Waiting: three, the Fortis one offered Fortis; the date says it's on the calendar.
  check(await section(page, 'Waiting for a home').locator('.justin-row').count() === 3, 'Waiting didn’t hold the three stickies with no home')
  check(await row(page, 'Fortis demo slides').getByRole('button', { name: 'Fortis', exact: true }).count() === 1, 'the Fortis sticky wasn’t offered Fortis')
  check((await row(page, 'Dentist').innerText()).includes('→ Calendar'), 'a date on the calendar didn’t say so')
  // Today and Yesterday: where each went.
  check((await row(page, 'The canvas is hard').innerText()).includes('→ OSAT → Problems'), 'a filed sticky didn’t say where it went')
  check((await section(page, 'Yesterday').innerText()).includes('Integrate n8n'), 'yesterday’s sticky wasn’t under Yesterday')
  await sleep(300)
  await page.screenshot({ path: `${OUT}/light-justin.png` })

  // One tap: onto Fortis. It stays on the list, saying where it went.
  await row(page, 'Fortis demo slides').getByRole('button', { name: 'Fortis', exact: true }).click()
  await sleep(200)
  check((await stored(page, 'w1')).folderId === 'fortis', 'the Fortis button didn’t put it on Fortis')
  check((await section(page, 'Today').innerText()).includes('Fortis demo slides'), 'a sticky given a home left Just in')
  check((await row(page, 'Fortis demo slides').innerText()).includes('→ Fortis → To-dos'), 'it didn’t say where it went')

  // Undo on a row: what the AI filed goes back to waiting.
  await row(page, 'The canvas is hard').getByRole('button', { name: 'Undo', exact: true }).click()
  await sleep(200)
  check((await stored(page, 'f1')).folderId === null, 'Undo on a row didn’t take the filing back')
  check((await section(page, 'Waiting for a home').innerText()).includes('The canvas is hard'), 'it wasn’t waiting again')

  // A date off the calendar, and back.
  await row(page, 'Dentist').getByRole('button', { name: 'Take off calendar' }).click()
  await sleep(200)
  check((await stored(page, 'w3')).cal?.off === true, 'Take off calendar didn’t take it off')
  await toastUndo(page).click()
  await sleep(300)
  check(Boolean((await stored(page, 'w3')).cal?.id), 'Undo didn’t put it back on the calendar')

  // To buy, kept beside: ticked off.
  await page.getByRole('checkbox', { name: 'Bought: milk, bread, turkey' }).click()
  await sleep(200)
  check(Boolean((await stored(page, 'milk')).doneAt), 'ticking To buy didn’t tick it off')

  // A photo of paper stickies: one sticky each, from the AI on this Mac.
  await page.locator('.boards-write input[type="file"]').setInputFiles({ name: 'stickies.png', mimeType: 'image/png', buffer: PNG })
  await row(page, 'Spotlight Search for OSAT').waitFor({ timeout: 5000 }).catch(() => problems.push('a photo’s stickies didn’t come in'))
  check(await page.evaluate(() => window.__pictures) === 1, 'the photo didn’t go to the AI on this Mac')
  const photos = (await readDoc(page)).notes.filter((note) => note.source === 'Photo')
  check(photos.length === 3 && photos.every((note) => note.unsorted), `the photo didn’t make three stickies in Just in (${photos.length})`)
  await sleep(300)
  await page.screenshot({ path: `${OUT}/light-photo.png` })

  // On a board: two stickies that say the same thing, merged, then Undo.
  await page.locator('nav.side .side-group[aria-label="Boards"]').getByRole('button', { name: /^OSAT\b/ }).click()
  const note = page.locator('.boards-note', { hasText: 'say the same thing' })
  await note.waitFor({ timeout: 3000 }).catch(() => problems.push('two stickies that say the same thing weren’t offered to merge'))
  check((await note.innerText()).includes('Two to-dos'), 'the merge note didn’t say what they are')
  await page.screenshot({ path: `${OUT}/light-merge.png` })
  await note.getByRole('button', { name: 'Merge' }).click()
  await sleep(200)
  check((await stored(page, 'j1')).markdown.includes('Call Jordan back about the roof estimate') && Boolean((await stored(page, 'j2')).trashedAt), 'Merge didn’t keep both in one sticky')
  check(await page.locator('.boards-card', { hasText: 'Call Jordan' }).count() === 1, 'both stickies were still on the board')
  await toastUndo(page).click()
  await sleep(200)
  check(!(await stored(page, 'j2')).trashedAt && (await stored(page, 'j1')).markdown === 'Call Jordan about the roof estimate', 'Undo didn’t bring both back')
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()

  const page = await openCanvas(browser, url, 'light')
  await light(page)
  await page.close()

  const dark = await openCanvas(browser, url, 'dark')
  await sleep(400)
  await dark.screenshot({ path: `${OUT}/dark-justin.png` })
  await dark.close()

  const narrow = await openCanvas(browser, url, 'light', { width: 760, height: 900 })
  await sleep(400)
  await narrow.screenshot({ path: `${OUT}/light-narrow.png` })
  await narrow.close()

  await browser.close()
  server?.kill()
  if (problems.length) {
    console.error(problems.map((problem) => `✗ ${problem}`).join('\n'))
    process.exit(1)
  }
  console.log(`Just in checked. Screenshots in ${OUT}/`)
}

main().catch((error) => { console.error(error); server?.kill(); process.exit(1) })
