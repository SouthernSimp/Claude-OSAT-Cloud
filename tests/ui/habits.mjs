// Tools → Habits in the built preview, seeded with a few habits and their past days: the runs in plain words, keeping
// today with a click and with Space/Return (and a second tap taking it back), marking a past day in the week strip,
// moving a habit with ⌥↑ and by dragging, Rename, Build ↔ Avoid, Delete with Undo, adding by name with Return,
// History (a month per habit, tap a day), Esc backing out one step at a time, the first-run ideas, the desk widget,
// a narrow room, light and dark. Fails on page errors or a step that didn't happen; screenshots land in
// test-results/ui/habits/. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/habits`
const PORT = Number(process.env.OSAT_PORT || 4329)

const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const ago = (days) => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - days); return key(date) }
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => ago(from + index))
const longDay = (days) => new Date(`${ago(days)}T12:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const TODAY = ago(0)
const HABITS = [
  { id: 'walk', name: 'Walk', type: 'build', doneDates: [...range(1, 9), ...range(11, 30)] },
  { id: 'read', name: 'Read 10 pages', type: 'build', doneDates: [0, 1, 2, 4, 5, 8, 9, 10, 15, 20].map(ago) },
  { id: 'water', name: 'Drink water', type: 'build', doneDates: [ago(0), ...range(2, 6)] },
  { id: 'phone', name: 'No phone in bed', type: 'avoid', doneDates: range(1, 12) },
  { id: 'bed', name: 'Bedtime', type: 'build', doneDates: [] },
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

/* A page with these habits saved (none: the first run), the desk up, and Habits opened from Tools unless `desk`. */
async function openRoom(browser, url, { theme = 'light', habits = HABITS, widgets = null, desk = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
  page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`))
  await page.addInitScript((widgets) => {
    for (const name of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(name, 'seen')
    if (widgets) localStorage.setItem('osat.widgets', JSON.stringify(widgets))
  }, widgets)
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async (habits) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 12, rev: 0, theme: 'system', notes: [], folders: [], habits, reflections: [], focus: { status: 'idle' }, projects: [], sorter: null, calendar: { events: [] }, budget: { currency: 'USD', transactions: [], recurring: [] }, settings: { autoFile: { on: false }, seeded: { direction: true } }, chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, habits)
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  if (desk) return page
  await page.locator('.app-dock [data-space="tools"]').click()
  await page.getByRole('menuitem', { name: 'Habits' }).click()
  await page.locator('.habits').waitFor({ timeout: 5000 })
  await sleep(500)
  return page
}

const room = (page) => page.locator('.popout[aria-label="Habits"]')
const habitButton = (page, name) => room(page).getByRole('button', { name, exact: true })
// `has` is matched inside each row, so it starts from the page, not the room.
const row = (page, name) => room(page).locator('.habit', { has: page.getByRole('button', { name, exact: true }) })
const words = (page, name) => row(page, name).locator('.habit-words small').innerText()
const order = (page, group) => room(page).getByRole('region', { name: group }).locator('.habit-hit').evaluateAll((list) => list.map((node) => node.getAttribute('aria-label')))
const stored = async (page, id) => (await readDoc(page)).habits.find((habit) => habit.id === id)

async function today(page) {
  const head = room(page).locator('.habits-title p')
  check((await head.innerText()).includes('2 of 5 kept'), `the day said “${await head.innerText()}”`)
  check(await room(page).locator('.habit').count() === 5, 'five habits didn’t show')
  check(/9 days in a row\s*·?\s*Best: 20/.test(await words(page, 'Walk')), `Walk said “${await words(page, 'Walk')}”`)
  check((await words(page, 'Read 10 pages')).trim() === '3 days in a row', 'a run that is the best so far said its best twice')
  check((await words(page, 'No phone in bed')).includes('12 days clean'), 'an Avoid habit didn’t count clean days')
  check((await words(page, 'Bedtime')).trim() === 'New', 'a new habit wasn’t just “New”')
  check(!/broke|missed|failed|behind/i.test(await room(page).innerText()), 'the room scolded')

  // Keep today with a click: the circle fills, the run grows, the day's line counts it. A second click takes it back.
  const walk = habitButton(page, 'Walk')
  await walk.click()
  check(await walk.getAttribute('aria-pressed') === 'true', 'a click didn’t keep Walk')
  await sleep(160)
  await page.screenshot({ path: `${OUT}/light-keeping.png` })
  check((await words(page, 'Walk')).includes('10 days in a row'), 'keeping today didn’t add to the run')
  check((await room(page).locator('.habits-title p').innerText()).includes('3 of 5 kept'), 'the day’s line didn’t count it')
  check((await stored(page, 'walk')).doneDates.includes(TODAY), 'today wasn’t saved')
  await sleep(600)
  await room(page).screenshot({ path: `${OUT}/light-today.png` })
  await walk.click()
  check(await walk.getAttribute('aria-pressed') === 'false' && !(await stored(page, 'walk')).doneDates.includes(TODAY), 'a second click didn’t take it back')

  // Space and Return do the same.
  await walk.focus()
  await page.keyboard.press('Space')
  check(await walk.getAttribute('aria-pressed') === 'true', 'Space didn’t keep it')
  await page.keyboard.press('Enter')
  check(await walk.getAttribute('aria-pressed') === 'false', 'Return didn’t take it back')

  // A past day, marked in the week strip; ← moves along the days.
  const week = room(page).getByRole('group', { name: 'Bedtime, the last seven days' })
  await week.getByRole('button', { name: longDay(2), exact: true }).click()
  check((await words(page, 'Bedtime')).startsWith('Last done'), `one day two days ago said “${await words(page, 'Bedtime')}”`)
  await week.getByRole('button', { name: longDay(1), exact: true }).click()
  check((await words(page, 'Bedtime')).includes('2 days in a row'), 'marking yesterday didn’t join the run')
  check(JSON.stringify((await stored(page, 'bed')).doneDates.sort()) === JSON.stringify([ago(2), ago(1)]), 'the past days weren’t saved')
  await week.getByRole('button', { name: `Today, ${longDay(0)}` }).focus()
  await page.keyboard.press('ArrowLeft')
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === longDay(1), '← didn’t move to yesterday')

  // ⌥↑ moves a habit up among its own kind, and the focus goes with it.
  await habitButton(page, 'Bedtime').focus()
  await page.keyboard.press('Alt+ArrowUp')
  await sleep(100)
  check(JSON.stringify(await order(page, 'Build')) === JSON.stringify(['Walk', 'Read 10 pages', 'Bedtime', 'Drink water']), `⌥↑ left ${await order(page, 'Build')}`)
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Bedtime', 'the focus didn’t stay on the habit moved')

  // Dragging: Drink water to the top; it stays kept (the drop isn't a click).
  const from = await habitButton(page, 'Drink water').boundingBox()
  const to = await habitButton(page, 'Walk').boundingBox()
  await page.mouse.move(from.x + 120, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 120, from.y + from.height / 2 - 12, { steps: 3 })
  await page.mouse.move(to.x + 120, to.y + 6, { steps: 10 })
  await page.screenshot({ path: `${OUT}/light-dragging.png` })
  await page.mouse.up()
  await sleep(200)
  check(JSON.stringify(await order(page, 'Build')) === JSON.stringify(['Drink water', 'Walk', 'Read 10 pages', 'Bedtime']), `the drag left ${await order(page, 'Build')}`)
  check(await habitButton(page, 'Drink water').getAttribute('aria-pressed') === 'true', 'the drop toggled the habit')
  check(JSON.stringify((await readDoc(page)).habits.map((habit) => habit.id)) === JSON.stringify(['water', 'walk', 'read', 'phone', 'bed']), 'the new order wasn’t saved')

  // Rename in place from the right-click menu; an emoji first becomes its picture.
  await row(page, 'Bedtime').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('😴 In bed by 11')
  await page.keyboard.press('Enter')
  check(await habitButton(page, '😴 In bed by 11').count() === 1, 'Rename didn’t rename')
  check(await room(page).locator('.habit .habit-emoji', { hasText: '😴' }).count() === 1, 'the emoji didn’t become its picture')
  check((await stored(page, 'bed')).name === '😴 In bed by 11', 'the new name wasn’t saved')

  // Build ↔ Avoid from the ⋯ menu.
  await room(page).getByRole('button', { name: 'More for Read 10 pages' }).click()
  await page.getByRole('menuitem', { name: 'Make it an Avoid habit' }).click()
  check(JSON.stringify(await order(page, 'Avoid')) === JSON.stringify(['Read 10 pages', 'No phone in bed']), `Avoid held ${await order(page, 'Avoid')}`)
  check((await words(page, 'Read 10 pages')).includes('3 days clean'), 'an Avoid habit’s run wasn’t in clean days')
  await room(page).getByRole('button', { name: 'More for Read 10 pages' }).click()
  await page.getByRole('menuitem', { name: 'Make it a Build habit' }).click()

  // Delete at once, with Undo bringing it back where it was. No confirmation.
  await room(page).getByRole('button', { name: 'More for Walk' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  check(await habitButton(page, 'Walk').count() === 0, 'Delete didn’t take Walk away')
  check(await page.getByRole('dialog', { name: /delete/i }).count() === 0, 'Delete asked first')
  const toast = page.locator('.undo-toasts .toast', { hasText: 'Deleted “Walk”' })
  check(await toast.count() === 1, 'no “Deleted” line with Undo')
  await page.screenshot({ path: `${OUT}/light-deleted.png` })
  await toast.getByRole('button', { name: 'Undo' }).click()
  check(JSON.stringify(await order(page, 'Build')) === JSON.stringify(['Drink water', 'Walk', 'Read 10 pages', '😴 In bed by 11']), `Undo put Walk back at ${await order(page, 'Build')}`)
  check((await stored(page, 'walk'))?.doneDates.length === 29, 'Undo lost Walk’s days')

  // A new habit by name and Return; the field stays for the next; Avoid puts one under Avoid. Esc clears what's typed.
  const field = room(page).getByRole('textbox', { name: 'New habit' })
  await field.click()
  await page.keyboard.type('Stretch')
  await page.keyboard.press('Enter')
  check((await order(page, 'Build')).at(-1) === 'Stretch', 'Return didn’t add Stretch at the end')
  check(await field.inputValue() === '' && await field.evaluate((node) => node === document.activeElement), 'the field didn’t clear and stay')
  await room(page).getByRole('radio', { name: 'Avoid' }).click()
  check(await field.evaluate((node) => node === document.activeElement), 'choosing Avoid didn’t go back to the name')
  await page.keyboard.type('No soda')
  await page.keyboard.press('Enter')
  check((await order(page, 'Avoid')).includes('No soda'), 'an Avoid habit didn’t land under Avoid')
  check((await readDoc(page)).habits.find((habit) => habit.name === 'No soda')?.type === 'avoid', 'No soda wasn’t saved as Avoid')
  await page.keyboard.type('Half a thought')
  await page.keyboard.press('Escape')
  check(await field.inputValue() === '' && await room(page).count() === 1, 'Esc didn’t just clear the name')

  // History: a month per habit, every habit together first; tap a day to change it; the month after today waits.
  await room(page).getByRole('tab', { name: 'History' }).click()
  await room(page).locator('.habit-month').first().waitFor({ timeout: 3000 })
  check(await room(page).locator('.habit-month').count() === 1 + (await readDoc(page)).habits.length, 'History didn’t show every habit and the whole')
  check(await room(page).getByRole('button', { name: 'The month after' }).isDisabled(), 'the month after this one could be opened')
  await sleep(300)
  await room(page).screenshot({ path: `${OUT}/light-history.png` })
  // Walk's one missed day (ten days ago), in whichever month it fell.
  if (ago(10).slice(0, 7) !== TODAY.slice(0, 7)) await room(page).getByRole('button', { name: 'The month before' }).click()
  await room(page).getByRole('article', { name: 'Walk' }).getByRole('button', { name: longDay(10), exact: true }).click()
  const walkStored = await stored(page, 'walk')
  check(walkStored.doneDates.includes(ago(10)), 'a day tapped in History wasn’t saved')
  // Esc goes back to Today first.
  await page.keyboard.press('Escape')
  check(await room(page).getByRole('tab', { name: 'Today' }).getAttribute('aria-selected') === 'true' && await room(page).count() === 1, 'Esc didn’t step back from History to Today')
  check((await words(page, 'Walk')).includes('30 days in a row'), 'the fixed day didn’t join Walk’s two runs')

  // Every habit kept: the ring fills and the day says so.
  for (const name of await room(page).locator('.habit-hit[aria-pressed="false"]').evaluateAll((list) => list.map((node) => node.getAttribute('aria-label')))) {
    await habitButton(page, name).click()
  }
  await sleep(380)
  await room(page).screenshot({ path: `${OUT}/light-all-kept.png` })
  check(/All \d+ kept today/.test(await room(page).locator('.habits-title p').innerText()), 'keeping everything wasn’t said')
  check(await room(page).locator('.habits-ring[data-full]').count() === 1, 'the ring didn’t fill')

  // Esc closes the room once nothing else is open.
  await habitButton(page, 'Walk').focus()
  await page.keyboard.press('Escape')
  await sleep(400)
  check(await room(page).count() === 0, 'Esc didn’t close the room')
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()

  const light = await openRoom(browser, url)
  await today(light)
  await light.close()

  // The first time: a few ideas, one tap each.
  const first = await openRoom(browser, url, { habits: [] })
  check(await room(first).getByText('Small things, kept daily').count() === 1, 'no first-run words')
  await sleep(1200)
  await room(first).screenshot({ path: `${OUT}/light-first.png` })
  await room(first).getByRole('button', { name: '💧 Drink water' }).click()
  check(await habitButton(first, '💧 Drink water').count() === 1 && await room(first).locator('.habits-start').count() === 0, 'an idea didn’t become the first habit')
  check((await readDoc(first)).habits[0]?.type === 'build', 'the idea wasn’t saved')
  await first.close()

  // A narrow room: the week goes under the name.
  const narrow = await openRoom(browser, url)
  await room(narrow).evaluate((node) => { node.style.width = '420px'; node.style.height = '820px'; node.style.top = '30px' })
  await sleep(400)
  await room(narrow).screenshot({ path: `${OUT}/light-narrow.png` })
  const strip = await room(narrow).locator('.habit-week').first().boundingBox()
  const name = await room(narrow).locator('.habit-words').first().boundingBox()
  check(strip.y > name.y + name.height - 2, 'the week didn’t move under the name in a narrow room')
  await narrow.close()

  // Dark: the room, History, the first run, and the desk widget.
  const dark = await openRoom(browser, url, { theme: 'dark' })
  await room(dark).screenshot({ path: `${OUT}/dark-today.png` })
  await room(dark).getByRole('tab', { name: 'History' }).click()
  await sleep(400)
  await room(dark).screenshot({ path: `${OUT}/dark-history.png` })
  await dark.close()
  const darkFirst = await openRoom(browser, url, { theme: 'dark', habits: [] })
  await sleep(1200)
  await room(darkFirst).screenshot({ path: `${OUT}/dark-first.png` })
  await darkFirst.close()

  const desk = await openRoom(browser, url, { theme: 'dark', widgets: ['calendar', 'habits', 'next'], desk: true })
  const widget = desk.locator('.widget-habits')
  await widget.waitFor({ timeout: 5000 }).catch(() => problems.push('the Habits widget didn’t show'))
  check((await widget.innerText()).includes('2 of 5'), 'the widget didn’t say how many are kept')
  const chip = widget.getByRole('button', { name: 'Bedtime', exact: true })
  await chip.click()
  check(await chip.getAttribute('aria-pressed') === 'true' && (await stored(desk, 'bed')).doneDates.includes(TODAY), 'a chip didn’t keep its habit')
  await sleep(500)
  await widget.screenshot({ path: `${OUT}/dark-widget.png` })
  await desk.close()

  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Habits checked. Screenshots in ${OUT}/`)
  })
