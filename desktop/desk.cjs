/* The desk: OSAT's one window. It fills the screen under the cursor, see-through
   with macOS vibrancy so the real desktop shows blurred behind it. ⌥Space brings it
   up (or forward), and puts it away when it is already in front. These are the pure
   pieces; main.cjs owns the window. */

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

/* Where Nate set a widget or icon down on the desk, as fractions of the desk
   (so it survives a different display). null puts it back in its usual place. */
function placeItem(places, id, spot) {
  if (typeof id !== 'string' || !/^[\w:.-]{1,120}$/.test(id)) return places
  const next = { ...places }
  delete next[id]
  if (spot === null) return next
  const x = Number(spot?.x)
  const y = Number(spot?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return places
  next[id] = { x: Math.min(Math.max(x, 0), 0.97), y: Math.min(Math.max(y, 0), 0.97) }
  // ponytail: oldest spots drop off past 200; nobody sets down that many things
  return Object.fromEntries(Object.entries(next).slice(-200))
}

/* What ⌥Space does: show a hidden desk, bring forward one behind other apps, put away
   the one you are looking at. */
function deskAction({ visible, focused }) {
  if (!visible) return 'show'
  return focused ? 'hide' : 'show'
}

module.exports = { DEFAULT_HOTKEY, addLauncher, placeItem, deskAction, displayAt, hotkeyLabel, validHotkey }
