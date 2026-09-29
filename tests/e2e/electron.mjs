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
//   9. Offline: going offline closes the browser's tabs and shuts every way out (the
//      desk's and the browser's requests, main's fetch, downloads, opening files in other
//      apps); back online brings the tabs back; a relaunch stays offline (driven through
//      window.osatUnder and the Go menu); the desk stays, and the line says it's offline
//  10. the drop folder (a stand-in ~/Documents/OSAT Nodes), while offline: a node file a bot
//      saved becomes a New node in the Sky and moves to Added
//  11. a cloud model (a stand-in OpenAI-style provider on this Mac): a bad key says so, a good
//      one connects, the line's answer comes from it, the running total grows, no key on disk
//  12. scans (a stand-in Google Drive folder): what's there when it's picked waits; a new scan
//      becomes a packed New node named by the model, and the original is never touched
//  13. the connector (MCP on 127.0.0.1): off until turned on, the key from the copied setup,
//      a node added over MCP arrives in the Sky, and Undo takes it away
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
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), OSAT_DATA_DIR: path.join(home, 'OSAT Test'), OSAT_AI: 'mock', OSAT_ICLOUD_DIR: path.join(home, 'iCloud Drive'), OSAT_PLACES_DIR: path.join(home, 'Mac'), OSAT_NODES_DIR: path.join(home, 'OSAT Nodes') }
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

  // 3. The desk put away (⌘W / ⌥Space; never Esc) is only hidden: it comes back with what was left on it.
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

  // 11. A cloud model, through a stand-in provider that speaks the OpenAI way.
  const KEY = 'sk-e2e-0123456789abcdef0123456789'
  const cloud = http.createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${KEY}`) return response.writeHead(401).end('{"error":{"message":"bad key"}}')
    if (request.url === '/v1/models') return response.end(JSON.stringify({ data: [{ id: 'test-chat' }, { id: 'text-embedding-test' }] }))
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const asked = JSON.parse(body)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const naming = /scanned page/.test(asked.messages.at(-1).content)
      for (const text of naming ? ['Name: Car insurance renewal\n', 'Summary: Pay by October 12.'] : ['From the ', 'cloud model']) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
      if (asked.stream_options) response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 4 } })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise((resolve) => cloud.listen(0, '127.0.0.1', resolve))
  try {
    ;({ app, main } = await launch())
    const provider = { preset: 'other', name: 'Test Cloud', baseUrl: `http://127.0.0.1:${cloud.address().port}/v1` }
    check(/didn’t accept that key/.test(await main.evaluate((input) => window.osatBots.connect(input).then(() => 'connected', (error) => error.message), { ...provider, key: 'sk-wrong-0123456789abcdef' })),
      'a bad key did not say plainly that it was not accepted')
    const made = await main.evaluate((input) => window.osatBots.connect(input), { ...provider, key: KEY }).catch((error) => ({ error: error.message }))
    check(made.model === 'test-chat' && made.models?.length === 1, `connecting a cloud model did not pick its chat model: ${JSON.stringify(made)}`)
    check((await main.evaluate(() => window.osatLocalAI.models())).models[0]?.id === 'cloud:custom-test-cloud:test-chat', 'the chosen cloud model was not first for the line')
    await main.fill('#home-line', 'Where does this answer come from?')
    // The line reads the new first model a moment after the choice: its drawer names it.
    await main.getByText('test-chat · Test Cloud').first().waitFor({ timeout: 5000 })
      .catch(() => problems.push('the line did not pick up the chosen cloud model'))
    await main.press('#home-line', 'ControlOrMeta+Enter')
    await main.locator('.home-answer').getByText('From the cloud model').waitFor({ timeout: 10000 })
      .catch(async () => problems.push(`the line’s answer did not come from the chosen cloud model: ${JSON.stringify(await main.locator('.home-answer').innerText().catch(() => 'no answer'))}`))
    const usage = (await main.evaluate(() => window.osatBots.status())).cloud.providers[0]?.usage
    check(usage?.requests === 1 && usage.input === 40 && usage.output === 4, `the running total did not count the question: ${JSON.stringify(usage)}`)
    check(!(await readFile(path.join(home, 'OSAT Test', 'bots.json'), 'utf8')).includes(KEY), 'the key was written to a file')

    // 12. Scans. The folder picker is the Mac's; here it answers with a stand-in Drive folder.
    const drive = path.join(home, 'Google Drive', 'Scans')
    await mkdir(drive, { recursive: true })
    const aged = new Date(Date.now() - 60_000)
    await writeFile(path.join(drive, 'Old scan.pdf'), '%PDF-1.4 an old scan')
    await utimes(path.join(drive, 'Old scan.pdf'), aged, aged)
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, drive)
    await main.evaluate(() => window.osatBots.chooseScanFolder())
    const scanStatus = async () => (await main.evaluate(() => window.osatBots.status())).scans
    check((await scanStatus()).waiting === 1, `the scan already in the folder was not noted as waiting: ${JSON.stringify(await scanStatus())}`)
    const newScan = path.join(drive, 'Scan_0001.pdf')
    await writeFile(newScan, '%PDF-1.4 a new scan')
    await utimes(newScan, aged, aged)
    const scanNode = async () => (await main.evaluate(async () => (await window.osat.store.load()).doc.folders)).find((folder) => folder.from?.source === 'Scan')
    check(await until(async () => (await scanNode())?.from?.proposal?.name === 'Car insurance renewal', 20000),
      `a new scan did not become a node with a proposed name: ${JSON.stringify(await scanNode())} ${JSON.stringify(await scanStatus())}`)
    const scanned = await scanNode()
    check(scanned?.packed && scanned.fresh && scanned.name === 'Scan 0001', 'the scan did not arrive as a packed New node named after its file')
    check((await main.evaluate(async () => (await window.osat.store.load()).doc.folders)).filter((folder) => folder.from?.source === 'Scan').length === 1, 'the old scan came in without being asked')
    check(await access(newScan).then(() => true, () => false), 'the original scan was moved or deleted')
    check(await access(path.join(home, 'OSAT Test', 'scans', scanned?.from?.scan || 'missing')).then(() => true, () => false), 'OSAT did not keep its own copy of the scan')
    // 13. The connector, as Claude Code would use it.
    const connector = await main.evaluate(() => window.osatBots.connectorOn()).catch((error) => ({ error: error.message }))
    check(connector.running && /^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(connector.url), `the connector did not start on this Mac: ${JSON.stringify(connector)}`)
    await main.evaluate(() => window.osatBots.copySetup('other'))
    const connectorKey = /Bearer (\S+)/.exec(await app.evaluate(({ clipboard }) => clipboard.readText()))?.[1]
    check(Boolean(connectorKey), 'the copied setup did not carry the key')
    const mcp = (body, key = connectorKey) => fetch(connector.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) })
    check((await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'wrong')).status === 401, 'the connector answered without its key')
    const init = await (await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } })).json()
    check(init.result?.serverInfo?.name === 'osat', 'the connector did not answer initialize')
    const added = await (await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'add_node', arguments: { title: 'From Claude over MCP', summary: 'Sent through the connector.', source: 'Claude' } } })).json()
    check(/Added the node “From Claude over MCP”/.test(added.result?.content?.[0]?.text), `add_node did not answer as expected: ${JSON.stringify(added)}`)
    const viaMcp = async () => (await main.evaluate(async () => (await window.osat.store.load()).doc.folders)).find((folder) => folder.name === 'From Claude over MCP')
    check(await until(async () => (await viaMcp())?.from?.source === 'Claude', 5000), 'a node added over MCP did not reach the windows')
    const listed = await (await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_nodes', arguments: {} } })).json()
    check(/From Claude over MCP \(New, packed, from Claude\)/.test(listed.result?.content?.[0]?.text), 'list_nodes did not list the new node')
    const lately = (await main.evaluate(() => window.osatBots.status())).connector.recent
    await main.evaluate((at) => window.osatBots.undoConnector(at), lately[0]?.at)
    check(await until(async () => !(await viaMcp()), 5000), 'Undo did not take away what came through the connector')
    await main.evaluate(() => window.osatBots.connectorOff())
    check(await mcp({ jsonrpc: '2.0', id: 4, method: 'ping' }).then(() => false, () => true), 'the connector still answered after turning it off')

    await main.evaluate(() => window.osatBots.chooseModel('local'))
    check((await main.evaluate(() => window.osatLocalAI.models())).models[0]?.id.startsWith('osat:'), 'choosing On this Mac did not put the AI on this Mac first again')
    await main.fill('#home-line', '')
    await app.close()
  } finally {
    cloud.closeAllConnections()
    cloud.close()
  }

  // 9. Offline, through window.osatUnder. A page on this Mac (loopback) stands in for
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
    check(/another app waits/.test(await refused(() => window.nateOSFiles.open('desktop', 'notes.txt'))), 'a file opened in another app while offline')
    check(await refused(() => window.nateOSFiles.list('desktop')) === 'answered', 'the Desktop could not be listed while offline')
    check(/iPhone link waits/.test(await refused(() => window.osatPhone.enable())), 'the iPhone link could be turned on while under')
    check((await main.evaluate(() => window.osatPhone.status())).sync?.on !== true, 'the iPhone link kept syncing while under')
    check(await access(icloudCopy).then(() => true, () => false), 'going under took the copy of the notes out of iCloud Drive')
    check((await goMenu()).includes('Go Online'), 'the Go menu did not offer Go Online while offline')
    // The page shows it: the desk stays, and the line says it's offline, its switch pressed.
    await main.locator('.home-offline-note', { hasText: 'Offline · nothing leaves OSAT' }).waitFor({ timeout: 5000 })
      .catch(() => problems.push('the line did not say that nothing leaves OSAT'))
    check(await main.locator('.home-offline[aria-pressed="true"]').isVisible(), 'the line\'s switch was not on while offline')
    check(await main.locator('.home').isVisible(), 'the desk went away offline')

    // Back online, from the line's switch.
    await main.locator('.home-offline').click()
    await main.locator('.home-offline-note').waitFor({ state: 'detached', timeout: 5000 }).catch(() => problems.push('the line still said offline after going back online'))
    check((await main.evaluate(() => window.osatUnder.status())).on === false, 'the line\'s switch did not go back online')
    check(await until(async () => {
      const urls = await tabUrls()
      return urls.length === 2 && urls.includes(page)
    }, 5000), 'coming up did not bring both browser tabs back (the page and the blank one)')
    check(await refused(() => window.osatLocalAI.resume()) === 'answered', 'the AI download still waited after coming up')
    check(await until(async () => (await main.evaluate(() => window.osatPhone.status())).sync?.on === true, 10000), 'the iPhone link did not start again after coming up')
    check((await goMenu()).includes('Go Offline'), 'the Go menu did not offer Go Offline again')

    // A relaunch stays under.
    await main.evaluate(() => window.osatUnder.set(true))
    await app.close()
    ;({ app, main } = await launch())
    check((await main.evaluate(() => window.osatUnder.status())).on === true, 'a relaunch did not stay under')
    check(await loadRemote() === 'ERR_BLOCKED_BY_CLIENT', 'a relaunch under reached the internet')
    check(await mainFetch() === 'OfflineError', 'a relaunch under let the main process fetch')
    check((await main.evaluate(() => window.osatPhone.status())).sync?.on !== true, 'a relaunch under started the iPhone link')
    check(/web waits/.test(await refused(() => window.osatBrowser.open('https://example.com/'))), 'a relaunch under opened a web page')
    await main.locator('.home-offline-note').waitFor({ timeout: 5000 })
      .catch(() => problems.push('a relaunch offline did not say so on the line'))
    // 10. The drop folder is on this Mac, so it works offline too.
    const nodesDir = path.join(home, 'OSAT Nodes')
    check((await main.evaluate(() => window.osatBots.status())).nodes?.dir === nodesDir, 'Settings → Bots did not show the drop folder')
    const nodeFile = path.join(nodesDir, 'Garden.md')
    await writeFile(nodeFile, '---\nsource: Muse\n---\n# Garden from Muse\nWhat grows where.\n')
    const settled = new Date(Date.now() - 60_000)
    await utimes(nodeFile, settled, settled)
    const arrivedNode = async () => (await main.evaluate(async () => (await window.osat.store.load()).doc.folders)).find((folder) => folder.name === 'Garden from Muse')
    check(await until(async () => {
      const node = await arrivedNode()
      return Boolean(node?.fresh && node.packed && node.from?.source === 'Muse')
    }, 40000), `a node file in the drop folder did not become a New, packed node: ${JSON.stringify(await arrivedNode())}`)
    check(await until(() => access(path.join(nodesDir, 'Added', 'Garden.md')).then(() => true, () => false), 5000), 'the node file did not move to Added')

    // Go Online from the Go menu (what ⇧⌘U does): main decides, and the page follows.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((item) => item.label === 'Go').submenu.items.find((item) => item.label === 'Go Online').click())
    await main.locator('.home-offline-note').waitFor({ state: 'detached', timeout: 5000 }).catch(() => problems.push('Go Online in the Go menu did not reach the line'))
    check((await main.evaluate(() => window.osatUnder.status())).on === false, 'Go Online in the Go menu did not go back online')
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
