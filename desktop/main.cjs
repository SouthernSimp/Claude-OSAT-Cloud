const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, Menu, Notification, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen, session, shell, systemPreferences, utilityProcess } = require('electron')
const { createUnder, guardFetch, isLocal, refusal } = require('./under.cjs')

/* Offline (see "Offline" below). Two locks, set before any of OSAT's own modules load:
   the main process's own fetch (the model download, Spotify's covers, LM Studio),
   and every session's requests (the desk's, the quick bar's and the browser's).
   While offline, only this Mac answers. */
const under = createUnder({ save: saveUnder, down: goingUnder, up: comingUp, changed: underChanged })
globalThis.fetch = guardFetch(globalThis.fetch, () => under.on)
const guardedSessions = new WeakSet()
// A download belongs to its session, not its tab: closing the tabs alone wouldn't stop it.
const downloads = new Set()
function guardSession(ses) {
  if (guardedSessions.has(ses)) return
  guardedSessions.add(ses)
  // A session keeps one listener per event: a second onBeforeRequest would replace this lock.
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: under.on && !isLocal(details.url) }))
  ses.on('will-download', (_event, item) => {
    downloads.add(item)
    item.once('done', () => downloads.delete(item))
  })
}
app.on('session-created', guardSession)

const { claimDataFolder } = require('./data-folder.cjs')
const { localAiChatStream, localAiModels, validateLocalChatPayload } = require('./local-ai.cjs')
const { createAi } = require('./ai/index.cjs')
const { estimateResources } = require('./ai/resources.cjs')
const { tierById } = require('./ai/catalog.cjs')
const { createPhoneBridge } = require('./phone.cjs')
const { watchFolder } = require('./folder-watch.cjs')
const { createBots } = require('./bots/index.cjs')
const { createMacSync } = require('./sync.cjs')
const { settleRoot } = require('./phone-root.cjs')
const { createBrowser } = require('./browser.cjs')
const { createSkills } = require('./skills.cjs')
const { createTerminals } = require('./terminal.cjs')
const { createStore } = require('./store/index.cjs')
const { DEFAULT_HOTKEY, DEFAULT_SEARCH_HOTKEY, accentCss, addLauncher, deskAction, displayAt, hotkeyLabel, pickWidgets, placeItem, sameBounds, validHotkey } = require('./desk.cjs')
const { createLauncher } = require('./launcher/index.cjs')
const { extractText } = require('./mac-files.cjs')
const { TidyError } = require('./file-ops.cjs')
const { NOT_ALLOWED, createFiles } = require('./files.cjs')
const { createMedia } = require('./media.cjs')
const { createUpdater } = require('./updater.cjs')
const { createMacCalendar } = require('./mac-calendar.cjs')

const APP_ENTRY = path.join(__dirname, '..', 'dist', 'client', 'index.html')
const APP_URL = pathToFileURL(APP_ENTRY).href

// Ask: the quick bar opened on Ask (it was the quick chat's key before the one bar, Phase 13c).
const CHAT_HOTKEY = 'Alt+Shift+Space'

let mainWindow
let quitting = false
let tray
let prefs = { hotkey: DEFAULT_HOTKEY, chatHotkey: CHAT_HOTKEY, searchHotkey: DEFAULT_SEARCH_HOTKEY, barSpot: null, launchers: [], places: {}, ai: { tier: null }, welcomed: false, toured: false, phone: false, under: false }
// The three shortcuts: the desk, the quick bar on Ask, and the quick bar. `value` is null when another app has it.
const shortcuts = {
  layer: { value: null, failed: false, run: () => toggleDesk() },
  chat: { value: null, failed: false, run: () => launcher?.search.toggle({ view: 'chat' }) },
  search: { value: null, failed: false, run: () => launcher?.search.toggle() },
}
// Which prefs.json key keeps each shortcut, and what it opens (for words like "already opens…").
const HOTKEY_PREF = { layer: 'hotkey', chat: 'chatHotkey', search: 'searchHotkey' }
const HOTKEY_OPENS = { layer: 'OSAT', chat: 'Ask in the quick bar', search: 'the quick bar' }
let ai
let launcher
let trayAiLine = ''
const browsers = new Map()
let terminals
let store
let files
const storeClients = new Map()

// Real notes live in "OSAT"; running from source uses "OSAT Dev" so development
// never touches them. See data-folder.cjs for how an older "OSAT" folder is kept safe.
// Tests pass OSAT_DATA_DIR (from source only) because macOS ignores a fake HOME.
const dataDir = (!app.isPackaged && process.env.OSAT_DATA_DIR) || path.join(app.getPath('appData'), app.isPackaged ? 'OSAT' : 'OSAT Dev')
app.setPath('userData', claimDataFolder(dataDir).folder)
app.setName('OSAT')
// One OSAT at a time: a second launch just brings the open one forward.
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()

class FileAccessError extends Error {}

function fail(message) {
  throw new FileAccessError(message)
}

/* Everything here answers only the OSAT window (the desk). */
function assertMainWindow(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) fail('Only the main OSAT window can do that.')
}

// ponytail: the same as the main window today; floating room windows will join it.
function assertAppWindow(event) {
  assertMainWindow(event)
}

function assertTrustedSender(event) {
  const frame = event.senderFrame
  const trustedWindow = BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && event.sender === window.webContents)
  if (
    !trustedWindow || !frame || frame !== frame.top || !frame.url.startsWith(APP_URL)
  ) fail('Untrusted file access request.')
}

/* Offline, what would reach out (the web, other apps, Spotify, downloads, iCloud)
   answers in plain words instead. */
function refuseUnder(channel) {
  const waits = under.on && refusal(channel)
  if (waits) fail(waits)
}

/* from: 'main' (the default), 'app' (any window that shows rooms), 'any', or a function that says
   whether a window's contents may ask (the quick bar answers the desk and its own panel). */
function handle(channel, operation, { from = 'main' } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event)
    if (typeof from === 'function' && !from(event.sender)) fail('Only the desk and the quick bar can do that.')
    if (from === 'main') assertMainWindow(event)
    if (from === 'app') assertAppWindow(event)
    refuseUnder(channel)
    try {
      return await operation(...args)
    } catch (error) {
      if (error instanceof FileAccessError) throw error
      if (error instanceof TidyError) throw new FileAccessError(error.message)
      if (error.code === 'EPERM' || error.code === 'EACCES') throw new FileAccessError(NOT_ALLOWED)
      console.error(`Local file operation failed (${channel}):`, error)
      throw new FileAccessError('Local file access failed.')
    }
  })
}

/* The Files room and Ask's files (desktop/files.cjs): places, folders Nate added, tidying. */
async function registerFiles() {
  files = await createFiles({ app, BrowserWindow, dialog, nativeImage, shell, mainWindow: () => mainWindow, dataDir, handle, fail, sharedModule, ai: () => ai })
}

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

/* The desk: one see-through window over the real desktop. It fills the screen under
   the cursor each time it comes up, and closing it only puts it away. */
function createWindow() {
  const mac = process.platform === 'darwin'
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    title: 'OSAT',
    ...(mac ? { vibrancy: 'fullscreen-ui', visualEffectState: 'active', roundedCorners: false } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow = window
  mainListening = false
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hideDesk()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!under.on && /^https:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.once('ready-to-show', () => showDesk())
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.loadFile(APP_ENTRY)
}

/* OSAT's own pages wear the Mac's accent colour; it is looked at again each time the desk
   comes up, in case it changed in System Settings. Web pages in the Browser are left alone. */
const accents = new WeakMap()
async function paintAccent(contents) {
  if (process.platform !== 'darwin' || contents.isDestroyed() || !contents.getURL().startsWith('file:')) return
  const css = accentCss(systemPreferences.getAccentColor())
  const before = accents.get(contents)
  if (before?.css === css) return
  accents.set(contents, { css })
  if (before?.key) await contents.removeInsertedCSS(before.key).catch(() => {})
  if (css) accents.set(contents, { css, key: await contents.insertCSS(css).catch(() => null) })
}
app.on('web-contents-created', (_event, contents) => contents.on('did-finish-load', () => {
  accents.delete(contents)
  paintAccent(contents)
}))

function showDesk() {
  if (!mainWindow || mainWindow.isDestroyed()) return createWindow()
  paintAccent(mainWindow.webContents)
  const window = mainWindow
  const mac = process.platform === 'darwin'
  if (window.isMinimized()) window.restore()
  const area = displayAt(screen.getAllDisplays(), screen.getCursorScreenPoint()).workArea
  if (!sameBounds(window.getBounds(), area)) window.setBounds(area)
  // Shown on every Space for a moment, so it comes to the Space you are on instead of
  // taking you back to the one it was last on. skipTransformProcessType: without it each
  // call made Electron activate the Mac's Dock and flip OSAT's Dock icon, so an auto-hiding
  // Dock slid up and down and the desk blinked behind it (Phase 13c).
  if (mac) window.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })
  window.show()
  if (mac) {
    app.focus({ steal: true })
    window.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true })
  }
  window.focus()
  window.webContents.send('desk:shown')
  return undefined
}

/* Put away, and the app you were in has focus again (unless the quick bar is up). */
function hideDesk() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return
  mainWindow.hide()
  if (process.platform === 'darwin' && !launcher?.search.window.isVisible()) app.hide()
}

function toggleDesk() {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  if (deskAction({ visible: Boolean(window?.isVisible()), focused: Boolean(window?.isFocused()) }) === 'hide') hideDesk()
  else showDesk()
}

const focusMain = showDesk

/* Everything in the menu bar goes through the same navigate() the app uses. */
// A command for a window that is closed or still loading waits until it is listening.
let pendingCommand
let mainListening = false
function command(detail) {
  if (mainWindow && !mainWindow.isDestroyed() && mainListening) {
    focusMain()
    send('app:command', detail)
    return
  }
  pendingCommand = detail
  focusMain()
}

function buildMenu() {
  const room = (label, view, accelerator) => ({ label, accelerator, click: () => command({ view }) })
  const template = [
    {
      label: 'OSAT',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => command({ view: 'Settings' }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Sticky', accelerator: 'CmdOrCtrl+Shift+N', click: () => command({ view: 'Capture' }) },
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => command({ view: 'Notes', detail: { action: 'new' } }) },
        { label: 'Show OSAT', accelerator: shortcuts.layer.value || undefined, registerAccelerator: false, click: () => showDesk() },
        { label: 'Quick Bar', accelerator: shortcuts.search.value || undefined, registerAccelerator: false, click: () => launcher?.search.show() },
        { label: 'Ask', accelerator: shortcuts.chat.value || undefined, registerAccelerator: false, click: () => launcher?.search.show({ view: 'chat' }) },
        { type: 'separator' },
        { label: 'New Browser Tab', accelerator: 'CmdOrCtrl+T', click: () => command({ view: 'Browser', action: 'new-tab' }) },
        ...(terminals?.available ? [{ label: 'New Terminal', accelerator: 'CmdOrCtrl+Shift+T', click: () => command({ view: 'Terminal', action: 'new-terminal' }) }] : []),
        { type: 'separator' },
        { label: 'Search Everything', accelerator: 'CmdOrCtrl+K', click: () => command({ action: 'search' }) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        // The same spaces and tools as the dock (src/lib/spaces.js).
        room('Desk', 'Today', 'CmdOrCtrl+1'),
        room('Notes', 'Notes', 'CmdOrCtrl+2'),
        room('Sky', 'Mindmap', 'CmdOrCtrl+3'),
        room('Ask', 'Assistant', 'CmdOrCtrl+4'),
        room('Files', 'Files', 'CmdOrCtrl+5'),
        { type: 'separator' },
        room('Journal', 'Journal'),
        room('Calendar', 'Calendar'),
        room('Habits', 'Habits'),
        room('Money', 'Budget'),
        room('Browser', 'Browser'),
        ...(terminals?.available ? [room('Terminal', 'Terminal')] : []),
        room('Roadmap', 'Roadmap'),
        { type: 'separator' },
        { label: under.on ? 'Go Online' : 'Go Offline', accelerator: 'CmdOrCtrl+Shift+U', click: () => toggleUnder() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  app.dock?.setMenu(Menu.buildFromTemplate([
    { label: 'Show OSAT', click: () => showDesk() },
    { label: 'Quick Bar', click: () => launcher?.search.show() },
    { label: 'Ask', click: () => launcher?.search.show({ view: 'chat' }) },
    { label: 'New Browser Tab', click: () => command({ view: 'Browser', action: 'new-tab' }) },
  ]))
}

/* Browser and terminal calls pass their own messages back to the room.
   Each window gets its own browser tabs. */
function handleApp(channel, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event)
    assertAppWindow(event)
    refuseUnder(channel)
    try {
      return await operation(event.sender, ...args)
    } catch (error) {
      fail(error?.message || 'That did not work.')
    }
  })
}

function onTrusted(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertTrustedSender(event)
      assertAppWindow(event)
      listener(event.sender, ...args)
    } catch {
      // Ignore requests from anything but an OSAT window.
    }
  })
}

function browserFor(sender) {
  let browser = browsers.get(sender.id)
  if (browser) return browser
  const window = BrowserWindow.fromWebContents(sender)
  browser = createBrowser({ window, emit: (channel, ...args) => { if (!sender.isDestroyed()) sender.send(channel, ...args) } })
  browsers.set(sender.id, browser)
  window.once('closed', () => { browser.destroy(); browsers.delete(sender.id) })
  return browser
}


/* Skills: recording and replaying in the same window's browser (desktop/skills.cjs). */
const skillStore = createSkills({ dataDir: app.getPath('userData'), sharedModule, fail })
const skillControllers = new Map()
function skillsFor(sender) {
  let controller = skillControllers.get(sender.id)
  if (controller) return controller
  controller = skillStore.controller({ browser: browserFor(sender), emit: (channel, ...args) => { if (!sender.isDestroyed()) sender.send(channel, ...args) } })
  skillControllers.set(sender.id, controller)
  BrowserWindow.fromWebContents(sender).once('closed', () => { controller.destroy(); skillControllers.delete(sender.id) })
  return controller
}

function registerBrowserAndTerminal() {
  // Settings → Data and About.
  handleApp('app:about', () => ({ version: app.getVersion(), dataFolder: app.getPath('userData') }))
  // Settings → About: look for a newer build on GitHub, then fetch it and swap the app (desktop/updater.cjs).
  const updater = createUpdater({ app, dataDir: app.getPath('userData'), quit: () => app.quit() })
  handleApp('update:check', () => updater.check())
  handleApp('update:install', (sender) => updater.install((progress) => { if (!sender.isDestroyed()) sender.send('update:progress', progress) }))
  handleApp('app:show-data-folder', async () => {
    if (await shell.openPath(app.getPath('userData'))) fail('Finder could not open the data folder.')
    return true
  })
  handleApp('browser:state', (sender) => browserFor(sender).state())
  handleApp('browser:open', (sender, url) => browserFor(sender).open(url))
  handleApp('browser:navigate', (sender, url) => browserFor(sender).navigate(url))
  handleApp('browser:activate', (sender, id) => browserFor(sender).activate(id))
  handleApp('browser:close', (sender, id) => browserFor(sender).close(id))
  handleApp('browser:back', (sender) => browserFor(sender).back())
  handleApp('browser:forward', (sender) => browserFor(sender).forward())
  handleApp('browser:reload', (sender) => browserFor(sender).reload())
  handleApp('browser:stop', (sender) => browserFor(sender).stop())
  handleApp('browser:clip', (sender) => browserFor(sender).clip())
  onTrusted('browser:place', (sender, rect) => browserFor(sender).place(rect))
  handleApp('skills:list', () => skillStore.list())
  handleApp('skills:state', (sender) => skillsFor(sender).state())
  handleApp('skills:record-start', (sender) => skillsFor(sender).recordStart())
  handleApp('skills:record-stop', (sender, name) => skillsFor(sender).recordStop(name))
  handleApp('skills:record-cancel', (sender) => skillsFor(sender).recordCancel())
  handleApp('skills:run', (sender, id, from) => skillsFor(sender).run(String(id), from))
  handleApp('skills:stop', (sender) => skillsFor(sender).stop())
  handleApp('skills:clear', (sender) => skillsFor(sender).clear())
  handleApp('skills:remove', (_sender, id) => skillStore.remove(String(id)))
  handleApp('skills:put', (_sender, skill) => skillStore.put(skill))

  terminals = process.mas ? { available: false, destroy() {} } : createTerminals({ emit: send })
  handleApp('terminal:available', () => terminals.available)
  handleApp('terminal:list', () => terminals.list())
  handleApp('terminal:start', (_sender, size) => terminals.start(size))
  handleApp('terminal:attach', (_sender, id) => terminals.attach(id))
  handleApp('terminal:close', (_sender, id) => terminals.close(id))
  onTrusted('terminal:write', (_sender, id, data) => terminals.write?.(id, data))
  onTrusted('terminal:resize', (_sender, id, cols, rows) => terminals.resize?.(id, cols, rows))
}

/* ---- The workspace store --------------------------------------------- */

// shared/ is unpacked from the app archive so Node can load it as a plain ES module.
function sharedModule(name) {
  const file = path.join(__dirname, '..', 'shared', name).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  return import(pathToFileURL(file).href)
}

function storeClient(sender) {
  let id = storeClients.get(sender.id)
  if (id) return id
  id = store.connect((message) => { if (!sender.isDestroyed()) sender.send('store:changed', message) })
  storeClients.set(sender.id, id)
  sender.once('destroyed', () => {
    store.disconnect(id)
    storeClients.delete(sender.id)
  })
  return id
}

function registerStore() {
  ipcMain.handle('store:load', (event) => {
    assertTrustedSender(event)
    storeClient(event.sender)
    return store.load()
  })
  ipcMain.handle('store:commit', (event, ops) => {
    assertTrustedSender(event)
    return store.commit(storeClient(event.sender), ops)
  })
  // Only used as a window closes, so its last keystrokes are never lost.
  ipcMain.on('store:commit-sync', (event, ops) => {
    try {
      assertTrustedSender(event)
      event.returnValue = store.commit(storeClient(event.sender), ops)
    } catch (error) {
      event.returnValue = { error: error.message }
    }
  })
  ipcMain.handle('store:replace', (event, doc) => {
    assertTrustedSender(event)
    return store.replace(doc)
  })
  store.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && storeClients.has(window.webContents.id)) window.webContents.send('store:status', status)
    }
  })
}

/* ---- The desk (⌥Space), its hotkey, launchers and the menu-bar icon ---- */

function prefsFile() {
  return path.join(app.getPath('userData'), 'prefs.json')
}

async function loadPrefs() {
  try {
    const saved = JSON.parse(await fs.readFile(prefsFile(), 'utf8'))
    prefs = {
      hotkey: validHotkey(saved.hotkey) ? saved.hotkey : DEFAULT_HOTKEY,
      chatHotkey: validHotkey(saved.chatHotkey) ? saved.chatHotkey : CHAT_HOTKEY,
      searchHotkey: validHotkey(saved.searchHotkey) ? saved.searchHotkey : DEFAULT_SEARCH_HOTKEY,
      // Where the quick bar was dragged to (its top middle); the old quick chat's chatBounds is left behind.
      barSpot: Number.isFinite(saved.barSpot?.x) && Number.isFinite(saved.barSpot?.y) ? { x: saved.barSpot.x, y: saved.barSpot.y } : null,
      launchers: Array.isArray(saved.launchers) ? saved.launchers.reduce((list, item) => addLauncher(list, item?.path), []) : [],
      places: Object.entries(saved.places || {}).reduce((places, [id, spot]) => placeItem(places, id, spot), {}),
      widgets: pickWidgets(saved.widgets),
      ai: { tier: typeof saved.ai?.tier === 'string' ? saved.ai.tier : null, startup: saved.ai?.startup === true,
        downloadQueue: Array.isArray(saved.ai?.downloadQueue) ? saved.ai.downloadQueue : [] },
      welcomed: saved.welcomed === true,
      toured: saved.toured === true,
      phone: saved.phone === true,
      under: saved.under === true,
    }
  } catch {
    // No preferences yet: the defaults stand.
  }
}

/* Saves take turns and always write the newest preferences: two saves at once (the
   welcome saves the AI size and "welcomed" together) must never collide. */
let prefsSaving = Promise.resolve()
function savePrefs() {
  prefsSaving = prefsSaving.catch(() => {}).then(async () => {
    const temporary = `${prefsFile()}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(prefs, null, 2))
      await fs.rename(temporary, prefsFile())
    } finally {
      await fs.rm(temporary, { force: true })
    }
  })
  return prefsSaving
}

/* Registers a new shortcut ('layer' or 'chat'), or keeps the old one when the new one is taken. */
function useHotkey(which, value) {
  const shortcut = shortcuts[which]
  if (!validHotkey(value)) return false
  if (value === shortcut.value) return true
  if (shortcut.value) globalShortcut.unregister(shortcut.value)
  // A panel shown while the keys are still going down can lose focus a moment later,
  // and then typing goes nowhere; 60 ms later it keeps it.
  const run = () => setTimeout(shortcut.run, 60)
  const ok = globalShortcut.register(value, run)
  if (!ok && shortcut.value) globalShortcut.register(shortcut.value, run)
  if (ok) shortcut.value = value
  shortcut.failed = !shortcut.value
  buildMenu()
  updateTray()
  return ok
}

const shortcutInfo = (which) => {
  const shortcut = shortcuts[which]
  return { hotkey: shortcut.value, label: hotkeyLabel(shortcut.value || prefs[HOTKEY_PREF[which]]), failed: shortcut.failed }
}

/* A macOS panel swallows Esc before the page sees it, so while the quick bar or the ring
   has focus, OSAT takes Esc itself and hands it to them. */
function routeEscape() {
  launcher?.escape()
}
function claimEscape() {
  if (process.platform === 'darwin' && !globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', routeEscape)
}
function releaseEscape() {
  if (!launcher?.focused()) globalShortcut.unregister('Escape')
}

const launcherIcons = new Map()
async function launcherList() {
  return Promise.all(prefs.launchers.map(async (item) => {
    // getFileIcon's large size crashes Electron 43 on the Mac; Quick Look gives the same icon.
    if (!launcherIcons.has(item.path)) launcherIcons.set(item.path, await files.thumbnail(item.path, 128).catch(() => null) || '')
    return { ...item, icon: launcherIcons.get(item.path) }
  }))
}

function registerDesk() {
  const fromDesk = (event) => {
    assertTrustedSender(event)
    assertMainWindow(event)
  }
  ipcMain.on('desk:hide', (event) => { try { fromDesk(event); hideDesk() } catch { /* ignored */ } })
  // Blur set to zero in Appearance: no frosting, the desktop shows through clear.
  ipcMain.on('desk:clear', (event, clear) => {
    try { fromDesk(event) } catch { return }
    if (process.platform === 'darwin') mainWindow.setVibrancy(clear === true ? null : 'fullscreen-ui')
  })
  // The shortcuts, read on the desk and changed in Settings.
  handle('desk:prefs', async () => ({ ...shortcutInfo('layer'), chat: shortcutInfo('chat'), search: shortcutInfo('search'), launchers: await launcherList(), places: prefs.places, widgets: prefs.widgets ?? null }), { from: 'app' })
  handle('desk:set-hotkey', async (value, which = 'layer') => {
    if (!shortcuts[which]) fail('That isn’t one of OSAT’s shortcuts.')
    if (!validHotkey(value)) fail('Use one or more of ⌘ ⌃ ⌥ ⇧ with one key.')
    const clash = Object.entries(shortcuts).find(([id, other]) => id !== which && other.value === value)
    if (clash) fail(`${hotkeyLabel(value)} already opens ${HOTKEY_OPENS[clash[0]]}.`)
    if (launcher?.taken(value)) fail(`${hotkeyLabel(value)} is one of the launcher’s keys (Settings → Launcher).`)
    if (!useHotkey(which, value)) fail(`${hotkeyLabel(value)} is taken by another app. Try a different one.`)
    prefs = { ...prefs, [HOTKEY_PREF[which]]: value }
    await savePrefs()
    return shortcutInfo(which)
  }, { from: 'app' })
  handle('desk:add-launcher', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add an app to the dock',
      defaultPath: '/Applications',
      properties: ['openFile'],
      filters: [{ name: 'Applications', extensions: ['app'] }],
    })
    if (!result.canceled && result.filePaths[0]) {
      prefs = { ...prefs, launchers: addLauncher(prefs.launchers, result.filePaths[0]) }
      await savePrefs()
    }
    return launcherList()
  })
  handle('desk:remove-launcher', async (appPath) => {
    prefs = { ...prefs, launchers: prefs.launchers.filter((item) => item.path !== appPath) }
    await savePrefs()
    return launcherList()
  })
  // Widgets and icons Nate moved on the desk. null puts one back; tidy puts all back.
  handle('desk:place', async (id, spot) => {
    prefs = { ...prefs, places: placeItem(prefs.places, id, spot) }
    await savePrefs()
    return prefs.places
  })
  // Widgets and icons go back where they were; stickies stay where they lie.
  handle('desk:tidy', async () => {
    prefs = { ...prefs, places: Object.fromEntries(Object.entries(prefs.places).filter(([key]) => key.startsWith('note:'))) }
    await savePrefs()
    return prefs.places
  })
  // Which widgets are out, in order (per Mac, like places). null brings back the defaults.
  handle('desk:widgets', async (list) => {
    prefs = { ...prefs, widgets: pickWidgets(list) }
    await savePrefs()
    return prefs.widgets
  })
  const media = createMedia()
  handle('media:now', () => (process.platform === 'darwin' ? media.nowPlaying() : null))
  handle('media:control', (action) => media.control(action))
  handle('media:seek', (seconds) => media.seek(seconds))
  // Only apps Nate added can be opened this way.
  handle('desk:launch', async (appPath) => {
    if (!prefs.launchers.some((item) => item.path === appPath)) fail('That app is not in the dock.')
    if (await shell.openPath(appPath)) fail('macOS could not open that app.')
    return true
  })
}

/* ---- The launcher (⌘⇧Space): the quick bar, the clipboard history, Hyper keys (desktop/launcher) ---- */

/* Putting the desk away hides OSAT (app.hide), and a hidden app's panels never appear: the quick bar, Ask, the
   clipboard and the ring then only worked once OSAT was opened. A panel unhides OSAT first, and when the last one
   goes OSAT hides again, so focus (and Paste, and a window layout) goes back to the app you were in. */
let unhidForPanel = false
function unhideForPanel() {
  if (process.platform !== 'darwin' || !app.isHidden()) return
  unhidForPanel = true
  app.show()
}
function hideAfterPanel() {
  if (!unhidForPanel || launcher?.visible() || mainWindow?.isVisible()) return
  unhidForPanel = false
  app.hide()
}

let barSaveTimer
async function registerLauncher() {
  launcher = await createLauncher({
    app,
    BrowserWindow,
    screen,
    clipboard: require('electron').clipboard,
    nativeImage,
    shell,
    systemPreferences,
    globalShortcut,
    dataDir: app.getPath('userData'),
    preload: path.join(__dirname, 'preload.cjs'),
    load: (window, surface = 'search') => {
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== window.webContents.getURL()) event.preventDefault()
      })
      window.loadFile(APP_ENTRY, { query: { surface } })
    },
    // What the ring does that only main can.
    ringActions: {
      desk: () => showDesk(),
      sky: () => command({ view: 'Mindmap' }),
      files: () => command({ view: 'Files' }),
    },
    // Hyper + middle-click over other apps: the launcher starts a small helper with this.
    spawnHelper: require('node:child_process').spawn,
    barSpot: prefs.barSpot,
    onBarMoved: (spot) => {
      prefs = { ...prefs, barSpot: spot }
      clearTimeout(barSaveTimer)
      barSaveTimer = setTimeout(() => savePrefs().catch(() => {}), 800)
    },
    files,
    handle,
    fail,
    sharedModule,
    mainWindow: () => mainWindow,
    command,
    sendToAllWindows,
    offline: () => under.on,
    // The panel goes when you click away, on the Mac (the tests drive it without a real focus).
    hideOnBlur: process.platform === 'darwin' && (app.isPackaged || !process.env.OSAT_DATA_DIR),
    isTaken: (accelerator) => Object.values(shortcuts).some((shortcut) => shortcut.value === accelerator),
    notify: (options) => { if (Notification.isSupported()) new Notification(options).show() },
    onShow: unhideForPanel,
    onHide: () => { releaseEscape(); hideAfterPanel() },
  })
  launcher.onFocus(claimEscape, releaseEscape)
}

/* ---- Ask (⌥⇧Space): the quick bar, opened on Ask ---- */

function registerAsk() {
  // Pop a chat out of the desk or Ask: { chatId } or { prompt }, or nothing for the last one. It opens in the quick bar.
  handle('chat:show', (detail) => {
    launcher.search.show({ view: 'chat', chat: detail && typeof detail === 'object' ? { chatId: typeof detail.chatId === 'string' ? detail.chatId : undefined, prompt: typeof detail.prompt === 'string' ? detail.prompt.slice(0, 8000) : undefined } : null })
    return true
  }, { from: 'app' })
}

function aiLine() {
  const status = ai?.status()
  if (!status) return 'Local AI'
  const download = status.download
  if (download?.state === 'running') return `Setting up the AI · ${Math.floor((download.received / download.total) * 100)}%`
  if (download?.state === 'failed') return 'AI download stopped · see Settings'
  const tier = status.tiers.find((item) => item.id === status.chosen)
  const loaded = status.tiers.filter((item) => item.state === 'ready').map((item) => item.label)
  if (loaded.length) return 'Local AI · ' + loaded.join(', ') + ' ready'
  if (tier?.ready) return 'Local AI · ' + tier.label + ' · unloaded'
  return 'Local AI: not set up yet'
}

const trayIcons = {}
function trayIcon(name) {
  if (!trayIcons[name]) {
    trayIcons[name] = nativeImage.createFromPath(path.join(__dirname, 'assets', `${name}.png`))
    trayIcons[name].setTemplateImage(true)
  }
  return trayIcons[name]
}

/* The menu-bar icon is a moon while offline, so the state shows with the desk away. */
function updateTray() {
  if (!tray || tray.isDestroyed()) return
  trayAiLine = aiLine()
  tray.setImage(trayIcon(under.on ? 'trayUnderTemplate' : 'trayTemplate'))
  tray.setToolTip(under.on ? 'OSAT · Offline' : 'OSAT')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show OSAT', accelerator: shortcuts.layer.value || undefined, registerAccelerator: false, click: () => showDesk() },
    { label: 'Quick Bar', accelerator: shortcuts.search.value || undefined, registerAccelerator: false, click: () => launcher?.search.show() },
    { label: 'Ask', accelerator: shortcuts.chat.value || undefined, registerAccelerator: false, click: () => launcher?.search.show({ view: 'chat' }) },
    { label: 'Offline', type: 'checkbox', checked: under.on, accelerator: 'CmdOrCtrl+Shift+U', registerAccelerator: false, click: () => toggleUnder() },
    { type: 'separator' },
    { label: trayAiLine, click: () => command({ view: 'Settings', detail: { section: 'ai' } }) },
    { label: 'Free AI memory', enabled: Boolean(ai?.status().tiers.some((tier) => tier.state === 'ready')),
      click: async () => {
        try {
          const result = await ai.unloadAll()
          if (!result.cancelled && result.busyModels.length) await dialog.showMessageBox(mainWindow, {
            type: 'info', title: 'AI memory', message: 'Some models are still working',
            detail: result.busyModels.map((id) => tierById(id).label).join(', ') + ' stays loaded until its work finishes.' + (result.unloaded.length ? '\n\nIdle models were unloaded.' : ''),
          })
        } catch (error) { dialog.showErrorBox('AI memory', error.message) }
      } },
    { label: shortcuts.layer.failed ? 'Shortcut not set · choose one…' : 'Change shortcuts…', click: () => command({ view: 'Settings', detail: { section: 'general' } }) },
    ...(app.isPackaged ? [{
      label: 'Open at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    }] : []),
    { type: 'separator' },
    { label: 'Quit OSAT', role: 'quit' },
  ]))
}

function createTray() {
  tray = new Tray(trayIcon('trayTemplate'))
  updateTray()
}

/* ---- The local AI: the built-in model, or LM Studio when that is running ---- */

function sendToAllWindows(channel, ...args) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args)
  }
}

function registerAi() {
  const mockAi = !app.isPackaged && process.env.OSAT_AI === 'mock'
  const forkAi = () => utilityProcess.fork(path.join(__dirname, 'ai', 'runtime.cjs'), [], { serviceName: 'OSAT AI' })
  const memory = (bytes) => (bytes / 1024 ** 3).toFixed(1) + ' GiB'
  const confirmLoad = async (info) => {
    if (mockAi) return info.keepOthers ? 'alongside' : 'replace'
    const others = info.others.map((item) => item.label).join(', ')
    const detail = [
      memory(info.totalMemory) + ' system memory · about ' + memory(info.freeMemory) + ' currently free.',
      info.estimatedMemory ? 'Estimated memory for ' + info.label + ': ' + memory(info.estimatedMemory) + ', including conversation context.' : 'A memory estimate is unavailable for this model.',
      info.combinedMemory && info.others.length ? 'Estimated AI memory with all these models kept loaded: ' + memory(info.combinedMemory) + '.' : '',
      info.others.length ? others + ' is already loaded. Switching and unloading releases idle, unretained models. Switching back will need to load them again.' : '',
      info.low ? 'This may leave little room for macOS and your other apps, causing slowdown or swap use. A smaller model is recommended.' : '',
      !info.low && info.lowKeeping && info.others.length ? 'Keeping these models loaded together may leave little room for macOS and your other apps, causing slowdown or swap use.' : '',
      info.others.some((item) => item.retained) ? 'Models marked Keep loaded stay until you unload them or quit OSAT.' : '',
      'These are estimates. OSAT keeps the engine’s allocation safeguards.',
    ].filter(Boolean).join('\n\n')
    const canReplace = !info.others.some((item) => !item.retained && item.busy)
    const keepLabel = info.others.length > 1 ? 'Keep all loaded' : 'Keep both'
    const buttons = ['Cancel', ...(canReplace ? [info.others.length ? 'Switch and unload' : 'Load model'] : []), ...(info.others.length ? [keepLabel] : [])]
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: 'AI memory', message: 'Load ' + info.label + '?', detail,
      buttons, defaultId: 0, cancelId: 0, noLink: true,
    })
    const picked = buttons[result.response]
    return picked === keepLabel ? 'alongside' : ['Load model', 'Switch and unload'].includes(picked) ? 'replace' : 'cancel'
  }
  const confirmUnload = async (ids) => {
    if (mockAi) return true
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: 'Free AI memory', message: 'Unload ' + ids.map((id) => tierById(id).label).join(', ') + '?',
      detail: 'This releases their working memory. The downloaded files and your conversations stay on this Mac. Larger models can take a while to load again.',
      buttons: ['Cancel', 'Unload'], defaultId: 0, cancelId: 0, noLink: true,
    })
    return result.response === 1
  }
  const saveAiPrefs = async (change) => {
    const previous = prefs.ai
    const next = { ...previous, ...change }
    prefs = { ...prefs, ai: next }
    try { await savePrefs() } catch (error) {
      if (prefs.ai === next) prefs = { ...prefs, ai: previous }
      throw error
    }
  }
  ai = createAi({
    dir: path.join(app.getPath('userData'), 'models'),
    totalMemory: os.totalmem(),
    chosen: prefs.ai.tier,
    save: (tier) => saveAiPrefs({ tier }),
    startup: prefs.ai.startup,
    saveStartup: (startup) => saveAiPrefs({ startup }),
    downloadQueue: prefs.ai.downloadQueue,
    saveQueue: (downloadQueue) => saveAiPrefs({ downloadQueue }),
    fork: forkAi,
    estimate: (modelPath) => estimateResources(forkAi, modelPath),
    confirmLoad, confirmUnload,
    emit: (status) => {
      sendToAllWindows('ai:status', status)
      if (aiLine() !== trayAiLine) updateTray()
    },
    // Tests and CI answer with a practice model instead of downloading one.
    mock: mockAi,
  })
  // Local startup loading works offline too. Only downloads wait for online.
  ai.start({ downloads: !under.on })
  if (under.on) aiWaiting = 'resume'
  // AI messages are written for Nate, so they pass through as they are.
  const plain = (fn) => async (...args) => {
    try { return await fn(...args) } catch (error) { throw new FileAccessError(error.message) }
  }
  handle('ai:status', () => ai.status(), { from: 'any' })
  handle('ai:select', plain((tier) => ai.select(tier)), { from: 'app' })
  handle('ai:install', plain((tiers) => ai.install(tiers)), { from: 'app' })
  handle('ai:load', plain((tier) => ai.load(tier, { interactive: true })), { from: 'app' })
  handle('ai:unload', plain((tier) => ai.unload(tier)), { from: 'app' })
  handle('ai:free-memory', plain(() => ai.unloadAll()), { from: (sender) => sender === mainWindow?.webContents || sender === launcher?.search.window.webContents })
  handle('ai:retain', plain((tier, value) => ai.setRetained(tier, value)), { from: 'app' })
  handle('ai:startup', plain((value) => ai.setStartup(value)), { from: 'app' })
  handle('ai:choose', plain((tier) => {
    // Offline, only a size already on this Mac can be chosen.
    if (under.on && !ai.status().tiers.some((item) => item.id === tier && item.ready)) throw new Error('Downloads wait until you’re back online.')
    return ai.choose(tier)
  }), { from: 'app' })
  handle('ai:cancel', () => { ai.cancel(); return ai.status() }, { from: 'app' })
  handle('ai:resume', () => { ai.resume(); return ai.status() }, { from: 'app' })
  handle('ai:remove', plain((tier) => ai.remove(tier)), { from: 'app' })
  handle('app:welcome', () => !prefs.welcomed, { from: 'main' })
  handle('app:welcomed', async () => { prefs = { ...prefs, welcomed: true }; await savePrefs(); return true }, { from: 'main' })
  // The first-run tour (Phase 27) shows once per Mac, after the welcome; Take the tour in ⌘K brings it back.
  handle('app:tour', () => !prefs.toured, { from: 'main' })
  handle('app:toured', async () => { prefs = { ...prefs, toured: true }; await savePrefs(); return true }, { from: 'main' })

  handle('local-ai:models', () => answeringModels(), { from: 'any' })
  const streams = new Map()
  ipcMain.on('local-ai:cancel', (event, id) => {
    assertTrustedSender(event)
    if (typeof id === 'string') streams.get(event.sender.id + ':' + id)?.abort()
  })
  ipcMain.handle('local-ai:chat-stream', async (event, id, payload) => {
    assertTrustedSender(event)
    if (typeof id !== 'string' || !/^stream-\d+$/.test(id)) throw new FileAccessError('Bad stream id.')
    const valid = validateLocalChatPayload(payload)
    const controller = new AbortController()
    const key = event.sender.id + ':' + id
    streams.set(key, controller)
    const onDelta = (delta) => { if (!event.sender.isDestroyed()) event.sender.send(`local-ai:delta:${id}`, delta) }
    try {
      return await chatWith(valid, onDelta, controller.signal)
    } catch (error) {
      if (error?.name === 'AbortError') return ''
      throw new FileAccessError(error.message || 'Local AI is unavailable.')
    } finally {
      streams.delete(key)
    }
  })
}

/* Ask lists the model chosen in Settings → Bots first (a cloud model, while online), then
   the built-in model, then whatever LM Studio has loaded. The line asks the first. */
async function answeringModels() {
  const own = [...(bots?.models() || []), ...ai.models()]
  try {
    return { models: [...own, ...await localAiModels()] }
  } catch {
    return { models: own, ...(own.length ? {} : { error: 'Set up the AI in Settings → AI, or start LM Studio.' }) }
  }
}

function chatWith(valid, onDelta, signal) {
  if (valid.model.startsWith('cloud:')) return bots.chatStream(valid, onDelta, signal)
  return valid.model.startsWith('osat:') ? ai.chatStream(valid, onDelta, signal, { interactive: !valid.background }) : localAiChatStream(valid, onDelta, signal)
}

/* ---- Your iPhone, through an OSAT folder in iCloud Drive (off until turned on) ---- */

// Tests (from source) pass OSAT_ICLOUD_DIR so they never touch the real iCloud Drive.
const ICLOUD_DRIVE = (!app.isPackaged && process.env.OSAT_ICLOUD_DIR) || path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
// The iPhone app's own iCloud folder (Files shows it as "OSAT" too). Once it exists the
// Mac moves its OSAT folder in there (phone-root.cjs), so both share one folder.
const APP_CONTAINER = !app.isPackaged && process.env.OSAT_ICLOUD_DIR
  ? process.env.OSAT_ICLOUD_APP_DIR || null
  : path.join(os.homedir(), 'Library', 'Mobile Documents', 'iCloud~ai~mccreery~osat', 'Documents')
let phoneRoot = path.join(ICLOUD_DRIVE, 'OSAT')
let phone = null
let macSync = null
let phoneClient = null
let phoneWatch = null
let phoneMirrorTimer = null

// Never touches iCloud Drive: macOS asks before an app looks there, and that
// should only happen when Nate turns the link on.
function phoneStatus() {
  const base = { enabled: prefs.phone, root: phoneRoot, sync: macSync?.status() || null }
  return phone ? { ...base, ...phone.status(), enabled: prefs.phone } : base
}

// Both do nothing while the link is off, or paused while offline.
const phoneLive = () => prefs.phone && !under.on
const mirrorSoon = () => {
  clearTimeout(phoneMirrorTimer)
  if (phoneLive()) phoneMirrorTimer = setTimeout(() => { if (phoneLive()) phone?.mirror() }, 2000)
}

async function bridgePhone() {
  const { normalizeNote } = await sharedModule('note-core.mjs')
  return createPhoneBridge({
    root: phoneRoot,
    // A thought from the iPhone is one Unsorted note, made the same way the windows make one.
    capture: (text) => {
      const now = new Date().toISOString()
      const title = text.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'A sticky'
      const note = normalizeNote({ id: `note-${randomUUID()}`, title, markdown: text, createdAt: now, updatedAt: now, unsorted: true, source: 'iPhone' })
      store.commit(phoneClient, [{ t: 'add', c: 'notes', v: note, at: 0 }])
      mirrorSoon()
    },
    snapshot: () => {
      const { doc } = store.load()
      return { notes: doc.notes || [], folders: doc.folders || [] }
    },
    onStatus: () => sendToAllWindows('phone:status', phoneStatus()),
  })
}

/* Sync, once set up on this Mac, notes every change even while the link is off. */
async function ensureSync() {
  if (!macSync) {
    const { createSyncEngine } = await sharedModule('sync-engine.mjs')
    macSync = createMacSync({
      root: () => phoneRoot,
      store,
      createSyncEngine,
      statePath: path.join(app.getPath('userData'), 'store', 'sync.json'),
      onStatus: () => sendToAllWindows('phone:status', phoneStatus()),
    })
  }
  await macSync.load()
  return macSync
}

async function startPhone() {
  // Asked after every wait: gone offline (or off) meanwhile, it stops before touching iCloud again.
  const waits = () => {
    if (phoneLive()) return false
    stopPhone()
    return true
  }
  const root = await settleRoot({ drive: ICLOUD_DRIVE, container: APP_CONTAINER })
  if (!phone || root !== phoneRoot) {
    phoneRoot = root
    phone = await bridgePhone()
  }
  if (waits()) return
  await phone.prepare()
  if (waits()) return
  // The same switch keeps this Mac in step with your other devices (OSAT/Sync).
  await (await ensureSync()).start()
  if (waits()) return
  phoneClient ??= store.connect(mirrorSoon)
  phoneWatch = watchFolder({ dir: path.join(phoneRoot, 'Inbox'), look: () => phone?.scan(), live: phoneLive })
  await phone.scan()
  if (waits()) return
  await phone.mirror()
}

function stopPhone() {
  macSync?.pause()
  phoneWatch?.stop()
  clearTimeout(phoneMirrorTimer)
  phoneWatch = null
}

async function registerPhone() {
  handle('phone:status', () => phoneStatus(), { from: 'app' })
  handle('phone:enable', async () => {
    if (!require('node:fs').existsSync(ICLOUD_DRIVE)) fail('iCloud Drive is off on this Mac. Turn it on in System Settings → Apple Account → iCloud, then try again.')
    try {
      prefs = { ...prefs, phone: true }
      await savePrefs()
      stopPhone()
      await startPhone()
    } catch (error) {
      prefs = { ...prefs, phone: false }
      await savePrefs()
      stopPhone()
      fail(error.code === 'EPERM' || error.code === 'EACCES'
        ? 'OSAT isn’t allowed into iCloud Drive yet. Allow it in System Settings → Privacy & Security → Files and Folders, then try again.'
        : `OSAT couldn’t make its folder in iCloud Drive (${error.code || error.message}).`)
    }
    return phoneStatus()
  })
  // Off means OSAT stops, and the copy of the notes leaves iCloud Drive. The Inbox stays.
  handle('phone:disable', async () => {
    stopPhone()
    prefs = { ...prefs, phone: false }
    await savePrefs()
    phone ??= await bridgePhone()
    await phone.removeCopies().catch(() => {})
    return phoneStatus()
  })
  handle('phone:show', async () => {
    if (await shell.openPath(phoneRoot)) fail('Finder could not open the OSAT folder in iCloud Drive.')
    return true
  })
  // Before any window opens, so no change goes unnoted; iCloud itself can take its time.
  await ensureSync().catch((error) => console.error('Sync could not load:', error))
  if (phoneLive()) startPhone().catch((error) => console.error('The iPhone link could not start:', error))
}

/* ---- Bots: what Muse, Grok Bot and Claude send OSAT (desktop/bots, Settings → Bots) ---- */

let bots = null

async function registerBots() {
  // ~/Documents/OSAT Nodes. From source it is "OSAT Nodes (Dev)", so development never takes
  // the real app's files; tests pass OSAT_NODES_DIR (from source only).
  const nodesDir = (!app.isPackaged && process.env.OSAT_NODES_DIR) || path.join(app.getPath('documents'), app.isPackaged ? 'OSAT Nodes' : 'OSAT Nodes (Dev)')
  bots = await createBots({
    dataDir: app.getPath('userData'),
    nodesDir,
    version: app.getVersion(),
    // Where keys sit in the Keychain; from source its own, so development never reads the app's.
    service: app.isPackaged ? 'OSAT' : 'OSAT-Dev',
    store,
    sharedModule,
    handle,
    fail,
    send: sendToAllWindows,
    shell,
    // What OSAT puts there (the connector's key, instructions for a bot) never goes into the clipboard history.
    clipboard: launcher.history.quiet(require('electron').clipboard),
    offline: () => under.on,
  })
  bots.start().catch((error) => console.error('Bots could not start:', error))
}

/* ---- Scans: the folder a scanner saves to; each new scan becomes a node (scans.cjs) ---- */

let scans = null
let scansWatcher = null
let scansPoll = null
let scansTimer = null
const scansSoon = () => {
  clearTimeout(scansTimer)
  scansTimer = setTimeout(() => scans?.scan().catch((error) => console.error('Scans:', error)), 1500)
}

// Google Drive for desktop keeps the Brother's folder here; offered first when choosing.
function scansGuess() {
  const cloud = path.join(os.homedir(), 'Library', 'CloudStorage')
  try {
    for (const name of require('node:fs').readdirSync(cloud)) {
      const folder = path.join(cloud, name, 'My Drive', 'From_BrotherDevice')
      if (name.startsWith('GoogleDrive') && require('node:fs').existsSync(folder)) return folder
    }
  } catch {
    // No Google Drive on this Mac: start from home.
  }
  return os.homedir()
}

// A streamed Google Drive folder may never tell fs.watch, so it is looked at every half minute too.
function watchScans() {
  scansWatcher?.close()
  clearInterval(scansPoll)
  scansWatcher = null
  scansPoll = null
  const { dir } = scans.status()
  if (!dir) return
  try {
    scansWatcher = require('node:fs').watch(dir, scansSoon)
  } catch {
    // The poll still finds new scans.
  }
  scansPoll = setInterval(scansSoon, 30000)
  scansSoon()
}

async function registerScans() {
  const { createScans, scanMessages, SCAN_SCHEMA } = require('./scans.cjs')
  scans = createScans({
    seenPath: path.join(app.getPath('userData'), 'scans.json'),
    read: async (file) => (await extractText(file)).text,
    // The built-in AI sorts it, knowing the nodes there are so it can @ them.
    organize: async (text) => {
      const names = (store.load().doc.folders || []).filter((folder) => !folder.parentId).map((folder) => folder.name)
      return JSON.parse(await ai.chatStream({ messages: scanMessages({ text, names }), schema: SCAN_SCHEMA }, () => {}))
    },
    onChange: () => {
      sendToAllWindows('scans:status', scans.status())
      if (scans.status().waiting) sendToAllWindows('scans:ready')
    },
  })
  handle('scans:status', () => scans.status())
  handle('scans:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose the folder your scanner saves to', defaultPath: scansGuess(), properties: ['openDirectory'] })
    if (!result.canceled && result.filePaths[0]) {
      await scans.use(result.filePaths[0])
      watchScans()
    }
    return scans.status()
  })
  handle('scans:stop', async () => {
    await scans.stop()
    watchScans()
    return scans.status()
  })
  handle('scans:show', async () => {
    if (await shell.openPath(scans.status().dir || '')) fail('Finder could not open the scans folder.')
    return true
  })
  handle('scans:take', () => scans.take())
  handle('scans:done', (id) => scans.done(String(id)))
  await scans.load()
  watchScans()
}

/* ---- Offline: OSAT with the internet off (the switch on the line, ⇧⌘U) ---- */

// Each window's browser tabs, closed going offline and opened again back online.
const sleepingTabs = new Map()
// 'resume' (a download was running) or 'start' (OSAT opened offline): what the AI does back online.
let aiWaiting = null
// A cancelled download takes a moment to stop; resuming before then would do nothing.
let aiStopped = Promise.resolve()

function underStatus() {
  // A terminal Nate started keeps running; the page says so. Ended shells don't count.
  return { on: under.on, terminal: Boolean(terminals?.list?.().some((session) => session.alive)) }
}

async function saveUnder(on) {
  prefs = { ...prefs, under: on }
  try {
    await savePrefs()
  } catch (error) {
    prefs = { ...prefs, under: !on }
    throw error
  }
}

// The flag is already on (both locks are closed) when this runs.
async function goingUnder() {
  for (const [id, browser] of browsers) sleepingTabs.set(id, browser.sleep())
  for (const item of downloads) item.cancel()
  if (ai?.status().download?.state === 'running') {
    aiWaiting = 'resume'
    aiStopped = Promise.resolve(ai.cancel())
  }
  // Pausing, never turning the link off: that would take the copy of the notes out of iCloud.
  stopPhone()
}

async function comingUp() {
  for (const [id, pages] of sleepingTabs) browsers.get(id)?.wake(pages)
  sleepingTabs.clear()
  const wake = aiWaiting
  aiWaiting = null
  if (wake) aiStopped.then(() => {
    // Offline again before it stopped: it waits for the next time online.
    if (under.on) aiWaiting ??= wake
    else if (wake === 'resume') ai.resume()
    else ai.start()
  })
  if (phoneLive()) startPhone().catch((error) => console.error('The iPhone link could not start:', error))
}

function underChanged() {
  sendToAllWindows('under:changed', underStatus())
  bots?.changed()
  buildMenu()
  updateTray()
}

// From the Go menu and the menu-bar icon; the page hears it through under:changed,
// and, when it didn't work, why (calm rule 7: there is no other place to say so).
function toggleUnder(on = !under.on) {
  under.set(on).catch((error) => sendToAllWindows('under:changed', { ...underStatus(), error: error.message }))
}

function registerUnder() {
  handle('under:status', () => underStatus(), { from: 'any' })
  // Only the desk asks; main decides, and answers once everything has paused (or woken).
  handle('under:set', async (on) => {
    try {
      await under.set(on === true)
    } catch (error) {
      fail(error.message)
    }
    return underStatus()
  })
}

/* A build can check its own AI engine without opening any notes:
     OSAT.app/Contents/MacOS/OSAT --osat-self-test[=/path/to/model.gguf]
   It prints one line and quits: 0 when the engine (and the model, if given) work. */
function selfTest(modelPath) {
  const child = utilityProcess.fork(path.join(__dirname, 'ai', 'runtime.cjs'), [], { serviceName: 'OSAT AI' })
  let text = ''
  let finished = false
  const finish = (ok, line) => {
    if (finished) return
    finished = true
    console.log(`OSAT self-test: ${line}`)
    child.kill()
    app.exit(ok ? 0 : 1)
  }
  setTimeout(() => finish(false, 'timed out'), 180000).unref()
  child.on('message', (message) => {
    if (message.type === 'probe') {
      if (!modelPath) finish(true, `engine ok (${message.gpu})`)
      else child.postMessage({ type: 'load', modelPath })
    } else if (message.type === 'loaded') {
      child.postMessage({ type: 'chat', id: 'self-test', messages: [{ role: 'user', content: 'Say hello in three words.' }], maxTokens: 24 })
    } else if (message.type === 'delta') {
      text += message.text
    } else if (message.type === 'done') {
      finish(Boolean(text.trim()), `model answered: ${text.trim()}`)
    } else if (message.type === 'error') {
      finish(false, message.message)
    }
  })
  child.on('exit', (code) => finish(false, `engine stopped (${code})`))
  child.postMessage({ type: 'probe' })
}

app.whenReady().then(async () => {
  if (!primaryInstance) return
  if (app.commandLine.hasSwitch('osat-self-test')) {
    selfTest(app.commandLine.getSwitchValue('osat-self-test'))
    return
  }
  try {
    const core = await sharedModule('store-core.mjs')
    store = await createStore({ dir: path.join(app.getPath('userData'), 'store'), core })
  } catch (error) {
    dialog.showErrorBox('OSAT couldn\u2019t open your notes', `${error.message}\n\nNothing was changed. Your notes are in ${app.getPath('userData')}.`)
    app.exit(1)
    return
  }
  registerStore()
  app.on('second-instance', () => focusMain())
  await registerFiles()
  ipcMain.on('app:listening', (event) => {
    if (event.sender !== mainWindow?.webContents) return
    mainListening = true
    if (!pendingCommand) return
    send('app:command', pendingCommand)
    pendingCommand = undefined
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, respond) => respond(false))
  guardSession(session.defaultSession)
  registerBrowserAndTerminal()
  await loadPrefs()
  // Before the AI, the iPhone link or any window starts, so nothing reaches out first.
  under.begin(prefs.under)
  registerUnder()
  registerAi()
  await registerPhone()
  await registerScans()
  await registerLauncher()
  await registerBots()
  createMacCalendar({ handle, fail })
  registerDesk()
  registerAsk()
  createWindow()
  createTray()
  launcher.start().catch((error) => console.error('The launcher could not start:', error))
  // If the desk's shortcut is taken by another app, open Settings so a new one can be picked.
  // The quick bar's are quieter: Settings says so when you look.
  useHotkey('chat', prefs.chatHotkey)
  useHotkey('search', prefs.searchHotkey)
  if (!useHotkey('layer', prefs.hotkey)) command({ view: 'Settings', detail: { section: 'general' } })
  // Clicking the Dock icon brings the desk up.
  app.on('activate', () => showDesk())
})

app.on('before-quit', () => { quitting = true })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // Every window has closed and handed over its last edits; write them now.
  try { store?.flushSync() } catch (error) { console.error('Final save failed:', error) }
  globalShortcut.unregisterAll()
  terminals?.destroy()
  ai?.dispose()
  stopPhone()
  bots?.stop()
  files?.stop()
  launcher?.stop()
})
