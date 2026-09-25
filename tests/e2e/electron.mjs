// Launches the real Electron app (built interface, isolated data folder) and
// checks the store end to end:
//   1. a thought typed in the main window is saved to disk and survives a restart
//   2. a second window sees the main window's change, and the other way round
//   3. a thought left on the ⌥Space layer while the main window is closed is not lost
// On Linux CI run it under xvfb:  xvfb-run -a node tests/e2e/electron.mjs
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const home = await mkdtemp(path.join(os.tmpdir(), 'osat-e2e-'))
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), OSAT_DATA_DIR: path.join(home, 'OSAT Test') }
const dataFile = path.join(home, 'OSAT Test', 'store', 'workspace.json')
const problems = []
const check = (ok, message) => { if (!ok) problems.push(message) }

async function launch() {
  const app = await electron.launch({ cwd: root, args: [root, '--no-sandbox'], env })
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
  // 1. Type a thought on home, quit, reopen.
  let { app, main } = await launch()
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
