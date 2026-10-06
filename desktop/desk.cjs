/* The desk: OSAT's one window. It fills the screen under the cursor, see-through
   with macOS vibrancy so the real desktop shows blurred behind it. ⌥Space brings it
   up (or forward), and puts it away when it is already in front. These are the pure
   pieces; main.cjs owns the window. */

const DEFAULT_HOTKEY = 'Alt+Space'
// The quick bar (Phase 13, one bar since 13c). ⌥Space is the desk and ⌥⇧Space opens the bar on Ask; ⌘⇧Space is free on a Mac.
const DEFAULT_SEARCH_HOTKEY = 'Command+Shift+Space'
const MODIFIERS = new Set(['Command', 'Control', 'Alt', 'Shift'])

/* The display under the cursor, or the first one. */
function displayAt(displays, point) {
  const inside = (d) => point.x >= d.bounds.x && point.x < d.bounds.x + d.bounds.width
    && point.y >= d.bounds.y && point.y < d.bounds.y + d.bounds.height
  return displays.find(inside) || displays[0]
}

/* The same rectangle: the desk is fitted only when it would change, so showing it never moves a window that
   is already where it belongs. */
const sameBounds = (a, b) => Boolean(a && b) && ['x', 'y', 'width', 'height'].every((key) => a[key] === b[key])

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

/* A stack of stickies on the desk (Phase 27, 'stack:<id>'): which stickies stand in it, in
   order, its name and whether it is folded. A stack with no stickies isn't kept. */
function stackOf(spot) {
  const ids = Array.isArray(spot?.ids) ? [...new Set(spot.ids.filter((id) => typeof id === 'string' && /^[\w.-]{1,120}$/.test(id)))].slice(0, 200) : []
  return {
    ids,
    ...(typeof spot?.name === 'string' && spot.name.trim() ? { name: spot.name.trim().slice(0, 80) } : {}),
    ...(spot?.folded === true ? { folded: true } : {}),
  }
}

/* Where Nate set a widget, an icon or a sticky down on the desk, as fractions of the desk
   (so it survives a different display); a sticky also keeps its size in points. null
   puts it back in its usual place. */
function placeItem(places, id, spot) {
  if (typeof id !== 'string' || !/^[\w:.-]{1,120}$/.test(id)) return places
  const next = { ...places }
  delete next[id]
  if (spot === null) return next
  const x = Number(spot?.x)
  const y = Number(spot?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return places
  const w = Number(spot?.w)
  const h = Number(spot?.h)
  const stack = id.startsWith('stack:') ? stackOf(spot) : null
  if (stack && !stack.ids.length) return next
  next[id] = {
    x: Math.min(Math.max(x, 0), 0.97),
    y: Math.min(Math.max(y, 0), 0.97),
    ...(Number.isFinite(w) && Number.isFinite(h) ? { w: Math.round(Math.min(Math.max(w, 120), 720)), h: Math.round(Math.min(Math.max(h, 90), 720)) } : {}),
    ...stack,
  }
  // ponytail: oldest spots drop off past 600 (stickies included); a desk that full wants sorting
  return Object.fromEntries(Object.entries(next).slice(-600))
}

/* Which widgets are out on the desk, in order. Only the shape is checked (the desk ignores
   ids it doesn't know): up to five distinct short ids. Not a list: the desk's defaults. */
function pickWidgets(list) {
  if (!Array.isArray(list)) return null
  return [...new Set(list.filter((id) => typeof id === 'string' && /^[a-z-]{1,24}$/.test(id)))].slice(0, 5)
}

/* The Mac's accent colour ("RRGGBBAA", from System Settings → Appearance) as the page's
   accent, with dark text on light accents (yellow) and white on the rest. */
function accentCss(value) {
  const hex = String(value || '').slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(hex)) return ''
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45
  return `:root { --mac-accent: #${hex.toLowerCase()}; --mac-accent-ink: ${light ? '#1d1d1f' : '#ffffff'}; }`
}

/* What ⌥Space does: show a hidden desk, bring forward one behind other apps, put away
   the one you are looking at. */
function deskAction({ visible, focused }) {
  if (!visible) return 'show'
  return focused ? 'hide' : 'show'
}

module.exports = { DEFAULT_HOTKEY, DEFAULT_SEARCH_HOTKEY, accentCss, addLauncher, placeItem, pickWidgets, deskAction, displayAt, hotkeyLabel, sameBounds, validHotkey }
