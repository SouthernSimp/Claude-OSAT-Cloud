/* Which keys are already taken (Settings → Shortcuts → Keys in use). Pure: main reads the Mac's own list
   (desktop/mac-keys.cjs) and this turns it into the same "Command+Shift+Space" keys OSAT records. */

// Carbon key codes (what macOS stores) → the names src/lib/hotkey.js records.
const CODES = {
  0: 'A', 11: 'B', 8: 'C', 2: 'D', 14: 'E', 3: 'F', 5: 'G', 4: 'H', 34: 'I', 38: 'J', 40: 'K', 37: 'L', 46: 'M', 45: 'N', 31: 'O', 35: 'P', 12: 'Q',
  15: 'R', 1: 'S', 17: 'T', 32: 'U', 9: 'V', 13: 'W', 7: 'X', 16: 'Y', 6: 'Z', 29: '0', 18: '1', 19: '2', 20: '3', 21: '4', 23: '5', 22: '6', 26: '7',
  28: '8', 25: '9', 49: 'Space', 48: 'Tab', 36: 'Return', 123: 'Left', 124: 'Right', 125: 'Down', 126: 'Up', 53: 'Esc', 50: '`',
  122: 'F1', 120: 'F2', 99: 'F3', 118: 'F4', 96: 'F5', 97: 'F6', 98: 'F7', 100: 'F8', 101: 'F9', 109: 'F10', 103: 'F11', 111: 'F12',
}
const MODIFIERS = [['Command', 0x100000], ['Control', 0x40000], ['Alt', 0x80000], ['Shift', 0x20000]]
const ORDER = MODIFIERS.map(([name]) => name)

// The ids of com.apple.symbolichotkeys we are sure of; any other enabled one is "Another Mac shortcut".
const NAMES = {
  27: 'Next window of the app', 28: 'Screenshot of the screen', 30: 'Screenshot of an area', 32: 'Mission Control', 33: 'App windows',
  36: 'Show Desktop', 52: 'Hide the Dock', 60: 'Previous input source', 61: 'Next input source', 64: 'Spotlight', 65: 'Finder search',
  79: 'Move left a Space', 81: 'Move right a Space', 184: 'Screenshot options',
}
for (let n = 1; n <= 9; n += 1) NAMES[117 + n] = `Switch to Desktop ${n}`

// Keys that only work while OSAT is in front (the menus and the desk), so they don't clash with other apps.
export const INSIDE_OSAT = Object.freeze([
  { name: 'Find anything', combo: 'Command+K' },
  { name: 'New sticky', combo: 'Command+Shift+N' },
  { name: 'Go offline / online', combo: 'Command+Shift+U' },
  { name: 'New Terminal', combo: 'Command+Shift+T' },
])

/* Same key whatever order its parts were written in. */
export function normalizeCombo(combo) {
  const parts = String(combo || '').split('+')
  const key = parts.pop()
  const mods = ORDER.filter((name) => parts.includes(name))
  return [...mods, String(key).length === 1 ? String(key).toUpperCase() : key].join('+')
}

/* One symbolic hotkey's [ascii, keyCode, modifierFlags] → "Command+Shift+Space", or null when it has no
   key we can name (Fn, a bare modifier) or no modifier at all. */
export function comboOfSymbolic(parameters) {
  if (!Array.isArray(parameters)) return null
  const [, code, flags] = parameters
  const key = CODES[code]
  if (!key || !Number.isInteger(flags) || flags & 0x800000) return null
  const mods = MODIFIERS.filter(([, bit]) => flags & bit).map(([name]) => name)
  return mods.length ? [...mods, key].join('+') : null
}

/* `plutil -convert json` of ~/Library/Preferences/com.apple.symbolichotkeys.plist → the shortcuts that are on. */
export function fromSymbolic(json) {
  const rows = []
  for (const [id, entry] of Object.entries(json?.AppleSymbolicHotKeys || {})) {
    const combo = entry?.enabled ? comboOfSymbolic(entry?.value?.parameters) : null
    if (combo) rows.push({ name: NAMES[id] || 'Another Mac shortcut', combo })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/* Everything taken, in groups: what OSAT opens from anywhere, the launcher's keys, OSAT's own, and the Mac's. */
export function keyGroups({ desk = [], launcher = [], mac = [] }) {
  return [
    { id: 'desk', title: 'OSAT, from any app', rows: desk },
    { id: 'launcher', title: 'OSAT’s launcher keys', rows: launcher },
    { id: 'inside', title: 'Inside OSAT only', rows: INSIDE_OSAT },
    { id: 'mac', title: 'Your Mac', rows: mac },
  ].map((group) => ({ ...group, rows: group.rows.filter((row) => row.combo) })).filter((group) => group.rows.length)
}

/* Who holds this key, as [{ name, group }] (nobody: an empty list). */
export function holdersOf(groups, combo) {
  const wanted = normalizeCombo(combo)
  return groups.flatMap((group) => group.rows.filter((row) => normalizeCombo(row.combo) === wanted).map((row) => ({ name: row.name, group: group.id })))
}
