/* The quick chat: a small Ask window that floats over every app, on every Space,
   and stays where you leave it. On the Mac it is a panel, so the app you were in
   keeps focus while you type. ⌥⇧Space shows it (or brings it forward); Esc puts it away. */
const { displayAt } = require('./overlay.cjs')

const SIZE = { width: 420, height: 600 }

/* Where it was left, if that is still on a screen; otherwise the top right of the
   screen under the cursor. */
function chatBounds(saved, displays, point) {
  const fits = (area) => saved.x < area.x + area.width && saved.y < area.y + area.height
    && saved.x + saved.width > area.x && saved.y + saved.height > area.y
  if (saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) && displays.some((d) => fits(d.workArea))) return saved
  const area = displayAt(displays, point).workArea
  return { x: area.x + area.width - SIZE.width - 24, y: area.y + 24, ...SIZE }
}

function createQuickChat({ BrowserWindow, screen, platform, preload, load, saved = null, onMoved }) {
  const mac = platform === 'darwin'
  const window = new BrowserWindow({
    show: false,
    ...SIZE,
    minWidth: 340,
    minHeight: 380,
    frame: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'OSAT Chat',
    ...(mac ? { type: 'panel', vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setAlwaysOnTop(true, 'floating')
  load(window)

  let placed = saved
  const remember = () => {
    placed = window.getBounds()
    onMoved?.(placed)
  }
  window.on('moved', remember)
  window.on('resized', remember)

  /* `detail` opens a chat ({ chatId }) or starts one ({ prompt }). */
  function show(detail = null) {
    if (!window.isVisible()) window.setBounds(chatBounds(placed, screen.getAllDisplays(), screen.getCursorScreenPoint()))
    window.show()
    window.focus()
    window.webContents.focus()
    window.webContents.send('chat:shown', detail)
  }
  const hide = () => { if (window.isVisible()) window.hide() }
  // The shortcut brings a chat left floating behind your work forward; pressed again, it goes.
  const toggle = () => (window.isVisible() && window.isFocused() ? hide() : show())
  return { window, show, hide, toggle }
}

module.exports = { SIZE, chatBounds, createQuickChat }
