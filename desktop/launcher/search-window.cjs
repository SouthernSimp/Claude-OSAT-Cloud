/* The quick search window (Phase 13): a bar that floats over every app on every Space, like the quick
   chat. On the Mac it is a panel, so the app you were in keeps focus while you type, and Paste goes
   back into it. It opens as a small bar; typing (or a source's Hyper key) opens the full view: results
   on the left, a big preview on the right. It sits in the upper third of the screen under the cursor
   each time, and goes when you click away (on the Mac). */
const { displayAt } = require('../desk.cjs')

const BAR = { width: 700, height: 76 }
const FULL = { width: 1000, height: 580 }
const SIZES = { bar: BAR, full: FULL }

/* Centred on the display under the cursor, a fifth of the way down; `mode` is 'bar' or 'full'. */
function searchBounds(mode, displays, point) {
  const area = displayAt(displays, point).workArea
  const { width, height } = SIZES[mode] || BAR
  const w = Math.min(width, area.width - 32)
  return { x: Math.round(area.x + (area.width - w) / 2), y: Math.round(area.y + area.height * 0.18), width: w, height: Math.min(height, area.height - 48) }
}

function createQuickSearch({ BrowserWindow, screen, platform, preload, load, hideOnBlur = false, onHide = () => {}, view = () => 'bar' }) {
  const mac = platform === 'darwin'
  const window = new BrowserWindow({
    show: false,
    ...BAR,
    frame: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'OSAT Search',
    ...(mac ? { type: 'panel', vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setAlwaysOnTop(true, 'floating')
  load(window)

  let mode = 'bar'
  let shownAt = 0
  const send = (channel, ...args) => { if (!window.isDestroyed()) window.webContents.send(channel, ...args) }

  /* `scope` opens on one source ('clipboard' from Hyper V); `expanded` opens the full view straight away (Settings →
     Launcher can make that the way it always opens). */
  function show({ scope = 'all', expanded = view() === 'full' } = {}) {
    mode = expanded || scope !== 'all' ? 'full' : 'bar'
    if (!window.isVisible()) window.setBounds(searchBounds(mode, screen.getAllDisplays(), screen.getCursorScreenPoint()))
    else window.setBounds({ ...window.getBounds(), ...SIZES[mode] })
    shownAt = Date.now()
    window.show()
    window.focus()
    window.webContents.focus()
    send('search:shown', { scope, mode })
  }
  function hide() {
    if (window.isDestroyed() || !window.isVisible()) return
    window.hide()
    onHide()
  }
  // The shortcut brings it up, and puts it away when it is already in front.
  const toggle = (options) => (window.isVisible() && window.isFocused() ? hide() : show(options))

  /* The page asks for the bar or the full view; the window keeps its top and its middle. */
  function setMode(next) {
    if (!SIZES[next] || next === mode || !window.isVisible()) return
    mode = next
    const bounds = window.getBounds()
    const { width, height } = SIZES[next]
    const w = Math.min(width, displayAt(screen.getAllDisplays(), { x: bounds.x, y: bounds.y }).workArea.width - 32)
    window.setBounds({ x: Math.round(bounds.x + (bounds.width - w) / 2), y: bounds.y, width: w, height })
  }

  window.on('blur', () => { if (hideOnBlur && Date.now() - shownAt > 400) hide() })

  return { window, show, hide, toggle, setMode, owns: (contents) => !window.isDestroyed() && contents === window.webContents, send }
}

module.exports = { BAR, FULL, createQuickSearch, searchBounds }
