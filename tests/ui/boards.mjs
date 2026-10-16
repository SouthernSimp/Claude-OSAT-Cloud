// The canvas (Phase 68) in the built preview, seeded with three boards (one with a branch) and two stickies just in:
// each board's Map has a column per kind (a branch's stickies count for its board), writing a sticky puts it in its
// column, carrying one to another column says what it is (Undo takes it back), the Board view's stages, the List,
// Just in and carrying onto a board in the side, a new board, Find, the right-click menu, and Esc stepping back
// down to the desk. Light, then dark. Fails on page errors or a step that didn't happen; screenshots land in
// test-results/ui/boards/. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/boards`
const PORT = Number(process.env.OSAT_PORT || 4331)

const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString()
const FOLDERS = [
  { id: 'osat', name: 'OSAT', createdAt: ago(900) },
  { id: 'osat-canvas', name: 'Canvas', parentId: 'osat', createdAt: ago(800) },
  { id: 'fortis', name: 'Fortis', createdAt: ago(700) },
  { id: 'home', name: 'Home', createdAt: ago(600) },
]
const sticky = (id, markdown, folderId, what, extra = {}) => ({ id, title: markdown.split('\n')[0], markdown, folderId, what, createdAt: ago(Number(id.replace(/\D/g, '')) || 1), ...extra })
const NOTES = [
  sticky('n1', 'Boards replace topics and branches', 'osat', 'idea'),
  sticky('n2', 'A kanban view for what is to be done', 'osat-canvas', 'idea'),
  sticky('n3', 'Should the Map show lines between related stickies?', 'osat', 'question'),
  sticky('n4', 'Every line leaves one point on the topic', 'osat', 'problem'),
  sticky('n5', 'Write the Phase 68 pull request', 'osat', 'todo'),
  sticky('n6', 'Ship the DMG to Nate', 'osat', 'todo', { stage: 'doing' }),
  sticky('n7', 'Demo for the payments team', 'fortis', 'todo'),
  sticky('n8', 'milk, bread, eggs, turkey', 'home', 'buy'),
  sticky('n9', 'What time does the DMV open?', null, 'question', { unsorted: true, source: 'Quick bar' }),
  sticky('n10', 'Call mom about the roof', null, 'todo', { unsorted: true, source: 'iPhone' }),
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
  await new Promise((resolve) => setTimeout(resolve, 500))
  const db = await new Promise((resolve) => { const request = indexedDB.open('osat-preview', 1); request.onsuccess = () => resolve(request.result) })
  return new Promise((resolve) => { const request = db.transaction('workspace').objectStore('workspace').get('doc'); request.onsuccess = () => resolve(request.result) })
})
const stored = async (page, id) => (await readDoc(page)).notes.find((note) => note.id === id)

/* The desk with these stickies saved, then the canvas from the dock. */
async function openCanvas(browser, url, theme, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport, colorScheme: theme })
  page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`))
  await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
  // Seeded from a blank page on the same origin, so the app never runs before the stickies are there.
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async ({ notes, folders }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 13, rev: 0, theme: 'system', notes, folders, habits: [], reflections: [], focus: { status: 'idle' }, projects: [], sorter: null, calendar: { events: [] }, budget: { currency: 'USD', transactions: [], recurring: [] }, settings: { autoFile: { on: false }, dates: { on: false }, seeded: { direction: true } }, chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { notes: NOTES, folders: FOLDERS })
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await page.getByRole('button', { name: 'Open the canvas', exact: true }).click()
  await page.locator('.boards').waitFor({ timeout: 5000 })
  return page
}

const side = (page, name) => page.getByRole('navigation', { name: 'Boards' }).getByRole('button', { name: new RegExp(`^${name}\\b`) })
const column = (page, name) => page.locator('.boards-body').getByRole('region', { name, exact: true })
const card = (page, words) => page.locator('.boards-card', { hasText: words })
const cardsIn = async (page, name) => column(page, name).locator('.boards-card').allInnerTexts()

/* Carries a card with the mouse onto `to` (a locator), the way the drag engine expects: down, a nudge, the path, up. */
async function carry(page, from, to) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(60, b.height / 2), { steps: 12 })
  await sleep(120)
  await page.mouse.up()
  await sleep(250)
}

async function light(page) {
  // Just in first: what has no home yet.
  check((await page.locator('.boards-title h1').innerText()) === 'Just in', 'the canvas didn’t open on Just in the first time')
  check(await page.locator('.justin-row').count() === 2, 'Just in didn’t show its two stickies')

  // A board's Map: a column per kind, the branch's sticky on its board, nothing tangled.
  await side(page, 'OSAT').click()
  await page.locator('.boards-title h1', { hasText: 'OSAT' }).waitFor({ timeout: 3000 })
  check((await cardsIn(page, 'Ideas')).length === 2, 'the Ideas column didn’t hold both ideas (the branch’s too)')
  check((await cardsIn(page, 'Questions')).length === 1 && (await cardsIn(page, 'Problems')).length === 1, 'questions or problems were in the wrong place')
  check((await cardsIn(page, 'To-dos')).length === 2, 'the To-dos column didn’t hold two')
  check(await column(page, 'To buy').count() === 0, 'an empty To buy column showed on a board without any')
  check((await card(page, 'A kanban view').innerText()).includes('Canvas'), 'a branch’s sticky didn’t say which branch')
  await sleep(300)
  await page.screenshot({ path: `${OUT}/light-map.png` })

  // Writing a sticky: it goes in its column.
  await page.getByRole('textbox', { name: 'Write a sticky on OSAT' }).fill('Do boards need colours?')
  await page.getByRole('textbox', { name: 'Write a sticky on OSAT' }).press('Enter')
  await card(page, 'Do boards need colours?').waitFor({ timeout: 3000 })
  check((await cardsIn(page, 'Questions')).some((text) => text.includes('Do boards need colours?')), 'a written question didn’t land in Questions')
  const written = (await readDoc(page)).notes.find((note) => note.markdown === 'Do boards need colours?')
  check(written?.folderId === 'osat' && written?.source === 'Canvas', 'the written sticky wasn’t saved on its board')

  // Carried to another column, it is that kind now; Undo takes it back.
  await carry(page, card(page, 'Every line leaves one point'), column(page, 'To-dos'))
  check((await cardsIn(page, 'To-dos')).some((text) => text.includes('Every line leaves one point')), 'carrying a sticky to To-dos didn’t move it')
  check((await stored(page, 'n4')).what === 'todo', 'its new kind wasn’t saved')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await sleep(200)
  check((await cardsIn(page, 'Problems')).some((text) => text.includes('Every line leaves one point')), 'Undo didn’t put it back in Problems')
  check((await stored(page, 'n4')).what === 'problem', 'Undo didn’t restore its kind')

  // Right-click: what it is.
  await card(page, 'Boards replace topics').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'What it is' }).click()
  await page.getByRole('menuitem', { name: 'Question', exact: true }).click()
  await sleep(200)
  check((await cardsIn(page, 'Questions')).some((text) => text.includes('Boards replace topics')), 'the menu’s What it is didn’t move it')

  // The Board view: to-dos, problems and dates by stage; carrying one to Doing saves its stage.
  await page.getByRole('tab', { name: 'Board' }).click()
  await column(page, 'Later').waitFor({ timeout: 3000 })
  check((await cardsIn(page, 'Doing')).some((text) => text.includes('Ship the DMG')), 'a sticky marked Doing wasn’t in Doing')
  check(!(await page.locator('.boards-kanban').innerText()).includes('A kanban view'), 'an idea showed on the Board view')
  await carry(page, card(page, 'Write the Phase 68'), column(page, 'Next'))
  check((await stored(page, 'n5')).stage === 'next', 'carrying to Next didn’t save the stage')
  await carry(page, card(page, 'Write the Phase 68'), column(page, 'Done'))
  check(Boolean((await stored(page, 'n5')).doneAt), 'carrying to Done didn’t tick it off')
  await sleep(300)
  await page.screenshot({ path: `${OUT}/light-board.png` })

  // The List: every sticky, one row each.
  await page.getByRole('tab', { name: 'List' }).click()
  check(await page.locator('.boards-list-row').count() === 7, `the List didn’t show the board’s seven stickies (${await page.locator('.boards-list-row').count()})`)
  await page.screenshot({ path: `${OUT}/light-list.png` })
  await page.getByRole('tab', { name: 'Map' }).click()

  // Find on a board.
  await page.getByRole('textbox', { name: 'Find on OSAT' }).fill('kanban')
  check(await page.locator('.boards-card').count() === 1, 'Find didn’t narrow the board to one sticky')
  await page.keyboard.press('Escape')
  check(await page.getByRole('textbox', { name: 'Find on OSAT' }).inputValue() === '', 'Esc didn’t clear Find first')
  check(await page.locator('.boards').count() === 1, 'Esc left the canvas while Find had words')

  // Just in: carried onto a board in the side, it lives there; Undo brings it back.
  const row = (words) => page.locator('.justin-row', { hasText: words })
  await side(page, 'Just in').click()
  await row('Call mom').waitFor({ timeout: 3000 })
  await carry(page, row('Call mom'), side(page, 'Home'))
  check((await stored(page, 'n10')).folderId === 'home', 'carrying onto Home didn’t file it there')
  check((await row('Call mom').innerText()).includes('→ Home'), 'Just in didn’t say where the sticky went')
  await page.locator('.toast').getByRole('button', { name: 'Undo', exact: true }).click()
  await sleep(200)
  check((await stored(page, 'n10')).folderId === null, 'Undo didn’t bring it back to Just in')
  await page.screenshot({ path: `${OUT}/light-justin.png` })

  // A new board, named in place.
  await page.getByRole('navigation', { name: 'Boards' }).getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('textbox', { name: 'New board’s name' }).fill('Garden')
  await page.getByRole('textbox', { name: 'New board’s name' }).press('Enter')
  await page.locator('.boards-title h1', { hasText: 'Garden' }).waitFor({ timeout: 3000 }).catch(() => problems.push('a new board didn’t open'))
  check((await readDoc(page)).folders.some((folder) => folder.name === 'Garden' && !folder.parentId), 'the new board wasn’t saved')
  check((await page.locator('.boards-title p').innerText()).includes('Nothing on Garden yet'), 'an empty board didn’t say so')

  // Right-click a board: Rename in place.
  await side(page, 'Garden').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('textbox', { name: 'Rename Garden' }).fill('Yard')
  await page.getByRole('textbox', { name: 'Rename Garden' }).press('Enter')
  await page.locator('.boards-title h1', { hasText: 'Yard' }).waitFor({ timeout: 3000 }).catch(() => problems.push('Rename didn’t rename the board'))

  // Delete a board: its stickies go back to Just in, and Undo brings it all back.
  await side(page, 'Fortis').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Delete board/ }).click()
  await sleep(200)
  check(await side(page, 'Fortis').count() === 0, 'Delete didn’t remove the board')
  const orphan = await stored(page, 'n7')
  check(orphan.folderId === null && orphan.unsorted === true, 'a deleted board’s sticky didn’t go back to Just in')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await side(page, 'Fortis').waitFor({ timeout: 3000 }).catch(() => problems.push('Undo didn’t bring the board back'))
  check((await stored(page, 'n7')).folderId === 'fortis', 'Undo didn’t put the sticky back on its board')

  // Esc goes back down to the desk.
  await page.keyboard.press('Escape')
  await page.locator('.boards').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('Esc didn’t come back down to the desk'))
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()

  const page = await openCanvas(browser, url, 'light')
  await light(page)
  await page.close()

  const dark = await openCanvas(browser, url, 'dark')
  await side(dark, 'OSAT').click()
  await sleep(400)
  await dark.screenshot({ path: `${OUT}/dark-map.png` })
  await dark.getByRole('tab', { name: 'Board' }).click()
  await sleep(300)
  await dark.screenshot({ path: `${OUT}/dark-board.png` })
  await dark.close()

  const narrow = await openCanvas(browser, url, 'light', { width: 820, height: 760 })
  await side(narrow, 'OSAT').click()
  await sleep(300)
  await narrow.screenshot({ path: `${OUT}/light-narrow.png` })
  await narrow.close()

  await browser.close()
  server?.kill()
  if (problems.length) {
    console.error(problems.map((problem) => `✗ ${problem}`).join('\n'))
    process.exit(1)
  }
  console.log(`The canvas checked. Screenshots in ${OUT}/`)
}

main().catch((error) => { console.error(error); server?.kill(); process.exit(1) })
