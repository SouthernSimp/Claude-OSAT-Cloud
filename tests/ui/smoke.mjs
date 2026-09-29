// Opens the built web preview in Chromium, visits every room, and fails on any
// page error. Screenshots land in test-results/ui/ (light, then dark) so each
// pull request shows what changed. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = process.env.OSAT_SHOTS || 'test-results/ui'
const PORT = Number(process.env.OSAT_PORT || 4317)
// The spaces that open as pop-outs (⌃2, 4, 5; ⌃3 is the Sky, a layer of its own), then
// every tool from the dock's Tools menu.
const SPACES = [['Notes', 2], ['Assistant', 4], ['Files', 5]]
const TOOLS = [['Journal', 'Journal'], ['Calendar', 'Calendar'], ['Habits', 'Habits'], ['Budget', 'Money'], ['Browser', 'Browser'], ['Terminal', 'Terminal'], ['Roadmap', 'Roadmap'], ['Settings', 'Settings']]

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
    await sleep(700)
    await page.screenshot({ path: `${OUT}/${theme}-Sky.png` })
    await page.locator('[data-node-head]', { hasText: 'Project Direction' }).dblclick({ force: true }).catch(() => problems.push(`sky: Project Direction was not there to open (${theme})`))
    await page.locator('.board-card.is-open .lane').first().waitFor({ timeout: 3000 }).catch(() => problems.push(`sky: opening a node showed no lanes (${theme})`))
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
  await page.locator('[data-node-head]', { hasText: 'Project Direction' }).click({ button: 'right', force: true })
  for (const gone of ['Link to', 'Lay it out', 'Put inside', 'Colour', 'Remove node']) if (await page.getByRole('menuitem', { name: gone }).count()) problems.push(`sky: the node menu still says "${gone}"`)
  for (const kept of ['Color', 'Delete node', 'Help me sort']) if (!await page.getByRole('menuitem', { name: kept }).count()) problems.push(`sky: the node menu has no "${kept}"`)
  await page.getByRole('menuitem', { name: 'Help me sort' }).click().catch(() => {})
  await page.locator('.sort-help').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: Help me sort said nothing'))
  await sleep(300)
  await page.screenshot({ path: `${OUT}/sky-sort.png` })
  const nodeFile = { title: 'Garden', summary: 'What grows where.', branches: [{ title: 'Beds', leaves: [{ text: 'Tomatoes', done: false }, { text: 'Dig', done: true }], sub_branches: [{ title: 'Herbs', leaves: [{ text: 'Basil' }] }] }] }
  await page.locator('.sky-layer input[type="file"]').setInputFiles({ name: 'garden.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(nodeFile)) })
  await page.getByText('Imported Garden with 2 branches').waitFor({ timeout: 3000 }).catch(() => problems.push('sky: Import did not say what it made'))
  await page.locator('[data-node-head]', { hasText: 'Garden' }).waitFor({ timeout: 3000 }).catch(() => problems.push('sky: the imported node was not in the Sky'))
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
  // Taken off the desk (its menu), the sticky joins the smoke test's sticky in the Unsorted pile, which opens Unsorted.
  await here.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Take off the desk' }).click()
  const shelfSticky = page.locator('.home .desk-sticky', { hasText: 'Smoke test thought' })
  if (await shelfSticky.count()) {
    await shelfSticky.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Take off the desk' }).click()
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
  if (await picked() !== 'Save as a sticky') problems.push(`esc: the first Esc did not go back to Save (${await picked()}, after opening ${latest}, focus ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.className)})`)
  await page.keyboard.press('Escape')
  if (await page.getByRole('listbox').count()) problems.push('esc: the second Esc did not close the drawer')
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
