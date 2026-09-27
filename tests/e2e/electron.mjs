// Launches the real Electron app (built interface, isolated data folder) and
// checks the store end to end:
//   1. a thought typed in the main window is saved to disk and survives a restart
//   2. a second window sees the main window's change, and the other way round
//   3. a thought on the desk survives putting the desk away (closing only hides it)
//   4. the first-launch welcome picks an AI size, and Ask answers on the desk
//      (OSAT_AI=mock: a practice model answers, nothing is downloaded)
//   5. the iPhone link: a file in the iCloud Inbox becomes a thought, and the copy of
//      the notes appears, then leaves when the link is turned off (a stand-in iCloud Drive)
//   6. two OSATs (their own data, one iCloud Drive) keep each other in step
//   7. the Mac's Desktop on the desk (a stand-in folder): a folder opens in Files, and Ask reads a file
//   8. the quick chat: its own window answers, and Esc puts it away
//   9. Incognito: going under closes the browser's tabs and shuts every way out (the
//      desk's and the browser's requests, main's fetch, downloads, files); coming up
//      brings the tabs back; a relaunch stays under (driven through window.osatUnder and the
//      Go menu); the page shows the Sky under the desk, and the desk again when back up
// On Linux CI run it under xvfb:  xvfb-run -a node tests/e2e/electron.mjs
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const home = await mkdtemp(path.join(os.tmpdir(), 'osat-e2e-'))
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), OSAT_DATA_DIR: path.join(home, 'OSAT Test'), OSAT_AI: 'mock', OSAT_ICLOUD_DIR: path.join(home, 'iCloud Drive'), OSAT_PLACES_DIR: path.join(home, 'Mac') }
const dataFile = path.join(home, 'OSAT Test', 'store', 'workspace.json')
const problems = []
const check = (ok, message) => { if (!ok) problems.push(message) }

async function launch(withEnv = env) {
  const app = await electron.launch({ cwd: root, args: [root, '--no-sandbox'], env: withEnv })
  // The quick chat is a window too; the desk is the one without a surface.
  let main
  while (!main) {
    main = app.windows().find((page) => !page.url().includes('surface='))
    if (!main) await sleep(100)
  }
  await main.waitForSelector('.overlay-surface .workspace-content', { timeout: 20000 })
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
  // A stand-in Desktop, Documents and Downloads.
  await mkdir(path.join(home, 'Mac', 'Desktop', 'Plans'), { recursive: true })
  await mkdir(path.join(home, 'Mac', 'Documents'), { recursive: true })
  await mkdir(path.join(home, 'Mac', 'Downloads'), { recursive: true })
  await writeFile(path.join(home, 'Mac', 'Desktop', 'Trip notes.md'), '# Trip\nLeave Friday')
  await writeFile(path.join(home, 'Mac', 'Desktop', '.hidden'), 'never shown')
  await writeFile(path.join(home, 'Mac', 'Desktop', 'Plans', 'packing.txt'), 'Tent, stove, a good book')

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
  await main.fill('#home-line', 'Saved across a restart')
  await main.press('#home-line', 'Enter')
  await sleep(1500)
  await app.close()
  const onDisk = JSON.parse(await readFile(dataFile, 'utf8'))
  check(onDisk.notes.some((note) => note.title === 'Saved across a restart' && note.unsorted), 'the thought was not written to workspace.json')
  ;({ app, main } = await launch())
  check((await notesIn(main)).includes('Saved across a restart'), 'the thought was not there after a restart')
  check(!(await main.getByRole('dialog', { name: /Everything stays/ }).count()), 'the welcome came back after it was finished')

  // 4. Ask on the desk: a question in the line and ⌘↵ (Ctrl↵ elsewhere); the answer
  //    appears under the line and is kept as a chat.
  await main.fill('#home-line', 'What did I save across a restart?')
  await main.press('#home-line', 'ControlOrMeta+Enter')
  const answered = await main.locator('.home-answer').getByText('practice model').waitFor({ timeout: 10000 }).then(() => true, () => false)
  check(answered, 'Ask did not answer on the desk (⌘↵ in the line)')
  if (answered) {
    await main.getByRole('button', { name: 'Keep talking' }).click()
    await main.locator('.popout-body[data-view="Assistant"] .bubble.assistant').first().waitFor({ timeout: 5000 })
      .catch(() => problems.push('Keep talking did not open the chat in Ask'))
    const chats = await main.evaluate(async () => (await window.osat.store.load()).doc.chats)
    check(chats.length === 1 && chats[0].messages.length === 2, 'the desk question and its answer were not kept as one chat')
    check(chats[0]?.messages[0].noteIds?.length === 1, 'Ask did not pick the matching note for the question')
    // Esc leaves the chat's box, then closes the Ask pop-out.
    await main.keyboard.press('Escape')
    await main.keyboard.press('Escape')
    await main.locator('.popout-body[data-view="Assistant"]').waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => problems.push('Esc did not close the Ask pop-out'))
  }
  // Whatever happened above, the line starts the next steps empty.
  await main.fill('#home-line', '')

  // 7. The Desktop on the desk; a folder opens in Files; Ask reads a file from there.
  await main.keyboard.press('Control+1')
  const icons = main.locator('.home-icons')
  await icons.getByRole('button', { name: 'Trip notes.md' }).waitFor({ timeout: 8000 })
    .catch(() => problems.push('the Desktop\'s files did not appear on the desk'))
  check(!(await icons.getByRole('button', { name: '.hidden' }).count()), 'a hidden file showed on the desk')
  await icons.getByRole('button', { name: 'Plans, folder' }).dblclick()
  const packing = main.locator('.popout-body[data-view="Files"] .finder-item', { hasText: 'packing.txt' })
  await packing.waitFor({ timeout: 5000 }).catch(() => problems.push('a Desktop folder did not open in Files'))
  await packing.click()
  await main.getByRole('button', { name: 'Ask about it' }).click()
  await main.locator('.ask-note-chip.is-file', { hasText: 'packing.txt' }).waitFor({ timeout: 5000 })
    .catch(() => problems.push('Ask about it did not attach the file'))
  await main.getByLabel('Ask the AI on this Mac').fill('What should I pack?')
  await main.keyboard.press('Enter')
  await main.locator('.bubble.assistant', { hasText: 'It read one file' }).waitFor({ timeout: 10000 })
    .catch(() => problems.push('Ask did not send the file to the AI'))
  const asked = async () => (await main.evaluate(async () => (await window.osat.store.load()).doc.chats)).find((chat) => chat.messages[0]?.content === 'What should I pack?')
  check(await until(async () => (await asked())?.messages[0].files?.[0] === 'packing.txt', 3000),
    `the question did not remember the file it read: ${JSON.stringify((await asked())?.messages[0])}`)

  // 8. The quick chat, in its own window.
  const quick = app.windows().find((page) => page.url().includes('surface=chat'))
  check(Boolean(quick), 'the quick chat window was not created at launch')
  const chatShown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().includes('surface=chat') && window.isVisible()))
  if (quick) {
    await main.evaluate(() => window.osatChat.show())
    check(await until(chatShown, 3000), 'the quick chat did not show')
    await quick.locator('.composer textarea').fill('Hello from the quick chat')
    await quick.keyboard.press('Enter')
    await quick.locator('.bubble.assistant', { hasText: 'Hello from the quick chat' }).waitFor({ timeout: 10000 })
      .catch(() => problems.push('the quick chat did not answer'))
    await quick.keyboard.press('Escape')
    check(await until(async () => !(await chatShown()), 3000), 'Esc did not put the quick chat away')
    // Pop out: the desk's chat moves into the quick chat.
    const deskChat = (await asked()).id
    await main.evaluate((chatId) => window.osatChat.show({ chatId }), deskChat)
    await quick.locator('.chat-title h2', { hasText: 'What should I pack?' }).waitFor({ timeout: 5000 })
      .catch(() => problems.push('Pop out did not open that chat in the quick chat'))
    await quick.keyboard.press('Escape')
  }
  await main.keyboard.press('Control+1')

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

  // 3. The desk put away (⌘W / Esc / ⌥Space) is only hidden: it comes back with what was left on it.
  // (The hidden second window from step 2 has no surface either; the desk is the visible one.)
  await main.fill('#home-line', 'Captured before putting it away')
  await main.press('#home-line', 'Enter')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('surface=') && window.isVisible())?.close())
  await sleep(300)
  const deskShown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => !window.webContents.getURL().includes('surface=') && window.isVisible()))
  check(!(await deskShown()), 'closing the desk did not put it away')
  check(app.windows().includes(main), 'closing the desk destroyed it instead of hiding it')
  await sleep(1200)
  await app.close()
  const afterClose = JSON.parse(await readFile(dataFile, 'utf8'))
  check(afterClose.notes.some((note) => note.title === 'Captured before putting it away'), 'a thought left on the desk before putting it away was lost')
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
  check(await until(async () => (await notesIn(other.main)).includes('Captured before putting it away'), 15000),
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

  // 9. Incognito, through window.osatUnder. A page on this Mac (loopback) stands in for
  //    the web, so no internet is needed; example.com is never actually reached.
  const local = http.createServer((request, response) => {
    if (request.url !== '/big') return response.end('<title>A page on this Mac</title>Hello')
    // A file that takes its time, like a real download.
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="big.bin"' })
    const drip = setInterval(() => response.write(Buffer.alloc(64 * 1024)), 50)
    response.on('close', () => clearInterval(drip))
  })
  await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve))
  const page = `http://127.0.0.1:${local.address().port}/`
  // Loads https://example.com in a hidden window of the desk's session or the browser's.
  const loadRemote = (partition) => app.evaluate(async ({ BrowserWindow }, partition) => {
    const window = new BrowserWindow({ show: false, webPreferences: partition ? { partition } : {} })
    try {
      await window.loadURL('https://example.com/')
      return 'loaded'
    } catch (error) {
      return error.code || error.message
    } finally {
      window.destroy()
    }
  }, partition)
  const mainFetch = () => app.evaluate(() => fetch('https://example.com/').then(() => 'reached', (error) => error.name))
  const refused = (call) => main.evaluate(call).then(() => 'answered', (error) => error.message)
  const tabUrls = async () => (await main.evaluate(() => window.osatBrowser.state())).tabs.map((tab) => tab.url)
  const goMenu = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((item) => item.label === 'Go').submenu.items.map((item) => item.label))
  const icloudCopy = path.join(icloud, 'Notes')
  try {
    ;({ app, main } = await launch())
    check((await main.evaluate(() => window.osatUnder.status())).on === false, 'OSAT started under before anyone went under')
    await main.evaluate((url) => window.osatBrowser.open(url), page)
    check(await until(async () => (await tabUrls()).includes(page), 5000), 'the browser did not open the page on this Mac')
    // A blank tab too, and a file the browser is still fetching.
    await main.evaluate(() => window.osatBrowser.open())
    await app.evaluate(({ session }, { url, saveTo }) => {
      const part = session.fromPartition('persist:osat-browser')
      part.once('will-download', (_event, item) => { item.setSavePath(saveTo); globalThis.e2eDownload = item })
      part.downloadURL(url)
    }, { url: `${page}big`, saveTo: path.join(home, 'big.bin') })
    const downloadState = () => app.evaluate(() => globalThis.e2eDownload?.getState())
    check(await until(async () => await downloadState() === 'progressing', 5000), 'the browser did not start the download')
    await main.evaluate(() => { window.underHeard = []; window.osatUnder.onChange((status) => window.underHeard.push(status.on)) })
    await until(async () => app.windows().some((win) => win.url().includes('surface=chat')), 5000)
    const quick = app.windows().find((win) => win.url().includes('surface=chat'))
    await quick.waitForFunction(() => Boolean(window.osatUnder))
    check(/Only the main OSAT window/.test(await quick.evaluate(() => window.osatUnder.set(true).then(() => 'went under', (error) => error.message))),
      'the quick chat was allowed to take OSAT under')

    // Going under.
    const down = await main.evaluate(() => window.osatUnder.set(true))
    check(down.on === true, 'going under did not answer that OSAT is under')
    check(JSON.stringify(await main.evaluate(() => window.underHeard)) === '[true]', 'the desk did not hear that OSAT went under')
    check((await tabUrls()).length === 0, 'going under left browser tabs open')
    check(await downloadState() === 'cancelled', 'a browser download kept going while under')
    check(/web waits/.test(await refused(() => window.osatBrowser.open('https://example.com/'))), 'the browser still opened a page while under')
    check(await loadRemote() === 'ERR_BLOCKED_BY_CLIENT', 'the desk\'s session reached the internet while under')
    check(await loadRemote('persist:osat-browser') === 'ERR_BLOCKED_BY_CLIENT', 'the browser\'s session reached the internet while under')
    check(await main.evaluate(() => fetch('https://example.com/').then(() => 'reached', () => 'failed')) === 'failed', 'the desk fetched from the internet while under')
    check(await mainFetch() === 'OfflineError', 'the main process fetched from the internet while under')
    check(await app.evaluate((_electron, url) => fetch(url).then((response) => response.ok), page), 'loopback (LM Studio\'s road) was shut while under')
    check(/Downloads wait/.test(await refused(() => window.osatLocalAI.resume())), 'the AI download was not waiting while under')
    check(/Files wait/.test(await refused(() => window.nateOSFiles.list('desktop'))), 'files were read while under')
    check(/iPhone link waits/.test(await refused(() => window.osatPhone.enable())), 'the iPhone link could be turned on while under')
    check((await main.evaluate(() => window.osatPhone.status())).sync?.on !== true, 'the iPhone link kept syncing while under')
    check(await access(icloudCopy).then(() => true, () => false), 'going under took the copy of the notes out of iCloud Drive')
    check((await goMenu()).includes('Come Up'), 'the Go menu did not offer Come Up while under')
    // The page shows it: the desk lifts away and the Sky, the line and the pill are there.
    await main.locator('.overlay-surface[data-under="under"] .under .field-sky.is-full').waitFor({ timeout: 5000 })
      .catch(() => problems.push('the page did not show the Sky under the desk'))
    await main.locator('.under-pill', { hasText: 'offline · nothing leaves OSAT' }).waitFor({ timeout: 5000 })
      .catch(() => problems.push('the page did not say that nothing leaves OSAT'))
    check(await main.locator('#under-line').isVisible(), 'the line was not there under the desk')
    check(!(await main.locator('.home').isVisible()), 'the desk stayed in view under')

    // Coming up.
    const up = await main.evaluate(() => window.osatUnder.set(false))
    check(up.on === false, 'coming up did not answer that OSAT is back up')
    await main.locator('.under').waitFor({ state: 'detached', timeout: 5000 }).catch(() => problems.push('the Sky stayed after coming up'))
    await main.getByText('Back up. Nothing left OSAT while you were under.').waitFor({ timeout: 3000 })
      .catch(() => problems.push('coming up did not say that nothing left OSAT'))
    check(await main.locator('.home').isVisible(), 'the desk did not come back after coming up')
    check(await until(async () => {
      const urls = await tabUrls()
      return urls.length === 2 && urls.includes(page)
    }, 5000), 'coming up did not bring both browser tabs back (the page and the blank one)')
    check(await refused(() => window.osatLocalAI.resume()) === 'answered', 'the AI download still waited after coming up')
    check(await refused(() => window.nateOSFiles.list('desktop')) === 'answered', 'files still waited after coming up')
    check(await until(async () => (await main.evaluate(() => window.osatPhone.status())).sync?.on === true, 10000), 'the iPhone link did not start again after coming up')
    check((await goMenu()).includes('Go Under'), 'the Go menu did not offer Go Under again')

    // A relaunch stays under.
    await main.evaluate(() => window.osatUnder.set(true))
    await app.close()
    ;({ app, main } = await launch())
    check((await main.evaluate(() => window.osatUnder.status())).on === true, 'a relaunch did not stay under')
    check(await loadRemote() === 'ERR_BLOCKED_BY_CLIENT', 'a relaunch under reached the internet')
    check(await mainFetch() === 'OfflineError', 'a relaunch under let the main process fetch')
    check((await main.evaluate(() => window.osatPhone.status())).sync?.on !== true, 'a relaunch under started the iPhone link')
    check(/web waits/.test(await refused(() => window.osatBrowser.open('https://example.com/'))), 'a relaunch under opened a web page')
    await main.locator('.overlay-surface[data-under="under"] .under-pill').waitFor({ timeout: 5000 })
      .catch(() => problems.push('a relaunch under did not open on the Sky'))
    // Come Up from the Go menu (what ⇧⌘U does): main decides, and the page follows.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((item) => item.label === 'Go').submenu.items.find((item) => item.label === 'Come Up').click())
    await main.locator('.under').waitFor({ state: 'detached', timeout: 5000 }).catch(() => problems.push('Come Up in the Go menu did not bring the desk back'))
    check((await main.evaluate(() => window.osatUnder.status())).on === false, 'Come Up in the Go menu did not come up')
    await app.close()
  } finally {
    local.closeAllConnections()
    local.close()
  }
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
