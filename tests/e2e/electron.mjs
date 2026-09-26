// Launches the real Electron app (built interface, isolated data folder) and
// checks the store end to end:
//   1. a thought typed in the main window is saved to disk and survives a restart
//   2. a second window sees the main window's change, and the other way round
//   3. a thought left on the ⌥Space layer while the main window is closed is not lost
//   4. the first-launch welcome picks an AI size, and Ask answers on the desk
//      (OSAT_AI=mock: a practice model answers, nothing is downloaded)
//   5. the iPhone link: a file in the iCloud Inbox becomes a thought, and the copy of
//      the notes appears, then leaves when the link is turned off (a stand-in iCloud Drive)
//   6. two OSATs (their own data, one iCloud Drive) keep each other in step
// On Linux CI run it under xvfb:  xvfb-run -a node tests/e2e/electron.mjs
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const home = await mkdtemp(path.join(os.tmpdir(), 'osat-e2e-'))
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), OSAT_DATA_DIR: path.join(home, 'OSAT Test'), OSAT_AI: 'mock', OSAT_ICLOUD_DIR: path.join(home, 'iCloud Drive') }
const dataFile = path.join(home, 'OSAT Test', 'store', 'workspace.json')
const problems = []
const check = (ok, message) => { if (!ok) problems.push(message) }

async function launch(withEnv = env) {
  const app = await electron.launch({ cwd: root, args: [root, '--no-sandbox'], env: withEnv })
  // The hidden ⌥Space layer is a window too; the main window is the one without a surface.
  let main
  while (!main) {
    main = app.windows().find((page) => !page.url().includes('surface='))
    if (!main) await sleep(100)
  }
  await main.waitForSelector('.workspace', { timeout: 20000 })
  return { app, main }
}

const notesIn = (page) => page.evaluate(async () => (await window.osat.store.load()).doc.notes.map((note) => note.title))
async function until(test, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await test()) return true
  return false
}

async function openSecondWindow(app, surface = '') {
  const count = app.windows().length
  await app.evaluate(({ BrowserWindow }, { query, preload }) => {
    const [first] = BrowserWindow.getAllWindows()
    const second = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } })
    second.loadURL(`${first.webContents.getURL().split('?')[0]}${query}`)
  }, { query: surface, preload: path.join(root, 'desktop', 'preload.cjs') })
  while (app.windows().length === count) await sleep(100)
  const page = app.windows().at(-1)
  await page.waitForLoadState('domcontentloaded')
  return page
}

try {
  // 1. The welcome, then a thought on home; quit, reopen.
  let { app, main } = await launch()
  const welcome = main.getByRole('dialog', { name: /Everything stays on this Mac/ })
  await welcome.waitFor({ timeout: 10000 }).catch(() => problems.push('the welcome did not appear on first launch'))
  await main.getByRole('button', { name: 'Continue' }).click()
  await main.getByRole('button', { name: 'Continue' }).click()
  await main.getByRole('radio', { name: /Light/ }).click()
  await main.getByRole('button', { name: 'Start', exact: true }).click()
  await main.getByRole('dialog', { name: /AI’s size/ }).waitFor({ state: 'detached', timeout: 5000 })
    .catch(() => problems.push('the welcome did not close after Start'))
  const keep = main.getByRole('button', { name: 'Start blank' })
  if (await keep.count()) await keep.click()
  await main.getByPlaceholder('Leave a thought here.').fill('Saved across a restart')
  await main.keyboard.press('Enter')
  await sleep(1500)
  await app.close()
  const onDisk = JSON.parse(await readFile(dataFile, 'utf8'))
  check(onDisk.notes.some((note) => note.title === 'Saved across a restart' && note.unsorted), 'the thought was not written to workspace.json')
  ;({ app, main } = await launch())
  check((await notesIn(main)).includes('Saved across a restart'), 'the thought was not there after a restart')
  check(!(await main.getByRole('dialog', { name: /Everything stays/ }).count()), 'the welcome came back after it was finished')

  // 4. Ask on the desk: the answer appears under the line and is kept as a chat.
  await main.getByRole('radio', { name: 'Ask' }).click()
  await main.getByPlaceholder('Ask your notes, or anything…').fill('What did I save across a restart?')
  await main.keyboard.press('Enter')
  await main.locator('.home-answer').getByText('practice model').waitFor({ timeout: 10000 })
    .catch(() => problems.push('Ask did not answer on the desk'))
  await main.getByRole('button', { name: 'Keep talking' }).click()
  await main.locator('.sheet-body[data-view="Assistant"] .bubble.assistant').first().waitFor({ timeout: 5000 })
    .catch(() => problems.push('Keep talking did not open the chat in Ask'))
  const chats = await main.evaluate(async () => (await window.osat.store.load()).doc.chats)
  check(chats.length === 1 && chats[0].messages.length === 2, 'the desk question and its answer were not kept as one chat')
  check(chats[0]?.messages[0].noteIds?.length === 1, 'Ask did not pick the matching note for the question')
  await main.keyboard.press('Escape')

  // 2. Two windows stay in step.
  const second = await openSecondWindow(app)
  await second.waitForFunction(() => Boolean(window.osat?.store))
  await second.evaluate(async () => {
    const { doc } = await window.osat.store.load()
    const note = { id: 'from-second', title: 'From the second window', markdown: 'hello', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), folderId: null, pinned: false, archived: false, trashedAt: null, unsorted: true, source: 'Test', kind: null, date: null }
    await window.osat.store.commit([{ t: 'add', c: 'notes', v: note, at: 0 }])
    return doc.rev
  })
  // The main window's own state (not a fresh load) must pick the note up.
  await main.keyboard.press('Control+2')
  await main.getByText('From the second window').first().waitFor({ timeout: 5000 })
    .catch(() => problems.push('the main window did not show the second window\'s note'))
  await main.keyboard.press('Control+1')

  // 5. The iPhone link, through a stand-in iCloud Drive.
  const icloud = path.join(home, 'iCloud Drive', 'OSAT')
  await mkdir(path.dirname(icloud), { recursive: true })
  const phone = await main.evaluate(() => window.osatPhone.enable())
  check(phone.enabled, 'the iPhone link did not turn on')
  const dropped = path.join(icloud, 'Inbox', 'Text.txt')
  await writeFile(dropped, 'From the phone\nwith a second line')
  const past = new Date(Date.now() - 60_000)
  await utimes(dropped, past, past)
  let arrived = false
  for (let i = 0; i < 40 && !arrived; i += 1) {
    await sleep(250)
    arrived = (await notesIn(main)).includes('From the phone')
  }
  check(arrived, 'a thought dropped in the iCloud Inbox did not arrive in Unsorted')
  await sleep(2600)
  const copy = path.join(icloud, 'Notes', 'Unsorted', 'From the phone.md')
  check(await access(copy).then(() => true, () => false), 'the copy of the notes was not written to iCloud Drive')
  check(await access(path.join(icloud, 'Inbox', 'Added', 'Text.txt')).then(() => true, () => false), 'the dropped file did not move to Inbox/Added')
  await main.evaluate(() => window.osatPhone.disable())
  check(!(await access(copy).then(() => true, () => false)), 'turning the iPhone link off left the copy of the notes behind')

  // 3. Capture on the ⌥Space layer with the main window closed.
  const layer = app.windows().find((page) => page.url().includes('surface=overlay'))
  check(Boolean(layer), 'the layer window was not created at launch')
  await layer.waitForSelector('#home-line', { timeout: 10000 })
  await main.close()
  await sleep(300)
  await layer.fill('#home-line', 'Captured with the window closed')
  await layer.press('#home-line', 'Enter')
  await sleep(1500)
  await app.close()
  const afterClose = JSON.parse(await readFile(dataFile, 'utf8'))
  check(afterClose.notes.some((note) => note.title === 'Captured with the window closed'), 'a capture made with the main window closed was lost')
  check(afterClose.notes.some((note) => note.title === 'From the second window'), 'the second window\'s note was not saved')

  // 6. Two OSATs in step: this one turns the link on again, a second one (its own data
  //    folder, the same iCloud Drive) catches up, then each hears the other's changes.
  ;({ app, main } = await launch())
  await main.evaluate(() => window.osatPhone.enable())
  const otherData = path.join(home, 'OSAT Other')
  await mkdir(otherData, { recursive: true })
  await writeFile(path.join(otherData, 'osat-data-folder.json'), '{"app":"ai.mccreery.osat"}')
  await writeFile(path.join(otherData, 'prefs.json'), '{"welcomed":true}')
  const other = await launch({ ...env, OSAT_DATA_DIR: otherData })
  await other.main.evaluate(() => window.osatPhone.enable())
  check(await until(async () => (await notesIn(other.main)).includes('Captured with the window closed'), 15000),
    'the second OSAT did not catch up with the first one\'s notes')
  await other.main.evaluate(async () => {
    const now = new Date().toISOString()
    await window.osat.store.commit([{ t: 'add', c: 'notes', v: { id: 'from-other', title: 'Written on the other Mac', markdown: '', tags: [], createdAt: now, updatedAt: now, folderId: null, pinned: false, archived: false, trashedAt: null, unsorted: false, source: null, kind: null, date: null } }])
  })
  check(await until(async () => (await notesIn(main)).includes('Written on the other Mac'), 30000),
    'the first OSAT did not hear the second one\'s new note')
  await main.evaluate(() => window.osat.store.commit([{ t: 'patch', c: 'notes', id: 'from-other', v: { title: 'Renamed on the first Mac' } }]))
  check(await until(async () => (await notesIn(other.main)).includes('Renamed on the first Mac'), 30000),
    'the second OSAT did not hear the first one\'s rename')
  await other.app.close()
  await app.close()
} catch (error) {
  problems.push(error.stack || String(error))
} finally {
  await rm(home, { recursive: true, force: true })
}

if (problems.length) {
  console.error(`Electron end-to-end test found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Electron end-to-end test passed.')
