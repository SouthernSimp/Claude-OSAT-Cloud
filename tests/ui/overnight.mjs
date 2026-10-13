// While you sleep (Phase 53) on the canvas, in the built preview with the Mac's overnight bridge faked:
// an idea shows as a faint thread and under "Ideas from last night"; Connect them draws the line (Undo
// takes it back), a topic idea makes the topic, and each is reported to main. Fails on page errors or a
// step that didn't happen; screenshots land in test-results/ui/overnight/. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/overnight`
const PORT = Number(process.env.OSAT_PORT || 4321)

const at = new Date(Date.now() - 86400000).toISOString()
const folders = [
  { id: 'fortis', name: 'Fortis Pay', rank: 1, at: { x: 0, y: 0 }, createdAt: at },
  { id: 'home', name: 'Home', rank: 2, at: { x: 520, y: 40 }, createdAt: at },
]
const sticky = (id, markdown, folderId) => ({ id, title: markdown, markdown, folderId, unsorted: !folderId, createdAt: at, updatedAt: at })
const notes = [
  sticky('n1', 'Send Dana the merchant dashboard mockup', 'fortis'),
  sticky('n2', 'Dana liked the dashboard colours', 'home'),
  sticky('p1', 'Call the Hendrix plumber', 'home'),
  sticky('p2', 'Hendrix plumber quote is $400', 'fortis'),
  sticky('p3', 'Pick a day for the Hendrix plumber', 'home'),
]
const IDEAS = [
  { id: 'link:note:n1|note:n2', kind: 'link', a: 'note:n1', b: 'note:n2', why: 'both are about Dana and the merchant dashboard' },
  { id: 'topic:hendrix plumber', kind: 'topic', name: 'Hendrix plumber', notes: ['p1', 'p2', 'p3'], why: 'It comes up in 3 of this week’s stickies.' },
]

/* The Mac app's overnight bridge, faked: the ideas, and what the page reports back. */
function fakeOvernight(ideas) {
  let status = { on: true, last: '', unseen: true, ideas, ai: true, thinking: false }
  window.__done = []
  window.osatOvernight = {
    status: async () => status,
    set: async () => status,
    think: async () => status,
    seen: async () => true,
    onChange: () => () => {},
    done: async (id, dismiss) => {
      window.__done.push([id, dismiss])
      status = { ...status, ideas: status.ideas.filter((idea) => idea.id !== id) }
      return status
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
  await page.addInitScript(fakeOvernight, IDEAS)
  await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async ({ notes, folders }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 12, rev: 0, theme: 'system', notes, folders, habits: [], reflections: [], focus: { status: 'idle' }, projects: [], sorter: null, calendar: { events: [] }, budget: { currency: 'USD', transactions: [], recurring: [] }, settings: { autoFile: { on: false }, seeded: { direction: true } }, chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { notes, folders })
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await page.locator('.app-dock [data-space="Mindmap"]').click()
  await page.locator('.sky-shell').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Fit view' }).click()
  await sleep(900)

  // The idea is a faint thread between the two topics, and the line under the header offers both.
  await page.locator('.board-lines path.is-idea').waitFor({ timeout: 5000 }).catch(() => problems.push('no faint thread for the link idea'))
  check(await page.locator('.board-lines path.is-link').count() === 0, 'a connection was drawn before anything was kept')
  await page.screenshot({ path: `${OUT}/thread.png` })

  // Clicking the thread says why and offers to connect.
  await page.locator('.board-lines g:has(path.is-idea) .link-hit').dispatchEvent('click')
  await page.locator('.context-note', { hasText: 'both are about Dana and the merchant dashboard' }).waitFor({ timeout: 3000 }).catch(() => problems.push('the thread’s menu didn’t say why'))
  await page.screenshot({ path: `${OUT}/thread-menu.png` })
  await page.getByRole('menuitem', { name: 'Connect them' }).click()
  await sleep(400)
  check(await page.locator('.board-lines path.is-link').count() === 1, 'Connect them didn’t draw the connection')
  check(await page.locator('.board-lines path.is-idea').count() === 0, 'the faint thread stayed after it was kept')
  check(JSON.stringify(await page.evaluate(() => window.__done)) === JSON.stringify([[IDEAS[0].id, false]]), 'keeping it wasn’t reported to the Mac')
  const toast = page.locator('.undo-toasts .toast').filter({ hasText: /^Connected / })
  check(await toast.count() === 1, 'no “Connected …” line with Undo')
  await toast.getByRole('button', { name: 'Undo' }).click()
  await sleep(400)
  check(await page.locator('.board-lines path.is-link').count() === 0, 'Undo didn’t take the connection back')

  // The topic idea, from "Ideas from last night".
  await page.getByRole('button', { name: 'Ideas from last night' }).click()
  await page.getByRole('menuitem', { name: /A new topic: Hendrix plumber/ }).click()
  await page.screenshot({ path: `${OUT}/ideas-menu.png` })
  await page.getByRole('menuitem', { name: 'Make “Hendrix plumber” a topic' }).click()
  await sleep(600)
  check(await page.locator('.board-card').filter({ has: page.getByText('Hendrix plumber', { exact: true }) }).count() === 1, 'the topic wasn’t made')
  check(await page.getByRole('button', { name: 'Ideas from last night' }).count() === 0, 'the ideas line stayed with nothing left')
  const stickies = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    const db = await new Promise((resolve) => { const request = indexedDB.open('osat-preview', 1); request.onsuccess = () => resolve(request.result) })
    const doc = await new Promise((resolve) => { const request = db.transaction('workspace').objectStore('workspace').get('doc'); request.onsuccess = () => resolve(request.result) })
    const topic = doc.folders.find((folder) => folder.name === 'Hendrix plumber')
    return { links: topic?.links || [], homes: doc.notes.filter((note) => note.id.startsWith('p')).map((note) => note.folderId) }
  })
  check(JSON.stringify(stickies.links) === JSON.stringify(['note:p1', 'note:p2', 'note:p3']), `the topic connected ${stickies.links.join(', ')}`)
  check(JSON.stringify(stickies.homes) === JSON.stringify(['home', 'fortis', 'home']), 'a sticky moved; a topic idea only connects')
  await page.screenshot({ path: `${OUT}/topic-made.png` })

  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Overnight ideas checked. Screenshots in ${OUT}/`)
  })
