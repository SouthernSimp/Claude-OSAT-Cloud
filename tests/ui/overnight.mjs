// While you sleep (Phase 53) on the canvas, in the built preview with the Mac's overnight bridge faked:
// one idea at a time over the board; a link idea names both stickies, Connect them connects them (Undo
// takes it back), a topic idea makes the board with its stickies on it (Undo puts them back), and each is
// reported to main. Fails on page errors or a
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
  await page.locator('.boards').waitFor({ timeout: 5000 })
  const readDoc = () => page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    const db = await new Promise((resolve) => { const request = indexedDB.open('osat-preview', 1); request.onsuccess = () => resolve(request.result) })
    return new Promise((resolve) => { const request = db.transaction('workspace').objectStore('workspace').get('doc'); request.onsuccess = () => resolve(request.result) })
  })
  const linked = async () => (await readDoc()).notes.filter((note) => note.links?.length).map((note) => [note.id, note.links])

  // One idea at a time, over the board: the link idea names both stickies and says why.
  const idea = page.locator('.boards-note')
  await idea.waitFor({ timeout: 5000 }).catch(() => problems.push('no idea showed on the canvas'))
  const words = await idea.innerText()
  check(words.includes('Send Dana the merchant dashboard mockup') && words.includes('Dana liked the dashboard colours'), `the link idea didn’t name both stickies: ${words}`)
  check(words.includes('both are about Dana and the merchant dashboard'), 'the idea didn’t say why')
  await sleep(500)
  await page.screenshot({ path: `${OUT}/link-idea.png` })

  // Connect them keeps it (reported to the Mac); Undo takes the connection back.
  await idea.getByRole('button', { name: 'Connect them' }).click()
  check(JSON.stringify(await linked()) === JSON.stringify([['n1', ['note:n2']]]), 'Connect them didn’t connect the two stickies')
  check(JSON.stringify(await page.evaluate(() => window.__done)) === JSON.stringify([[IDEAS[0].id, false]]), 'keeping it wasn’t reported to the Mac')
  const toast = page.locator('.undo-toasts .toast').filter({ hasText: /^Connected / })
  check(await toast.count() === 1, 'no “Connected …” line with Undo')
  await toast.getByRole('button', { name: 'Undo' }).click()
  check((await linked()).length === 0, 'Undo didn’t take the connection back')

  // The topic idea is next: Make the board makes it with the stickies it is about on it, and opens it; Undo puts them back.
  await idea.filter({ hasText: '“Hendrix plumber” could be a board.' }).waitFor({ timeout: 3000 }).catch(() => problems.push('the board idea didn’t come next'))
  await page.screenshot({ path: `${OUT}/board-idea.png` })
  await idea.getByRole('button', { name: 'Make the board' }).click()
  await page.locator('.boards-title h1', { hasText: 'Hendrix plumber' }).waitFor({ timeout: 3000 }).catch(() => problems.push('the board wasn’t made'))
  check(await idea.count() === 0, 'an idea stayed with nothing left')
  const doc = await readDoc()
  const topic = doc.folders.find((folder) => folder.name === 'Hendrix plumber')
  const homes = (state) => JSON.stringify(state.notes.filter((note) => note.id.startsWith('p')).map((note) => note.folderId))
  check(homes(doc) === JSON.stringify([topic?.id, topic?.id, topic?.id]), `the stickies it is about weren’t put on the board: ${homes(doc)}`)
  check(await page.locator('.boards-card').count() === 3, 'the new board didn’t show its three stickies')
  await page.screenshot({ path: `${OUT}/board-made.png` })
  await page.locator('.undo-toasts .toast').filter({ hasText: /^Made the board/ }).getByRole('button', { name: 'Undo' }).click()
  const undone = await readDoc()
  check(homes(undone) === JSON.stringify(['home', 'fortis', 'home']) && !undone.folders.some((folder) => folder.name === 'Hendrix plumber'), 'Undo didn’t put the stickies back and take the board away')

  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Overnight ideas checked. Screenshots in ${OUT}/`)
  })
