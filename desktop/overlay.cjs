/* The OSAT layer: one full-screen, see-through window over the real desktop.
   On the Mac it is a non-activating panel with vibrancy, so the desktop shows
   blurred behind it, it floats over full-screen apps and follows you to every
   Space, and the app you were in keeps focus when it hides. It is created
   hidden at launch and only ever hidden, never closed, so it opens instantly.

   Everything Electron-specific is passed in, so the pure pieces can be tested. */

const DEFAULT_HOTKEY = 'Alt+Space'
const MODIFIERS = new Set(['Command', 'Control', 'Alt', 'Shift'])

/* The display under the cursor, or the first one. */
function displayAt(displays, point) {
  const inside = (d) => point.x >= d.bounds.x && point.x < d.bounds.x + d.bounds.width
    && point.y >= d.bounds.y && point.y < d.bounds.y + d.bounds.height
  return displays.find(inside) || displays[0]
}

/* A hotkey is one or more modifiers plus one key, e.g. "Alt+Space" or "Control+Shift+O". */
function validHotkey(value) {
  if (typeof value !== 'string' || value.length > 40) return false
  const parts = value.split('+')
  const key = parts.pop()
  return parts.length > 0 && parts.every((part) => MODIFIERS.has(part)) && new Set(parts).size === parts.length
    && /^([A-Z0-9]|F([1-9]|1[0-9])|Space|Tab|Return|Up|Down|Left|Right|[`\-=[\];',./\\])$/.test(key)
}

/* "Alt+Space" → "⌥Space" for menus and Settings. */
function hotkeyLabel(value) {
  const symbols = { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' }
  return String(value || '').split('+').map((part) => symbols[part] || part).join('')
}

/* Launchers are Mac apps Nate picked. Only a real .app path is kept, once. */
function addLauncher(list, appPath) {
  if (typeof appPath !== 'string' || !/^\/.+\.app$/.test(appPath) || list.some((item) => item.path === appPath)) return list
  const name = appPath.split('/').pop().replace(/\.app$/, '')
  return [...list, { path: appPath, name }].slice(0, 12)
}

function createOverlay({ BrowserWindow, screen, platform, preload, load, onBlur }) {
  const mac = platform === 'darwin'
  const window = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'OSAT',
    ...(mac ? { type: 'panel', vibrancy: 'fullscreen-ui', visualEffectState: 'active' } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
  })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setAlwaysOnTop(true, 'floating')
  // Switching to another app puts the layer away, like Spotlight.
  window.on('blur', () => onBlur?.())
  load(window)

  const visible = () => window.isVisible()
  function show() {
    // The usable area: the Mac's menu bar and Dock stay visible and reachable.
    window.setBounds(displayAt(screen.getAllDisplays(), screen.getCursorScreenPoint()).workArea)
    window.show()
    window.focus()
    window.webContents.focus()
    window.webContents.send('overlay:shown')
  }
  function hide() {
    if (visible()) window.hide()
  }
  return { window, show, hide, visible, toggle: () => (visible() ? hide() : show()) }
}

module.exports = { DEFAULT_HOTKEY, addLauncher, createOverlay, displayAt, hotkeyLabel, validHotkey }
