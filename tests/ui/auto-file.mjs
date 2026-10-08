// The AI files stickies on its own (src/sky/auto-file.js) in the built preview, with the AI faked:
// a pile written a minute ago is filed, a long one gets a short version, one line says where they
// went (Undo takes it all back), and Notes → Filed for you lists them. Fails on page errors or a
// step that didn't happen; screenshots land in test-results/ui/auto-file/. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/auto-file`
const PORT = Number(process.env.OSAT_PORT || 4319)

const minuteAgo = new Date(Date.now() - 60000).toISOString()
const long = 'Garage: this weekend I really need to clear it out because the bike is in the way and the boxes from the move are still there, '
  + 'and maybe I can sell the bike and the old desk on Marketplace, and then there would be room for the workbench I keep talking about, '
  + 'which means I also need to measure the wall by the door before I buy anything.'
const folders = [
  { id: 'jordan', name: 'Jordan', rank: 1, at: { x: 0, y: 0 } },
  { id: 'home', name: 'Home', rank: 2, at: { x: 400, y: 0 } },
]
const notes = [
  { id: 'kept', title: 'Jordan likes the blue logo', markdown: 'Jordan likes the blue logo', folderId: 'jordan', createdAt: minuteAgo, updatedAt: minuteAgo },
  ...['Send Jordan the revised quote', long, 'Buy cat litter', 'Cat vet on Friday', 'Something I can’t place'].map((text, index) => ({
    id: `u${index}`, title: text.split(':')[0].slice(0, 120), markdown: text, unsorted: true, source: 'Quick bar', createdAt: minuteAgo, updatedAt: minuteAgo, rank: index + 1,
  })),
]

/* The Mac app's AI bridge, faked: a short version for a long sticky, then homes for the pile. */
function fakeAi() {
  const status = { chosen: 'balanced', tiers: [{ id: 'balanced', label: 'Balanced', model: 'Gemma 4', ready: true, state: 'ready', busy: false, blocked: false, message: '' }], download: null }
  window.__asked = []
  window.osatLocalAI = {
    status: async () => status,
    onStatus: () => () => {},
    models: async () => ({ models: [{ id: 'osat:balanced', name: 'Gemma 4 · Balanced', label: 'Balanced', runtime: 'osat', offline: true, state: 'ready' }] }),
    chatStream: (payload, onDelta) => {
      window.__asked.push(payload)
      const gist = /Answer in exactly two lines/.test(payload.messages[1].content)
      const text = gist ? 'Title: Clear out the garage\nGist: Clear the garage this weekend and sell the bike and old desk to make room for a workbench.'
        : '1: 1\n2: 2\n3: new: Cats\n4: new: Cats\n5: none'
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

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => problems.push(error.message))
  await page.addInitScript(fakeAi)
  await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  const since = new Date(Date.now() - 3600000).toISOString()
  await page.evaluate(async ({ notes, folders, since }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 12, rev: 0, theme: 'system', notes, folders, habits: [], reflections: [], focus: { status: 'idle' }, projects: [], sorter: null, calendar: { events: [] }, budget: { currency: 'USD', transactions: [], recurring: [] }, settings: { autoFile: { on: true, since } }, chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { notes, folders, since })
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })

  // The pile is filed on its own, and one line says where.
  const toast = page.locator('.undo-toasts .toast').filter({ hasText: /^Filed / })
  await toast.waitFor({ timeout: 10000 }).catch(() => problems.push('no “Filed …” line appeared'))
  const said = await toast.textContent().catch(() => '')
  check(/Filed 4 stickies into/.test(said), `the line said “${said}”`)
  const asked = await page.evaluate(() => window.__asked)
  check(asked.length === 2 && asked.every((payload) => payload.background === true), `asked ${asked.length} times; each must be a background job`)
  check(/Clear the garage this weekend/.test(asked[1]?.messages[1].content || ''), 'filing did not read the long sticky’s short version')
  await page.screenshot({ path: `${OUT}/filed-line.png` })

  // Undo takes the whole run back; the next run never asks about them again.
  await toast.getByRole('button', { name: 'Undo' }).click()
  await sleep(400)
  const unsorted = await page.evaluate(async () => {
    const db = await new Promise((resolve) => { const request = indexedDB.open('osat-preview', 1); request.onsuccess = () => resolve(request.result) })
    await new Promise((resolve) => setTimeout(resolve, 600))
    const doc = await new Promise((resolve) => { const request = db.transaction('workspace').objectStore('workspace').get('doc'); request.onsuccess = () => resolve(request.result) })
    return doc.notes.filter((note) => note.unsorted && !note.folderId).map((note) => note.id).sort()
  })
  check(JSON.stringify(unsorted) === JSON.stringify(['u0', 'u1', 'u2', 'u3', 'u4']), `after Undo, Unsorted held ${unsorted.join(', ')}`)
  check((await page.evaluate(() => window.__asked.length)) === 2, 'it asked again about stickies it had already read')

  // File them again by hand-free means: a new pile, then Notes → Filed for you lists them.
  await page.evaluate(() => { localStorage.removeItem('osat.autofile.tried.v1') })
  await page.reload()
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await page.locator('.undo-toasts .toast').filter({ hasText: /^Filed / }).waitFor({ timeout: 10000 }).catch(() => problems.push('no second filing after reload'))
  await page.getByRole('button', { name: 'Notes', exact: true }).first().click()
  await page.locator('.notes-organizer').getByRole('button', { name: /Filed for you/ }).click()
  await sleep(300)
  const rows = await page.locator('.notes-list .note-row').count()
  check(rows === 4, `Filed for you listed ${rows} stickies`)
  check(await page.locator('.notes-list .note-row', { hasText: 'Clear out the garage' }).count() === 1, 'the long sticky didn’t get its short title')
  await page.screenshot({ path: `${OUT}/filed-for-you.png` })
  await page.locator('.notes-list .note-row', { hasText: 'Clear out the garage' }).click()
  await sleep(300)
  check(await page.locator('.note-gist').count() === 1, 'the editor didn’t show “In short”')
  await page.screenshot({ path: `${OUT}/in-short.png` })

  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Filing on its own checked. Screenshots in ${OUT}/`)
  })
