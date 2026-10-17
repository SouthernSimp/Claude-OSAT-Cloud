// Opens the built web preview in Chromium, visits every room, and fails on any
// page error. Screenshots land in test-results/ui/ (light, then dark) so each
// pull request shows what changed. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { DEFAULT_SETTINGS } from '../../shared/launcher-model.mjs'
import { LAYOUTS } from '../../shared/window-layouts.mjs'
import { installSearchBridge } from './search-bridge.mjs'
import { createRequire } from 'node:module'
import { openRoom as openPlace } from './window.mjs'
const { TIERS, fits, pickTier, recommendFor } = createRequire(import.meta.url)('../../desktop/ai/catalog.cjs')

const OUT = process.env.OSAT_SHOTS || 'test-results/ui'
const PORT = Number(process.env.OSAT_PORT || 4317)
// The places ⌘1–6 open (Just in is the boards' room), then the rest from the sidebar.
const SPACES = [[1, 'Today'], [2, 'Mindmap'], [3, 'Calendar'], [4, 'Todo'], [5, 'Notes'], [6, 'Files']]
const TOOLS = [['Meetings', 'Meetings'], ['Mail', 'Mail'], ['Journal', 'Journal'], ['Habits', 'Habits'], ['Goals', 'Goals'], ['Budget', 'Money'], ['Browser', 'Web'], ['Terminal', 'Terminal'], ['Roadmap', 'Roadmap'], ['Settings', 'Settings']]


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

  // The first-run tour comes by itself, once: the arrow keys and Back / Next walk it, Done ends it, and it stays away.
  room = 'tour'
  await page.locator('.tour').waitFor({ timeout: 6000 }).catch(() => problems.push('tour: the first-run tour did not appear'))
  if (await page.locator('.tour').count()) {
    const heading = () => page.locator('#tour-title').textContent()
    await page.screenshot({ path: `${OUT}/tour.png` })
    if (!/write it down/i.test(await heading())) problems.push('tour: it did not start with the bar')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await sleep(500)
    if (!/boards/i.test(await heading())) problems.push('tour: the arrow keys did not walk it to the boards')
    await page.screenshot({ path: `${OUT}/tour-boards.png` })
    await page.getByRole('button', { name: 'Back' }).click()
    await page.locator('.tour').getByRole('button', { name: 'Next', exact: true }).click()
    await page.locator('.tour').getByRole('button', { name: 'Next', exact: true }).click()
    await page.locator('.tour').getByRole('button', { name: 'Next', exact: true }).click()
    if (!/any app/i.test(await heading())) problems.push('tour: it did not end on "from any app"')
    await page.getByRole('button', { name: 'Done' }).click()
    await page.locator('.tour').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('tour: Done did not end it'))
  }
  await page.goto(`${url}?fresh=1`)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await sleep(2600)
  if (await page.locator('.tour').count()) problems.push('tour: it came back after it was finished')
  // ⌘K brings it back, and Esc skips it.
  await page.keyboard.press('Control+k')
  await page.keyboard.type('take the tour')
  for (let step = 0; step < 6 && await picked() !== 'Take the tour'; step += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('.tour').waitFor({ timeout: 3000 }).catch(() => problems.push('tour: "Take the tour" in ⌘K did not start it'))
  await page.keyboard.press('Escape')
  await page.locator('.tour').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('tour: Esc did not skip it'))
  await page.fill('#home-line', '')

  // A thought typed in the bar is saved, survives a reload, and waits in Just in. Typing folds the drawer open, and
  // Save is the picked row, so Return saves.
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
  await page.locator('.today-card[aria-label="Waiting in Just in"]', { hasText: 'Smoke test thought' }).waitFor({ timeout: 5000 })
    .catch(() => problems.push('capture: Today did not show the thought waiting in Just in after a reload'))
  await page.keyboard.press('Control+5')
  await page.locator('.organizer-row', { hasText: 'Just in' }).first().click()
  await page.locator('.note-row', { hasText: 'Smoke test thought' }).first().waitFor({ timeout: 5000 })
    .catch(() => problems.push('capture: a thought typed in the bar was not in Just in after a reload'))

  // Every place opens from the sidebar into the window, beside it; ⌘1–6 open the first six.
  async function visit(view, label, theme) {
    room = view
    await openPlace(page, label)
    const body = page.locator(`.app-room[data-view="${view}"]`)
    await body.waitFor({ timeout: 5000 }).catch(() => problems.push(`${view}: the room did not open`))
    await sleep(900)
    if (!await body.evaluate((node) => node.children.length > 0).catch(() => false)) problems.push(`${view}: rendered nothing`)
    await page.screenshot({ path: `${OUT}/${theme}-${view}.png` })
  }

  for (const theme of ['light', 'dark']) {
    for (const [key, view] of SPACES) {
      room = view
      await page.keyboard.press(`Control+${key}`)
      await page.locator(`.app-room[data-view="${view}"]`).waitFor({ timeout: 5000 }).catch(() => problems.push(`${view}: ⌃${key} did not open it (${theme})`))
      await sleep(700)
      await page.screenshot({ path: `${OUT}/${theme}-${view === 'Mindmap' ? 'JustIn' : view}.png` })
    }
    // The boards, in the sidebar: the first time they offer starter boards, never add them by itself.
    // (tests/ui/boards.mjs checks a board itself.)
    room = 'boards'
    const boardsSide = page.locator('nav.side .side-group[aria-label="Boards"]')
    if (theme === 'light') {
      if (await boardsSide.locator('.side-dot').count()) problems.push('boards: the first visit silently added boards')
      await boardsSide.getByRole('button', { name: /^Add Personal, Home, Work/ }).click()
      await boardsSide.getByRole('button', { name: /^Work\b/ }).waitFor({ timeout: 3000 }).catch(() => problems.push('boards: the starter boards were not made'))
      // The board the rest of this test files things into.
      await page.locator('nav.side').getByRole('button', { name: 'New board', exact: true }).click()
      await page.getByRole('textbox', { name: 'New board’s name' }).fill('Project Direction')
      await page.getByRole('textbox', { name: 'New board’s name' }).press('Enter')
    }
    await boardsSide.getByRole('button', { name: /^Project Direction/ }).click().catch(() => problems.push(`boards: Project Direction was not there to open (${theme})`))
    await page.locator('.map-column').first().waitFor({ timeout: 3000 }).catch(() => problems.push(`boards: a board showed no Map (${theme})`))
    await sleep(500)
    await page.screenshot({ path: `${OUT}/${theme}-Canvas.png` })
    for (const [view, label] of TOOLS) await visit(view, label, theme)
    room = 'today'
    await page.keyboard.press('Control+1')
    await sleep(400)
    await page.screenshot({ path: `${OUT}/${theme}-Desk.png` })
    room = 'drawer'
    await page.keyboard.press('Control+k')
    await page.keyboard.type('Smoke')
    await page.getByRole('listbox').waitFor({ timeout: 3000 }).catch(() => problems.push('drawer: typing did not open it'))
    await sleep(400)
    await page.screenshot({ path: `${OUT}/${theme}-Drawer.png` })
    await page.fill('#home-line', '')
    // Offline (the look only in the preview): the switch at the foot of the sidebar, and back.
    room = 'offline'
    await page.locator('.side-net').click()
    await page.locator('.side-net[aria-pressed="true"]').waitFor({ timeout: 3000 }).catch(() => problems.push(`offline: the switch did not say so (${theme})`))
    await page.screenshot({ path: `${OUT}/${theme}-Offline.png` })
    await page.locator('.side-net').click()
    await page.locator('.side-net[aria-pressed="false"]').waitFor({ timeout: 3000 }).catch(() => problems.push(`offline: the switch did not turn off (${theme})`))
    if (theme === 'light') {
      // Appearance is a page of Settings: Light, Dark or the Mac's own.
      await openPlace(page, 'Settings')
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance', exact: true }).click()
      await page.getByRole('radio', { name: 'Dark' }).click()
      await openPlace(page, 'Today')
      await sleep(300)
    }
  }
  // Settings (Phase 13b): a sidebar with a search box and a page for each thing. Quick search: the places, how it opens.
  // Shortcuts: every word and key in one table. Clipboard: limits, Pause, Clear (with Undo). Quick links: add, take off, Undo.
  room = 'settings'
  const calls = () => page.evaluate(() => window.__calls)
  await page.keyboard.press('Control+,')
  const rail = page.getByRole('navigation', { name: 'Settings sections' })
  const goTo = async (name) => { await rail.getByRole('button', { name, exact: true }).click(); await sleep(350) }
  await rail.getByRole('button', { name: 'Quick bar', exact: true }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: the sidebar had no Quick bar page'))
  await goTo('Quick bar')
  const names = (await page.locator('.setting-group', { hasText: 'Where it looks' }).locator('.setting-text b').allInnerTexts().catch(() => [])).join(', ')
  if (names !== 'Files, Clipboard, Apps, Notes and boards, Calculator, Window layouts') problems.push(`settings: the places were ${names}`)
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
  await page.getByRole('button', { name: 'Key for Notes and boards' }).click()
  await page.keyboard.press('Control+Alt+Shift+Meta+F')
  await page.getByText('Hyper F is Files’s key already.').waitFor({ timeout: 3000 }).catch(() => problems.push('settings: a key two things wanted was not refused, naming who has it'))
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
  for (const said of ['Make Caps Lock a Hyper key', 'Use ⌘Space for the quick bar', 'Another app makes my Hyper key']) {
    if (!await page.getByText(said, { exact: false }).count()) problems.push(`settings: missing "${said}"`)
  }
  await page.getByLabel('What the Hyper key sends').selectOption('three')
  if ((await page.evaluate(() => window.osatSearch.settings())).hyper.sends !== 'three') problems.push('settings: what the Hyper key sends was not saved')
  await page.getByLabel('What the Hyper key sends').selectOption('four')
  // OSAT's own Hyper key (Phase 63): a real switch, off until turned on; on, it says what it needs and the other app's choice steps aside.
  const hyperSwitch = page.getByRole('switch', { name: 'Make Caps Lock a Hyper key' })
  if (await hyperSwitch.isChecked()) problems.push('settings: the built-in Hyper key was on before it was turned on')
  await hyperSwitch.check()
  if ((await page.evaluate(() => window.osatSearch.settings())).hyper.own !== true) problems.push('settings: the built-in Hyper key switch did not save')
  await page.getByText('Needs Accessibility', { exact: false }).first().waitFor({ timeout: 3000 }).catch(() => problems.push('settings: the built-in Hyper key did not say it needs Accessibility'))
  await page.getByRole('switch', { name: 'A tap of Caps Lock is Esc' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: the Caps Lock tap switch was missing'))
  if (await page.getByLabel('What the Hyper key sends').count()) problems.push('settings: the other app’s Hyper choice stayed while OSAT’s own was on')
  await page.screenshot({ path: `${OUT}/settings-keyboard-hyper.png` })
  await hyperSwitch.uncheck()
  await page.getByLabel('What the Hyper key sends').waitFor({ timeout: 3000 }).catch(() => problems.push('settings: turning the built-in Hyper key off did not bring back the other app’s choice'))
  await goTo('Window layouts')
  await page.getByRole('switch', { name: 'Use keys to move the window I’m in, from any app' }).check()
  await page.getByRole('button', { name: 'Key for Left half' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: turning window keys on did not list the layouts'))
  await page.screenshot({ path: `${OUT}/settings-window-layouts.png` })
  // Phase 61: an alias, a command of his own (with Undo on Delete), a command turned off, and the same list in Shortcuts.
  const waitSetting = (check, said) => page.waitForFunction(check, null, { timeout: 3000 }).catch(() => problems.push(said))
  await page.getByLabel('Word for Left half').fill('lh')
  await page.getByLabel('Word for Left half').blur()
  await waitSetting(() => window.osatSearch.settings().then((value) => value.windows.aliases['left-half'] === 'lh'), 'window layouts: an alias was not saved')
  await page.getByRole('button', { name: 'Create command' }).click()
  await page.getByLabel('Name of the command').fill('Bottom Right Ninth')
  await page.getByLabel('From the left %, percent of the screen').fill('66.7')
  await page.getByLabel('From the top %, percent of the screen').fill('66.7')
  await page.getByLabel('Width %, percent of the screen').fill('33.3')
  await page.getByLabel('Height %, percent of the screen').fill('33.3')
  await page.screenshot({ path: `${OUT}/settings-window-create.png` })
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('button', { name: 'Key for Bottom Right Ninth' }).waitFor({ timeout: 3000 }).catch(() => problems.push('window layouts: a command he made did not appear with a key'))
  await waitSetting(() => window.osatSearch.settings().then((value) => value.windows.custom.length === 1 && value.windows.custom[0].rect.w === 33.3), 'window layouts: the new command was not saved')
  await page.getByLabel('Word for Bottom Right Ninth', { exact: true }).fill('br')
  await page.getByLabel('Word for Bottom Right Ninth', { exact: true }).blur()
  await page.getByLabel('Word for Left half').fill('br')
  await page.getByLabel('Word for Left half').blur()
  await page.getByText('“br” is Bottom Right Ninth’s word already.').waitFor({ timeout: 3000 }).catch(() => problems.push('window layouts: a word two commands wanted was not refused, naming who has it'))
  await page.getByRole('button', { name: 'More for Bottom Right Ninth' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.locator('.undo-toasts .toast', { hasText: 'Deleted “Bottom Right Ninth”' }).getByRole('button', { name: 'Undo' }).click()
  await page.getByLabel('Word for Bottom Right Ninth', { exact: true }).waitFor({ timeout: 3000 }).catch(() => problems.push('window layouts: Undo did not bring the command back'))
  await waitSetting(() => window.osatSearch.settings().then((value) => value.windows.aliases[value.windows.custom[0]?.id] === 'br'), 'window layouts: Undo did not bring its word back')
  await page.getByRole('button', { name: 'More for Left half' }).click()
  await page.getByRole('button', { name: 'Turn off', exact: true }).click()
  await waitSetting(() => window.osatSearch.settings().then((value) => value.windows.off.includes('left-half')), 'window layouts: Turn off was not saved')
  await page.getByRole('button', { name: 'More for Left half' }).click()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await waitSetting(() => window.osatSearch.settings().then((value) => !value.windows.off.includes('left-half') && !value.windows.aliases['left-half']), 'window layouts: Reset did not put the command back as it came')
  await goTo('Shortcuts')
  await page.getByLabel('Words and keys').getByRole('button', { name: 'Window layouts', exact: true }).click()
  await page.getByLabel('Word for Bottom Right Ninth', { exact: true }).waitFor({ timeout: 3000 }).catch(() => problems.push('shortcuts: his own window command was not in the table'))
  await page.getByLabel('Words and keys').getByRole('button', { name: 'Window layouts', exact: true }).click()
  await goTo('Window layouts')
  await goTo('The ring')
  // The ring opens with Hyper + middle click over any app; its switch is on, saves, and the key is still there as the backup.
  const middleSwitch = page.getByRole('switch', { name: 'Open the ring with Hyper and a middle click' })
  if (!await middleSwitch.isChecked()) problems.push('settings: the ring’s Hyper + middle click was not on')
  if (!await page.getByText('Hyper + middle click', { exact: true }).count()) problems.push('settings: the ring did not say Hyper + middle click')
  await middleSwitch.uncheck()
  await page.waitForFunction(() => window.osatSearch.settings().then((value) => value.ring.middle === false), null, { timeout: 3000 }).catch(() => problems.push('settings: turning the middle click off was not saved'))
  await middleSwitch.check()
  await page.waitForFunction(() => window.osatSearch.settings().then((value) => value.ring.middle === true), null, { timeout: 3000 }).catch(() => problems.push('settings: turning the middle click on was not saved'))
  if (!await page.getByRole('button', { name: 'Key for The ring' }).count()) problems.push('settings: the ring’s key is gone')
  await page.getByRole('button', { name: 'Move Clipboard earlier' }).click()
  await page.waitForFunction(() => window.osatSearch.settings().then((value) => value.ring.items?.[0] === 'clipboard'), null, { timeout: 3000 }).catch(() => problems.push('settings: the ring’s order was not changed'))
  // With a place free, the ring can take a screenshot tool (CleanShot X is on the stand-in Mac).
  await page.getByRole('button', { name: 'Take Maximize off the ring' }).click()
  await page.getByLabel('Add a tool to the ring').locator('option', { hasText: 'Record screen' }).waitFor({ state: 'attached', timeout: 3000 }).catch(() => problems.push('settings: the ring could not take Record screen'))
  await page.getByRole('button', { name: 'Reset the ring' }).click()
  await page.screenshot({ path: `${OUT}/settings-ring.png` })
  // Soul and memory (Phase 70): SOUL.md to read and change, a line remembered and forgotten with Undo, the rules.
  await goTo('Soul and memory')
  if (!(await page.getByLabel('SOUL.md').inputValue().catch(() => '')).startsWith('I am OSAT.')) problems.push('soul: SOUL.md did not start as OSAT’s own')
  await page.getByLabel('Something to remember').fill('Food goes to Groceries')
  await page.getByRole('button', { name: 'Remember', exact: true }).click()
  const forget = page.getByRole('button', { name: 'Forget Food goes to Groceries' })
  await forget.waitFor({ timeout: 3000 }).catch(() => problems.push('soul: a remembered line did not show'))
  await forget.click()
  await page.locator('.undo-toasts .toast', { hasText: 'Forgot “Food goes to Groceries”' }).getByRole('button', { name: 'Undo' }).click().catch(() => problems.push('soul: Forget did not offer Undo'))
  await forget.waitFor({ timeout: 3000 }).catch(() => problems.push('soul: Undo did not bring the line back'))
  const filing = page.getByRole('radiogroup', { name: 'File new stickies' })
  await filing.getByRole('radio', { name: 'Ask me' }).click()
  if (await filing.getByRole('radio', { name: 'Ask me' }).getAttribute('aria-checked') !== 'true') problems.push('soul: File new stickies did not change to Ask me')
  await filing.getByRole('radio', { name: 'On its own' }).click()
  await page.screenshot({ path: `${OUT}/settings-soul.png` })
  // Screenshots: CleanShot X is on the stand-in Mac; recent captures are off until turned on; each capture can have a key.
  await goTo('Screenshots')
  await page.getByRole('radio', { name: 'CleanShot X' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: Screenshots did not offer CleanShot X'))
  if (await page.getByRole('radio', { name: 'CleanShot X' }).getAttribute('aria-checked').catch(() => null) !== 'true') problems.push('settings: CleanShot X was not the tool while it is installed')
  // CleanShot is never forced: the Mac's own can take them instead, and Recent captures (CleanShot's) step aside.
  await page.getByRole('radio', { name: 'The Mac’s own' }).click()
  await page.getByText('Save to', { exact: true }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: picking the Mac’s own did not offer where to save'))
  if ((await page.evaluate(() => window.osatSearch.settings())).captures?.using !== 'mac') problems.push('settings: the Mac’s own screenshots were not saved as the choice')
  await page.getByRole('radio', { name: 'CleanShot X' }).click()
  await page.getByText('Recent captures in the quick bar', { exact: true }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: going back to CleanShot X did not bring Recent captures back'))
  const recentSwitch = page.getByRole('switch', { name: 'Show recent captures in the quick search' })
  await recentSwitch.check()
  await sleep(400)
  if (!await recentSwitch.isChecked()) problems.push('settings: the recent captures switch went back off')
  if (!(await page.evaluate(() => window.osatSearch.settings())).captures?.recent) problems.push('settings: recent captures were not turned on')
  if (!await page.getByRole('button', { name: 'Key for Record screen' }).count()) problems.push('settings: Record screen had no key to set')
  await page.screenshot({ path: `${OUT}/settings-screenshots.png` })
  // Every other page opens without a fault, and the search finds a row by its words on any page.
  // Snippets: add one; its word shows; the switch for any app waits for Accessibility and says so.
  await goTo('Snippets')
  await page.getByRole('textbox', { name: 'Name of the snippet' }).fill('Home address')
  await page.getByRole('textbox', { name: 'Word for the snippet' }).fill(';addr')
  await page.getByRole('textbox', { name: 'Text of the snippet' }).fill('12 Oak Lane\nSpringfield')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('textbox', { name: 'Word for Home address' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: a snippet was not added'))
  await page.getByRole('switch', { name: 'Turn words into text in any app' }).check()
  await page.locator('.setting-row', { hasText: 'Waiting for Accessibility' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: typed snippets did not say they wait for Accessibility'))
  await page.screenshot({ path: `${OUT}/settings-snippets.png` })
  await page.getByRole('switch', { name: 'Turn words into text in any app' }).uncheck()
  // Mouse (Phase 64): the first switch reverses the wheel, per axis; nothing runs until Accessibility is there, and it says so.
  await goTo('Mouse')
  const reverseSwitch = page.getByRole('switch', { name: 'Reverse mouse wheel scrolling' })
  if (await reverseSwitch.isChecked()) problems.push('settings: the mouse wheel was reversed before anyone asked')
  await reverseSwitch.check()
  await page.waitForFunction(() => window.osatSearch.settings().then((value) => value.mouse.on && value.mouse.reverse.mouse.vertical && value.mouse.reverse.mouse.horizontal && !value.mouse.reverse.trackpad.vertical), null, { timeout: 3000 }).catch(() => problems.push('settings: reversing the wheel was not saved (mouse only)'))
  await page.getByRole('radio', { name: 'Up and down', exact: true }).click()
  await page.waitForFunction(() => window.osatSearch.settings().then((value) => value.mouse.reverse.mouse.vertical && !value.mouse.reverse.mouse.horizontal), null, { timeout: 3000 }).catch(() => problems.push('settings: choosing one direction was not saved'))
  await page.getByLabel('Mouse wheel speed').fill('2')
  await page.getByLabel('Mouse wheel speed').dispatchEvent('pointerup')
  await page.waitForFunction(() => window.osatSearch.settings().then((value) => value.mouse.speed === 2), null, { timeout: 3000 }).catch(() => problems.push('settings: the wheel speed was not saved'))
  await page.getByLabel('Side button 1').selectOption('back')
  await page.waitForFunction(() => window.osatSearch.settings().then((value) => value.mouse.buttons[3] === 'back'), null, { timeout: 3000 }).catch(() => problems.push('settings: a side button was not saved'))
  await page.locator('.setting-row', { hasText: 'Waiting for Accessibility' }).waitFor({ timeout: 3000 }).catch(() => problems.push('settings: Mouse did not say it waits for Accessibility'))
  if (!await page.getByRole('button', { name: 'Allow…' }).count()) problems.push('settings: Mouse offered no way to allow Accessibility')
  await page.screenshot({ path: `${OUT}/settings-mouse.png` })
  await page.getByRole('switch', { name: 'Use these mouse changes' }).uncheck()
  await page.waitForFunction(() => window.osatSearch.settings().then((value) => value.mouse.on === false && value.mouse.speed === 2), null, { timeout: 3000 }).catch(() => problems.push('settings: switching Mouse off lost its settings'))
  for (const name of ['General', 'Appearance', 'AI', 'Soul and memory', 'Connections', 'Data', 'Scans', 'iPhone', 'About']) {
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
  await openPlace(page, 'Today')
  // The bar hears the new word at once.
  await page.fill('#home-line', 'cb')
  await page.locator('.home-row', { hasText: 'jordan@acme.com' }).waitFor({ timeout: 3000 }).catch(() => problems.push('launcher settings: the line did not use the new word for the clipboard'))
  await page.fill('#home-line', '')
  await page.evaluate(() => window.osatSearch.saveSettings({ sources: { clipboard: { keyword: 'v', on: true } }, view: 'bar' }))

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

  // A thought from the bar waits in Just in; carried onto a board in the sidebar, it's filed there.
  room = 'stickies'
  await page.fill('#home-line', 'Left in the bar')
  await page.press('#home-line', 'Enter')
  await openPlace(page, 'Just in')
  const leftRow = page.locator('.justin-row', { hasText: 'Left in the bar' })
  await leftRow.waitFor({ timeout: 3000 }).catch(() => problems.push('stickies: a thought from the bar did not wait in Just in'))
  const boardRow = page.locator('nav.side .side-group[aria-label="Boards"]').getByRole('button', { name: /^Project Direction/ })
  const from = await leftRow.boundingBox()
  const to = await boardRow.boundingBox()
  await page.mouse.move(from.x + 60, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 68, from.y + from.height / 2 + 8, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await sleep(150)
  await page.mouse.up()
  await sleep(300)
  await boardRow.click()
  await page.locator('.boards-card', { hasText: 'Left in the bar' }).waitFor({ timeout: 3000 }).catch(() => problems.push('stickies: the sticky dropped on a board was not on it'))
  await page.screenshot({ path: `${OUT}/desk-stickies.png` })

  // An @ only links: a typo makes no board.
  room = 'mentions'
  await page.fill('#home-line', 'Call about @Project Direction and @Projct')
  await page.press('#home-line', 'Enter')
  await sleep(300)
  if (await page.locator('nav.side .side-group[aria-label="Boards"]').getByRole('button', { name: /^Projct/ }).count()) problems.push('mentions: a typo made a board')

  // The Roadmap's Timeline: every phase of the Status table, in order, read from the same text the Roadmap shows;
  // picking one opens its part of the Roadmap.
  room = 'timeline'
  const statusRows = (await readFile('docs/ROADMAP.md', 'utf8')).split('## Status')[1].split('\n## ')[0].split('\n').filter((line) => /^\|\s*[^|\s-][^|]*\|/.test(line) && !/^\|\s*Phase\s*\|/.test(line)).length
  await openPlace(page, 'Roadmap')
  const roadmapRoom = page.locator('.app-room[data-view="Roadmap"]')
  await roadmapRoom.getByRole('tab', { name: 'Timeline' }).click().catch(() => problems.push('timeline: the Roadmap room has no Timeline'))
  await page.locator('.timeline-list li').first().waitFor({ timeout: 3000 }).catch(() => problems.push('timeline: nothing on the Timeline'))
  if (await page.locator('.timeline-list li').count() !== statusRows) problems.push(`timeline: ${await page.locator('.timeline-list li').count()} phases shown, the Status table has ${statusRows}`)
  if (!await page.locator('.timeline-list li[data-state="planned"]').count()) problems.push('timeline: no planned phases shown')
  await sleep(400)
  await page.screenshot({ path: `${OUT}/timeline.png` })
  await page.locator('.timeline-list button', { hasText: 'Phase 12b' }).click()
  await roadmapRoom.getByRole('heading', { name: /Phase 12b/ }).waitFor({ timeout: 3000 }).catch(() => problems.push('timeline: picking a phase did not open its part of the Roadmap'))
  if (!await roadmapRoom.getByRole('heading', { name: /Phase 12b/ }).isVisible()) problems.push('timeline: the phase’s part of the Roadmap was not in view')
  // Reflection's one home: a tab of the Journal.
  room = 'journal'
  await openPlace(page, 'Journal')
  await page.getByRole('button', { name: 'Evening', exact: true }).click().catch(() => problems.push('journal: no Evening tab'))
  await page.locator('.app-room[data-view="Journal"] .journal-form').waitFor({ timeout: 3000 }).catch(() => problems.push('journal: the Reflection tab showed nothing'))

  // ⌘K lands in the bar from any room; ↓ walks past Save, Ask and Add as a to-do to the match, ↵ opens it in Notes.
  room = 'find'
  await page.keyboard.press('Control+k')
  if (!await page.evaluate(() => document.activeElement?.id === 'home-line')) problems.push('find: ⌘K in a room did not focus the bar')
  await page.keyboard.type('Smoke test')
  for (let step = 0; step < 8 && await picked() !== 'Smoke test thought'; step += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('.app-room[data-view="Notes"]').waitFor({ timeout: 5000 }).catch(() => problems.push('find: a note found from the bar did not open in Notes'))
  if (await page.inputValue('#home-line')) problems.push('find: the search stayed in the bar after opening what it found')
  await sleep(400)
  await page.screenshot({ path: `${OUT}/pop-outs.png` })
  // An empty bar jumps: ↓ then ↵ opens the latest note.
  await page.keyboard.press('Control+k')
  await page.keyboard.press('ArrowDown')
  const latest = await picked()
  await page.keyboard.press('Enter')
  if (!latest) problems.push('find: ↓ on an empty bar did not show Jump to')
  // Esc, one step at a time: the picked row goes back to Save, the drawer closes and keeps the words, and the room stays.
  room = 'esc'
  await page.keyboard.press('Control+k')
  await page.keyboard.type('One step at a time')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  if (await picked() !== 'Save as a sticky') problems.push(`esc: the first Esc did not go back to Save (${await picked()})`)
  await page.keyboard.press('Escape')
  if (await page.locator('#home-drawer').count()) problems.push('esc: the second Esc did not close the drawer')
  if (await page.inputValue('#home-line') !== 'One step at a time') problems.push(`esc: closing the drawer lost the words (${JSON.stringify(await page.inputValue('#home-line'))})`)
  await page.keyboard.press('Escape')
  if (!await page.locator('.app-room').count()) problems.push('esc: the room went away')
  await page.fill('#home-line', '')
  // ⌘↵ asks in the panel on the right, with the question.
  room = 'ask'
  await page.keyboard.press('Control+k')
  await page.keyboard.type('A question for the panel')
  await page.keyboard.press('Control+Enter')
  await page.locator('.ask-panel').waitFor({ timeout: 5000 }).catch(() => problems.push('ask: ⌘↵ did not open Ask beside the room'))
  await page.keyboard.press('Escape')
  await page.locator('.ask-panel').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('ask: Esc did not close the Ask panel'))

  // Offline from ⌘K: the window and its room stay, a thought is an ordinary sticky, rooms that need the internet say
  // they wait, and the switch comes back online.
  room = 'offline'
  await page.keyboard.press('Control+k')
  await page.keyboard.type('offline')
  for (let step = 0; step < 8 && await picked() !== 'Offline'; step += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('.side-net[aria-pressed="true"]').waitFor({ timeout: 3000 }).catch(() => problems.push('offline: "Offline" in ⌘K did not turn it on'))
  if (!await page.locator('.app-room').count()) problems.push('offline: the room went away')
  await page.fill('#home-line', 'Written offline')
  await page.keyboard.press('Enter')
  await openPlace(page, 'Just in')
  await page.locator('.justin-row', { hasText: 'Written offline' }).waitFor({ timeout: 5000 }).catch(() => problems.push('offline: a thought saved offline did not wait in Just in'))
  await openPlace(page, 'Web')
  await page.getByText(/waits until you’re back online/).waitFor({ timeout: 3000 }).catch(() => problems.push('offline: the browser did not say it waits'))
  if (await page.locator('.app-room[data-view="Browser"]').count()) problems.push('offline: the browser opened')
  await page.screenshot({ path: `${OUT}/offline.png` })
  await page.locator('.side-net').click()
  await page.locator('.side-net[aria-pressed="false"]').waitFor({ timeout: 3000 }).catch(() => problems.push('offline: the switch did not come back online'))

  // Sort a pile (found by name in ⌘K): stickies tossed down around the quick input (a pasted list makes many), one
  // dropped on another starts a branch, Help me sort suggests more, and Send to a board makes one board with its
  // branches inside.
  room = 'pile'
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await page.keyboard.press('Control+k')
  await page.keyboard.type('sort a pile')
  for (let step = 0; step < 8 && await picked() !== 'Sort a pile'; step += 1) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
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
  await page.getByRole('button', { name: 'Send to a board' }).click()
  await page.getByLabel('Name of the board').fill('Kitchen table')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('button', { name: 'Open the board' }).click().catch(() => problems.push('pile: sending did not offer to open the board'))
  await page.locator('.boards-title h1', { hasText: 'Kitchen table' }).waitFor({ timeout: 5000 }).catch(() => problems.push('pile: the board did not open'))
  if (await page.locator('.pile-room').count()) problems.push('pile: the table stayed open beside the board')

  // One bar (Phase 13c): Ask, a sticky and commands in the quick bar, with a stand-in for the Mac app (no AI here).
  room = 'quick bar'
  const bar = await browser.newPage({ viewport: { width: 1000, height: 620 } })
  bar.on('pageerror', (error) => problems.push(`${room}: ${error.message}`))
  await bar.addInitScript(installSearchBridge, DEFAULT_SETTINGS)
  await bar.goto(`${url}?surface=search&fresh=1`)
  await bar.locator('.quick-search[data-mode="bar"]').waitFor({ timeout: 8000 }).catch(() => problems.push(`${room}: the bar did not open`))
  // ↓ on the small bar opens the list: the latest copies first, then files.
  await bar.locator('#qs-input').press('ArrowDown')
  await bar.locator('.quick-search[data-mode="full"]').waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: ↓ did not open the list`))
  await bar.locator('.qs-head').first().waitFor({ timeout: 3000 }).catch(() => {})
  if ((await bar.locator('.qs-head').first().innerText().catch(() => '')).toLowerCase() !== 'clipboard') problems.push(`${room}: the list did not start with what was copied`)
  await bar.screenshot({ path: `${OUT}/QuickBar-start.png` })
  await bar.evaluate(() => window.__shown({}))
  // Words typed: Ask AI is the first row and Save as a sticky the last; the one-line hint names the keys.
  await bar.fill('#qs-input', 'pack the tent')
  await bar.locator('.qs-row', { hasText: 'Save as a sticky' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: typed words did not offer Save as a sticky`))
  if (!/^Ask AI “pack the tent”/.test(await bar.locator('.qs-row').first().innerText().catch(() => ''))) problems.push(`${room}: Ask AI was not the first row`)
  if ((await bar.locator('.qs-row[aria-selected="true"]').innerText().catch(() => '')).startsWith('Ask AI') === false) problems.push(`${room}: with nothing else found, the highlight did not start on Ask AI`)
  const hint = await bar.locator('.qs-keys').innerText().catch(() => '')
  if (!/⇥\s*Ask AI/.test(hint) || !/⌥↵\s*Save as a sticky/.test(hint)) problems.push(`${room}: the hint did not name ⇥ and ⌥↵ (${hint})`)
  if (await bar.locator('[role="tab"]').count()) problems.push(`${room}: the bar still has tabs`)
  await bar.screenshot({ path: `${OUT}/QuickBar-words.png` })
  // ⌥Return: straight to Unsorted.
  await bar.keyboard.press('Alt+Enter')
  await bar.locator('.qs-said', { hasText: 'Saved to Just in' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: ⌥Return did not save a sticky`))
  const kept = await bar.evaluate(async () => (await window.osat?.store?.load?.())?.doc?.notes?.map((note) => [note.title, note.source, note.unsorted]) ?? null)
  if (kept && !kept.some(([title, source, unsorted]) => title === 'pack the tent' && source === 'Quick bar' && unsorted)) problems.push(`${room}: the sticky was not in Unsorted (${JSON.stringify(kept)})`)
  // Commands by word: "sticky" starts one, "clipboard" opens the history.
  await bar.fill('#qs-input', 'sticky')
  await bar.locator('.qs-row', { hasText: 'Write a sticky' }).first().waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "sticky" did not find Write a sticky`))
  await bar.keyboard.press('Enter')
  await bar.locator('.quick-sticky-field').waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "sticky" did not start a sticky`))
  await bar.keyboard.press('Escape')
  if (await bar.locator('.quick-sticky-field').count()) problems.push(`${room}: Esc did not leave the sticky first`)
  await bar.fill('#qs-input', 'clipboard')
  await bar.locator('.qs-row', { hasText: 'Clipboard history' }).first().waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "clipboard" did not find the clipboard history`))
  await bar.keyboard.press('Enter')
  await bar.locator('.qs-chip.is-scope', { hasText: 'Clipboard' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "clipboard" did not open the clipboard history`))
  // A copied picture shows itself in its row, and a copy drags out into other apps.
  await bar.locator('.qs-row .qs-thumb').first().waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a copied picture had no thumbnail in its row`))
  if (await bar.locator('.qs-row[draggable="true"]').count() < 4) problems.push(`${room}: the copies could not be dragged out`)
  await bar.locator('.qs-row', { hasText: 'Image' }).dispatchEvent('dragstart')
  if (!(await bar.evaluate(() => window.__calls)).some(([name, id]) => name === 'dragClip' && id === 'c4')) problems.push(`${room}: dragging a picture did not hand it to the Mac's drag`)
  // The big preview drags out too.
  const dragsBefore = (await bar.evaluate(() => window.__calls)).filter(([name]) => name === 'dragClip').length
  await bar.locator('.qs-stage[draggable="true"]').dispatchEvent('dragstart').catch(() => problems.push(`${room}: the preview of a copy could not be dragged out`))
  if ((await bar.evaluate(() => window.__calls)).filter(([name]) => name === 'dragClip').length !== dragsBefore + 1) problems.push(`${room}: dragging the preview did not hand the copy to the Mac's drag`)
  await bar.screenshot({ path: `${OUT}/QuickBar-clipboard.png` })
  // ⌘Return: Ask, in the same window, with the question; Esc comes back to the bar, then away.
  await bar.locator('.qs-chip.is-scope').click()
  await bar.fill('#qs-input', 'What should I pack?')
  await bar.keyboard.press('Control+Enter')
  await bar.locator('.qs-chat .composer textarea').waitFor({ timeout: 5000 }).catch(() => problems.push(`${room}: ⌘Return did not open Ask`))
  if ((await bar.locator('.qs-chat .composer textarea').inputValue().catch(() => '')) !== 'What should I pack?') problems.push(`${room}: Ask did not have the question (no AI here, so it waits)`)
  if (await bar.locator('.quick-search').isVisible()) problems.push(`${room}: the search stayed under Ask`)
  await sleep(300)
  await bar.screenshot({ path: `${OUT}/QuickBar-ask.png` })
  await bar.locator('.qs-chat .composer textarea').press('Escape')
  await bar.locator('#qs-input').waitFor({ state: 'visible', timeout: 3000 }).catch(() => problems.push(`${room}: Esc did not come back from Ask to the bar`))
  // Raycast-style customizing, right in the bar (⌘K): a word, a key and a favorite for a command; the Mac's own commands.
  await bar.evaluate(() => window.__shown({}))
  await bar.fill('#qs-input', 'clipboard history')
  await bar.locator('.qs-row[aria-selected="true"]', { hasText: 'Clipboard history' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "clipboard history" did not pick the command`))
  await bar.keyboard.press('Control+k')
  await bar.locator('.qs-actions').getByRole('menuitem', { name: /Set a word/ }).click().catch(() => problems.push(`${room}: ⌘K had no Set a word…`))
  await bar.getByRole('textbox', { name: 'A word for Clipboard history' }).fill('cb')
  await bar.getByRole('textbox', { name: 'A word for Clipboard history' }).press('Enter')
  await bar.fill('#qs-input', 'cb')
  await bar.locator('.qs-head', { hasText: 'Your word “cb”' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: the word did not find what it was given to`))
  await bar.screenshot({ path: `${OUT}/QuickBar-your-word.png` })
  await bar.keyboard.press('Control+k')
  await bar.locator('.qs-actions').getByRole('menuitem', { name: /Set a key/ }).click()
  await bar.locator('.qs-editor', { hasText: 'Press the keys for' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: Set a key… did not ask for the keys`))
  await bar.screenshot({ path: `${OUT}/QuickBar-set-key.png` })
  await bar.keyboard.press('Control+Alt+B')
  await bar.locator('.qs-foot', { hasText: 'now does “Clipboard history”' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: giving a key did not say so`))
  if (!(await bar.evaluate(() => window.__calls)).some(([name, key, change]) => name === 'customize' && key === 'act:clipboard' && change.hotkey === 'Control+Alt+B')) problems.push(`${room}: the key pressed was not given to the command`)
  await bar.keyboard.press('Shift+Control+f')
  await bar.locator('.qs-foot', { hasText: 'is in your favorites' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: ⇧⌘F did not add a favorite`))
  await bar.evaluate(() => window.__shown({}))
  await bar.locator('.quick-search[data-mode="bar"]').waitFor({ timeout: 3000 })
  await bar.locator('#qs-input').press('ArrowDown')
  if ((await bar.locator('.qs-head').first().innerText().catch(() => '')).toLowerCase() !== 'favorites') problems.push(`${room}: a favorite was not first on the empty bar`)
  await bar.screenshot({ path: `${OUT}/QuickBar-favorites.png` })
  await bar.fill('#qs-input', 'lock')
  await bar.locator('.qs-row[data-kind="system"]', { hasText: 'Lock the screen' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "lock" did not offer Lock the screen`))
  await bar.fill('#qs-input', 'empty bin')
  await bar.locator('.qs-row[aria-selected="true"]', { hasText: 'Empty the Bin' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "empty bin" did not pick Empty the Bin`))
  await bar.keyboard.press('Enter')
  if ((await bar.evaluate(() => window.__calls)).some(([name]) => name === 'system')) problems.push(`${room}: Empty the Bin did not wait for a second Return`)
  await bar.locator('.qs-foot', { hasText: 'Press Return again' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: Empty the Bin did not say it can't be undone`))
  await bar.keyboard.press('Enter')
  await sleep(200)
  if (!(await bar.evaluate(() => window.__calls)).some(([name, id]) => name === 'system' && id === 'empty-bin')) problems.push(`${room}: the second Return did not empty the Bin`)
  await bar.evaluate(() => window.__shown({}))
  // Snippets: a copy saved as one from ⌘K, then its word finds it and Return pastes it.
  await bar.fill('#qs-input', 'v revised quote')
  await bar.locator('.qs-row[aria-selected="true"]', { hasText: 'Jordan asked' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: the copy was not picked`))
  await bar.keyboard.press('Control+k')
  await bar.locator('.qs-actions').getByRole('menuitem', { name: /Save as a snippet/ }).click().catch(() => problems.push(`${room}: a copy had no Save as a snippet…`))
  await bar.getByRole('textbox', { name: 'A word for the snippet' }).fill(';jq')
  await bar.getByRole('textbox', { name: 'A word for the snippet' }).press('Enter')
  await bar.locator('.qs-foot', { hasText: 'Saved as a snippet' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: saving a snippet did not say so`))
  await bar.evaluate(() => window.__shown({}))
  await bar.fill('#qs-input', ';jq')
  await bar.locator('.qs-row[data-kind="snippet"][aria-selected="true"]').waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a snippet's word did not find it`))
  await bar.screenshot({ path: `${OUT}/QuickBar-snippet.png` })
  await bar.keyboard.press('Enter')
  await sleep(200)
  if (!(await bar.evaluate(() => window.__calls)).some(([name, id]) => name === 'pasteSnippet' && id === 'snip-c1')) problems.push(`${room}: Return on a snippet did not paste it`)
  await bar.evaluate(() => window.__shown({}))
  // Pop out (from the desk's chat) opens it on Ask; ring "sticky" opens it to write a sticky.
  await bar.evaluate(() => window.__shown({ view: 'chat' }))
  await bar.locator('.qs-chat .composer textarea').waitFor({ state: 'visible', timeout: 3000 }).catch(() => problems.push(`${room}: the Ask key did not open Ask`))
  // Keys for this app: "keys" offers it; inside, every shortcut of the app behind the bar, and words find any menu item.
  await bar.evaluate(() => window.__shown({}))
  await bar.fill('#qs-input', 'keys')
  await bar.locator('.qs-row', { hasText: 'Keys for this app' }).first().click().catch(() => problems.push(`${room}: "keys" did not offer Keys for this app`))
  await bar.keyboard.press('Enter')
  await bar.locator('.qs-row[data-kind="menu"] .qs-menu-key', { hasText: '⇧⌘O' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: the app's shortcuts did not show`))
  if (await bar.locator('.qs-row[data-kind="menu"]', { hasText: 'Export' }).count()) problems.push(`${room}: a menu item without keys showed before anything was typed`)
  if (await bar.locator('.qs-keycaps kbd').count() !== 3) problems.push(`${room}: the picked menu item's keys were not drawn as three caps`)
  await sleep(400)
  await bar.screenshot({ path: `${OUT}/QuickBar-app-keys.png` })
  await bar.fill('#qs-input', 'model next')
  await bar.locator('.qs-row[data-kind="menu"][aria-selected="true"]', { hasText: 'Next Model' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: words did not find a menu item`))
  await bar.keyboard.press('Enter')
  await sleep(200)
  if (!(await bar.evaluate(() => window.__calls)).some(([name, path]) => name === 'pressMenu' && path?.join('/') === 'Edit/Next Model')) problems.push(`${room}: Return did not press the menu item`)
  await bar.evaluate(() => window.__shown({ view: 'sticky' }))
  // Hyper N's quick sticky: "- " starts a list, ⌘B bolds, Area adds a screenshot, ⌘Return saves it with all of that.
  const field = bar.locator('.quick-sticky-field')
  await field.waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: the ring's sticky did not open the bar to write one`))
  await field.click().catch(() => {})
  await bar.keyboard.type('Trip to Austin')
  await bar.keyboard.press('Enter')
  await bar.keyboard.type('- book the hotel')
  await bar.keyboard.press('Enter')
  await bar.keyboard.type('rent a car')
  if (await bar.locator('.quick-sticky-field ul li').count() !== 2) problems.push(`${room}: "- " did not start a bullet list`)
  await bar.getByRole('button', { name: 'Add a part of the screen' }).click().catch(() => problems.push(`${room}: the sticky had no Area button`))
  await bar.locator('.quick-sticky-pictures img').waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: the screenshot did not show on the sticky`))
  await bar.screenshot({ path: `${OUT}/QuickBar-sticky.png` })
  await bar.keyboard.press('Meta+Enter')
  await bar.locator('.qs-said, .qs-foot', { hasText: 'Saved to Just in' }).first().waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: ⌘Return did not save the sticky`))
  await bar.close()

  // The quick search (⌥⇧Space in the Mac app), with a stand-in for what the Mac app gives it: a bar; typing opens
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
    for (const label of ['Open', 'Show in Finder', 'Copy path', 'Ask about it', 'Add to a topic…', 'Pin', 'Delete']) {
      if (!(await actions.innerText().catch(() => '')).includes(label)) problems.push(`${room}: ⌘K did not list ${label}`)
    }
    if (scheme === 'light') await search.screenshot({ path: `${OUT}/QuickSearch-actions.png` })
    await search.keyboard.press('Escape')
    if (await actions.count()) problems.push(`${room}: Esc did not close the actions first`)
    // Return does the obvious thing: open the file.
    await search.keyboard.press('Enter')
    await sleep(200)
    if (!(await search.evaluate(() => window.__calls)).some(([name, root, relative]) => name === 'openFile' && root === 'documents' && relative === 'Taxes/Taxes 2025.pdf')) problems.push(`${room}: Return did not open the file`)
    // Screenshots and recording by plain words; Return starts one (CleanShot X on the stand-in Mac).
    await search.fill('#qs-input', 'record')
    await search.locator('.qs-row', { hasText: 'Record screen' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "record" did not offer Record screen`))
    await search.locator('.qs-row', { hasText: 'Record screen' }).click()
    await search.keyboard.press('Enter')
    await sleep(200)
    if (!(await search.evaluate(() => window.__calls)).some(([name, id]) => name === 'capture' && id === 'record')) problems.push(`${room}: Return did not start the recording`)
    // Recent captures (once turned on): "screenshots" lists CleanShot's newest, with a picture in the preview.
    await search.evaluate(() => window.osatSearch.saveSettings({ captures: { recent: true } }))
    await search.fill('#qs-input', 'screenshots')
    await search.locator('.qs-head', { hasText: 'Recent captures' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "screenshots" did not list the recent captures`))
    await search.locator('.qs-row', { hasText: 'CleanShot 1.png' }).click().catch(() => {})
    await search.locator('.qs-picture').waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a recent capture showed no picture`))
    if (await search.locator('.qs-row[draggable="true"]').count() !== 2) problems.push(`${room}: the recent captures could not be dragged out`)
    if (scheme === 'light') await search.screenshot({ path: `${OUT}/QuickSearch-captures.png` })
    await search.evaluate(() => window.osatSearch.saveSettings({ captures: { recent: false } }))
    // v is the clipboard: pins first, then the day; Return pastes (the stand-in says it needs Accessibility, so it says so).
    await search.fill('#qs-input', 'v')
    await search.locator('.qs-head', { hasText: 'Pinned' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "v" did not show the clipboard with its pins first`))
    if (!await search.locator('.qs-head', { hasText: 'Today' }).count()) problems.push(`${room}: the clipboard was not grouped by day`)
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
    await search.locator('.qs-chip.is-scope').click()
    await search.fill('#qs-input', '2*49')
    await search.locator('.qs-row', { hasText: '= 98' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a sum did not answer`))
    // Units and dates answer too, offline.
    await search.fill('#qs-input', '5 km in miles')
    await search.locator('.qs-row', { hasText: '= 3.107 mi' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a unit did not convert`))
    await search.fill('#qs-input', 'days until christmas')
    await search.locator('.qs-row[data-kind="calc"]', { hasText: /= \d+ days/ }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "days until christmas" did not answer`))
    if (scheme === 'light') await search.screenshot({ path: `${OUT}/QuickSearch-dates.png` })
    // A window layout: "left half" finds one with a picture of where the window will go; without Accessibility the panel
    // says what is waiting (the Mac app touches nothing); w is the Windows tab with every layout.
    await search.fill('#qs-input', 'left half')
    await search.locator('.qs-row[data-kind="layout"]', { hasText: 'Left half' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: "left half" did not find a layout`))
    await search.locator('.qs-screen i').waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a layout had no picture of where the window goes`))
    await search.keyboard.press('Enter')
    await search.locator('.qs-foot [role="status"]', { hasText: 'allowed in Accessibility' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a layout did not say what is waiting without Accessibility`))
    if (!(await search.evaluate(() => window.__calls)).some(([name, layout]) => name === 'snap' && layout === 'left-half')) problems.push(`${room}: Return on a layout did not ask for it`)
    await search.fill('#qs-input', 'w')
    await search.locator('.qs-row', { hasText: 'Put it back' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: w did not list every layout`))
    if ((await search.locator('.qs-row').count()) !== LAYOUTS.length) problems.push(`${room}: the Windows tab did not list all ${LAYOUTS.length} layouts`)
    if (scheme === 'light') await search.screenshot({ path: `${OUT}/QuickSearch-windows.png` })
    await search.locator('.qs-chip.is-scope').click()
    await search.fill('#qs-input', 'boards')
    await search.locator('.qs-row', { hasText: 'Boards' }).first().waitFor({ timeout: 3000 }).catch(() => problems.push(`${room}: a room was not found`))
    if (!/boards/i.test(await search.locator('.qs-row[aria-selected="true"]').innerText().catch(() => ''))) problems.push(`${room}: the highlight did not start on the first thing found`)
    // Tab asks the AI about the words (as in Raycast); Esc comes back to the bar.
    await search.keyboard.press('Tab')
    await search.locator('.qs-chat .composer textarea').waitFor({ state: 'visible', timeout: 3000 }).catch(() => problems.push(`${room}: Tab did not ask the AI`))
    await search.locator('.qs-chat .composer textarea').press('Escape')
    await search.locator('#qs-input').waitFor({ state: 'visible', timeout: 3000 }).catch(() => problems.push(`${room}: Esc did not come back from Ask`))
    await search.fill('#qs-input', 'canvas')
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
  // Settings → AI (Oct 2026): the best model for this Mac, the ones on it, and every model compared. A stand-in for the
  // Mac app's AI: a 64 GB Mac with Light downloaded.
  room = 'models'
  const models = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  models.on('pageerror', (error) => problems.push(`${room}: ${error.message}`))
  const memory = 64 * 1024 ** 3
  const fakeStatus = {
    recommended: pickTier(memory).id, best: recommendFor(memory).id, chosen: 'light', startup: false, totalMemory: memory, queued: [], download: null, engine: 'idle', message: '',
    tiers: TIERS.map((tier) => ({ id: tier.id, label: tier.label, model: tier.model, blurb: tier.blurb, starter: Boolean(tier.starter), maker: tier.maker, speed: tier.speed, smarts: tier.smarts, best: tier.best, minMemory: tier.minMemory, fits: fits(tier, memory), size: tier.size, ready: tier.id === 'light', state: 'idle', busy: false, retained: false, blocked: false, message: '', sees: false, visionSize: tier.vision.size, can: tier.can })),
  }
  await models.addInitScript((status) => {
    window.__installs = []
    window.osatLocalAI = {
      status: async () => status, onStatus: () => () => {}, models: async () => ({ models: [] }),
      install: async (id) => { window.__installs.push(id); return status },
    }
    for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen')
  }, fakeStatus)
  await models.goto(`${url}?fresh=1`)
  await models.waitForSelector('.workspace-content', { timeout: 15000 })
  await models.keyboard.press('Control+,')
  await models.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'AI', exact: true }).click()
  await models.locator('.ai-compare tbody tr').first().waitFor({ timeout: 5000 }).catch(() => problems.push(`${room}: Settings → AI had no comparison`))
  if (await models.locator('.ai-compare tbody tr').count() !== TIERS.length) problems.push(`${room}: the comparison did not list every model`)
  const bestGroup = models.locator('.setting-group').filter({ has: models.locator('h3', { hasText: 'Best for this Mac' }) })
  if (!(await bestGroup.innerText().catch(() => '')).includes('Qwen 3.6 35B')) problems.push(`${room}: a 64 GB Mac was not offered Qwen 3.6 35B`)
  await models.locator('.ai-compare tr', { hasText: 'Qwen 3.5 9B' }).getByRole('button', { name: 'Get' }).click()
  if (!(await models.evaluate(() => window.__installs)).includes('qwen35-9b')) problems.push(`${room}: Get did not download the model`)
  // Phase 37b: what each model can do, and a model here without its picture part offers it.
  if (!(await models.locator('.ai-compare tr', { hasText: 'Qwen 3.6 35B' }).locator('.ai-can-chip').allTextContents()).join('|').includes('Best at code')) problems.push(`${room}: Qwen 3.6 didn't say it is best at code`)
  if (!(await models.locator('.ai-compare tr', { hasText: 'Gemma 4 E2B' }).locator('.ai-can-chip', { hasText: 'Pictures' }).count())) problems.push(`${room}: a model didn't say it reads pictures`)
  await models.locator('.ai-compare tr', { hasText: 'Gemma 4 E2B' }).getByRole('button', { name: 'Add pictures' }).click()
  if (!(await models.evaluate(() => window.__installs)).includes('light')) problems.push(`${room}: Add pictures did not download the picture part`)
  await bestGroup.scrollIntoViewIfNeeded()
  await models.screenshot({ path: `${OUT}/settings-models-best.png` })
  await models.locator('.ai-compare').scrollIntoViewIfNeeded()
  await models.screenshot({ path: `${OUT}/settings-models.png` })
  await models.close()

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
