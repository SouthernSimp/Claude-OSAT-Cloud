const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, safeStorage, screen, session, shell } = require('electron')
const { resolveApprovedPath, resolveApprovedWritePath } = require('./path-guard.cjs')
const { SecretVault } = require('./secret-vault.cjs')
const { isSafeOpenFilename, isSafeTextPreviewName, readTextFile, writeTextFile } = require('./text-files.cjs')
const { localAiChat, localAiChatStream, localAiModels, validateLocalChatPayload } = require('./local-ai.cjs')
const { createBrowser } = require('./browser.cjs')
const { createTerminals } = require('./terminal.cjs')

const APP_ENTRY = path.join(__dirname, '..', 'dist', 'client', 'index.html')
const APP_URL = pathToFileURL(APP_ENTRY).href
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WRITABLE_EXTENSIONS = new Set(['.canvas', '.markdown', '.md'])

let mainWindow
let quickCaptureWindow
let assistantWindow
let grants = []
let grantsFile
let mutation = Promise.resolve()
let secretVault
let browser
let terminals
const grantAccessStops = new Map()

// OSAT Field keeps its own data folder. It never reads OSAT, OSAT V2, or NateOS.
// Move data across with Settings → backup / restore.
app.setPath('userData', path.join(app.getPath('appData'), app.isPackaged ? 'OSAT Field' : 'OSAT Field Preview'))
app.setName('OSAT Field')

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

function handle(channel, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event)
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
    const fits = saved.width >= 320 && saved.height >= 560 && saved.x < area.x + area.width && saved.y < area.y + area.height && saved.x + saved.width > area.x && saved.y + saved.height > area.y
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
    minWidth: 320,
    minHeight: 560,
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
  if (saved?.maximized) window.maximize()
  browser?.destroy()
  browser = createBrowser({ window, emit: send })
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
    if (mainWindow === window) {
      mainWindow = undefined
      browser?.destroy()
      browser = undefined
    }
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
function command(detail) {
  Promise.resolve(focusMain()).then(() => send('app:command', detail))
}

function buildMenu() {
  const room = (label, view, accelerator) => ({ label, accelerator, click: () => command({ view }) })
  const template = [
    {
      label: 'OSAT Field',
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
        { label: 'Quick Capture Anywhere', accelerator: 'Alt+Space', registerAccelerator: false, click: showQuickCapture },
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
        room('Home', 'Today', 'CmdOrCtrl+1'),
        room('Notes', 'Notes', 'CmdOrCtrl+2'),
        room('Mindmap', 'Mindmap', 'CmdOrCtrl+3'),
        room('Journal', 'Journal', 'CmdOrCtrl+4'),
        room('Calendar', 'Calendar', 'CmdOrCtrl+5'),
        room('Local AI', 'Assistant', 'CmdOrCtrl+6'),
        room('Browser', 'Browser', 'CmdOrCtrl+7'),
        ...(terminals?.available ? [room('Terminal', 'Terminal', 'CmdOrCtrl+8')] : []),
        { type: 'separator' },
        room('Sky', 'Sky'),
        room('Files', 'Files'),
        room('Projects', 'Projects'),
        room('Habits', 'Habits'),
        room('Money', 'Budget'),
        { type: 'separator' },
        { label: 'Local AI in Its Own Window', accelerator: 'CmdOrCtrl+Shift+L', click: showAssistant },
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
    { label: 'New Thought', click: showQuickCapture },
    { label: 'Local AI', click: showAssistant },
    { label: 'New Browser Tab', click: () => command({ view: 'Browser', action: 'new-tab' }) },
  ]))
}

/* Browser and terminal calls pass their own messages back to the room. */
function handleApp(channel, operation) {
  handle(channel, async (...args) => {
    try {
      return await operation(...args)
    } catch (error) {
      if (error instanceof FileAccessError) throw error
      fail(error?.message || 'That did not work.')
    }
  })
}

function onTrusted(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertTrustedSender(event)
      listener(...args)
    } catch {
      // Ignore requests from anything but the OSAT window.
    }
  })
}

function registerBrowserAndTerminal() {
  handleApp('browser:state', () => browser?.state() || { tabs: [], active: null })
  handleApp('browser:open', (url) => browser.open(url))
  handleApp('browser:navigate', (url) => browser.navigate(url))
  handleApp('browser:activate', (id) => browser.activate(id))
  handleApp('browser:close', (id) => browser.close(id))
  handleApp('browser:back', () => browser.back())
  handleApp('browser:forward', () => browser.forward())
  handleApp('browser:reload', () => browser.reload())
  handleApp('browser:stop', () => browser.stop())
  handleApp('browser:clip', () => browser.clip())
  onTrusted('browser:place', (rect) => browser?.place(rect))

  terminals = process.mas ? { available: false, destroy() {} } : createTerminals({ emit: send })
  handleApp('terminal:available', () => terminals.available)
  handleApp('terminal:list', () => terminals.list())
  handleApp('terminal:start', (size) => terminals.start(size))
  handleApp('terminal:attach', (id) => terminals.attach(id))
  handleApp('terminal:close', (id) => terminals.close(id))
  onTrusted('terminal:write', (id, data) => terminals.write?.(id, data))
  onTrusted('terminal:resize', (id, cols, rows) => terminals.resize?.(id, cols, rows))
}

function createSurfaceWindow(surface, options) {
  const window = new BrowserWindow({
    ...options,
    show: false,
    backgroundColor: '#f8f7f3',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.loadFile(APP_ENTRY, { query: { surface } })
  return window
}

function showQuickCapture() {
  if (!quickCaptureWindow || quickCaptureWindow.isDestroyed()) {
    quickCaptureWindow = createSurfaceWindow('quick-capture', {
      width: 520,
      height: 390,
      minWidth: 420,
      minHeight: 330,
      resizable: true,
      alwaysOnTop: true,
      title: 'Quick capture',
    })
  }
  quickCaptureWindow.center()
  quickCaptureWindow.show()
  quickCaptureWindow.focus()
}

function showAssistant() {
  if (!assistantWindow || assistantWindow.isDestroyed()) {
    assistantWindow = createSurfaceWindow('assistant', {
      width: 620,
      height: 780,
      minWidth: 460,
      minHeight: 620,
      title: 'OSAT Local AI',
    })
  }
  assistantWindow.show()
  assistantWindow.focus()
}

app.whenReady().then(async () => {
  grantsFile = path.join(app.getPath('userData'), 'approved-files.json')
  secretVault = new SecretVault(path.join(app.getPath('userData'), 'secure-secrets.json'), safeStorage)
  await loadGrants()
  registerFileHandlers()
  handle('secrets:status', async () => {
    const status = secretVault.status()
    if (!status.available) return status
    return { available: true, count: (await secretVault.keys()).length }
  })
  handle('secrets:keys', () => secretVault.keys())
  handle('secrets:set', (key, value) => secretVault.set(key, value))
  handle('secrets:delete', (key) => secretVault.delete(key))
  handle('local-ai:models', async () => {
    try {
      return { runtime: 'lm-studio', offline: true, models: await localAiModels() }
    } catch {
      return { runtime: 'lm-studio', offline: true, models: [], error: 'Start the LM Studio local server to use offline AI.' }
    }
  })
  handle('local-ai:chat', async (payload) => {
    validateLocalChatPayload(payload)
    try {
      return await localAiChat(payload)
    } catch (error) {
      throw new FileAccessError(error.message || 'Local AI is unavailable.')
    }
  })
  const streams = new Map()
  ipcMain.on('local-ai:cancel', (event, id) => {
    assertTrustedSender(event)
    if (typeof id === 'string') streams.get(id)?.abort()
  })
  ipcMain.handle('local-ai:chat-stream', async (event, id, payload) => {
    assertTrustedSender(event)
    if (typeof id !== 'string' || !/^stream-\d+$/.test(id)) throw new FileAccessError('Bad stream id.')
    validateLocalChatPayload(payload)
    const controller = new AbortController()
    streams.set(id, controller)
    try {
      return await localAiChatStream(payload, (delta) => {
        if (!event.sender.isDestroyed()) event.sender.send(`local-ai:delta:${id}`, delta)
      }, controller.signal)
    } catch (error) {
      if (error?.name === 'AbortError') return ''
      throw new FileAccessError(error.message || 'Local AI is unavailable.')
    } finally {
      streams.delete(id)
    }
  })
  ipcMain.on('quick-capture:submit', (event, text) => {
    if (!quickCaptureWindow || event.sender !== quickCaptureWindow.webContents || typeof text !== 'string') return
    const clean = text.trim().slice(0, 10_000)
    if (!clean || !mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('quick-capture:received', clean)
    quickCaptureWindow.hide()
  })
  ipcMain.handle('app:open-assistant', (event) => {
    assertTrustedSender(event)
    showAssistant()
    return true
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, respond) => respond(false))
  registerBrowserAndTerminal()
  await createWindow()
  buildMenu()
  globalShortcut.register(process.platform === 'darwin' ? 'Alt+Space' : 'CommandOrControl+Shift+Space', showQuickCapture)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  terminals?.destroy()
  for (const id of grantAccessStops.keys()) stopGrantAccess(id)
})
