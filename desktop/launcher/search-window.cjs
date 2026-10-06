/* The quick bar (Phase 13, one bar since 13c): a bar that floats over every app on every Space. On the Mac it is a
   panel, so the app you were in keeps focus while you type, and Paste goes back into it. It opens as a small bar;
   typing (or a source's Hyper key) opens the full view: results on the left, a big preview on the right; Ask opens it
   as a chat. It sits in the upper third of the screen under the cursor until it is dragged somewhere; then it opens
   where it was left (`spot`, its top middle, kept in prefs.json) while that is on a screen. It goes when you click
   away (on the Mac). */
const { displayAt } = require('../desk.cjs')

const BAR = { width: 700, height: 76 }
const FULL = { width: 1000, height: 580 }
const CHAT = { width: 700, height: 620 }
const SIZES = { bar: BAR, full: FULL, chat: CHAT }

const within = (area, point) => point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height
const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high))

/* The window for `mode` ('bar', 'full' or 'chat') with its top middle at `top` ({ x, y }), kept inside `area`. */
function fitAt(mode, area, top) {
  const { width, height } = SIZES[mode] || BAR
  const w = Math.min(width, area.width - 32)
  const h = Math.min(height, area.height - 48)
  return { x: Math.round(clamp(top.x - w / 2, area.x, area.x + area.width - w)), y: Math.round(clamp(top.y, area.y, area.y + area.height - h)), width: w, height: h }
}

/* Where it opens: where it was dragged to (`spot`, its top middle) while that is on a screen, else centred on the
   display under the cursor, a fifth of the way down. */
function searchBounds(mode, displays, point, spot = null) {
  const kept = spot && Number.isFinite(spot.x) && Number.isFinite(spot.y) ? displays.find((display) => within(display.workArea, spot)) : null
  if (kept) return fitAt(mode, kept.workArea, spot)
  const area = displayAt(displays, point).workArea
  return fitAt(mode, area, { x: area.x + area.width / 2, y: area.y + area.height * 0.18 })
}

function createQuickSearch({ BrowserWindow, screen, platform, preload, load, hideOnBlur = false, onHide = () => {}, view = () => 'bar', spot = null, onMoved = () => {} }) {
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
    title: 'OSAT',
    ...(mac ? { type: 'panel', vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  })
  // skipTransformProcessType: without it Electron hides OSAT's Dock icon and activates the Dock app on every call (the
  // Dock bug, Phase 13c). A panel shows over full-screen apps without that.
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  window.setAlwaysOnTop(true, 'floating')
  load(window)

  let mode = 'bar'
  let shownAt = 0
  let placed = spot
  // Only a move Nate made is remembered; OSAT's own placing (open, grow, shrink) is not.
  let dragging = false
  let placingAt = 0
  const place = (bounds) => { placingAt = Date.now(); window.setBounds(bounds) }
  window.on('will-move', () => { if (Date.now() - placingAt > 250) dragging = true })
  window.on('moved', () => {
    if (!dragging) return
    dragging = false
    const bounds = window.getBounds()
    placed = { x: Math.round(bounds.x + bounds.width / 2), y: bounds.y }
    onMoved(placed)
  })
  const send = (channel, ...args) => { if (!window.isDestroyed()) window.webContents.send(channel, ...args) }
  const areaOf = (bounds) => displayAt(screen.getAllDisplays(), { x: bounds.x + bounds.width / 2, y: bounds.y }).workArea
  const resize = (next) => { const bounds = window.getBounds(); place(fitAt(next, areaOf(bounds), { x: bounds.x + bounds.width / 2, y: bounds.y })) }

  /* `scope` opens on one source ('clipboard' from Hyper V); `expanded` opens the full view straight away (Settings can
     make that the way it always opens); `text` is words waiting in the field (a quick link's word); `view` is 'chat'
     for Ask (`chat`: { chatId } or { prompt } to open) or 'sticky' to write a sticky. */
  function show({ scope = 'all', expanded = view() === 'full', text = '', view: page = 'search', chat = null } = {}) {
    mode = page === 'chat' ? 'chat' : page === 'sticky' ? 'bar' : expanded || scope !== 'all' ? 'full' : 'bar'
    if (!window.isVisible()) place(searchBounds(mode, screen.getAllDisplays(), screen.getCursorScreenPoint(), placed))
    else resize(mode)
    shownAt = Date.now()
    window.show()
    window.focus()
    window.webContents.focus()
    send('search:shown', { scope, mode, text: String(text).slice(0, 200), view: page, chat })
  }
  function hide() {
    if (window.isDestroyed() || !window.isVisible()) return
    window.hide()
    onHide()
  }
  // The shortcut brings it up, and puts it away when it is already in front on the same page (the Ask key over the
  // search switches to Ask instead).
  const toggle = (options = {}) => (window.isVisible() && window.isFocused() && (mode === 'chat') === (options.view === 'chat') ? hide() : show(options))

  /* The page asks for the bar, the full view or the chat; the window keeps its top and its middle. */
  function setMode(next) {
    if (!SIZES[next] || next === mode || !window.isVisible()) return
    mode = next
    resize(next)
  }

  window.on('blur', () => { if (hideOnBlur && Date.now() - shownAt > 400) hide() })

  return { window, show, hide, toggle, setMode, owns: (contents) => !window.isDestroyed() && contents === window.webContents, send }
}

module.exports = { BAR, FULL, CHAT, createQuickSearch, fitAt, searchBounds }
