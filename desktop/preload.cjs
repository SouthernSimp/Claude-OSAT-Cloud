const { contextBridge, ipcRenderer, webUtils } = require('electron')

/* Files: Desktop, Documents and Downloads, plus the folders you add. */
contextBridge.exposeInMainWorld('nateOSFiles', Object.freeze({
  choose: (kind) => ipcRenderer.invoke('files:choose', kind),
  roots: () => ipcRenderer.invoke('files:roots'),
  list: (rootId, relative = '') => ipcRenderer.invoke('files:list', rootId, relative),
  readText: (rootId, relative = '') => ipcRenderer.invoke('files:read-text', rootId, relative),
  writeText: (rootId, relative, content, expectedHash) => (
    ipcRenderer.invoke('files:write-text', rootId, relative, content, expectedHash)
  ),
  open: (rootId, relative = '') => ipcRenderer.invoke('files:open', rootId, relative),
  reveal: (rootId, relative = '') => ipcRenderer.invoke('files:reveal', rootId, relative),
  thumb: (rootId, relative = '', size = 128) => ipcRenderer.invoke('files:thumb', rootId, relative, size),
  quickLook: (rootId, relative = '') => ipcRenderer.invoke('files:quick-look', rootId, relative),
  search: (query) => ipcRenderer.invoke('files:search', query),
  forget: (rootId) => ipcRenderer.invoke('files:forget', rootId),
  // Tidying: items are { rootId, relative }; each change answers with `undo`, a token for undo().
  newFolder: (rootId, relative = '') => ipcRenderer.invoke('files:new-folder', rootId, relative),
  rename: (rootId, relative, name) => ipcRenderer.invoke('files:rename', rootId, relative, name),
  move: (items, rootId, relative = '', copy = false) => ipcRenderer.invoke('files:move', items, rootId, relative, copy),
  // Files dropped from Finder ({ files: the page's File objects }); their paths are read here, not by the page.
  moveIn: (files, rootId, relative = '', copy = false) => (
    ipcRenderer.invoke('files:move-in', Array.from(files, (file) => webUtils.getPathForFile(file)).filter(Boolean), rootId, relative, copy)
  ),
  dragOut: (items) => ipcRenderer.invoke('files:drag-out', items),
  trash: (items) => ipcRenderer.invoke('files:trash', items),
  undo: (token) => ipcRenderer.invoke('files:undo', token),
  // The text Ask reads: from a file OSAT can see, a file dropped on a chat, or one chosen now.
  extract: (rootId, relative = '') => ipcRenderer.invoke('files:extract', rootId, relative),
  attachDropped: (file) => ipcRenderer.invoke('files:attach', webUtils.getPathForFile(file) || ''),
  attachChosen: () => ipcRenderer.invoke('files:attach', null),
}))

let streamSeq = 0

contextBridge.exposeInMainWorld('osatLocalAI', Object.freeze({
  models: () => ipcRenderer.invoke('local-ai:models'),
  // The built-in AI: which size, the download, and whether the model is awake.
  status: () => ipcRenderer.invoke('ai:status'),
  choose: (tier) => ipcRenderer.invoke('ai:choose', tier),
  cancel: () => ipcRenderer.invoke('ai:cancel'),
  resume: () => ipcRenderer.invoke('ai:resume'),
  remove: (tier) => ipcRenderer.invoke('ai:remove', tier),
  onStatus: (listener) => {
    const handler = (_event, status) => listener(status)
    ipcRenderer.on('ai:status', handler)
    return () => ipcRenderer.removeListener('ai:status', handler)
  },
  // Streams deltas over a per-request channel. `done` resolves with the full text;
  // `cancel` stops it (an AbortSignal can't cross into the preload, a function can).
  chatStream: (payload, onDelta) => {
    const id = `stream-${++streamSeq}`
    const channel = `local-ai:delta:${id}`
    let streamed = ''
    const listener = (_event, text) => { if (typeof text === 'string') { streamed += text; onDelta(text) } }
    ipcRenderer.on(channel, listener)
    const done = ipcRenderer
      .invoke('local-ai:chat-stream', id, payload)
      .then((full) => {
        // The answer can come back before its last piece does (a fast cloud model sends them
        // in one go): whatever hasn't streamed yet is handed over now, once.
        if (typeof full === 'string' && full.length > streamed.length && full.startsWith(streamed)) onDelta(full.slice(streamed.length))
        return full
      })
      .finally(() => ipcRenderer.removeListener(channel, listener))
    return { done, cancel: () => ipcRenderer.send('local-ai:cancel', id) }
  },
}))

const listen = (channel, listener) => {
  const handler = (_event, ...args) => listener(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('osatBrowser', Object.freeze({
  state: () => ipcRenderer.invoke('browser:state'),
  open: (url) => ipcRenderer.invoke('browser:open', url),
  navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
  activate: (id) => ipcRenderer.invoke('browser:activate', id),
  close: (id) => ipcRenderer.invoke('browser:close', id),
  back: () => ipcRenderer.invoke('browser:back'),
  forward: () => ipcRenderer.invoke('browser:forward'),
  reload: () => ipcRenderer.invoke('browser:reload'),
  stop: () => ipcRenderer.invoke('browser:stop'),
  clip: () => ipcRenderer.invoke('browser:clip'),
  place: (rect) => ipcRenderer.send('browser:place', rect),
  onState: (listener) => listen('browser:state', listener),
}))

contextBridge.exposeInMainWorld('osatTerminal', Object.freeze({
  available: () => ipcRenderer.invoke('terminal:available'),
  list: () => ipcRenderer.invoke('terminal:list'),
  start: (size) => ipcRenderer.invoke('terminal:start', size),
  attach: (id) => ipcRenderer.invoke('terminal:attach', id),
  close: (id) => ipcRenderer.invoke('terminal:close', id),
  write: (id, data) => ipcRenderer.send('terminal:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  onData: (listener) => listen('terminal:data', listener),
  onExit: (listener) => listen('terminal:exit', listener),
}))

/* The workspace store in the main process. Windows send operations, never whole documents. */
contextBridge.exposeInMainWorld('osat', Object.freeze({
  store: Object.freeze({
    load: () => ipcRenderer.invoke('store:load'),
    commit: (ops) => ipcRenderer.invoke('store:commit', ops),
    commitSync: (ops) => {
      const result = ipcRenderer.sendSync('store:commit-sync', ops)
      if (result?.error) throw new Error(result.error)
      return result
    },
    replace: (doc) => ipcRenderer.invoke('store:replace', doc),
    onChange: (listener) => listen('store:changed', listener),
    onStatus: (listener) => listen('store:status', listener),
  }),
}))

contextBridge.exposeInMainWorld('osatApp', Object.freeze({
  about: () => ipcRenderer.invoke('app:about'),
  // The first-launch welcome shows once per Mac.
  needsWelcome: () => ipcRenderer.invoke('app:welcome'),
  welcomed: () => ipcRenderer.invoke('app:welcomed'),
  // The first-run tour shows once per Mac, after the welcome.
  needsTour: () => ipcRenderer.invoke('app:tour'),
  toured: () => ipcRenderer.invoke('app:toured'),
  showDataFolder: () => ipcRenderer.invoke('app:show-data-folder'),
  onCommand: (listener) => {
    const stop = listen('app:command', listener)
    ipcRenderer.send('app:listening')
    return stop
  },
}))

/* Your iPhone, through an OSAT folder in iCloud Drive: an Inbox and a copy of your notes. */
contextBridge.exposeInMainWorld('osatPhone', Object.freeze({
  status: () => ipcRenderer.invoke('phone:status'),
  enable: () => ipcRenderer.invoke('phone:enable'),
  disable: () => ipcRenderer.invoke('phone:disable'),
  show: () => ipcRenderer.invoke('phone:show'),
  onStatus: (listener) => listen('phone:status', listener),
}))

/* Bots (Settings → Bots): the drop folder where Muse and other bots save node files, cloud
   models (keys go straight to the Keychain in main; status never carries them) and the
   connector. */
contextBridge.exposeInMainWorld('osatBots', Object.freeze({
  status: () => ipcRenderer.invoke('bots:status'),
  showNodes: () => ipcRenderer.invoke('bots:show-nodes'),
  copyInstructions: () => ipcRenderer.invoke('bots:copy-instructions'),
  connect: (provider) => ipcRenderer.invoke('bots:connect', provider),
  removeProvider: (id) => ipcRenderer.invoke('bots:remove-provider', id),
  chooseModel: (model) => ipcRenderer.invoke('bots:choose-model', model),
  openPage: (url) => ipcRenderer.invoke('bots:open-page', url),
  // The connector (MCP, on this Mac only): its key never comes here, only to the clipboard.
  connectorOn: () => ipcRenderer.invoke('bots:connector-on'),
  connectorOff: () => ipcRenderer.invoke('bots:connector-off'),
  connectorReset: () => ipcRenderer.invoke('bots:connector-reset'),
  copySetup: (which) => ipcRenderer.invoke('bots:copy-setup', which),
  undoConnector: (at) => ipcRenderer.invoke('bots:undo-connector', at),
  onStatus: (listener) => listen('bots:status', listener),
}))

/* Scans: the folder a scanner saves to. The desk takes each sorted scan, imports it and
   says done. */
contextBridge.exposeInMainWorld('osatScans', Object.freeze({
  status: () => ipcRenderer.invoke('scans:status'),
  choose: () => ipcRenderer.invoke('scans:choose'),
  stop: () => ipcRenderer.invoke('scans:stop'),
  show: () => ipcRenderer.invoke('scans:show'),
  take: () => ipcRenderer.invoke('scans:take'),
  done: (id) => ipcRenderer.invoke('scans:done', id),
  onStatus: (listener) => listen('scans:status', listener),
  onReady: (listener) => listen('scans:ready', listener),
}))

/* The desk (⌥Space): put it away, the shortcuts, the app launchers, where things sit
   on it, Spotify, and the frosting behind it. */
contextBridge.exposeInMainWorld('osatDesk', Object.freeze({
  hide: () => ipcRenderer.send('desk:hide'),
  prefs: () => ipcRenderer.invoke('desk:prefs'),
  // which: 'layer' (⌥Space, the desk) or 'chat' (⌥⇧Space).
  setHotkey: (value, which = 'layer') => ipcRenderer.invoke('desk:set-hotkey', value, which),
  addLauncher: () => ipcRenderer.invoke('desk:add-launcher'),
  removeLauncher: (appPath) => ipcRenderer.invoke('desk:remove-launcher', appPath),
  launch: (appPath) => ipcRenderer.invoke('desk:launch', appPath),
  place: (id, spot) => ipcRenderer.invoke('desk:place', id, spot),
  tidy: () => ipcRenderer.invoke('desk:tidy'),
  setWidgets: (list) => ipcRenderer.invoke('desk:widgets', list),
  nowPlaying: () => ipcRenderer.invoke('media:now'),
  media: (action) => ipcRenderer.invoke('media:control', action),
  seek: (seconds) => ipcRenderer.invoke('media:seek', seconds),
  setClear: (clear) => ipcRenderer.send('desk:clear', clear === true),
  onShown: (listener) => listen('desk:shown', listener),
}))

/* The quick search (⌘⇧Space, desktop/launcher): what its panel and the desk ask of it. Files, the
   clipboard history and apps come from main; Return and ⌘K do their work through the calls below
   (each checks what it is given). Only the panel and the desk may ask. */
const search = (channel) => (...args) => ipcRenderer.invoke(`search:${channel}`, ...args)
contextBridge.exposeInMainWorld('osatSearch', Object.freeze({
  ready: search('ready'),
  settings: search('settings'),
  saveSettings: search('save-settings'),
  status: search('status'),
  askAccess: search('ask-access'),
  files: search('files'),
  preview: search('preview'),
  apps: search('apps'),
  appIcon: search('app-icon'),
  clipboard: search('clipboard'),
  clipboardImage: search('clipboard-image'),
  clipboardText: search('clipboard-text'),
  pauseClipboard: search('clipboard-pause'),
  clearClipboard: search('clipboard-clear'),
  openFile: search('open-file'),
  revealFile: search('reveal-file'),
  copyPath: search('copy-path'),
  trashFile: search('trash-file'),
  undoFile: search('undo-file'),
  pinFile: search('pin-file'),
  pasteClip: search('paste-clip'),
  copyClip: search('copy-clip'),
  pinClip: search('pin-clip'),
  forgetClip: search('forget-clip'),
  undoClip: search('undo-clip'),
  copyText: search('copy-text'),
  pasteText: search('paste-text'),
  openApp: search('open-app'),
  openAppNamed: search('open-app-named'),
  revealApp: search('reveal-app'),
  openLink: search('open-link'),
  snap: search('snap'),
  // The desk's own ring (⌘ + middle-click) opens the quick search over it, on a tab.
  show: search('show'),
  hide: search('hide'),
  mode: search('mode'),
  openInOSAT: search('open-in-osat'),
  onShown: (listener) => listen('search:shown', listener),
  onEscape: (listener) => listen('search:escape', listener),
  onSettings: (listener) => listen('launcher:changed', listener),
  // A new copy arrived on the clipboard ({ id, kind, at, text?, app? }); only the desk hears it.
  onCopied: (listener) => listen('clipboard:copied', listener),
}))

/* The ring's small window over other apps (Hyper R): it draws the tools (settings come from osatSearch), and says
   which was picked or that it should go. */
contextBridge.exposeInMainWorld('osatRing', Object.freeze({
  ready: () => ipcRenderer.invoke('ring:ready'),
  pick: (id) => ipcRenderer.invoke('ring:pick', id),
  hide: () => ipcRenderer.invoke('ring:hide'),
  onShown: (listener) => listen('ring:shown', listener),
  onEscape: (listener) => listen('ring:escape', listener),
}))

/* Offline: OSAT with the internet off. status() → { on, terminal }; set(on) answers
   once main has paused (or woken) everything, and only the desk may ask. onChange
   hears every change, including ⇧⌘U and the menu-bar icon; when one of those didn't
   work, the status also carries `error`, one plain line to show. */
contextBridge.exposeInMainWorld('osatUnder', Object.freeze({
  status: () => ipcRenderer.invoke('under:status'),
  set: (on) => ipcRenderer.invoke('under:set', on === true),
  onChange: (listener) => listen('under:changed', listener),
}))

/* The quick chat: pop a chat out of any window, and, inside it, put it away or move it
   to the main window. */
contextBridge.exposeInMainWorld('osatChat', Object.freeze({
  show: (detail) => ipcRenderer.invoke('chat:show', detail),
  hide: () => ipcRenderer.send('chat:hide'),
  openInWindow: (view, detail) => ipcRenderer.send('chat:open-in-window', view, detail),
  onShown: (listener) => listen('chat:shown', listener),
  onEscape: (listener) => listen('chat:escape', listener),
}))
