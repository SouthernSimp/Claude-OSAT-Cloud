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

contextBridge.exposeInMainWorld('osatSecrets', Object.freeze({
  status: () => ipcRenderer.invoke('secrets:status'),
  keys: () => ipcRenderer.invoke('secrets:keys'),
  set: (key, value) => ipcRenderer.invoke('secrets:set', key, value),
  delete: (key) => ipcRenderer.invoke('secrets:delete', key),
}))

let streamSeq = 0

contextBridge.exposeInMainWorld('osatLocalAI', Object.freeze({
  models: () => ipcRenderer.invoke('local-ai:models'),
  chat: (payload) => ipcRenderer.invoke('local-ai:chat', payload),
  // Streams deltas over a per-request channel, then resolves with the full text.
  chatStream: (payload, onDelta, signal) => {
    const id = `stream-${++streamSeq}`
    const channel = `local-ai:delta:${id}`
    const listener = (_event, text) => { if (typeof text === 'string') onDelta(text) }
    ipcRenderer.on(channel, listener)
    const abort = () => ipcRenderer.send('local-ai:cancel', id)
    signal?.addEventListener('abort', abort, { once: true })
    return ipcRenderer
      .invoke('local-ai:chat-stream', id, payload)
      .finally(() => {
        ipcRenderer.removeListener(channel, listener)
        signal?.removeEventListener('abort', abort)
      })
  },
}))

contextBridge.exposeInMainWorld('osatQuickCapture', Object.freeze({
  submit: (text) => ipcRenderer.send('quick-capture:submit', text),
  onCapture: (listener) => {
    const handler = (_event, text) => { if (typeof text === 'string') listener(text) }
    ipcRenderer.on('quick-capture:received', handler)
    return () => ipcRenderer.removeListener('quick-capture:received', handler)
  },
}))

contextBridge.exposeInMainWorld('osatWindows', Object.freeze({
  openAssistant: () => ipcRenderer.invoke('app:open-assistant'),
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

contextBridge.exposeInMainWorld('osatApp', Object.freeze({
  onCommand: (listener) => listen('app:command', listener),
}))
