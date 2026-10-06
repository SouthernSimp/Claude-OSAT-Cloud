/* The ring's window (Phase 13): a small see-through panel that opens with its middle under the pointer, over any
   app on any Space, and goes when you click away or pick something. Like the quick search it is a panel, so the app
   you were in keeps focus (a layout then moves that app's window). */
const { displayAt } = require('../desk.cjs')

const SIZE = 340

/* The same as shared/ring-model.mjs ringBounds (main can't import an ES module here synchronously). */
function ringBounds(point, area, size = SIZE) {
  const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high))
  return {
    x: Math.round(clamp(point.x - size / 2, area.x, area.x + area.width - size)),
    y: Math.round(clamp(point.y - size / 2, area.y, area.y + area.height - size)),
    width: size,
    height: size,
  }
}

function createRing({ BrowserWindow, screen, platform, preload, load, hideOnBlur = false, onHide = () => {} }) {
  const window = new BrowserWindow({
    show: false,
    width: SIZE,
    height: SIZE,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'OSAT Ring',
    ...(platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  window.setAlwaysOnTop(true, 'floating')
  load(window)

  let ready = false
  let waiting = false
  let shownAt = 0
  window.webContents.on('did-start-loading', () => { ready = false })
  const send = (channel, ...args) => { if (!window.isDestroyed()) window.webContents.send(channel, ...args) }

  function show() {
    const point = screen.getCursorScreenPoint()
    window.setBounds(ringBounds(point, displayAt(screen.getAllDisplays(), point).workArea))
    shownAt = Date.now()
    window.show()
    window.focus()
    window.webContents.focus()
    if (ready) send('ring:shown')
    else waiting = true
  }
  function hide() {
    if (window.isDestroyed() || !window.isVisible()) return
    window.hide()
    onHide()
  }
  const toggle = () => (window.isVisible() && window.isFocused() ? hide() : show())

  window.on('blur', () => { if (hideOnBlur && Date.now() - shownAt > 300) hide() })

  return {
    window,
    show,
    hide,
    toggle,
    send,
    // The page says when it is listening; a key pressed while it loads still shows the ring.
    ready() { ready = true; if (waiting) { waiting = false; send('ring:shown') } },
    owns: (contents) => !window.isDestroyed() && contents === window.webContents,
  }
}

module.exports = { SIZE, createRing, ringBounds }
