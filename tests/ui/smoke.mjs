// Opens the built web preview in Chromium, visits every room, and fails on any
// page error. Screenshots land in test-results/ui/ (light, then dark) so each
// pull request shows what changed. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = process.env.OSAT_SHOTS || 'test-results/ui'
const PORT = Number(process.env.OSAT_PORT || 4317)
// The five spaces (⌃1–5), then every tool from the dock's Tools menu.
const SPACES = [['Notes', 2], ['Mindmap', 3], ['Assistant', 4], ['Files', 5]]
const TOOLS = [['Journal', 'Today’s page'], ['Calendar', 'Calendar'], ['Habits', 'Habits'], ['Reflection', 'Reflect'], ['Budget', 'Money'], ['Projects', 'Projects'], ['Browser', 'Browser'], ['Terminal', 'Terminal'], ['Settings', 'Settings']]

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
async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  let room = 'start'
  // The name of the drawer row Return would run.
  const picked = () => page.locator('.home-row[aria-selected="true"] .home-row-label').evaluate((node) => node.firstChild.textContent).catch(() => null)
  page.on('pageerror', (error) => problems.push(`${room}: ${error.message}`))
  page.on('console', (message) => {
    // The local AI runtime is not running in CI; a refused request is expected.
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`${room}: ${message.text()}`)
  })

  await page.goto(`${url}?fresh=1`)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await sleep(600)
  if (await page.getByText(/sample room/i).count()) problems.push('desk: the sample room is still offered')

  // A thought typed on home is saved, survives a reload, and waits in Unsorted. Typing
  // folds the drawer open, and Save is the picked row, so Return saves.
  room = 'capture'
  await page.getByPlaceholder('Write it down, find it, or ask…').fill('Smoke test thought')
  await page.getByRole('listbox').waitFor({ timeout: 3000 }).catch(() => problems.push('capture: typing did not open the drawer'))
  if (await picked() !== 'Save as a thought') problems.push(`capture: the first row was not Save (${await picked()})`)
  // Only the keys move the pick: a pointer resting on the drawer never changes what Return does.
  await page.locator('.home-row').nth(1).hover()
  if (await picked() !== 'Save as a thought') problems.push('capture: the pointer moved the picked row')
  await page.keyboard.press('Enter')
  await sleep(800)
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await page.keyboard.press('Control+2')
  await page.locator('.organizer-row', { hasText: 'Unsorted' }).first().click()
  await page.locator('.note-row', { hasText: 'Smoke test thought' }).first().waitFor({ timeout: 5000 })
    .catch(() => problems.push('capture: a thought typed on home was not in Unsorted after a reload'))

  // Each room opens as a pop-out over the desk, and Esc closes it again.
  async function visit(view, go, theme) {
    room = view
    await go()
    const body = page.locator(`.popout-body[data-view="${view}"]`)
    await body.waitFor({ timeout: 5000 }).catch(() => problems.push(`${view}: the room did not open`))
    await sleep(900)
    if (!await body.evaluate((node) => node.children.length > 0).catch(() => false)) problems.push(`${view}: rendered nothing`)
    await page.screenshot({ path: `${OUT}/${theme}-${view}.png` })
    await page.locator('.popout.is-top .popout-bar strong').click()
    await page.keyboard.press('Escape')
    await body.waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push(`${view}: Esc did not close the pop-out`))
  }

  for (const theme of ['light', 'dark']) {
    for (const [view, key] of SPACES) await visit(view, () => page.keyboard.press(`Control+${key}`), theme)
    await visit('Sky', () => page.keyboard.press('Control+3').then(() => sleep(900)).then(() => page.getByRole('radio', { name: 'Sky' }).click()), theme)
    for (const [view, label] of TOOLS) {
      await visit(view, async () => {
        await page.locator('.app-dock [data-space="tools"]').click()
        await page.getByRole('menuitem', { name: label }).click()
      }, theme)
    }
    room = 'desk'
    await sleep(400)
    await page.screenshot({ path: `${OUT}/${theme}-Desk.png` })
    room = 'drawer'
    await page.keyboard.press('Control+k')
    await page.keyboard.type('Smoke')
    await page.getByRole('listbox').waitFor({ timeout: 3000 }).catch(() => problems.push('drawer: typing did not open it'))
    await sleep(400)
    await page.screenshot({ path: `${OUT}/${theme}-Drawer.png` })
    await page.fill('#home-line', '')
    if (theme === 'light') {
      await page.locator('.app-dock .appearance > button').click()
      await page.getByRole('radio', { name: 'Dark' }).click()
      await page.keyboard.press('Escape')
      await sleep(300)
    }
  }

  // A widget opens its room, growing out of it, and its spot stays empty; Esc shrinks it back.
  room = 'widgets'
  await page.locator('.widget-calendar .widget-date').click()
  await page.getByRole('dialog', { name: 'Calendar' }).waitFor({ timeout: 5000 }).catch(() => problems.push('widgets: clicking the Calendar widget did not open the Calendar'))
  if (!await page.locator('.widget-calendar[data-open]').count()) problems.push('widgets: the Calendar widget kept its spot while its room was open')
  await sleep(400)
  await page.locator('.popout.is-top .popout-bar strong').click()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Calendar' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('widgets: Esc did not put the Calendar away'))
  // ⌘K finds "Add a widget", which raises the tray; Esc puts just the tray away.
  await page.keyboard.press('Control+k')
  await page.keyboard.type('add a widget')
  for (let step = 0; step < 6 && await picked() !== 'Add a widget'; step += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  const tray = page.getByRole('dialog', { name: 'Add a widget' })
  await tray.waitFor({ timeout: 3000 }).catch(() => problems.push('widgets: "Add a widget" in the line did not raise the tray'))
  await page.keyboard.press('Escape')
  await tray.waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('widgets: Esc did not put the tray away'))
  // The + adds Habits to the foot of the column; its – takes it off at once, and Undo brings it back.
  await page.locator('.home-widgets').hover()
  await page.getByRole('button', { name: 'Add a widget', exact: true }).click()
  await sleep(500)
  await page.screenshot({ path: `${OUT}/widget-tray.png` })
  await page.getByRole('button', { name: /^Add Habits/ }).click()
  const habits = page.locator('.home-widgets > .widget-habits')
  await habits.waitFor({ timeout: 3000 }).catch(() => problems.push('widgets: Habits was not added from the tray'))
  if (!await page.locator('.home-widgets > .widget').last().evaluate((node) => node.classList.contains('widget-habits')).catch(() => false)) problems.push('widgets: Habits did not land at the foot of the column')
  await habits.hover()
  await page.getByRole('button', { name: 'Take Habits off the desk' }).click()
  if (await habits.count()) problems.push('widgets: the – did not take Habits off')
  await page.getByRole('button', { name: 'Undo' }).click()
  await habits.waitFor({ timeout: 3000 }).catch(() => problems.push('widgets: Undo did not bring Habits back'))
  await page.mouse.move(720, 700)

  // On the desk: a thought, the pile of loose thoughts, a note found from the line, stacked pop-outs, Esc.
  room = 'pop-outs'
  await page.fill('#home-line', 'Left on the desk')
  await page.press('#home-line', 'Enter')
  // Two loose thoughts now: they rest in one pile, which opens Unsorted.
  await page.getByRole('button', { name: /loose thoughts/ }).click()
  await page.getByRole('dialog', { name: 'Notes' }).waitFor({ timeout: 5000 })
    .catch(() => problems.push('pop-outs: the pile of loose thoughts did not open Unsorted'))
  await page.locator('.popout.is-top .popout-bar strong').click()
  await page.keyboard.press('Escape')
  // ⌘K lands in the line; ↓ walks past Save, Ask and Add to Next to the match, ↵ opens it.
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Smoke test')
  for (let step = 0; step < 8 && await picked() !== 'Smoke test thought'; step += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: 'Smoke test thought' }).waitFor({ timeout: 5000 })
    .catch(() => problems.push('pop-outs: a note found from the line did not open as a pop-out'))
  if (await page.inputValue('#home-line')) problems.push('pop-outs: the search stayed in the line after opening what it found')
  await page.getByRole('button', { name: 'Notes', exact: true }).click()
  await page.getByRole('dialog', { name: 'Notes' }).waitFor({ timeout: 5000 })
    .catch(() => problems.push('pop-outs: Notes did not open as a pop-out'))
  await sleep(400)
  await page.screenshot({ path: `${OUT}/pop-outs.png` })
  // ⌘K from inside a room still lands in the line; an empty line jumps (↓ then ↵ opens the latest note).
  await page.locator('.popout.is-top .popout-bar strong').click()
  await page.keyboard.press('Control+k')
  if (!await page.evaluate(() => document.activeElement?.id === 'home-line')) problems.push('pop-outs: ⌘K over a room did not focus the line')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowDown')
  const latest = await picked()
  await page.keyboard.press('Enter')
  if (!latest) problems.push('pop-outs: ↓ on an empty line did not show Jump to')
  else await page.getByRole('dialog', { name: latest }).waitFor({ timeout: 5000 }).catch(() => problems.push(`pop-outs: ↓↵ did not open ${latest}`))
  // Esc, one step at a time: the picked row goes back to Save, the drawer closes and keeps
  // the words, then the top pop-out closes.
  room = 'esc'
  await page.keyboard.press('Control+k')
  await page.keyboard.type('One step at a time')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  if (await picked() !== 'Save as a thought') problems.push('esc: the first Esc did not go back to Save')
  await page.keyboard.press('Escape')
  if (await page.getByRole('listbox').count()) problems.push('esc: the second Esc did not close the drawer')
  if (await page.inputValue('#home-line') !== 'One step at a time') problems.push('esc: closing the drawer lost the words')
  const before = await page.locator('.popout').count()
  await page.keyboard.press('Escape')
  if (await page.locator('.popout').count() !== before - 1) problems.push('esc: the third Esc did not close just the top pop-out')
  // No AI here: ⌘↵ opens Settings → AI and the question stays in the line for later.
  room = 'ask'
  await page.keyboard.press('Control+k')
  await page.keyboard.type('A question for later')
  await page.keyboard.press('Control+Enter')
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 5000 }).catch(() => problems.push('ask: ⌘↵ with no AI did not open Settings'))
  if (await page.inputValue('#home-line') !== 'A question for later') problems.push('ask: setting up the AI lost the question')

  // The quick chat's window, as the browser preview can show it (no AI here).
  room = 'quick chat'
  const chat = await browser.newPage({ viewport: { width: 420, height: 600 } })
  chat.on('pageerror', (error) => problems.push(`quick chat: ${error.message}`))
  await chat.goto(`${url}?surface=chat`)
  await chat.locator('.quick-chat .composer textarea').waitFor({ timeout: 8000 })
    .catch(() => problems.push('quick chat: the chat did not appear'))
  await sleep(400)
  await chat.screenshot({ path: `${OUT}/quick-chat.png` })
  await chat.close()

  // The iPhone app, with a stand-in for its Swift side (files, and an iCloud that
  // already holds a snapshot from a Mac): it catches up, then sends its own change.
  room = 'iphone'
  const phone = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  phone.on('pageerror', (error) => problems.push(`iphone: ${error.message}`))
  await phone.addInitScript(() => {
    const now = new Date().toISOString()
    const mac = { id: 'from-mac', title: 'Written on the Mac', markdown: 'Written on the Mac\n- [ ] Water the plants\n', tags: [], createdAt: now, updatedAt: now, folderId: null, pinned: false, archived: false, trashedAt: null, unsorted: false, source: null, kind: null, date: null }
    const cloud = {
      'Sync/mac-test/snapshot.json': JSON.stringify({
        device: 'mac-test', seq: 0, seen: {}, at: '0000000001000.000000.mac-test',
        meta: { rec: { 'notes\u0000from-mac': { a: '0000000001000.000000.mac-test' } }, set: {}, order: {} },
        doc: { schema: 2, rev: 1, theme: 'system', notes: [mac], folders: [], chats: [], settings: {}, calendar: { events: [] }, budget: { currency: 'USD', transactions: [], recurring: [] }, habits: [], reflections: [], projects: [], sorter: null, focus: { status: 'idle' } },
      }),
    }
    const local = {}
    window.__cloud = cloud
    window.webkit = { messageHandlers: { osat: { postMessage(message) {
      let result = null
      if (message.type === 'local.read') result = local[message.name] ?? null
      else if (message.type === 'local.write') { local[message.name] = message.text; result = true }
      else if (message.type === 'cloud.status') result = { available: true }
      else if (message.type === 'cloud.list') result = [...new Set(Object.keys(cloud).filter((key) => key.startsWith(`${message.path}/`)).map((key) => key.slice(message.path.length + 1).split('/')[0]))]
      else if (message.type === 'cloud.read') result = cloud[message.path] ?? null
      else if (message.type === 'cloud.write') { cloud[message.path] = message.text; result = true }
      setTimeout(() => window.osatNative.reply(message.id, result, null), 0)
    } } } }
  })
  await phone.goto(`${url}?surface=phone`)
  await phone.getByText('Written on the Mac').first().waitFor({ timeout: 8000 })
    .catch(() => problems.push('iphone: the note from the Mac did not arrive'))
  await phone.fill('#phone-line', 'Thought on the phone')
  await phone.click('button[aria-label="Save the thought"]')
  await sleep(2500)
  const sent = await phone.evaluate(() => Object.entries(window.__cloud).some(([key, text]) => /^Sync\/iphone-[a-z0-9]{8}\/00000001\.json$/.test(key) && text.includes('Thought on the phone')))
  if (!sent) problems.push('iphone: the thought was not written to iCloud')
  await phone.screenshot({ path: `${OUT}/iphone-today.png` })
  await phone.getByRole('button', { name: 'iCloud' }).click()
  await phone.getByText('In step with your Mac.').waitFor({ timeout: 5000 })
    .catch(() => problems.push('iphone: the iCloud page did not say it is in step'))
  await phone.screenshot({ path: `${OUT}/iphone-icloud.png` })
  await browser.close()
}

try {
  await main()
} catch (error) {
  problems.push(error.stack || String(error))
} finally {
  server?.kill()
}
if (problems.length) {
  console.error(`UI smoke test found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`UI smoke test passed. Screenshots are in ${OUT}/`)
