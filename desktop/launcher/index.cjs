/* The launcher (Phase 13): quick search, the clipboard history, and the keys that open them. main.cjs
   only calls `createLauncher` (as it calls `createFiles` and `createBots`); everything below is wired
   here. main passes in what it owns: IPC's `handle` and `fail`, the desk window, Electron's pieces.
   - `search`: the quick search panel (search-window.cjs). Its page (src/surfaces/QuickSearch.jsx) asks
     for everything through the `search:*` channels below, which answer only the panel and the desk.
   - `history`: the clipboard history (clipboard-history.cjs), kept in `<data folder>/clipboard/`.
   - settings: `launcher.json` in the data folder (shared/launcher-model.mjs): which sources are on,
     each one's keyword and Hyper key, Nate's keywords, how much the clipboard keeps, pins.
   Nothing here sends anything anywhere, except opening a link Nate chose in his own browser, which
   waits while OSAT is offline. */
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { hotkeyLabel, validHotkey } = require('../desk.cjs')
const { isSafeTextPreviewName, readTextFile } = require('../text-files.cjs')
const { createApps } = require('./apps.cjs')
const { createClipboardHistory } = require('./clipboard-history.cjs')
const { frontApp, pasteInto } = require('./front.cjs')
const { createHotkeys } = require('./hotkeys.cjs')
const { createQuickSearch } = require('./search-window.cjs')
const { createRing } = require('./ring-window.cjs')
const { createSnap } = require('./snap.cjs')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function createLauncher({
  BrowserWindow, screen, clipboard, nativeImage, shell, systemPreferences, globalShortcut, platform = process.platform,
  dataDir, preload, load, files, handle, fail, sharedModule, mainWindow, command, sendToAllWindows,
  offline = () => false, hideOnBlur = false, isTaken = () => false, onHide = () => {}, exec, notify = () => {},
  // What the ring does that only main can: the desk, the quick chat, a new sticky, the Sky, Files.
  ringActions = {},
}) {
  const [clipModel, launcherModel, layoutModel, ringModel] = await Promise.all([sharedModule('clipboard-model.mjs'), sharedModule('launcher-model.mjs'), sharedModule('window-layouts.mjs'), sharedModule('ring-model.mjs')])
  const clean = (saved) => launcherModel.cleanSettings(saved, { validHotkey })
  const settingsFile = path.join(dataDir, 'launcher.json')
  let settings = clean(undefined)

  const apps = createApps()
  const desk = () => { const window = mainWindow(); return window && !window.isDestroyed() ? window.webContents : null }
  const history = createClipboardHistory({
    dir: path.join(dataDir, 'clipboard'),
    clipboard,
    nativeImage,
    model: clipModel,
    frontApp: () => frontApp({ exec, platform }),
    limits: () => settings.clipboard,
    // The desk hears of a new copy (so it can offer "Add to Jordan?"); the words go no further than this window.
    onCopy: (item) => desk()?.send('clipboard:copied', item.kind === 'image' ? { id: item.id, kind: 'image', at: item.at } : { id: item.id, kind: item.kind, at: item.at, text: item.text.slice(0, 2000), ...(item.app ? { app: item.app } : {}) }),
  })
  const hotkeys = createHotkeys({ globalShortcut, isTaken })
  const trusted = () => platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false)
  // Window snapping: it needs Accessibility, and OSAT never moves its own windows.
  const snap = createSnap({ exec, platform, trusted, screens: () => screen.getAllDisplays(), own: ['OSAT', 'Electron'], layouts: layoutModel })
  // A layout key pressed while OSAT isn't allowed says so once, calmly, and then leaves it alone.
  let told = false
  async function snapFromKey(id) {
    const result = await snap.snap(id)
    if (result.reason === 'access' && !told) {
      told = true
      notify({ title: 'OSAT', body: 'To move windows, OSAT needs to be allowed in Accessibility. Settings → Launcher shows how; nothing changes until you do.' })
    }
  }

  let search = null
  const startSearch = () => {
    search = createQuickSearch({ BrowserWindow, screen, platform, preload, load: (window) => load(window, 'search'), hideOnBlur, onHide, view: () => settings.view })
    // The page says when it is listening, so a key pressed while it loads still opens it on the right tab.
    let ready = false
    let waiting = null
    const send = search.send
    search.send = (channel, ...args) => (ready || channel !== 'search:shown' ? send(channel, ...args) : (waiting = [channel, ...args]))
    search.ready = () => { ready = true; if (waiting) { send(...waiting); waiting = null } }
    search.window.webContents.on('did-start-loading', () => { ready = false })
  }

  // The ring's window is made the first time it is wanted.
  let ring = null
  let hooks = null
  const ensureRing = () => {
    if (!ring) {
      ring = createRing({ BrowserWindow, screen, platform, preload, load: (window) => load(window, 'ring'), hideOnBlur, onHide })
      if (hooks) { ring.window.on('focus', hooks.focus); ring.window.on('blur', hooks.blur) }
    }
    return ring
  }
  const ofSearchOrDesk = (sender) => Boolean(search?.owns(sender)) || sender === desk()
  const ofRing = (sender) => Boolean(ring?.owns(sender))
  const ofDesk = (sender) => sender === desk()
  const on = (channel, operation, from = ofSearchOrDesk) => handle(channel, operation, { from })

  /* ---- Settings ---- */

  async function readSettings() {
    try {
      settings = clean(JSON.parse(await fsp.readFile(settingsFile, 'utf8')))
    } catch {
      settings = clean(undefined)
    }
  }
  async function writeSettings() {
    await fsp.mkdir(dataDir, { recursive: true })
    const temporary = `${settingsFile}.${process.pid}.${crypto.randomUUID()}.tmp`
    try {
      await fsp.writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 })
      await fsp.rename(temporary, settingsFile)
    } finally {
      await fsp.rm(temporary, { force: true })
    }
  }

  /* Each source's Hyper key opens the quick search on it. → the ids that couldn't have their key. */
  function applyHotkeys(next = settings) {
    const wanted = {}
    for (const source of launcherModel.SOURCES.filter((item) => item.panel !== false)) {
      const own = next.sources[source.id]
      if (own.on && own.hotkey) wanted[`source:${source.id}`] = { key: own.hotkey, run: () => search?.toggle({ scope: source.id }) }
    }
    if (next.ring.on && next.ring.hotkey) wanted.ring = { key: next.ring.hotkey, run: () => ensureRing().toggle() }
    if (next.windows.on) {
      for (const layout of layoutModel.LAYOUTS) {
        const key = next.windows.hotkeys[layout.id]
        if (key) wanted[`snap:${layout.id}`] = { key, run: () => snapFromKey(layout.id) }
      }
    }
    return hotkeys.sync(wanted)
  }

  /* A patch is { view?, sources?: { id: { on?, keyword?, hotkey? } }, keywords?, clipboard?, pins?, … }. A key another
     app (or one of OSAT's own shortcuts) holds is refused, and everything else in the patch still stands. */
  async function save(patch) {
    const from = patch && typeof patch === 'object' ? patch : {}
    const merged = {
      ...settings,
      ...from,
      sources: Object.fromEntries(Object.entries(settings.sources).map(([id, own]) => [id, { ...own, ...(from.sources?.[id] || {}) }])),
      clipboard: { ...settings.clipboard, ...(from.clipboard || {}) },
      windows: { ...settings.windows, ...(from.windows || {}), hotkeys: { ...settings.windows.hotkeys, ...(from.windows?.hotkeys || {}) } },
      ring: { ...settings.ring, ...(from.ring || {}) },
    }
    const next = clean(merged)
    // A key that changed in this patch and can't be had goes back to what it was; one that was already refused stays as it is.
    const changed = (id) => (id === 'ring' ? next.ring.hotkey !== settings.ring.hotkey : id.startsWith('source:') ? next.sources[id.slice(7)]?.hotkey !== settings.sources[id.slice(7)]?.hotkey : id.startsWith('snap:') && next.windows.hotkeys[id.slice(5)] !== settings.windows.hotkeys[id.slice(5)])
    const failed = applyHotkeys(next).filter(changed)
    for (const id of failed) {
      if (id === 'ring') next.ring.hotkey = settings.ring.hotkey
      else if (id.startsWith('source:')) next.sources[id.slice(7)].hotkey = settings.sources[id.slice(7)].hotkey
      else next.windows.hotkeys[id.slice(5)] = settings.windows.hotkeys[id.slice(5)]
    }
    settings = next
    applyHotkeys()
    await writeSettings()
    history.limitsChanged()
    history.watch(settings.sources.clipboard.on)
    sendToAllWindows('launcher:changed', settings)
    if (failed.length) {
      const label = failed[0] === 'ring' ? 'The ring' : launcherModel.SOURCES.find((source) => `source:${source.id}` === failed[0])?.label || layoutModel.layoutById(failed[0].slice(5))?.label
      fail(`That key is taken by another app or another OSAT shortcut, so ${label} keeps its old one. Try a different key.`)
    }
    return settings
  }

  /* ---- What the quick search's page asks for ---- */

  on('search:ready', () => { search.ready(); return true })
  on('search:settings', () => settings, (sender) => ofSearchOrDesk(sender) || ofRing(sender))
  on('search:save-settings', save, ofDesk)
  on('search:status', () => ({
    accessibility: platform !== 'darwin' ? 'unavailable' : systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'needed',
    keysFailed: hotkeys.failed(),
  }), ofDesk)
  // The one place OSAT asks macOS for Accessibility: a button in Settings → Launcher, never by itself.
  on('search:ask-access', () => platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(true), ofDesk)

  on('search:files', async (query) => {
    if (!settings.sources.files.on) return []
    const words = typeof query === 'string' ? query.trim() : ''
    return words ? files.find(words, { limit: 12 }) : files.recent(30)
  })
  // The big preview: the words of a text file, else what Quick Look draws.
  on('search:preview', async (rootId, relative) => {
    const target = await files.resolve(rootId, relative)
    const stat = await fsp.stat(target)
    const name = path.basename(target)
    const text = stat.isFile() && stat.size <= 2 * 1024 * 1024 && isSafeTextPreviewName(name) ? (await readTextFile(target).catch(() => null))?.content.slice(0, 5000) ?? null : null
    return { text, thumb: text ? null : await files.thumbnail(target, 640).catch(() => null) }
  })
  on('search:apps', async () => (settings.sources.apps.on ? apps.list() : []))
  on('search:app-icon', async (appPath) => ((await apps.has(appPath)) ? files.thumbnail(appPath, 128).catch(() => null) : null))
  on('search:clipboard', () => (settings.sources.clipboard.on ? history.list() : { paused: false, watching: false, items: [] }))
  on('search:clipboard-image', (id) => history.image(id))
  on('search:clipboard-pause', (paused) => history.setPaused(paused === true), ofDesk)
  on('search:clipboard-clear', () => history.clear(), ofDesk)
  on('search:clipboard-text', (id) => history.textOf(id))

  /* ---- What Return and ⌘K do ---- */

  on('search:open-file', (rootId, relative) => files.open(rootId, relative))
  on('search:reveal-file', (rootId, relative) => files.reveal(rootId, relative))
  on('search:copy-path', async (rootId, relative) => { clipboard.writeText(await files.resolve(rootId, relative)); return true })
  on('search:trash-file', (rootId, relative) => files.trash([{ rootId, relative }]))
  on('search:undo-file', (token) => files.undo(token))
  on('search:pin-file', async (row, pinned) => {
    // Only something OSAT can see can be pinned.
    await files.resolve(String(row?.rootId), String(row?.relative))
    const pin = { kind: row.kind === 'folder' ? 'folder' : 'file', rootId: String(row.rootId), relative: String(row.relative), name: path.posix.basename(String(row.relative)), where: files.whereOf({ rootId: String(row.rootId), relative: String(row.relative) }) }
    const others = settings.pins.filter((item) => !(item.rootId === pin.rootId && item.relative === pin.relative))
    return (await save({ pins: pinned ? [pin, ...others] : others })).pins
  })

  /* A copy goes back on the clipboard, then ⌘V is sent to the app you were in. Without Accessibility
     nothing is sent: it says so, and ⌘V does it by hand. */
  async function pasteWhenAble() {
    const trusted = platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false)
    if (!trusted) return { pasted: false, reason: platform === 'darwin' ? 'access' : 'mac' }
    search.hide()
    await wait(140)
    return pasteInto({ exec, platform, trusted: () => true })
  }
  on('search:paste-clip', async (id) => {
    if (!history.use(id)) fail('That copy is gone.')
    return pasteWhenAble()
  })
  on('search:copy-clip', (id) => history.use(id))
  on('search:pin-clip', (id, pinned) => history.pin(id, pinned === true))
  on('search:forget-clip', (id) => history.forget(id))
  on('search:undo-clip', (token) => history.undo(token))
  on('search:copy-text', (text) => { clipboard.writeText(String(text).slice(0, 2000)); return true })
  on('search:paste-text', (text) => { clipboard.writeText(String(text).slice(0, 2000)); return pasteWhenAble() })

  async function openApp(appPath) {
    if (await shell.openPath(appPath)) fail('macOS could not open that app.')
    return true
  }
  on('search:open-app', async (appPath) => {
    if (!(await apps.has(appPath))) fail('That app isn’t in the list any more.')
    return openApp(appPath)
  })
  on('search:open-app-named', async (name) => {
    const found = await apps.named(name)
    if (!found) fail(`${String(name).slice(0, 40)} isn’t installed on this Mac.`)
    return openApp(found.path)
  })
  on('search:reveal-app', async (appPath) => {
    if (!(await apps.has(appPath))) fail('That app isn’t in the list any more.')
    shell.showItemInFolder(appPath)
    return true
  })
  // A web address opens in Nate's own browser, only while OSAT is online.
  on('search:open-link', async (url) => {
    if (typeof url !== 'string' || url.length > 2000 || !/^https?:\/\/[^\s]+$/i.test(url)) fail('That isn’t a web address OSAT can open.')
    if (!offline() && /^https?:\/\//i.test(url)) await shell.openExternal(url)
    return true
  })

  /* A layout for the window you were in: the panel goes away first, so that window is in front again. Without
     Accessibility nothing is touched, and the panel stays to say so. */
  on('search:snap', async (id) => {
    if (!layoutModel.layoutById(id)) fail('That isn’t a layout OSAT knows.')
    if (!snap.allowed()) return { ok: false, reason: platform === 'darwin' ? 'access' : 'mac' }
    search.hide()
    await wait(140)
    return snap.snap(id)
  })

  /* The ring: quick tools around the pointer. Its page asks for what to draw (search:settings) and says what was picked. */
  const ringDoes = {
    search: () => search.show(),
    clipboard: () => search.show({ scope: 'clipboard' }),
    sticky: () => ringActions.sticky?.(),
    chat: () => ringActions.chat?.(),
    desk: () => ringActions.desk?.(),
    sky: () => ringActions.sky?.(),
    files: () => ringActions.files?.(),
  }
  const showRing = () => { if (settings.ring.on) ensureRing().show() }
  handle('ring:ready', () => { ring?.ready(); return true }, { from: ofRing })
  handle('ring:hide', () => { ring?.hide(); return true }, { from: ofRing })
  handle('ring:pick', async (id) => {
    const item = ringModel.RING_ITEMS.find((entry) => entry.id === id)
    if (!item) fail('That isn’t a tool the ring holds.')
    ring.hide()
    await wait(80)
    if (item.layout) await snapFromKey(item.layout)
    else ringDoes[item.id]?.()
    return true
  }, { from: ofRing })
  // From the desk's own ring (⌘ + middle-click on the desk): the quick search over it, on a tab.
  on('search:show', (scope) => { search.show({ scope: ['files', 'clipboard', 'apps', 'notes', 'windows'].includes(scope) ? scope : 'all' }); return true }, ofDesk)

  on('search:hide', () => { search.hide(); return true })
  on('search:mode', (mode) => { search.setMode(mode); return true })
  // "Open in OSAT": a note, a node, a room or Ask about a file goes to the desk.
  on('search:open-in-osat', (view, detail) => {
    if (typeof view !== 'string') return false
    search.hide()
    command({ view, detail: detail && typeof detail === 'object' ? detail : null })
    return true
  })

  startSearch()

  return {
    // The panels, for main's Esc and focus routing (a panel keeps Esc from the page).
    escape() {
      if (search.window.isFocused()) search.send('search:escape')
      else if (ring?.window.isFocused()) ring.send('ring:escape')
    },
    focused: () => Boolean(search.window.isFocused() || ring?.window.isFocused()),
    onFocus(focus, blur) {
      hooks = { focus, blur }
      search.window.on('focus', focus)
      search.window.on('blur', blur)
    },
    ring: { show: showRing, hide: () => ring?.hide(), toggle: () => (settings.ring.on ? ensureRing().toggle() : undefined) },
    search: { show: (options) => search.show(options), hide: () => search.hide(), toggle: (options) => search.toggle(options), get window() { return search.window }, send: (...args) => search.send(...args) },
    history,
    // A key that is one of the launcher's (so the desk's shortcut picker never takes it).
    taken: (accelerator) => hotkeys.has(accelerator),
    settings: () => settings,
    hotkeyLabel: (accelerator) => launcherModel.hyperLabel(accelerator, hotkeyLabel),
    async start() {
      await readSettings()
      await history.start()
      history.watch(settings.sources.clipboard.on)
      applyHotkeys()
    },
    stop() {
      history.stop()
      hotkeys.stop()
    },
  }
}

module.exports = { createLauncher }
