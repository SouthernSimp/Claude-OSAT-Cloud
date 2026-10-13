// Put the desk away (Phase 56) in the built preview: a cluttered desk (loose stickies and a named stack),
// the desk's menu → Put the desk away, everything goes into one topic on the canvas and Undo brings it all
// back. Fails on page errors or a step that didn't happen; screenshots land in test-results/ui/put-away/.
// Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/put-away`
const PORT = Number(process.env.OSAT_PORT || 4325)

const at = new Date(Date.now() - 86400000).toISOString()
const folders = [{ id: 'osat', name: 'OSAT', rank: 1, at: { x: 0, y: 0 }, createdAt: at }]
const sticky = (id, text, folderId = null) => ({ id, title: text, markdown: text, folderId, unsorted: !folderId, createdAt: at, updatedAt: at })
const notes = [
  sticky('a', 'We could integrate n8n inside OSAT'), sticky('b', 'Need to update billing on my websites'), sticky('c', 'One map view for everything', 'osat'),
  sticky('q1', 'Do we allow more than one board?'), sticky('q2', 'Implement OpenWeb UI into my own software?'),
]
const places = {
  'note:a': { x: 0.38, y: 0.42 }, 'note:b': { x: 0.5, y: 0.62 }, 'note:c': { x: 0.62, y: 0.45 },
  'stack:s1': { x: 0.26, y: 0.12, ids: ['q1', 'q2'], name: 'Questions' },
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
  await new Promise((resolve) => setTimeout(resolve, 600))
  const db = await new Promise((resolve) => { const request = indexedDB.open('osat-preview', 1); request.onsuccess = () => resolve(request.result) })
  return new Promise((resolve) => { const request = db.transaction('workspace').objectStore('workspace').get('doc'); request.onsuccess = () => resolve(request.result) })
})

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => problems.push(error.message))
  await page.addInitScript((places) => {
    for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen')
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('osat.places', JSON.stringify(places)); sessionStorage.setItem('seeded', '1') }
  }, places)
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
  await page.locator('.desk-sticky').first().waitFor({ timeout: 5000 }).catch(() => problems.push('the seeded desk showed no stickies'))
  await sleep(600)
  check(await page.locator('.desk-sticky').count() === 3, `the desk showed ${await page.locator('.desk-sticky').count()} loose stickies`)
  check(await page.locator('.desk-stack').count() === 1, 'the stack didn’t show')
  await page.screenshot({ path: `${OUT}/before.png` })

  await page.mouse.click(1100, 780, { button: 'right' })
  await page.getByRole('menuitem', { name: /Put the desk away/ }).click()
  await sleep(500)
  check(await page.locator('.desk-sticky').count() === 0 && await page.locator('.desk-stack').count() === 0, 'the desk wasn’t cleared')
  const toast = page.locator('.undo-toasts .toast').filter({ hasText: /^Put 5 stickies away in “Put away · / })
  check(await toast.count() === 1, 'no “Put 5 stickies away …” line with Undo')
  await page.screenshot({ path: `${OUT}/after.png` })
  const doc = await readDoc(page)
  const topic = doc.folders.find((folder) => folder.name.startsWith('Put away · '))
  const branch = doc.folders.find((folder) => folder.parentId === topic?.id)
  check(topic && branch?.name === 'Questions', 'no topic with a Questions branch on the canvas')
  check(doc.notes.find((item) => item.id === 'a')?.folderId === topic?.id, 'an Unsorted sticky didn’t move into the topic')
  check(doc.notes.find((item) => item.id === 'c')?.folderId === 'osat', 'a sorted sticky left its topic')

  await toast.getByRole('button', { name: 'Undo' }).click()
  await sleep(600)
  check(await page.locator('.desk-sticky').count() === 3 && await page.locator('.desk-stack').count() === 1, 'Undo didn’t put the desk back')
  const undone = await readDoc(page)
  check(!undone.folders.some((folder) => folder.name.startsWith('Put away · ')), 'Undo left the topic behind')
  check(undone.notes.find((item) => item.id === 'a')?.folderId == null, 'Undo didn’t return the sticky to Unsorted')
  await page.screenshot({ path: `${OUT}/undone.png` })
  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Put the desk away checked. Screenshots in ${OUT}/`)
  })
