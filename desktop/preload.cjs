const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nateOSFiles', Object.freeze({
  choose: (kind) => ipcRenderer.invoke('files:choose', kind),
  roots: () => ipcRenderer.invoke('files:roots'),
  list: (rootId, relative = '') => ipcRenderer.invoke('files:list', rootId, relative),
  readText: (rootId, relative = '') => ipcRenderer.invoke('files:read-text', rootId, relative),
  writeText: (rootId, relative, content, expectedHash) => (
    ipcRenderer.invoke('files:write-text', rootId, relative, content, expectedHash)
  ),
  open: (rootId, relative = '') => ipcRenderer.invoke('files:open', rootId, relative),
  forget: (rootId) => ipcRenderer.invoke('files:forget', rootId),
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
    const listener = (_event, text) => { if (typeof text === 'string') onDelta(text) }
    ipcRenderer.on(channel, listener)
    const done = ipcRenderer
      .invoke('local-ai:chat-stream', id, payload)
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

/* The ⌥Space layer: hide it, hand a pop-out to the main window, the hotkey, the app launchers,
   where things sit on it, and Spotify. */
contextBridge.exposeInMainWorld('osatOverlay', Object.freeze({
  hide: () => ipcRenderer.send('overlay:hide'),
  openInWindow: (view, detail) => ipcRenderer.send('overlay:open-in-window', view, detail),
  prefs: () => ipcRenderer.invoke('overlay:prefs'),
  setHotkey: (value) => ipcRenderer.invoke('overlay:set-hotkey', value),
  addLauncher: () => ipcRenderer.invoke('overlay:add-launcher'),
  removeLauncher: (appPath) => ipcRenderer.invoke('overlay:remove-launcher', appPath),
  launch: (appPath) => ipcRenderer.invoke('overlay:launch', appPath),
  place: (id, spot) => ipcRenderer.invoke('overlay:place', id, spot),
  tidy: () => ipcRenderer.invoke('overlay:tidy'),
  nowPlaying: () => ipcRenderer.invoke('media:now'),
  media: (action) => ipcRenderer.invoke('media:control', action),
  setClear: (clear) => ipcRenderer.send('overlay:clear', clear === true),
  onShown: (listener) => listen('overlay:shown', listener),
  onEscape: (listener) => listen('overlay:escape', listener),
}))
