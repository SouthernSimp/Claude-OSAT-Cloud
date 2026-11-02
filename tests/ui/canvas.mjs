// Canvases (Phase 85) in the built preview: the first canvas from the sidebar, a sticky from the Sticky button typed into
// straight away, another from N, a mind map grown from it with Tab, all saved; a new kanban and a second canvas from the
// Boards list's +, Rename and Delete with Undo; dark. Fails on page errors or a step that didn't happen; screenshots land in
// test-results/ui/canvas/. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { sideButton } from './window.mjs'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/canvas`
const PORT = Number(process.env.OSAT_PORT || 4351)
const NOW = new Date().toISOString()
const FOLDERS = [{ id: 'folder-fortis', name: 'Fortis', parentId: null, createdAt: NOW, updatedAt: NOW }]
const NOTES = [
  { id: 'note-deck', title: 'Send the deck', markdown: 'Send the deck', folderId: 'folder-fortis', what: 'todo', createdAt: NOW, updatedAt: NOW },
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

const readDoc = (page) => page.evaluate(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const db = await new Promise((resolve) => { const request = indexedDB.open('osat-preview', 1); request.onsuccess = () => resolve(request.result) })
  return new Promise((resolve) => { const request = db.transaction('workspace').objectStore('workspace').get('doc'); request.onsuccess = () => resolve(request.result) })
})

async function openPage(browser, url, theme) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
  page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`))
  // Excalidraw lists esm.sh after OSAT's own copy for every font (hard-coded, public/excalidraw/fonts comes first) and
  // OSAT's font-src 'self' refuses it; the Chinese one (Xiaolai, 12 MB) isn't shipped, so it is never drawn. Anything
  // else refused, or anything outside that actually loads, fails.
  const fallback = (text) => /esm\.sh\/@excalidraw\/excalidraw@[\d.]+\/dist\/prod\/fonts\//.test(text)
  page.on('console', (message) => { if (message.type() === 'error' && /Content Security Policy|Refused/.test(message.text()) && !fallback(message.text())) problems.push(`${theme}: ${message.text().slice(0, 200)}`) })
  page.on('requestfinished', (request) => { if (!request.url().startsWith(url)) problems.push(`${theme}: reached outside OSAT: ${request.url().slice(0, 120)}`) })
  await page.addInitScript(() => { for (const name of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(name, 'seen') })
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async ({ notes, folders }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 16, rev: 0, theme: 'system', notes, folders, habits: [], goals: [], reflections: [], focus: { status: 'idle' }, projects: [], sorter: null, calendar: { events: [] }, budget: { currency: 'USD', transactions: [], recurring: [] }, settings: { autoFile: { on: false }, seeded: { direction: true } }, chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { notes: NOTES, folders: FOLDERS })
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  return page
}

const room = (page) => page.locator('.app-room[data-view="Canvas"]')

async function light(browser, url) {
  const page = await openPage(browser, url, 'light')
  // The first canvas: the sidebar offers it.
  await page.locator('nav.side').getByRole('button', { name: 'New canvas', exact: true }).click()
  await room(page).locator('.excalidraw').waitFor({ timeout: 20000 })
  check(await room(page).locator('.canvas-head h1').innerText() === 'My canvas', 'the first canvas wasn’t “My canvas”')
  await sleep(800)

  // Sticky: one click, then type.
  await room(page).getByRole('button', { name: 'Sticky' }).click()
  await page.locator('.excalidraw-textEditorContainer textarea').waitFor({ timeout: 5000 })
  await page.keyboard.type('Pricing idea')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `${OUT}/sticky.png` })

  // N: another, without the mouse.
  await room(page).locator('.excalidraw canvas').last().click({ position: { x: 900, y: 600 } })
  await page.keyboard.press('n')
  await page.locator('.excalidraw-textEditorContainer textarea').waitFor({ timeout: 5000 })
  await page.keyboard.type('Ask Sam')
  await page.keyboard.press('Escape')

  // A mind map: Tab on the picked sticky makes a joined idea, ready to type; Esc, Tab again, another.
  await page.keyboard.press('Tab')
  await page.locator('.excalidraw-textEditorContainer textarea').waitFor({ timeout: 5000 })
  await page.keyboard.type('Call Fortis')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await page.locator('.excalidraw-textEditorContainer textarea').waitFor({ timeout: 5000 })
  await page.keyboard.type('Book the demo')
  await page.keyboard.press('Escape')
  // ⇧Tab: a sibling of Book the demo, also off Call Fortis.
  await page.keyboard.press('Shift+Tab')
  await page.locator('.excalidraw-textEditorContainer textarea').waitFor({ timeout: 5000 })
  await page.keyboard.type('Send pricing')
  await page.keyboard.press('Escape')
  await sleep(900)
  await page.screenshot({ path: `${OUT}/mind-map.png` })

  const doc = await readDoc(page)
  const saved = doc.canvases?.[0]
  const texts = (saved?.elements || []).filter((element) => element.type === 'text').map((element) => element.text)
  check(['Pricing idea', 'Ask Sam', 'Call Fortis', 'Book the demo', 'Send pricing'].every((words) => texts.includes(words)), `the stickies’ words weren’t saved: ${JSON.stringify(texts)}`)
  check((saved?.elements || []).filter((element) => element.type === 'arrow').length >= 3, 'Tab didn’t join the new ideas with arrows')
  const shapes = (saved?.elements || [])
  const boxOf = (words) => shapes.find((element) => element.id === shapes.find((text) => text.type === 'text' && text.text === words)?.containerId)
  const parentOfBox = (box) => shapes.find((element) => element.type === 'arrow' && element.endBinding?.elementId === box?.id)?.startBinding?.elementId
  check(parentOfBox(boxOf('Send pricing')) === boxOf('Call Fortis')?.id, '⇧Tab didn’t hang the sibling off the same idea')
  check(!await room(page).getByRole('button', { name: 'Kanban' }).count(), 'the canvas still offers a kanban of its own')

  // The board's own tab is called Kanban now.
  await sideButton(page, 'Fortis').click()
  await page.getByRole('tab', { name: 'Kanban' }).click()
  check(await page.locator('.app-room').getByText('Send the deck').count() > 0, 'the Kanban tab didn’t show the sticky')

  // A new kanban from the Boards list's +: it opens as a kanban.
  await page.locator('nav.side').getByRole('button', { name: 'New kanban or canvas' }).click()
  await page.getByRole('menuitem', { name: /New kanban/ }).click()
  await page.getByRole('textbox', { name: 'New kanban’s name' }).fill('Launch')
  await page.getByRole('textbox', { name: 'New kanban’s name' }).press('Enter')
  await page.getByRole('tab', { name: 'Kanban', selected: true }).waitFor({ timeout: 5000 })
  check(await sideButton(page, 'Launch').count() === 1, 'the new kanban isn’t in Boards')

  // A second canvas from the same +, renamed, then deleted with Undo; the first still has its stickies.
  await page.locator('nav.side').getByRole('button', { name: 'New kanban or canvas' }).click()
  await page.getByRole('menuitem', { name: /New canvas/ }).click()
  await page.getByRole('textbox', { name: 'New canvas’s name' }).fill('Q4 plan')
  await page.getByRole('textbox', { name: 'New canvas’s name' }).press('Enter')
  await room(page).locator('.canvas-head h1').filter({ hasText: 'Q4 plan' }).waitFor({ timeout: 10000 })
  await sideButton(page, 'Q4 plan').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Delete canvas/ }).click()
  check(!await sideButton(page, 'Q4 plan').count(), 'Delete canvas didn’t delete it')
  await page.getByRole('button', { name: 'Undo' }).click()
  check(await sideButton(page, 'Q4 plan').count() === 1, 'Undo didn’t bring the canvas back')
  await sideButton(page, 'My canvas').click()
  await room(page).locator('.excalidraw').waitFor({ timeout: 10000 })
  await sleep(800)
  check((await readDoc(page)).canvases.find((canvas) => canvas.name === 'My canvas')?.elements.length >= 5, 'the first canvas lost what was on it')
  await page.screenshot({ path: `${OUT}/back.png` })
  await page.close()
}

async function dark(browser, url) {
  const page = await openPage(browser, url, 'dark')
  await page.locator('nav.side').getByRole('button', { name: 'New canvas', exact: true }).click()
  await room(page).locator('.excalidraw.theme--dark').waitFor({ timeout: 20000 })
  await room(page).getByRole('button', { name: 'Sticky' }).click()
  await page.locator('.excalidraw-textEditorContainer textarea').waitFor({ timeout: 5000 })
  await page.keyboard.type('Dark sticky')
  await page.keyboard.press('Escape')
  const texts = (await readDoc(page)).canvases?.[0]?.elements.filter((element) => element.type === 'text').map((element) => element.text)
  check(JSON.stringify(texts) === '["Dark sticky"]', `dark: one sticky with its words wasn’t saved: ${JSON.stringify(texts)}`)
  await page.screenshot({ path: `${OUT}/dark.png` })
  await page.close()
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  try {
    await light(browser, url)
    await dark(browser, url)
  } finally {
    await browser.close()
    server?.kill()
  }
  if (problems.length) {
    console.error(`Canvas problems:\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
  console.log(`Canvases checked. Screenshots in ${OUT}/`)
}

main().catch((error) => { console.error(error); server?.kill(); process.exit(1) })
