/* OSAT's one window (Phase 73: a Mac window with a sidebar; until then a see-through desk over the screen). ⌥Space
   brings it up (or forward), and puts it away when it is already in front. These are the pure pieces; main.cjs owns
   the window. */

const DEFAULT_HOTKEY = 'Alt+Space'
// The quick bar (Phase 13, one bar since 13c; one key for it since Oct 2026). ⌥Space is the desk, ⌥⇧Space the bar. ⌘⇧Space
// was its first key, but Apple's own AI holds it on newer Macs, so a saved ⌘⇧Space becomes ⌥⇧Space (OLD_SEARCH_HOTKEY).
const DEFAULT_SEARCH_HOTKEY = 'Alt+Shift+Space'
const OLD_SEARCH_HOTKEY = 'Command+Shift+Space'
const MODIFIERS = new Set(['Command', 'Control', 'Alt', 'Shift'])

/* The display under the cursor, or the first one. */
function displayAt(displays, point) {
  const inside = (d) => point.x >= d.bounds.x && point.x < d.bounds.x + d.bounds.width
    && point.y >= d.bounds.y && point.y < d.bounds.y + d.bounds.height
  return displays.find(inside) || displays[0]
}

/* Where the window opens (Phase 73): where it was left, while that is still mostly on a screen; else 1280 × 820 (or
   what fits) in the middle of the screen under the cursor. */
const WINDOW_SIZE = { width: 1280, height: 820 }
function windowSpot(saved, displays, point) {
  const ok = saved && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved[key])) && saved.width >= 600 && saved.height >= 400
  const shown = (area) => Math.max(0, Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x))
    * Math.max(0, Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y))
  if (ok && displays.some((display) => shown(display.workArea) >= saved.width * saved.height * 0.5)) {
    return { x: Math.round(saved.x), y: Math.round(saved.y), width: Math.round(saved.width), height: Math.round(saved.height) }
  }
  const area = displayAt(displays, point).workArea
  const width = Math.min(WINDOW_SIZE.width, area.width - 40)
  const height = Math.min(WINDOW_SIZE.height, area.height - 40)
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height }
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

module.exports = { DEFAULT_HOTKEY, DEFAULT_SEARCH_HOTKEY, OLD_SEARCH_HOTKEY, accentCss, deskAction, displayAt, hotkeyLabel, validHotkey, windowSpot }
