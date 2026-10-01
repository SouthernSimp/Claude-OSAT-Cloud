// Opens the built web preview in Chromium, visits every room, and fails on any
// page error. Screenshots land in test-results/ui/ (light, then dark) so each
// pull request shows what changed. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { DEFAULT_SETTINGS } from '../../shared/launcher-model.mjs'
import { installSearchBridge } from './search-bridge.mjs'

const OUT = process.env.OSAT_SHOTS || 'test-results/ui'
const PORT = Number(process.env.OSAT_PORT || 4317)
// The spaces that open as pop-outs (⌃2, 4, 5; ⌃3 is the Sky, a layer of its own), then
// every tool from the dock's Tools menu.
const SPACES = [['Notes', 2], ['Assistant', 4], ['Files', 5]]
const TOOLS = [['Journal', 'Journal'], ['Calendar', 'Calendar'], ['Habits', 'Habits'], ['Budget', 'Money'], ['Terminal', 'Terminal'], ['Roadmap', 'Roadmap'], ['Pile', 'Sort a pile'], ['Settings', 'Settings']]

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
  // The Mac app's quick search bridge, so the desk can hear of a copy (the offer to add it to a node).
  await page.addInitScript(installSearchBridge, DEFAULT_SETTINGS)
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
  if (await picked() !== 'Save as a sticky') problems.push(`capture: the first row was not Save (${await picked()})`)
  // Only the keys move the pick: a pointer resting on the drawer never changes what Return does.
  await page.locator('.home-row').nth(1).hover()
  if (await picked() !== 'Save as a sticky') problems.push('capture: the pointer moved the picked row')
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
    // The Sky: the layer above the desk, a whiteboard of nodes; one opens in place; Esc goes back down.
    room = 'sky'
    await page.keyboard.press('Control+3')
    await page.locator('.sky-layer').waitFor({ timeout: 5000 }).catch(() => problems.push(`sky: ⌃3 did not bring the Sky (${theme})`))
    // The first time, the Sky says how it works; Got it puts that away for good.
    const guide = page.getByRole('dialog', { name: 'How the Sky works' })
    if (theme === 'light') {
      await guide.waitFor({ timeout: 3000 }).catch(() => problems.push('sky: the first visit did not say how the Sky works'))
      await sleep(500)
      await page.screenshot({ path: `${OUT}/sky-guide.png` })
      await page.getByRole('button', { name: 'Got it' }).click().catch(() => {})
    }
    await sleep(300)
    if (await guide.count()) problems.push(`sky: the guide showed again after Got it (${theme})`)
    if (theme === 'light') {
      room = 'free Sky stickies'
      await page.getByRole('button', { name: 'New sticky', exact: true }).click()
      await page.getByRole('textbox', { name: 'A new sticky', exact: true }).fill('Freely placed Sky sticky\nSame note everywhere')
      await page.getByRole('textbox', { name: 'A new sticky', exact: true }).press('Escape')
      const free = page.locator('.board-sticky', { hasText: 'Freely placed Sky sticky' })
      await free.waitFor({ timeout: 3000 })
      if (await page.locator('[data-card="unsorted"] .sticky', { hasText: 'Freely placed Sky sticky' }).count()) problems.push('sky: a free sticky was duplicated in the Unsorted pile')
      const before = await free.evaluate((element) => element.style.translate)
      await free.locator('.sticky').focus()
      await page.keyboard.press('ArrowRight')
      await sleep(250)
      if (await free.evaluate((element) => element.style.translate) === before) problems.push('sky: arrow keys did not move a focused free sticky')
      const from = await free.boundingBox()
      const board = await page.locator('.board').boundingBox()
      await page.mouse.move(from.x + 30, from.y + 25)
      await page.mouse.down()
      await page.mouse.move(board.x + board.width - 280, board.y + 260, { steps: 12 })
      await page.mouse.up()
      await sleep(250)
      const placed = await free.evaluate((element) => element.style.translate)
      await free.locator('.sticky').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Back to Unsorted', exact: true }).click()
      await free.waitFor({ state: 'detached', timeout: 3000 })
      await page.locator('[data-card="unsorted"] .sticky', { hasText: 'Freely placed Sky sticky' }).waitFor({ timeout: 3000 })
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await free.waitFor({ timeout: 3000 })
      if (await free.evaluate((element) => element.style.translate) !== placed) problems.push('sky: Undo did not restore the sticky’s exact placement')
      await page.getByRole('textbox', { name: 'Find a sticky' }).fill('Freely placed Sky sticky')
      await page.getByRole('textbox', { name: 'Find a sticky' }).press('Enter')
      await free.locator('.sticky.is-found').waitFor({ timeout: 3000 })
      await sleep(800)
      await page.screenshot({ path: `${OUT}/sky-free-stickies.png` })
      await page.reload()
      await page.waitForSelector('.workspace-content')
      await page.keyboard.press('Control+3')
      await free.waitFor({ timeout: 5000 })
      if (await free.evaluate((element) => element.style.translate) !== placed) problems.push('sky: a free sticky lost its placement after reload')
      await page.locator('.board-zoom-fit').click()
      await sleep(800)
    }
    await sleep(700)
    await page.screenshot({ path: `${OUT}/${theme}-Sky.png` })
    // Opening a node never moves the other cards (it used to push them away for good).
    const cardSpots = () => page.evaluate(() => JSON.stringify([...document.querySelectorAll('.board-card[data-card]')].map((card) => [card.dataset.card, card.style.translate])))
    const spotsBefore = await cardSpots()
    await page.locator('[data-node-head]', { hasText: 'Project Direction' }).dblclick({ force: true }).catch(() => problems.push(`sky: Project Direction was not there to open (${theme})`))
    await page.locator('.board-card.is-open .lane').first().waitFor({ timeout: 3000 }).catch(() => problems.push(`sky: opening a node showed no lanes (${theme})`))
    if (await cardSpots() !== spotsBefore) problems.push(`sky: opening a node moved the other cards (${theme})`)
    await sleep(900)
    await page.screenshot({ path: `${OUT}/${theme}-Sky-node.png` })
    await page.keyboard.press('Escape')
    await page.locator('.sky-layer').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('sky: Esc did not bring the desk back'))
    await page.locator('.sky-shell').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
    for (const [view, label] of TOOLS) {
      await visit(view, async () => {
        await page.locator('.app-dock [data-space="tools"]').click()
        await page.getByRole('menuitem', { name: label }).click()
      }, theme)
    }
    // The browser has its own button on the dock ("Web").
    await visit('Browser', () => page.locator('.app-dock [data-space="Browser"]').click(), theme)
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
    // Offline (the look only in the preview): the switch at the end of the line, and back.
    room = 'offline'
    await page.locator('.home-offline').click()
    await page.locator('.home-offline-note').waitFor({ timeout: 3000 }).catch(() => problems.push(`offline: the switch did not say so (${theme})`))
    await page.screenshot({ path: `${OUT}/${theme}-Offline.png` })
    await page.locator('.home-offline').click()
    await page.locator('.home-offline-note').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push(`offline: the switch did not turn off (${theme})`))
    if (theme === 'light') {
      // Appearance lives in the Tools menu (Settings → Appearance), not on the dock.
      if (await page.locator('.app-dock').getByText('Look', { exact: true }).count()) problems.push('dock: Look is still on the dock')
      await page.locator('.app-dock [data-space="tools"]').click()
      for (const gone of ['Reflect', 'Projects']) if (await page.getByRole('menuitem', { name: gone, exact: true }).count()) problems.push(`tools: ${gone} is still in the Tools list`)
      await page.getByRole('menuitem', { name: 'Appearance' }).click()
      await page.getByRole('radio', { name: 'Dark' }).click()
      await page.locator('.popout.is-top .popout-bar strong').click()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: 'Settings' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('appearance: Esc did not close Settings'))
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

  // Settings (Phase 13b): a sidebar with a search box and a page for each thing. Quick search: the places, how it opens.
  // Shortcuts: every word and key in one table. Clipboard: limits, Pause, Clear (with Undo). Quick links: add, take off, Undo.
  room = 'settings'
  const calls = () => page.evaluate(() => window.__calls)
  await page.keyboard.press('Control+,')
  const rail = page.getByRole('navigation', { name: 'Settings sections' })
  const goTo = async (name) => { await rail.getByRole('button', { name, exact: true }).click(); await sleep(350) }
  await rail.getByRole('button', { name: 'Quick search', exact: true }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: the sidebar had no Quick search page'))
  await goTo('Quick search')
  const names = (await page.locator('.setting-group', { hasText: 'Where it looks' }).locator('.setting-text b').allInnerTexts().catch(() => [])).join(', ')
  if (names !== 'Files, Clipboard, Apps, Notes and nodes, Calculator, Window layouts') problems.push(`settings: the places were ${names}`)
  await page.getByRole('switch', { name: 'Look in Clipboard' }).uncheck()
  await page.getByRole('radio', { name: 'The full view' }).click()
  if ((await page.evaluate(() => window.osatSearch.settings())).view !== 'full') problems.push('settings: a change was not saved at once')
  await page.screenshot({ path: `${OUT}/settings-quick-search.png` })
  await goTo('Shortcuts')
  const clipboardRow = page.locator('.short-row', { hasText: 'Clipboard' })
  await clipboardRow.waitFor({ timeout: 3000 }).catch(() => problems.push('settings: the Shortcuts table had no Clipboard row'))
  if (!(await clipboardRow.getAttribute('class').catch(() => ''))?.includes('is-off')) problems.push('settings: turning a place off did not dim its row')
  await page.getByRole('switch', { name: 'Use Clipboard' }).check()
  await page.getByLabel('Word for Clipboard').fill('cb')
  await page.getByLabel('Word for Clipboard').blur()
  await page.getByLabel('Word for Files').fill('cb')
  await page.getByLabel('Word for Files').blur()
  await page.getByText('“cb” is Clipboard’s word already.').waitFor({ timeout: 3000 }).catch(() => problems.push('settings: a word two things wanted was not refused, naming who has it'))
  await page.getByRole('button', { name: 'Key for Files' }).click()
  await page.keyboard.press('Control+Alt+Shift+Meta+F')
  await page.getByRole('button', { name: 'Key for Files' }).filter({ hasText: 'Hyper' }).filter({ hasText: /F$/ }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: a recorded Hyper key was not shown as Hyper F'))
  await page.getByRole('button', { name: 'Key for Notes and nodes' }).click()
  await page.keyboard.press('Control+Alt+Shift+Meta+F')
  await page.getByText('Hyper F is Files’ key already.').waitFor({ timeout: 3000 }).catch(() => problems.push('settings: a key two things wanted was not refused, naming who has it'))
  await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'Has a word' }).click()
  if (await page.locator('.short-row', { hasText: 'Calculator' }).count()) problems.push('settings: the Has a word filter kept a row with no word')
  await page.getByRole('radio', { name: 'All' }).click()
  await page.getByRole('button', { name: /^Places/ }).click()
  if (await page.locator('.short-row', { hasText: 'Files' }).count()) problems.push('settings: a group did not fold')
  await page.getByRole('button', { name: /^Places/ }).click()
  await page.screenshot({ path: `${OUT}/settings-shortcuts.png` })
  await goTo('Clipboard')
  await page.getByLabel('How many copies to keep').selectOption('100')
  await page.getByLabel('How long to keep a copy').selectOption('7')
  if ((await page.evaluate(() => window.osatSearch.settings())).clipboard.days !== 7) problems.push('settings: the clipboard limits were not saved at once')
  await page.getByRole('switch', { name: 'Pause the clipboard history' }).check()
  await page.getByText('Not keeping what you copy.', { exact: false }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: Pause did not say so'))
  await page.getByRole('switch', { name: 'Pause the clipboard history' }).uncheck()
  await page.getByRole('button', { name: 'Clear the history' }).click()
  const cleared = page.locator('.undo-toasts .toast', { hasText: 'Cleared the clipboard history' })
  await cleared.waitFor({ timeout: 3000 }).catch(() => problems.push('settings: Clear did not offer Undo'))
  await cleared.getByRole('button', { name: 'Undo' }).click()
  if (!(await calls()).some(([name, token]) => name === 'undoClip' && token === 'undo-clear')) problems.push('settings: Undo did not bring the history back')
  if (!await page.getByText('Allow OSAT to paste and move windows', { exact: false }).count()) problems.push('settings: the Accessibility permission was not explained')
  await page.screenshot({ path: `${OUT}/settings-clipboard.png` })
  await goTo('Quick links')
  await page.getByLabel('Address of the quick link').fill('https://github.com/{query}')
  await page.getByLabel('Word for the quick link').fill('gh')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Take off github.com' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: a new quick link was not added'))
  await page.getByRole('button', { name: 'Take off github.com' }).click()
  await page.locator('.undo-toasts .toast', { hasText: 'Took off “github.com”' }).getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Take off github.com' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: Undo did not bring a quick link back'))
  await page.screenshot({ path: `${OUT}/settings-quick-links.png` })
  await goTo('Keyboard')
  for (const said of ['Make Caps Lock a Hyper key', 'Use ⌘Space for the quick search', 'Another app makes my Hyper key']) {
    if (!await page.getByText(said, { exact: false }).count()) problems.push(`settings: missing "${said}"`)
  }
  await page.getByLabel('What the Hyper key sends').selectOption('three')
  if ((await page.evaluate(() => window.osatSearch.settings())).hyper.sends !== 'three') problems.push('settings: what the Hyper key sends was not saved')
  await page.getByLabel('What the Hyper key sends').selectOption('four')
  await goTo('Window layouts')
  await page.getByRole('switch', { name: 'Use keys to move the window I’m in, from any app' }).check()
  await page.getByRole('button', { name: 'Key for Left half' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: turning window keys on did not list the layouts'))
  await page.screenshot({ path: `${OUT}/settings-window-layouts.png` })
  await goTo('The ring')
  await page.getByRole('button', { name: 'Move Clipboard earlier' }).click()
  await page.waitForFunction(() => window.osatSearch.settings().then((value) => value.ring.items?.[0] === 'clipboard'), null, { timeout: 3000 }).catch(() => problems.push('settings: the ring’s order was not changed'))
  await page.getByRole('button', { name: 'Reset the ring' }).click()
  await page.screenshot({ path: `${OUT}/settings-ring.png` })
  // Every other page opens without a fault, and the search finds a row by its words on any page.
  for (const name of ['General', 'Appearance', 'AI', 'Bots', 'Data', 'Scans', 'iPhone', 'About']) {
    await goTo(name)
    if (!await page.locator('.settings-section .setting-head h2', { hasText: new RegExp(`^${name}$`) }).count()) problems.push(`settings: the ${name} page did not open`)
    await page.screenshot({ path: `${OUT}/settings-${name.toLowerCase()}.png` })
  }
  await page.keyboard.press('Control+f')
  await page.getByRole('searchbox', { name: 'Search settings' }).waitFor({ timeout: 2000 }).catch(() => {})
  await page.keyboard.type('hyper')
  await page.locator('.setting-found', { hasText: 'Keyboard' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: searching "hyper" did not find the Keyboard page'))
  if (await page.locator('.setting-row', { hasText: 'Download a backup' }).count()) problems.push('settings: the search left a row that does not match')
  await page.screenshot({ path: `${OUT}/settings-search.png` })
  await page.keyboard.press('Escape')
  if (await page.getByRole('searchbox', { name: 'Search settings' }).inputValue() !== '') problems.push('settings: Esc did not clear the search')
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('zzzz nothing')
  await page.getByText('Nothing in Settings matches', { exact: false }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: a search with no answer did not say so'))
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('')
  await page.locator('.popout.is-top .popout-bar strong').click()
  await page.keyboard.press('Escape')
  // The line hears the new word at once.
  await page.fill('#home-line', 'cb')
  await page.locator('.home-row', { hasText: 'jordan@acme.com' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher settings: the line did not use the new word for the clipboard'))
  await page.fill('#home-line', '')
  await page.evaluate(() => window.osatSearch.saveSettings({ sources: { clipboard: { keyword: 'v', on: true } }, view: 'bar' }))

  // The ring on the desk: ⌘ + middle-click opens quick tools around the pointer (the layouts are for other apps, so not
  // here); a number picks; Esc leaves; a tool does its one thing.
  room = 'ring'
  const ring = page.locator('.ring')
  await page.keyboard.down('Meta')
  await page.mouse.click(720, 640, { button: 'middle' })
  await page.keyboard.up('Meta')
  await ring.waitFor({ timeout: 3000 }).catch(() => problems.push('ring: ⌘ + middle-click did not open the ring'))
  const tools = (await ring.locator('.ring-item span').allInnerTexts().catch(() => [])).join(', ')
  if (tools !== 'Quick search, Clipboard, New sticky, Quick chat, The desk') problems.push(`ring: the desk's ring held ${tools}`)
  await sleep(500)
  await page.screenshot({ path: `${OUT}/desk-ring.png` })
  await page.keyboard.press('Escape')
  await ring.waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('ring: Esc did not put the ring away'))
  await page.mouse.click(720, 640, { button: 'middle' })
  if (await ring.count()) problems.push('ring: a middle-click without ⌘ opened the ring')
  await page.keyboard.down('Meta')
  await page.mouse.click(720, 640, { button: 'middle' })
  await page.keyboard.up('Meta')
  await page.keyboard.press('2')
  await ring.waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('ring: picking a tool did not put the ring away'))
  if (!(await calls()).some(([name, scope]) => name === 'show' && scope === 'clipboard')) problems.push('ring: the Clipboard tool did not open the quick search on the clipboard')
  await page.keyboard.down('Meta')
  await page.mouse.click(720, 640, { button: 'middle' })
  await page.keyboard.up('Meta')
  await page.keyboard.press('3')
  await page.waitForFunction(() => document.activeElement?.id === 'home-line', null, { timeout: 3000 }).catch(() => problems.push('ring: New sticky did not take you to the line'))

  // Widgets grow by their bottom right corner: taller in the column, never smaller than their own content, kept, and
  // put back with a double-click.
  room = 'widget size'
  await page.mouse.move(720, 700)
  const nextWidget = page.locator('.widget-next')
  const natural = await nextWidget.boundingBox()
  await nextWidget.hover()
  const resizer = page.getByRole('button', { name: 'Resize Next' })
  const drag = async (dy) => {
    const here = await resizer.boundingBox()
    await page.mouse.move(here.x + here.width / 2, here.y + here.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 8; step += 1) await page.mouse.move(here.x + here.width / 2, here.y + here.height / 2 + (dy * step) / 8)
    await page.mouse.up()
    await sleep(200)
  }
  await drag(100)
  const grown = await nextWidget.boundingBox()
  if (grown.height < natural.height + 80) problems.push(`widget size: dragging its corner did not make it taller (${natural.height} → ${grown.height})`)
  if (Math.abs(grown.width - natural.width) > 1) problems.push('widget size: a widget in the column changed its width')
  if (!(await page.evaluate(() => JSON.parse(localStorage.getItem('osat.places'))['size:widget:next']?.h)) > natural.height) problems.push('widget size: the size was not kept with the other places')
  await sleep(300)
  await page.screenshot({ path: `${OUT}/desk-widget-grown.png` })
  await nextWidget.hover()
  await drag(-400)
  const least = await nextWidget.boundingBox()
  if (least.height < natural.height - 2) problems.push(`widget size: it went smaller than its own content (${natural.height} → ${least.height})`)
  await nextWidget.hover()
  await drag(60)
  await nextWidget.hover()
  await resizer.dblclick()
  await sleep(200)
  const back = await nextWidget.boundingBox()
  if (Math.abs(back.height - natural.height) > 2 || await nextWidget.getAttribute('data-sized') !== null) problems.push('widget size: a double-click did not put it back')
  await resizer.focus()
  await page.keyboard.press('ArrowDown')
  await sleep(200)
  if ((await nextWidget.boundingBox()).height < natural.height + 20) problems.push('widget size: the arrow keys on the corner did not make it taller')
  await page.keyboard.press('Home')
  await page.mouse.move(720, 700)

  // Tools is a wheel with a line for each tool; the dock can move to the left or right edge (and back), and rooms keep clear of it.
  room = 'dock'
  const wheelRows = page.locator('.tools-list [role="menuitem"]')
  const middleTool = () => page.locator('.tools-row.is-middle b').innerText().catch(() => '')
  await page.locator('.app-dock [data-space="tools"]').click()
  await page.locator('.tools-wheel').waitFor({ timeout: 3000 }).catch(() => problems.push('dock: Tools did not open its wheel'))
  if ((await wheelRows.count()) < 8) problems.push('dock: the wheel did not list the tools')
  if (!/Think out loud with the AI on this Mac/.test(await wheelRows.first().innerText().catch(() => ''))) problems.push('dock: a tool had no line saying what it is')
  await sleep(400)
  await page.screenshot({ path: `${OUT}/desk-tools-wheel.png` })
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.querySelector('.tools-row.is-middle b')?.textContent === 'Sort a pile', null, { timeout: 3000 }).catch(async () => problems.push(`dock: ↓ did not move the wheel (${await middleTool()})`))
  await page.keyboard.press('Escape')
  await page.locator('.tools-wheel').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('dock: Esc did not close the wheel'))
  await page.locator('.app-dock [data-space="tools"]').click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.querySelector('.tools-row.is-middle b')?.textContent === 'Journal', null, { timeout: 3000 }).catch(() => problems.push('dock: the wheel did not reach Journal'))
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: 'Journal' }).waitFor({ timeout: 3000 }).catch(() => problems.push('dock: Return on the middle tool did not open it'))
  await page.locator('.popout.is-top .popout-bar strong').click()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Journal' }).waitFor({ state: 'detached', timeout: 3000 })
  const dockNow = () => page.locator('.app-dock').getAttribute('data-side')
  if ((await dockNow()) !== 'bottom') problems.push('dock: it did not start at the bottom')
  await page.locator('.app-dock [data-space="tools"]').click()
  await page.getByRole('button', { name: 'Move the dock: On the left' }).click()
  await sleep(500)
  if ((await dockNow()) !== 'left') problems.push('dock: the wheel did not move it to the left')
  if (await page.evaluate(() => localStorage.getItem('osat.dock.side.v1')) !== 'left') problems.push('dock: its side was not remembered')
  const standing = await page.locator('.app-dock').boundingBox()
  if (!standing || standing.x > 30 || standing.height < standing.width * 2) problems.push(`dock: on the left it did not stand along the edge (${JSON.stringify(standing)})`)
  await page.keyboard.press('Control+5')
  const files = await page.locator('.popout.is-top').boundingBox()
  if (!files || files.x < 90) problems.push(`dock: a room opened over the dock on the left (${JSON.stringify(files)})`)
  await sleep(500)
  await page.screenshot({ path: `${OUT}/desk-dock-left.png` })
  await page.locator('.popout.is-top .popout-bar strong').click()
  await page.keyboard.press('Escape')
  // Carried by its grip to the right edge, and let go.
  const grip = await page.locator('.dock-grip').boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(grip.x + ((1420 - grip.x) * step) / 10, grip.y + ((450 - grip.y) * step) / 10)
  await page.locator('.dock-targets i[data-edge="right"][data-on]').waitFor({ timeout: 3000 }).catch(() => problems.push('dock: carrying it did not light the edge it would land on'))
  await page.mouse.up()
  await sleep(400)
  if ((await dockNow()) !== 'right') problems.push('dock: carrying it to the right edge did not put it there')
  // …and back to the bottom from the keyboard (the grip listens to the arrow keys).
  await page.locator('.dock-grip').focus()
  await page.keyboard.press('ArrowDown')
  await sleep(300)
  if ((await dockNow()) !== 'bottom') problems.push('dock: the arrow keys on the grip did not put it back at the bottom')
  if (await page.locator('.dock-targets').count()) problems.push('dock: the landing edges stayed up')

  // A copy that looks like a customer's email, for a node that exists (the seeded "Project Direction"), is offered
  // once, calmly; Add puts it in that node with Undo; Not now lets it go; an address for no node is not offered.
  room = 'clipboard offer'
  const copied = (text, id) => page.evaluate(([words, key]) => window.__copied({ id: key, kind: 'email', at: new Date().toISOString(), text: words }), [text, id])
  await copied('pat@nobody-here.example', 'c-none')
  await sleep(300)
  if (await page.locator('.desk-note.is-offer').count()) problems.push('clipboard offer: an address for no node was offered')
  await copied('ann@project-direction.example', 'c-1')
  const offerLine = page.locator('.desk-note.is-offer')
  await offerLine.waitFor({ timeout: 3000 }).catch(() => problems.push('clipboard offer: a copied email for an existing node was not offered'))
  if (!/Add it to Project Direction\?/.test(await offerLine.innerText().catch(() => ''))) problems.push('clipboard offer: the offer did not name the node')
  await page.screenshot({ path: `${OUT}/desk-clipboard-offer.png` })
  await offerLine.getByRole('button', { name: 'Not now' }).click()
  await offerLine.waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('clipboard offer: Not now did not let it go'))
  await copied('ann@project-direction.example', 'c-2')
  await offerLine.getByRole('button', { name: 'Add', exact: true }).click()
  const added = page.locator('.undo-toasts .toast', { hasText: 'Added to Project Direction' })
  await added.waitFor({ timeout: 3000 }).catch(() => problems.push('clipboard offer: Add did not say it was added'))
  await added.getByRole('button', { name: 'Undo' }).click()
  await added.waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('clipboard offer: Undo did not clear the toast'))

  // The line is a launcher: a sum answers in place, a keyword opens an app or a web search, `v` lists what was copied, an
  // app by name is a row, `>` says no bot takes jobs yet; and Save stays first, so Return never guesses.
  room = 'launcher'
  await page.fill('#home-line', '2*49')
  await page.locator('.home-sum', { hasText: '= 98' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher: a sum did not answer in the line'))
  if (await picked() !== 'Save as a sticky') problems.push(`launcher: a sum moved the pick off Save (${await picked()})`)
  await sleep(350)
  await page.screenshot({ path: `${OUT}/desk-launcher-sum.png` })
  await page.keyboard.press('ArrowDown')
  if (await picked() !== '= 98') problems.push(`launcher: the arrow did not reach the answer (${await picked()})`)
  await page.keyboard.press('Enter')
  await page.locator('.desk-note', { hasText: 'Copied 98' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher: copying the answer did not say so'))
  if (!(await calls()).some(([name, words]) => name === 'copyText' && words === '98')) problems.push('launcher: the answer was not copied')
  await page.fill('#home-line', 'ss')
  await page.locator('.home-row', { hasText: 'Open Spotify' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher: ss did not offer Spotify'))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await sleep(150)
  if (!(await calls()).some(([name, app]) => name === 'openAppNamed' && app === 'Spotify')) problems.push('launcher: ss did not open Spotify')
  await page.fill('#home-line', 'g best crms')
  await page.locator('.home-row', { hasText: 'Search Google for “best crms”' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher: g did not offer a web search'))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await sleep(150)
  if (!(await calls()).some(([name, url]) => name === 'openLink' && url === 'https://www.google.com/search?q=best%20crms')) problems.push('launcher: g did not open the search')
  await page.fill('#home-line', 'v')
  await page.locator('.home-row', { hasText: 'jordan@acme.com' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher: v did not list what was copied'))
  if (await picked() !== 'Save as a sticky') problems.push('launcher: v moved the pick off Save')
  await page.fill('#home-line', 'v revised quote')
  await page.locator('.home-row', { hasText: 'Jordan asked for the revised quote' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher: v and words did not find the copy'))
  await sleep(350)
  await page.screenshot({ path: `${OUT}/desk-launcher-clipboard.png` })
  await page.fill('#home-line', 'spot')
  await page.locator('.home-row', { hasText: 'Open Spotify' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher: an app named as you type was not a row'))
  await page.fill('#home-line', '> research best CRMs')
  await page.locator('.home-row', { hasText: 'Hand this to a bot' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher: > did not offer a bot'))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('.desk-note', { hasText: 'No bot takes jobs yet' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher: > did not say plainly that no bot takes jobs'))
  if ((await page.inputValue('#home-line')) !== '> research best CRMs') problems.push('launcher: the job was cleared though nothing took it')
  await page.fill('#home-line', 'a good idea for the shop')
  if (await picked() !== 'Save as a sticky' || await page.locator('.home-row', { hasText: 'Clipboard' }).count()) problems.push('launcher: a sentence starting with "a" was hijacked')
  await page.fill('#home-line', '')

  // Stickies on the desk: a thought saved in the line lands there as a sticky; a double-click
  // writes one where it was clicked.
  room = 'stickies'
  await page.fill('#home-line', 'Left on the desk')
  await page.press('#home-line', 'Enter')
  const left = page.locator('.home .desk-sticky', { hasText: 'Left on the desk' })
  await left.waitFor({ timeout: 3000 }).catch(() => problems.push('stickies: a thought from the line did not land on the desk'))
  await page.mouse.dblclick(1150, 620)
  await page.keyboard.type('Written right here')
  await page.keyboard.press('Escape')
  const here = page.locator('.home .desk-sticky', { hasText: 'Written right here' })
  await here.waitFor({ timeout: 3000 }).catch(() => problems.push('stickies: a double-click on the desk did not write a sticky there'))
  const spot = await here.boundingBox().catch(() => null)
  if (!spot || Math.abs(spot.x - 1126) > 40 || Math.abs(spot.y - 600) > 40) problems.push(`stickies: the sticky was not where the desk was double-clicked (${JSON.stringify(spot)})`)
  await sleep(300)
  await page.screenshot({ path: `${OUT}/desk-stickies.png` })
  // Carried to the dock's Sky and held there, the Sky comes down; dropped on a node, it's filed.
  const from = await left.boundingBox()
  const skyButton = await page.locator('.app-dock [data-space="Mindmap"]').boundingBox()
  await page.mouse.move(from.x + 30, from.y + 20)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(from.x + 30 + ((skyButton.x + skyButton.width / 2 - from.x - 30) * step) / 8, from.y + 20 + ((skyButton.y + skyButton.height / 2 - from.y - 20) * step) / 8)
  await sleep(1100)
  const head = await page.locator('[data-node-head]', { hasText: 'Project Direction' }).boundingBox().catch(() => null)
  if (!head) problems.push('stickies: holding a sticky on the Sky did not bring the Sky down')
  else {
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(skyButton.x + ((head.x + head.width / 2 - skyButton.x) * step) / 6, skyButton.y + ((head.y + head.height / 2 - skyButton.y) * step) / 6)
    await page.mouse.up()
    await sleep(300)
    await page.locator('[data-node-head]', { hasText: 'Project Direction' }).dblclick({ force: true })
    await page.locator('.lane.is-loose .sticky', { hasText: 'Left on the desk' }).waitFor({ timeout: 3000 }).catch(() => problems.push('stickies: the sticky dropped on a node was not in it'))
    await page.keyboard.press('Escape')
    await page.locator('.sky-shell').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('stickies: Esc did not come back down from the Sky'))
    if (await left.count()) problems.push('stickies: a sticky filed in a node stayed on the desk')
  }
  if (!await page.locator('.home').count()) problems.push('stickies: Esc put the desk away')

  // An @ only links: the sticky stays on the desk, a typo makes no node, and the @ is a link
  // that goes to its node in the Sky.
  room = 'mentions'
  await page.fill('#home-line', 'Call about @Project Direction and @Projct')
  await page.press('#home-line', 'Enter')
  const mentioned = page.locator('.home .desk-sticky', { hasText: 'Call about' })
  await mentioned.waitFor({ timeout: 3000 }).catch(() => problems.push('mentions: a sticky with an @ did not land on the desk (it was filed)'))
  const link = mentioned.locator('.sticky-mention', { hasText: '@Project Direction' })
  if (!await link.count()) problems.push('mentions: the @ on the sticky was not a link')
  if (await mentioned.locator('.sticky-mention', { hasText: '@Projct' }).count()) problems.push('mentions: a typo became a link')
  await link.click().catch(() => {})
  await page.locator('.sky-layer').waitFor({ timeout: 5000 }).catch(() => problems.push('mentions: the @ link did not open the Sky'))
  await sleep(600)
  if (await page.locator('[data-node-head]', { hasText: 'Projct' }).count()) problems.push('mentions: a typo made a node')
  // The Sky: names only, no Link to or layouts, Help me sort in plain words, and Import.
  room = 'sky menus'
  if (await page.locator('.node-number').count()) problems.push('sky: node cards still show numbers')
  // The AI in the Sky: a pill opens a small card; "sort these" suggests homes from matching words (no AI in this test),
  // Make it and Undo work, and Unsorted and a branch fold.
  room = 'sky ask'
  const unsortedCard = page.locator('.board-card.is-unsorted')
  await unsortedCard.getByRole('button', { name: 'Write a sticky' }).dispatchEvent('click').catch(() => problems.push('sky: Unsorted had no Write a sticky'))
  for (const text of ['Buy cat litter', 'Cat food is running low', 'Vet visit for the cat']) {
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
  }
  await page.locator('.sky-bar').click({ position: { x: 4, y: 4 } })
  await page.locator('.sky-layer').getByRole('button', { name: 'Ask', exact: true }).click().catch(() => problems.push('sky: there was no Ask pill'))
  const skyCard = page.getByRole('dialog', { name: 'Ask about your Sky' })
  await skyCard.waitFor({ timeout: 3000 }).catch(() => problems.push('sky: the Ask pill did not open its card'))
  await skyCard.getByRole('textbox').fill('sort these')
  await skyCard.getByRole('textbox').press('Enter')
  const catLine = skyCard.locator('.sort-suggestion', { hasText: 'new node, Cat' })
  await catLine.waitFor({ timeout: 3000 }).catch(() => problems.push('sky: "sort these" did not suggest a node for the three cat stickies'))
  await sleep(300)
  await page.screenshot({ path: `${OUT}/sky-ask.png` })
  await catLine.getByRole('button', { name: 'Make it' }).click().catch(() => {})
  await page.locator('[data-node-head]', { hasText: 'Cat' }).waitFor({ timeout: 3000 }).catch(() => problems.push('sky: Make it did not make the node'))
  if (await unsortedCard.locator('.sticky', { hasText: 'Buy cat litter' }).count()) problems.push('sky: the cat stickies were still in Unsorted after Make it')
  await page.getByRole('button', { name: 'Undo', exact: true }).click().catch(() => problems.push('sky: Make it offered no Undo'))
  await page.locator('[data-node-head]', { hasText: 'Cat' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('sky: Undo did not take the new node away'))
  await unsortedCard.locator('.sticky', { hasText: 'Buy cat litter' }).waitFor({ timeout: 3000 }).catch(() => problems.push('sky: Undo did not bring the cat stickies back to Unsorted'))
  await skyCard.getByRole('button', { name: 'Put it away' }).click()
  await skyCard.waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('sky: the Ask card did not go away'))
  await unsortedCard.getByRole('button', { name: /^Unsorted/ }).dispatchEvent('click')
  await unsortedCard.locator('.fold-pile').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: clicking Unsorted did not fold it into a pile'))
  if (await unsortedCard.locator('.sticky').count()) problems.push('sky: a folded Unsorted still showed every sticky')
  await page.screenshot({ path: `${OUT}/sky-folded.png` })
  await unsortedCard.locator('.fold-pile').dispatchEvent('click')
  await unsortedCard.locator('.sticky', { hasText: 'Buy cat litter' }).waitFor({ timeout: 3000 }).catch(() => problems.push('sky: clicking the pile did not open Unsorted again'))
  // Opening a node shows its top at a size you can read, so scroll the board (as a person does) to reach a branch further down.
  const reveal = async (locator) => {
    const top = await locator.evaluate((element) => element.getBoundingClientRect().top).catch(() => null)
    if (top === null) return
    await page.mouse.move(700, 450)
    await page.mouse.wheel(0, top - 350)
    await sleep(500)
  }
  await page.locator('[data-node-head]', { hasText: 'Project Direction' }).dblclick({ force: true })
  await sleep(900)
  await reveal(page.locator('.lane-head', { hasText: 'Later' }).first())
  await page.getByRole('button', { name: 'Fold Later', exact: true }).click({ force: true }).catch(() => problems.push('sky: a branch had no fold arrow'))
  await page.locator('.lane[aria-label="Branch: Later"] .lane-folded').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: the fold arrow did not fold the branch to a line'))
  await page.getByRole('button', { name: 'Open Later', exact: true }).click({ force: true }).catch(() => {})
  await page.locator('.lane[aria-label="Branch: Later"] .lane-folded').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('sky: the branch did not open again'))
  room = 'sky menus'
  await reveal(page.locator('[data-node-head]', { hasText: 'Project Direction' }))
  await page.locator('[data-node-head]', { hasText: 'Project Direction' }).click({ button: 'right', force: true })
  for (const gone of ['Link to', 'Lay it out', 'Put inside', 'Colour', 'Remove node']) if (await page.getByRole('menuitem', { name: gone }).count()) problems.push(`sky: the node menu still says "${gone}"`)
  for (const kept of ['Color', 'Delete node', 'Help me sort']) if (!await page.getByRole('menuitem', { name: kept }).count()) problems.push(`sky: the node menu has no "${kept}"`)
  await page.getByRole('menuitem', { name: 'Help me sort' }).click().catch(() => {})
  await page.locator('.sort-help').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: Help me sort said nothing'))
  await sleep(300)
  await page.screenshot({ path: `${OUT}/sky-sort.png` })
  // A branch's menu: New branch inside puts one inside it, on its own line, and Rename works.
  await reveal(page.locator('.lane-head', { hasText: 'Later' }).first())
  await page.locator('.lane-head', { hasText: 'Later' }).first().click({ button: 'right', force: true })
  await page.getByRole('menuitem', { name: 'New branch inside' }).click().catch(() => problems.push('sky: a branch menu has no "New branch inside"'))
  await page.keyboard.type('Mac apps')
  await page.keyboard.press('Enter')
  await page.locator('.branch:has(> .lane[aria-label="Branch: Later"]) .branch-tree .lane[aria-label="Branch: Mac apps"]').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: New branch inside did not make a branch inside'))
  await page.locator('.lane-head', { hasText: 'Mac apps' }).click({ button: 'right', force: true })
  await page.getByRole('menuitem', { name: 'Rename' }).click().catch(() => {})
  await page.keyboard.type('Apps')
  await page.keyboard.press('Enter')
  await page.locator('.lane[aria-label="Branch: Apps"]').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: Rename in a branch menu did nothing'))
  await sleep(400)
  await page.screenshot({ path: `${OUT}/sky-tree.png` })
  const nodeFile = { title: 'Garden', summary: 'What grows where.', branches: [{ title: 'Beds', leaves: [{ text: 'Tomatoes', done: false }, { text: 'Dig', done: true }], sub_branches: [{ title: 'Herbs', leaves: [{ text: 'Basil' }] }] }] }
  await page.locator('.sky-layer input[type="file"]').setInputFiles({ name: 'garden.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(nodeFile)) })
  await page.getByText('Imported Garden with 2 branches').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: Import did not say what it made'))
  await page.locator('[data-node-head]', { hasText: 'Garden' }).waitFor({ timeout: 3000 }).catch(() => problems.push('sky: the imported node was not in the Sky'))
  await page.locator('.branch:has(> .lane[aria-label="Branch: Beds"]) .branch-tree .lane[aria-label="Branch: Herbs"]').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: an imported sub-branch was not drawn inside its branch'))
  await sleep(900)
  await page.screenshot({ path: `${OUT}/sky-import.png` })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.locator('[data-node-head]', { hasText: 'Garden' }).waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('sky: Undo did not take the import away'))
  // A packed node (Markdown, only a summary, as a bot writes it): it says so, and Unpack opens it up.
  room = 'sky packed'
  await page.locator('.sky-layer input[type="file"]').setInputFiles({ name: 'spring.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nsource: Muse\n---\n# Spring launch\nEverything worth keeping, in one paragraph.\n') })
  const packedHead = page.locator('[data-node-head]', { hasText: 'Spring launch' })
  await packedHead.locator('.node-origin', { hasText: 'packed' }).waitFor({ timeout: 3000 }).catch(() => problems.push('sky: a packed node file did not arrive packed'))
  await page.locator('.board-card.is-open .packed-bar').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: a packed node showed no Unpack'))
  // Fly to it (the board moves, it never scrolls, so a click can't reach a card off-screen).
  await packedHead.dispatchEvent('dblclick').catch(() => {})
  await sleep(1100)
  await page.screenshot({ path: `${OUT}/sky-packed.png` })
  await page.locator('.packed-bar').getByRole('button', { name: 'Unpack', exact: true }).dispatchEvent('click').catch(() => problems.push('sky: Unpack could not be pressed'))
  await page.locator('.board-card.is-open .packed-bar').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('sky: Unpack left the node packed'))
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Undo', exact: true }).click().catch(() => {})
  await page.keyboard.press('Escape')
  await page.locator('.sky-shell').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('sky: Esc did not come back down'))
  if (!await mentioned.count()) problems.push('mentions: the sticky with an @ left the desk')
  // The Roadmap room's Timeline: every phase of the Status table, in order, read from the same
  // text the Roadmap shows; picking one opens its part of the Roadmap.
  room = 'timeline'
  const statusRows = (await readFile('docs/ROADMAP.md', 'utf8')).split('## Status')[1].split('\n## ')[0].split('\n').filter((line) => /^\|\s*[^|\s-][^|]*\|/.test(line) && !/^\|\s*Phase\s*\|/.test(line)).length
  await page.locator('.app-dock [data-space="tools"]').click()
  await page.getByRole('menuitem', { name: 'Roadmap' }).click()
  const roadmapRoom = page.locator('.popout-body[data-view="Roadmap"]')
  await roadmapRoom.getByRole('tab', { name: 'Timeline' }).click().catch(() => problems.push('timeline: the Roadmap room has no Timeline'))
  await page.locator('.timeline-list li').first().waitFor({ timeout: 3000 }).catch(() => problems.push('timeline: nothing on the Timeline'))
  if (await page.locator('.timeline-list li').count() !== statusRows) problems.push(`timeline: ${await page.locator('.timeline-list li').count()} phases shown, the Status table has ${statusRows}`)
  if (!await page.locator('.timeline-list li[data-state="planned"]').count()) problems.push('timeline: no planned phases shown')
  await sleep(400)
  await page.screenshot({ path: `${OUT}/timeline.png` })
  await page.locator('.timeline-list button', { hasText: 'Phase 12b' }).click()
  await roadmapRoom.getByRole('heading', { name: /Phase 12b/ }).waitFor({ timeout: 3000 }).catch(() => problems.push('timeline: picking a phase did not open its part of the Roadmap'))
  if (!await roadmapRoom.getByRole('heading', { name: /Phase 12b/ }).isVisible()) problems.push('timeline: the phase’s part of the Roadmap was not in view')
  await page.locator('.popout.is-top .popout-bar strong').click()
  await page.keyboard.press('Escape')
  await roadmapRoom.waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('timeline: Esc did not close the Roadmap'))
  // Reflection's one home: a tab of the Journal.
  room = 'journal'
  await page.locator('.app-dock [data-space="tools"]').click()
  await page.getByRole('menuitem', { name: 'Journal' }).click()
  await page.getByRole('button', { name: 'Evening', exact: true }).click().catch(() => problems.push('journal: no Evening tab'))
  await page.locator('.popout-body[data-view="Journal"] .journal-form').waitFor({ timeout: 3000 }).catch(() => problems.push('journal: the Reflection tab showed nothing'))
  await page.locator('.popout.is-top .popout-bar strong').click()
  await page.keyboard.press('Escape')

  // On the desk: the Unsorted pile, a note found from the line, stacked pop-outs, Esc.
  room = 'pop-outs'
  // Sent up to the Sky (its menu), the same sticky is set down freely; Notes still finds it in Unsorted.
  await here.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Send up to the Sky' }).click()
  await page.locator('.board-sticky', { hasText: 'Written right here' }).waitFor({ timeout: 3000 }).catch(() => problems.push('stickies: Send up to the Sky did not set the sticky on the canvas'))
  await page.locator('.sky-layer').getByRole('button', { name: 'Desk', exact: true }).click()
  await page.locator('.sky-shell').waitFor({ state: 'detached', timeout: 3000 })
  const shelfSticky = page.locator('.home .desk-sticky', { hasText: 'Smoke test thought' })
  if (await shelfSticky.count()) {
    await shelfSticky.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Send up to the Sky' }).click()
    await page.locator('.sky-layer').getByRole('button', { name: 'Desk', exact: true }).click()
    await page.locator('.sky-shell').waitFor({ state: 'detached', timeout: 3000 })
  }
  await page.getByRole('button', { name: /^Unsorted, / }).click()
  await page.getByRole('dialog', { name: 'Notes' }).waitFor({ timeout: 5000 })
    .catch(() => problems.push('pop-outs: the Unsorted pile did not open Unsorted'))
  await page.locator('.popout.is-top .popout-bar strong').click()
  await page.keyboard.press('Escape')
  // ⌘K lands in the line; ↓ walks past Save, Ask and Add as a next step to the match, ↵ opens it.
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
  // That Esc closed the drawer ⌘K opened, not the room behind the line.
  if (!await page.getByRole('dialog', { name: 'Notes' }).count()) problems.push('pop-outs: Esc right after ⌘K closed Notes instead of the drawer')
  await page.keyboard.press('ArrowDown')
  const latest = await picked()
  await page.keyboard.press('Enter')
  if (!latest) problems.push('pop-outs: ↓ on an empty line did not show Jump to')
  else {
    await page.getByRole('dialog', { name: latest }).waitFor({ timeout: 5000 }).catch(() => problems.push(`pop-outs: ↓↵ did not open ${latest}`))
    // The sticky takes the keyboard a beat after it opens; let it, or it steals the next ⌘K's words.
    await page.waitForFunction(() => document.activeElement?.closest('.popout'), null, { timeout: 5000 })
      .catch(() => problems.push(`pop-outs: ${latest} opened without taking the keyboard`))
  }
  // Esc, one step at a time: the picked row goes back to Save, the drawer closes and keeps
  // the words, then the top pop-out closes.
  room = 'esc'
  await page.keyboard.press('Control+k')
  await page.keyboard.type('One step at a time')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  if (await picked() !== 'Save as a sticky') problems.push(`esc: the first Esc did not go back to Save (${await picked()}, after opening ${latest}, focus ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.className)})`)
  await page.keyboard.press('Escape')
  // The line's own drawer: a room behind it (Notes' list) is a listbox too.
  if (await page.locator('#home-drawer').count()) problems.push('esc: the second Esc did not close the drawer')
  if (await page.inputValue('#home-line') !== 'One step at a time') problems.push(`esc: closing the drawer lost the words (${JSON.stringify(await page.inputValue('#home-line'))})`)
  const before = await page.locator('.popout').count()
  await page.keyboard.press('Escape')
  // A room may shrink back into its widget first: give the close a moment to finish.
  for (let wait = 0; wait < 20 && await page.locator('.popout').count() !== before - 1; wait += 1) await sleep(100)
  if (await page.locator('.popout').count() !== before - 1) problems.push('esc: the third Esc did not close just the top pop-out')
  // No AI here: ⌘↵ opens Settings → AI and the question stays in the line for later.
  room = 'ask'
  await page.keyboard.press('Control+k')
  await page.keyboard.type('A question for later')
  await page.keyboard.press('Control+Enter')
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 5000 }).catch(() => problems.push('ask: ⌘↵ with no AI did not open Settings'))
  if (await page.inputValue('#home-line') !== 'A question for later') problems.push('ask: setting up the AI lost the question')

  // Offline from the line: the desk and its rooms stay, a thought is an ordinary sticky on
  // the desk, rooms that need the internet say they wait, and the switch comes back online.
  room = 'offline'
  const roomsOpen = await page.locator('.popout').count()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('offline')
  for (let step = 0; step < 8 && await picked() !== 'Offline'; step += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('.home-offline-note').waitFor({ timeout: 3000 }).catch(() => problems.push('offline: "Offline" in the line did not turn it on'))
  if (await page.locator('.popout').count() !== roomsOpen) problems.push('offline: the rooms on the desk went away')
  await page.fill('#home-line', 'Written offline')
  await page.keyboard.press('Enter')
  await page.locator('.desk-sticky', { hasText: 'Written offline' }).waitFor({ timeout: 5000 }).catch(() => problems.push('offline: a thought saved offline did not land on the desk'))
  await page.keyboard.press('Control+k')
  await page.keyboard.type('browser')
  for (let step = 0; step < 8 && await picked() !== 'Browser'; step += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.getByText(/waits until you’re back online/).waitFor({ timeout: 3000 }).catch(() => problems.push('offline: the browser did not say it waits'))
  if (await page.getByRole('dialog', { name: 'Browser' }).count()) problems.push('offline: the browser opened')
  await page.screenshot({ path: `${OUT}/offline.png` })
  await page.locator('.home-offline').click()
  await page.locator('.home-offline-note').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('offline: the switch did not come back online'))

  // The quick chat's window, as the browser preview can show it (no AI here).
  room = 'quick chat'
  // Sort a pile: stickies tossed down around the quick input (a pasted list makes many), one
  // dropped on another starts a branch, Help me sort suggests more, and Send to the Sky
  // makes one node with its branches inside.
  room = 'pile'
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await page.locator('.app-dock [data-space="tools"]').click()
  await page.getByRole('menuitem', { name: 'Sort a pile' }).click()
  await page.locator('.pile-room').waitFor({ timeout: 5000 }).catch(() => problems.push('pile: Sort a pile did not open'))
  const pileInput = page.getByLabel('Write a sticky', { exact: true })
  for (const words of ['Florist for the wedding', 'Wedding cake tasting']) { await pileInput.fill(words); await pileInput.press('Enter') }
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/plain', '- Oil change for the car\n- Car insurance renewal\n- Call mom')
    document.querySelector('.pile-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await sleep(500)
  if (await page.locator('.pile-card').count() !== 5) problems.push(`pile: 5 stickies were tossed down, ${await page.locator('.pile-card').count()} are on the table`)
  const [one, two] = [await page.locator('.pile-card').nth(0).boundingBox(), await page.locator('.pile-card').nth(1).boundingBox()]
  await page.mouse.move(one.x + 30, one.y + 30)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(one.x + 30 + ((two.x - one.x) * step) / 10, one.y + 30 + ((two.y - one.y) * step) / 10)
  await page.mouse.up()
  await page.locator('.pile-group .name-field').waitFor({ timeout: 3000 }).catch(() => problems.push('pile: dropping a sticky on another did not start a branch'))
  await page.keyboard.type('Wedding')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Help me sort' }).click()
  await page.locator('.pile-suggestion', { hasText: 'Car' }).waitFor({ timeout: 8000 }).catch(() => problems.push('pile: Help me sort did not suggest a Car branch'))
  await page.screenshot({ path: `${OUT}/pile.png` })
  await page.locator('.pile-suggestion', { hasText: 'Car' }).getByRole('button', { name: 'Make the branch' }).click().catch(() => {})
  if (await page.locator('.pile-group').count() !== 2) problems.push(`pile: expected 2 branches, found ${await page.locator('.pile-group').count()}`)
  await page.getByRole('button', { name: 'Send to the Sky' }).click()
  await page.getByLabel('Name of the node').fill('Kitchen table')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('button', { name: 'See it in the Sky' }).click().catch(() => problems.push('pile: sending did not offer to show it in the Sky'))
  await page.locator('[data-node-head]', { hasText: 'Kitchen table' }).waitFor({ timeout: 5000 }).catch(() => problems.push('pile: the node was not in the Sky'))
  if (await page.locator('.pile-room').count()) problems.push('pile: the table stayed open over the Sky')

  const chat = await browser.newPage({ viewport: { width: 420, height: 600 } })
  chat.on('pageerror', (error) => problems.push(`quick chat: ${error.message}`))
  await chat.goto(`${url}?surface=chat`)
  await chat.locator('.quick-chat .composer textarea').waitFor({ timeout: 8000 })
    .catch(() => problems.push('quick chat: the chat did not appear'))
  await sleep(400)
  await chat.screenshot({ path: `${OUT}/quick-chat.png` })
  await chat.close()

  // The quick search (⌘⇧Space in the Mac app), with a stand-in for what the Mac app gives it: a bar; typing opens
  // the full view with a big preview; Return, ⌘K and Esc; the clipboard and a sum. Light, then dark.
  for (const scheme of ['light', 'dark']) {
    room = `quick search (${scheme})`
    const search = await browser.newPage({ viewport: { width: 1000, height: 580 }, colorScheme: scheme })
    search.on('pageerror', (error) => problems.push(`${room}: ${error.message}`))
    search.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`${room}: ${message.text()}`) })
    await search.addInitScript(installSearchBridge, DEFAULT_SETTINGS)
    await search.goto(`${url}?surface=search&fresh=1`)
    await search.locator('.quick-search[data-mode="bar"]').waitFor({ timeout: 8000 }).catch(() => problems.push(`${room}: the bar did not open`))
    if (await search.locator('.qs-body').count()) problems.push(`${room}: the bar showed results before anything was typed`)
    await search.fill('#qs-input', 'taxes')
    const taxes = search.locator('.qs-row', { hasText: 'Taxes 2025.pdf' })
    await taxes.waitFor({ timeout: 5000 }).catch(() => problems.push(`${room}: typing did not find the file`))
    if (!await search.locator('.quick-search[data-mode="full"]').count()) problems.push(`${room}: typing did not open the full view`)
    await search.locator('.qs-picture').waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: the preview did not show the file`))
    const facts = await search.locator('.qs-details').innerText().catch(() => '')
    if (!/Documents › Taxes/.test(facts) || !/PDF document/.test(facts) || !/1\.2 MB/.test(facts)) problems.push(`${room}: the details did not say where, what and how big (${facts})`)
    await sleep(300)
    await search.screenshot({ path: `${OUT}/${scheme}-QuickSearch.png` })
    // ⌘K lists the other actions (Ctrl stands in for ⌘ off the Mac); Esc closes just that.
    await search.keyboard.press('Control+k')
    const actions = search.locator('.qs-actions')
    await actions.waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: ⌘K did not list the actions`))
    for (const label of ['Open', 'Show in Finder', 'Copy path', 'Ask about it', 'Add to a node…', 'Pin', 'Delete']) {
      if (!(await actions.innerText().catch(() => '')).includes(label)) problems.push(`${room}: ⌘K did not list ${label}`)
    }
    if (scheme === 'light') await search.screenshot({ path: `${OUT}/QuickSearch-actions.png` })
    await search.keyboard.press('Escape')
    if (await actions.count()) problems.push(`${room}: Esc did not close the actions first`)
    // Return does the obvious thing: open the file.
    await search.keyboard.press('Enter')
    await sleep(200)
    if (!(await search.evaluate(() => window.__calls)).some(([name, root, relative]) => name === 'openFile' && root === 'documents' && relative === 'Taxes/Taxes 2025.pdf')) problems.push(`${room}: Return did not open the file`)
    // v is the clipboard: pins first, then the day; Return pastes (the stand-in says it needs Accessibility, so it says so).
    await search.fill('#qs-input', 'v')
    await search.locator('.qs-head', { hasText: 'Pinned' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "v" did not show the clipboard with its pins first`))
    if (!await search.locator('.qs-head', { hasText: 'Today' }).count()) problems.push(`${room}: the clipboard was not grouped by day`)
    await search.getByRole('tab', { name: 'Clipboard' }).click()
    await search.getByRole('button', { name: 'Images' }).click()
    await search.locator('.qs-row', { hasText: 'Image' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: the Images filter showed no picture`))
    await search.locator('.qs-picture').waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: the copied picture had no big preview`))
    await search.getByRole('button', { name: 'All', exact: true }).click()
    await search.locator('.qs-row', { hasText: 'Jordan asked for the revised quote' }).click()
    if (!/Mail/.test(await search.locator('.qs-details').innerText().catch(() => ''))) problems.push(`${room}: the details of a copy did not say which app it came from`)
    if (scheme === 'light') await search.screenshot({ path: `${OUT}/QuickSearch-clipboard.png` })
    await search.keyboard.press('Enter')
    await search.locator('.qs-foot [role="status"]', { hasText: 'Copied. Press ⌘V to paste' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: Return on a copy did not say to press ⌘V without Accessibility`))
    // A sum answers (on Everything); a room is found; Tab moves between the tabs; Esc backs out a step at a time, then away.
    await search.getByRole('tab', { name: 'Everything' }).click()
    await search.fill('#qs-input', '2*49')
    await search.locator('.qs-row', { hasText: '= 98' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a sum did not answer`))
    // A window layout: "left half" finds one with a picture of where the window will go; without Accessibility the panel
    // says what is waiting (the Mac app touches nothing); w is the Windows tab with every layout.
    await search.fill('#qs-input', 'left half')
    await search.locator('.qs-row', { hasText: 'Left half' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "left half" did not find a layout`))
    await search.locator('.qs-screen i').waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a layout had no picture of where the window goes`))
    await search.keyboard.press('Enter')
    await search.locator('.qs-foot [role="status"]', { hasText: 'allowed in Accessibility' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a layout did not say what is waiting without Accessibility`))
    if (!(await search.evaluate(() => window.__calls)).some(([name, layout]) => name === 'snap' && layout === 'left-half')) problems.push(`${room}: Return on a layout did not ask for it`)
    await search.fill('#qs-input', 'w')
    await search.locator('.qs-row', { hasText: 'Put it back' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: w did not list every layout`))
    if ((await search.locator('.qs-row').count()) !== 16) problems.push(`${room}: the Windows tab did not list all sixteen layouts`)
    if (scheme === 'light') await search.screenshot({ path: `${OUT}/QuickSearch-windows.png` })
    await search.getByRole('tab', { name: 'Everything' }).click()
    await search.fill('#qs-input', 'sky')
    await search.locator('.qs-row', { hasText: 'Sky' }).first().waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a room was not found`))
    await search.keyboard.press('Tab')
    if ((await search.locator('[role="tab"][aria-selected="true"]').innerText()) !== 'Files') problems.push(`${room}: Tab did not move to the next tab`)
    await search.keyboard.press('Escape')
    if ((await search.inputValue('#qs-input')) !== '') problems.push(`${room}: Esc did not clear the words first`)
    await search.keyboard.press('Escape')
    if (!await search.locator('.quick-search[data-mode="bar"]').count()) problems.push(`${room}: Esc did not go back to the bar`)
    await search.keyboard.press('Escape')
    await sleep(150)
    if (!(await search.evaluate(() => window.__calls)).some(([name]) => name === 'hide')) problems.push(`${room}: the last Esc did not put the bar away`)
    await search.close()
  }

  // The ring over other apps (Hyper R), in its own small window: eight tools, a number picks one, Esc goes.
  for (const scheme of ['light', 'dark']) {
    room = `ring window (${scheme})`
    const small = await browser.newPage({ viewport: { width: 340, height: 340 }, colorScheme: scheme })
    small.on('pageerror', (error) => problems.push(`${room}: ${error.message}`))
    await small.addInitScript(installSearchBridge, DEFAULT_SETTINGS)
    await small.goto(`${url}?surface=ring&fresh=1`)
    await small.locator('.ring-item').first().waitFor({ timeout: 8000 }).catch(() => problems.push(`${room}: the ring did not draw`))
    if ((await small.locator('.ring-item').count()) !== 8) problems.push(`${room}: the ring did not hold eight tools`)
    await sleep(600)
    await small.screenshot({ path: `${OUT}/${scheme}-Ring.png`, omitBackground: true })
    await small.keyboard.press('3')
    if (!(await small.evaluate(() => window.__calls)).some(([name, id]) => name === 'ringPick' && id === 'sticky')) problems.push(`${room}: a number did not pick its tool`)
    await small.close()
  }

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
  await phone.click('button[aria-label="Save the sticky"]')
  await sleep(2500)
  const sent = await phone.evaluate(() => Object.entries(window.__cloud).some(([key, text]) => /^Sync\/iphone-[a-z0-9]{8}\/00000001\.json$/.test(key) && text.includes('Thought on the phone')))
  if (!sent) problems.push('iphone: the sticky was not written to iCloud')
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
