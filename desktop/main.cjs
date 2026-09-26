const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen, session, shell, utilityProcess } = require('electron')
const { claimDataFolder } = require('./data-folder.cjs')
const { resolveApprovedPath, resolveApprovedWritePath } = require('./path-guard.cjs')
const { isSafeOpenFilename, isSafeTextPreviewName, readTextFile, writeTextFile } = require('./text-files.cjs')
const { localAiChatStream, localAiModels, validateLocalChatPayload } = require('./local-ai.cjs')
const { createAi } = require('./ai/index.cjs')
const { createPhoneBridge } = require('./phone.cjs')
const { createBrowser } = require('./browser.cjs')
const { createTerminals } = require('./terminal.cjs')
const { createStore } = require('./store/index.cjs')
const { DEFAULT_HOTKEY, addLauncher, createOverlay, hotkeyLabel, placeItem, validHotkey } = require('./overlay.cjs')
const { createMedia } = require('./media.cjs')

const APP_ENTRY = path.join(__dirname, '..', 'dist', 'client', 'index.html')
const APP_URL = pathToFileURL(APP_ENTRY).href
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WRITABLE_EXTENSIONS = new Set(['.canvas', '.markdown', '.md'])

let mainWindow
let overlay
let tray
let prefs = { hotkey: DEFAULT_HOTKEY, launchers: [], places: {}, ai: { tier: null }, welcomed: false, phone: false }
let hotkey = null
let hotkeyFailed = false
let ai
let trayAiLine = ''
let holdOverlay = false
let grants = []
let grantsFile
let mutation = Promise.resolve()
const browsers = new Map()
let terminals
let store
const storeClients = new Map()
const grantAccessStops = new Map()

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

function publicGrant(grant) {
  return {
    id: grant.id,
    kind: grant.kind,
    name: path.basename(grant.root) || (grant.kind === 'folder' ? 'Folder' : 'File'),
  }
}

function getGrant(id) {
  if (typeof id !== 'string' || !UUID.test(id)) fail('Invalid file access grant.')
  const grant = grants.find((item) => item.id === id)
  if (!grant) fail('That file access grant is no longer available.')
  return grant
}

function stopGrantAccess(id) {
  const stop = grantAccessStops.get(id)
  if (!stop) return
  grantAccessStops.delete(id)
  try {
    stop()
  } catch {
    // The operating system already revoked this session's access.
  }
}

function ensureGrantAccess(grant) {
  if (process.platform !== 'darwin' || !process.mas || grantAccessStops.has(grant.id)) return
  if (!grant.bookmark) fail('Choose this location again to restore access.')
  try {
    grantAccessStops.set(grant.id, app.startAccessingSecurityScopedResource(grant.bookmark))
  } catch {
    fail('Choose this location again to restore access.')
  }
}

/* Files answer only the main OSAT window; the browser and the terminal also answer the layer. */
function assertMainWindow(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) fail('Only the main OSAT window can do that.')
}

function assertAppWindow(event) {
  if (overlay && event.sender === overlay.window.webContents) return
  assertMainWindow(event)
}

function assertTrustedSender(event) {
  const frame = event.senderFrame
  const trustedWindow = BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && event.sender === window.webContents)
  if (
    !trustedWindow || !frame || frame !== frame.top || !frame.url.startsWith(APP_URL)
  ) fail('Untrusted file access request.')
}

async function approvedPath(grant, relative = '') {
  if (grant.kind === 'file' && relative !== '') fail('A selected file has no child items.')
  ensureGrantAccess(grant)
  try {
    return await resolveApprovedPath(grant.root, relative)
  } catch (error) {
    if (error.message === 'INVALID_RELATIVE_PATH' || error.message === 'PATH_OUTSIDE_ROOT') {
      fail('Invalid relative file path.')
    }
    if (error.code === 'ENOENT') fail('That file or folder is no longer available.')
    fail('That approved location can no longer be accessed safely.')
  }
}

async function approvedWritePath(grant, relative) {
  if (grant.kind !== 'folder') fail('Writing requires an approved folder.')
  ensureGrantAccess(grant)
  try {
    return await resolveApprovedWritePath(grant.root, relative)
  } catch (error) {
    if (error.message === 'INVALID_RELATIVE_PATH' || error.message === 'PATH_OUTSIDE_ROOT') {
      fail('Invalid relative file path.')
    }
    if (error.code === 'ENOENT') fail('The destination folder is no longer available.')
    fail('That approved location can no longer be accessed safely.')
  }
}

async function loadGrants() {
  try {
    const parsed = JSON.parse(await fs.readFile(grantsFile, 'utf8'))
    const seen = new Set()
    grants = Array.isArray(parsed.grants) ? parsed.grants.filter((grant) => {
      const valid = grant && typeof grant.id === 'string' && UUID.test(grant.id) && !seen.has(grant.id) &&
        (grant.kind === 'folder' || grant.kind === 'file') &&
        typeof grant.root === 'string' && path.isAbsolute(grant.root)
      if (valid) seen.add(grant.id)
      return valid
    }).map(({ id, kind, root, bookmark }) => ({
      id,
      kind,
      root,
      ...(typeof bookmark === 'string' && bookmark ? { bookmark } : {}),
    })) : []
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to read approved file grants:', error)
    grants = []
  }
}

async function saveGrants(next) {
  await fs.mkdir(path.dirname(grantsFile), { recursive: true })
  const temporary = `${grantsFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ version: 2, grants: next }, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await fs.rename(temporary, grantsFile)
    grants = next
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

function mutateGrants(change) {
  const result = mutation.then(async () => saveGrants(await change(grants)))
  mutation = result.catch(() => {})
  return result
}

/* from: 'main' (the default), 'app' (main or the layer), 'overlay' (the layer) or 'any'. */
function handle(channel, operation, { from = 'main' } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event)
    if (from === 'main') assertMainWindow(event)
    if (from === 'app') assertAppWindow(event)
    if (from === 'overlay' && event.sender !== overlay?.window.webContents) fail('Only the OSAT layer can do that.')
    try {
      return await operation(...args)
    } catch (error) {
      if (error instanceof FileAccessError) throw error
      console.error(`Local file operation failed (${channel}):`, error)
      throw new FileAccessError('Local file access failed.')
    }
  })
}

function registerFileHandlers() {
  handle('files:roots', async () => {
    await mutation
    return grants.map(publicGrant)
  })

  handle('files:choose', async (kind) => {
    if (!['folder', 'file', 'files'].includes(kind)) fail('Choose either a folder or files.')
    const chooseFolder = kind === 'folder'
    const result = await dialog.showOpenDialog(mainWindow, {
      title: chooseFolder ? 'Choose a folder for OSAT' : 'Choose files for OSAT',
      properties: chooseFolder ? ['openDirectory'] : ['openFile', 'multiSelections'],
      securityScopedBookmarks: process.platform === 'darwin' && process.mas,
    })
    if (result.canceled) return null

    const selected = []
    await mutateGrants(async (current) => {
      const next = [...current]
      for (const [index, selectedPath] of result.filePaths.entries()) {
        const root = await fs.realpath(selectedPath)
        const stat = await fs.stat(root)
        const actualKind = stat.isDirectory() ? 'folder' : stat.isFile() ? 'file' : null
        if (!actualKind || actualKind !== (chooseFolder ? 'folder' : 'file')) continue
        const bookmark = result.bookmarks?.[index]
        const currentIndex = next.findIndex((item) => item.root === root && item.kind === actualKind)
        let grant = currentIndex >= 0 ? next[currentIndex] : null
        if (grant) {
          if (typeof bookmark === 'string' && bookmark) {
            stopGrantAccess(grant.id)
            grant = { ...grant, bookmark }
            next[currentIndex] = grant
          }
        } else {
          grant = {
            id: randomUUID(),
            kind: actualKind,
            root,
            ...(typeof bookmark === 'string' && bookmark ? { bookmark } : {}),
          }
          next.push(grant)
        }
        selected.push(publicGrant(grant))
      }
      return next
    })
    const selectedIds = new Set(selected.map((grant) => grant.id))
    return [...grants.filter((grant) => !selectedIds.has(grant.id)).map(publicGrant), ...selected]
  })

  handle('files:list', async (rootId, relative = '') => {
    const grant = getGrant(rootId)
    if (grant.kind !== 'folder') fail('Only folders can be browsed.')
    const directory = await approvedPath(grant, relative)
    if (!(await fs.stat(directory)).isDirectory()) fail('That item is not a folder.')

    const entries = []
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const itemRelative = relative ? `${relative}/${item.name}` : item.name
      try {
        const resolved = await approvedPath(grant, itemRelative)
        const stat = await fs.stat(resolved)
        const kind = stat.isDirectory() ? 'folder' : stat.isFile() ? 'file' : null
        if (!kind) continue
        entries.push({
          kind,
          name: item.name,
          relative: itemRelative,
          size: kind === 'file' ? stat.size : undefined,
          modifiedAt: stat.mtime.toISOString(),
        })
      } catch {
        // Broken links and links escaping the approved root stay invisible.
      }
    }
    return entries.sort((a, b) => Number(a.kind === 'file') - Number(b.kind === 'file') || a.name.localeCompare(b.name))
  })

  handle('files:read-text', async (rootId, relative = '') => {
    const grant = getGrant(rootId)
    const file = await approvedPath(grant, relative)
    const filename = path.basename(file)
    if (!isSafeTextPreviewName(filename)) {
      fail('Preview is available only for safe text file types.')
    }

    try {
      return { name: filename, relative, ...await readTextFile(file) }
    } catch (error) {
      if (error.message === 'NOT_A_FILE') fail('That item is not a file.')
      if (error.message === 'FILE_TOO_LARGE') fail('Text previews are limited to 2 MB.')
      if (error.message === 'INVALID_UTF8') fail('That file is not valid UTF-8 text.')
      if (error.message === 'FILE_CHANGED_DURING_READ') fail('That file changed while it was being read. Try again.')
      throw error
    }
  })

  handle('files:write-text', async (rootId, relative, content, expectedHash) => {
    if (typeof relative !== 'string' || !WRITABLE_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      fail('Only Markdown and Canvas files can be written.')
    }
    const target = await approvedWritePath(getGrant(rootId), relative)
    try {
      return { name: path.basename(target), relative, ...await writeTextFile(target, content, expectedHash) }
    } catch (error) {
      if (error.message === 'WRITE_CONFLICT') fail('This file changed after review. Read it again before saving.')
      if (error.message === 'INVALID_CONTENT' || error.message === 'INVALID_EXPECTED_HASH') {
        fail('Invalid reviewed file update.')
      }
      if (error.message === 'FILE_TOO_LARGE') fail('Reviewed file writes are limited to 5 MB.')
      if (error.message === 'INVALID_UTF8') fail('The current file is not valid UTF-8 text.')
      if (error.message === 'FILE_CHANGED_DURING_READ') fail('That file changed after review. Read it again before saving.')
      if (error.message === 'SYMLINK_WRITE_DENIED') fail('Symbolic links cannot be written.')
      throw error
    }
  })

  handle('files:open', async (rootId, relative = '') => {
    const target = await approvedPath(getGrant(rootId), relative)
    const stat = await fs.stat(target)
    if (stat.isDirectory()) {
      shell.showItemInFolder(target)
      return true
    }
    if (!stat.isFile() || !isSafeOpenFilename(path.basename(target))) {
      fail('Only safe documents, text files, images, and PDFs can be opened.')
    }
    if (await shell.openPath(target)) fail('The system could not open that item.')
    return true
  })

  handle('files:forget', async (rootId) => {
    getGrant(rootId)
    stopGrantAccess(rootId)
    await mutateGrants(async (current) => current.filter((grant) => grant.id !== rootId))
    return grants.map(publicGrant)
  })
}

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

async function readWindowState() {
  try {
    const saved = JSON.parse(await fs.readFile(windowStateFile(), 'utf8'))
    const area = screen.getDisplayMatching(saved).workArea
    const fits = saved.width >= 960 && saved.height >= 600 && saved.x < area.x + area.width && saved.y < area.y + area.height && saved.x + saved.width > area.x && saved.y + saved.height > area.y
    return fits ? saved : null
  } catch {
    return null
  }
}

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

async function createWindow() {
  const saved = await readWindowState()
  const window = new BrowserWindow({
    width: saved?.width || 1487,
    height: saved?.height || 1058,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#f8f5ef',
    title: 'OSAT',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow = window
  mainListening = false
  if (saved?.maximized) window.maximize()
  window.on('close', () => {
    const bounds = window.getNormalBounds()
    fs.writeFile(windowStateFile(), JSON.stringify({ ...bounds, maximized: window.isMaximized() })).catch(() => {})
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.loadFile(APP_ENTRY)
}

function focusMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  return undefined
}

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
        { label: 'New Thought', accelerator: 'CmdOrCtrl+Shift+N', click: () => command({ view: 'Capture' }) },
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => command({ view: 'Notes', detail: { action: 'new' } }) },
        { label: 'Show OSAT Layer', accelerator: hotkey || undefined, registerAccelerator: false, click: () => overlay?.show() },
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
        room('Map', 'Mindmap', 'CmdOrCtrl+3'),
        room('Ask', 'Assistant', 'CmdOrCtrl+4'),
        room('Sky', 'Sky'),
        { type: 'separator' },
        room('Today’s Page', 'Journal'),
        room('Calendar', 'Calendar'),
        room('Habits', 'Habits'),
        room('Reflect', 'Reflection'),
        room('Money', 'Budget'),
        room('Projects', 'Projects'),
        room('Files', 'Files'),
        room('Browser', 'Browser'),
        ...(terminals?.available ? [room('Terminal', 'Terminal')] : []),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  app.dock?.setMenu(Menu.buildFromTemplate([
    { label: 'Show OSAT Layer', click: () => overlay?.show() },
    { label: 'Local AI', click: () => command({ view: 'Assistant' }) },
    { label: 'New Browser Tab', click: () => command({ view: 'Browser', action: 'new-tab' }) },
  ]))
}

/* Browser and terminal calls pass their own messages back to the room.
   Each window (the main one and the layer) gets its own browser tabs. */
function handleApp(channel, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event)
    assertAppWindow(event)
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

/* Terminal output goes to every window that can show a terminal. */
function sendToAppWindows(channel, ...args) {
  send(channel, ...args)
  if (overlay && !overlay.window.isDestroyed()) overlay.window.webContents.send(channel, ...args)
}

function registerBrowserAndTerminal() {
  // Settings → Data and About.
  handleApp('app:about', () => ({ version: app.getVersion(), dataFolder: app.getPath('userData') }))
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

  terminals = process.mas ? { available: false, destroy() {} } : createTerminals({ emit: sendToAppWindows })
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

/* ---- The layer (⌥Space), its hotkey, launchers and the menu-bar icon ---- */

function prefsFile() {
  return path.join(app.getPath('userData'), 'prefs.json')
}

async function loadPrefs() {
  try {
    const saved = JSON.parse(await fs.readFile(prefsFile(), 'utf8'))
    prefs = {
      hotkey: validHotkey(saved.hotkey) ? saved.hotkey : DEFAULT_HOTKEY,
      launchers: Array.isArray(saved.launchers) ? saved.launchers.reduce((list, item) => addLauncher(list, item?.path), []) : [],
      places: Object.entries(saved.places || {}).reduce((places, [id, spot]) => placeItem(places, id, spot), {}),
      ai: { tier: typeof saved.ai?.tier === 'string' ? saved.ai.tier : null },
      welcomed: saved.welcomed === true,
      phone: saved.phone === true,
    }
  } catch {
    // No preferences yet: the defaults stand.
  }
}

async function savePrefs() {
  const temporary = `${prefsFile()}.${process.pid}.tmp`
  await fs.writeFile(temporary, JSON.stringify(prefs, null, 2))
  await fs.rename(temporary, prefsFile())
}

/* Registers a new hotkey, or keeps the old one when the new one is taken. */
function useHotkey(value) {
  if (!validHotkey(value)) return false
  if (value === hotkey) return true
  if (hotkey) globalShortcut.unregister(hotkey)
  const ok = globalShortcut.register(value, () => overlay?.toggle())
  if (!ok && hotkey) globalShortcut.register(hotkey, () => overlay?.toggle())
  if (ok) hotkey = value
  hotkeyFailed = !hotkey
  buildMenu()
  updateTray()
  return ok
}

const launcherIcons = new Map()
async function launcherList() {
  return Promise.all(prefs.launchers.map(async (item) => {
    if (!launcherIcons.has(item.path)) {
      launcherIcons.set(item.path, await app.getFileIcon(item.path, { size: 'large' }).then((icon) => icon.toDataURL()).catch(() => ''))
    }
    return { ...item, icon: launcherIcons.get(item.path) }
  }))
}

function registerOverlay() {
  overlay = createOverlay({
    BrowserWindow,
    screen,
    platform: process.platform,
    preload: path.join(__dirname, 'preload.cjs'),
    load: (window) => {
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== window.webContents.getURL()) event.preventDefault()
      })
      window.loadFile(APP_ENTRY, { query: { surface: 'overlay' } })
    },
    onBlur: () => { if (!holdOverlay && !overlay.window.webContents.isDevToolsOpened()) overlay.hide() },
  })
  // A macOS panel swallows Esc before the page sees it, so while the layer is up
  // OSAT takes Esc itself and hands it to the page as an ordinary key press.
  overlay.window.on('show', escapeToLayer)
  overlay.window.on('hide', () => globalShortcut.unregister('Escape'))

  const fromOverlay = (event) => {
    assertTrustedSender(event)
    if (event.sender !== overlay.window.webContents) fail('Only the OSAT layer can do that.')
  }
  ipcMain.on('overlay:hide', (event) => { try { fromOverlay(event); overlay.hide() } catch { /* ignored */ } })
  // Blur set to zero in Appearance: no frosting, the desktop shows through clear.
  ipcMain.on('overlay:clear', (event, clear) => {
    try { fromOverlay(event) } catch { return }
    if (process.platform === 'darwin') overlay.window.setVibrancy(clear === true ? null : 'fullscreen-ui')
  })
  ipcMain.on('overlay:open-in-window', (event, view, detail) => {
    try { fromOverlay(event) } catch { return }
    if (typeof view !== 'string') return
    overlay.hide()
    if (process.platform === 'darwin') app.focus({ steal: true })
    command({ view, detail: detail && typeof detail === 'object' ? detail : null })
  })
  // The hotkey can be read and changed from the layer or from Settings in the main window.
  handle('overlay:prefs', async () => ({ hotkey, label: hotkeyLabel(hotkey || prefs.hotkey), failed: hotkeyFailed, launchers: await launcherList(), places: prefs.places }), { from: 'app' })
  handle('overlay:set-hotkey', async (value) => {
    if (!validHotkey(value)) fail('Use one or more of ⌘ ⌃ ⌥ ⇧ with one key.')
    if (!useHotkey(value)) fail(`${hotkeyLabel(value)} is taken by another app. Try a different one.`)
    prefs = { ...prefs, hotkey: value }
    await savePrefs()
    return { hotkey, label: hotkeyLabel(hotkey), failed: false }
  }, { from: 'app' })
  handle('overlay:add-launcher', async () => {
    holdOverlay = true
    globalShortcut.unregister('Escape')
    try {
      const result = await dialog.showOpenDialog(overlay.window, {
        title: 'Add an app to the dock',
        defaultPath: '/Applications',
        properties: ['openFile'],
        filters: [{ name: 'Applications', extensions: ['app'] }],
      })
      if (!result.canceled && result.filePaths[0]) {
        prefs = { ...prefs, launchers: addLauncher(prefs.launchers, result.filePaths[0]) }
        await savePrefs()
      }
    } finally {
      holdOverlay = false
      overlay.show()
      escapeToLayer()
    }
    return launcherList()
  }, { from: 'overlay' })
  handle('overlay:remove-launcher', async (appPath) => {
    prefs = { ...prefs, launchers: prefs.launchers.filter((item) => item.path !== appPath) }
    await savePrefs()
    return launcherList()
  }, { from: 'overlay' })
  // Widgets and icons Nate moved on the layer. null puts one back; tidy puts all back.
  handle('overlay:place', async (id, spot) => {
    prefs = { ...prefs, places: placeItem(prefs.places, id, spot) }
    await savePrefs()
    return prefs.places
  }, { from: 'overlay' })
  handle('overlay:tidy', async () => {
    prefs = { ...prefs, places: {} }
    await savePrefs()
    return prefs.places
  }, { from: 'overlay' })
  const media = createMedia()
  handle('media:now', () => (process.platform === 'darwin' ? media.nowPlaying() : null), { from: 'overlay' })
  handle('media:control', (action) => media.control(action), { from: 'overlay' })
  // Only apps Nate added can be opened this way.
  handle('overlay:launch', async (appPath) => {
    if (!prefs.launchers.some((item) => item.path === appPath)) fail('That app is not in the dock.')
    overlay.hide()
    if (await shell.openPath(appPath)) fail('macOS could not open that app.')
    return true
  }, { from: 'overlay' })
}

function escapeToLayer() {
  if (process.platform !== 'darwin' || globalShortcut.isRegistered('Escape')) return
  globalShortcut.register('Escape', () => overlay.window.webContents.send('overlay:escape'))
}

function aiLine() {
  const status = ai?.status()
  if (!status) return 'Local AI'
  const download = status.download
  if (download?.state === 'running') return `Setting up the AI · ${Math.floor((download.received / download.total) * 100)}%`
  if (download?.state === 'failed') return 'AI download stopped · see Settings'
  const tier = status.tiers.find((item) => item.id === status.chosen)
  if (tier?.ready) return `Local AI · ${tier.model}${status.engine === 'ready' ? ' · awake' : ''}`
  return 'Local AI: not set up yet'
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return
  trayAiLine = aiLine()
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show OSAT Layer', accelerator: hotkey || undefined, registerAccelerator: false, click: () => overlay.show() },
    { label: 'Open OSAT', click: () => focusMain() },
    { type: 'separator' },
    { label: trayAiLine, click: () => command({ view: 'Settings', detail: { section: 'ai' } }) },
    { label: hotkeyFailed ? 'Shortcut not set · choose one…' : `Change shortcut (${hotkeyLabel(hotkey)})…`, click: () => command({ view: 'Settings' }) },
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
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('OSAT')
  updateTray()
}

/* ---- The local AI: the built-in model, or LM Studio when that is running ---- */

function sendToAllWindows(channel, ...args) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, ...args)
  }
}

function registerAi() {
  ai = createAi({
    dir: path.join(app.getPath('userData'), 'models'),
    totalMemory: os.totalmem(),
    chosen: prefs.ai.tier,
    save: async (tier) => { prefs = { ...prefs, ai: { tier } }; await savePrefs() },
    fork: () => utilityProcess.fork(path.join(__dirname, 'ai', 'runtime.cjs'), [], { serviceName: 'OSAT AI' }),
    emit: (status) => {
      sendToAllWindows('ai:status', status)
      if (aiLine() !== trayAiLine) updateTray()
    },
    // Tests and CI answer with a practice model instead of downloading one.
    mock: !app.isPackaged && process.env.OSAT_AI === 'mock',
  })
  ai.start()
  // AI messages are written for Nate, so they pass through as they are.
  const plain = (fn) => async (...args) => {
    try { return await fn(...args) } catch (error) { throw new FileAccessError(error.message) }
  }
  handle('ai:status', () => ai.status(), { from: 'any' })
  handle('ai:choose', plain((tier) => ai.choose(tier)), { from: 'app' })
  handle('ai:cancel', () => { ai.cancel(); return ai.status() }, { from: 'app' })
  handle('ai:resume', () => { ai.resume(); return ai.status() }, { from: 'app' })
  handle('ai:remove', plain((tier) => ai.remove(tier)), { from: 'app' })
  handle('app:welcome', () => !prefs.welcomed, { from: 'main' })
  handle('app:welcomed', async () => { prefs = { ...prefs, welcomed: true }; await savePrefs(); return true }, { from: 'main' })

  // Ask lists the built-in model first, then whatever LM Studio has loaded.
  handle('local-ai:models', async () => {
    const own = ai.models()
    try {
      return { models: [...own, ...await localAiModels()] }
    } catch {
      return { models: own, ...(own.length ? {} : { error: 'Set up the AI in Settings → AI, or start LM Studio.' }) }
    }
  }, { from: 'any' })
  const streams = new Map()
  ipcMain.on('local-ai:cancel', (event, id) => {
    assertTrustedSender(event)
    if (typeof id === 'string') streams.get(id)?.abort()
  })
  ipcMain.handle('local-ai:chat-stream', async (event, id, payload) => {
    assertTrustedSender(event)
    if (typeof id !== 'string' || !/^stream-\d+$/.test(id)) throw new FileAccessError('Bad stream id.')
    const valid = validateLocalChatPayload(payload)
    const controller = new AbortController()
    streams.set(id, controller)
    const onDelta = (delta) => { if (!event.sender.isDestroyed()) event.sender.send(`local-ai:delta:${id}`, delta) }
    try {
      return valid.model.startsWith('osat:')
        ? await ai.chatStream(valid, onDelta, controller.signal)
        : await localAiChatStream(valid, onDelta, controller.signal)
    } catch (error) {
      if (error?.name === 'AbortError') return ''
      throw new FileAccessError(error.message || 'Local AI is unavailable.')
    } finally {
      streams.delete(id)
    }
  })
}

/* ---- Your iPhone, through an OSAT folder in iCloud Drive (off until turned on) ---- */

// Tests (from source) pass OSAT_ICLOUD_DIR so they never touch the real iCloud Drive.
const ICLOUD_DRIVE = (!app.isPackaged && process.env.OSAT_ICLOUD_DIR) || path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
const PHONE_ROOT = path.join(ICLOUD_DRIVE, 'OSAT')
let phone = null
let phoneClient = null
let phoneWatcher = null
let phonePoll = null
let phoneMirrorTimer = null
let phoneScanTimer = null

// Never touches iCloud Drive: macOS asks before an app looks there, and that
// should only happen when Nate turns the link on.
function phoneStatus() {
  const base = { enabled: prefs.phone, root: PHONE_ROOT }
  return phone ? { ...base, ...phone.status(), enabled: prefs.phone } : base
}

// Both do nothing while the link is off.
const mirrorSoon = () => {
  clearTimeout(phoneMirrorTimer)
  if (prefs.phone) phoneMirrorTimer = setTimeout(() => { if (prefs.phone) phone?.mirror() }, 2000)
}
const scanSoon = () => {
  clearTimeout(phoneScanTimer)
  if (prefs.phone) phoneScanTimer = setTimeout(() => { if (prefs.phone) phone?.scan() }, 800)
}

async function bridgePhone() {
  const { normalizeNote } = await sharedModule('note-core.mjs')
  return createPhoneBridge({
    root: PHONE_ROOT,
    // A thought from the iPhone is one Unsorted note, made the same way the windows make one.
    capture: (text) => {
      const now = new Date().toISOString()
      const title = text.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'A thought'
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

async function startPhone() {
  phone ??= await bridgePhone()
  await phone.prepare()
  phoneClient ??= store.connect(mirrorSoon)
  try {
    phoneWatcher = require('node:fs').watch(path.join(PHONE_ROOT, 'Inbox'), scanSoon)
  } catch {
    // The poll below still finds new thoughts.
  }
  phonePoll = setInterval(scanSoon, 30000)
  await phone.scan()
  await phone.mirror()
}

function stopPhone() {
  phoneWatcher?.close()
  clearInterval(phonePoll)
  clearTimeout(phoneMirrorTimer)
  clearTimeout(phoneScanTimer)
  phoneWatcher = null
  phonePoll = null
}

function registerPhone() {
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
    if (await shell.openPath(PHONE_ROOT)) fail('Finder could not open the OSAT folder in iCloud Drive.')
    return true
  })
  if (prefs.phone) startPhone().catch((error) => console.error('The iPhone link could not start:', error))
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
  grantsFile = path.join(app.getPath('userData'), 'approved-files.json')
  await loadGrants()
  registerFileHandlers()
  ipcMain.on('app:listening', (event) => {
    if (event.sender !== mainWindow?.webContents) return
    mainListening = true
    if (!pendingCommand) return
    send('app:command', pendingCommand)
    pendingCommand = undefined
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, respond) => respond(false))
  registerBrowserAndTerminal()
  await loadPrefs()
  registerAi()
  registerPhone()
  registerOverlay()
  await createWindow()
  createTray()
  // If the shortcut is taken by another app, open Settings so a new one can be picked.
  if (!useHotkey(prefs.hotkey)) command({ view: 'Settings', detail: { section: 'shortcut' } })
  // Clicking the Dock icon reopens the main window, even while the hidden layer exists.
  app.on('activate', () => focusMain())
})

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
  for (const id of grantAccessStops.keys()) stopGrantAccess(id)
})
