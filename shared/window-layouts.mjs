/* Window snapping (Phase 13, grown in Phase 61): the commands that move a window (halves, thirds, fourths, sixths,
   ninths, corners, centre, bigger, smaller, nudges, screens), where each one puts a window on a screen, which screen a
   window is on, and the words that find one. Nate's own commands (`windows.custom` in launcher.json: a name and a
   rectangle in percent of the screen) are the same kind of thing and run through the same rect maths. Restore is not a
   place: OSAT remembers where a window was before it moved it (desktop/launcher/snap.cjs). Pure. */

const GROUPS = [
  ['halves', 'Halves'], ['quarters', 'Quarters'], ['thirds', 'Thirds'], ['fourths', 'Fourths'], ['sixths', 'Sixths'],
  ['ninths', 'Ninths'], ['size', 'Size and middle'], ['move', 'Move'], ['screens', 'Screens and undo'],
]
export const LAYOUT_GROUPS = GROUPS.map(([id, title]) => ({ id, title }))

/* A box is [x, y, width, height], each a fraction of the screen's work area (below the menu bar, beside the Dock).
   `key` is the usual key for it when window keys are on (Settings → Window layouts); the same keys Rectangle uses.
   The newer commands have none: Nate gives them one. `op` is for the ones that are not a place. */
const at = (id, label, box, group, key = null, words = '') => ({ id, label, key, box, group, ...(words ? { words } : {}) })
/* One cell of a grid: cell(3, 2, 1, 0) is the top middle of six. */
const cell = (cols, rows, col, row) => [col / cols, row / rows, 1 / cols, 1 / rows]
const ROW = ['top', 'middle', 'bottom']
const COL = ['left', 'center', 'right']
const grid = (cols, rows, name, group) => {
  const list = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const where = rows === 3 && cols === 3 && row === 1 && col === 1 ? 'Center' : `${ROW[rows === 2 ? row * 2 : row]} ${COL[col]}`
      list.push(at(`${ROW[rows === 2 ? row * 2 : row]}-${COL[col]}-${name}`, `${where[0].toUpperCase()}${where.slice(1)} ${name}`, cell(cols, rows, col, row), group))
    }
  }
  return list
}

export const LAYOUTS = [
  at('left-half', 'Left half', [0, 0, 1 / 2, 1], 'halves', 'Control+Alt+Left'),
  at('right-half', 'Right half', [1 / 2, 0, 1 / 2, 1], 'halves', 'Control+Alt+Right'),
  at('top-half', 'Top half', [0, 0, 1, 1 / 2], 'halves', 'Control+Alt+Up'),
  at('bottom-half', 'Bottom half', [0, 1 / 2, 1, 1 / 2], 'halves', 'Control+Alt+Down'),
  at('top-left', 'Top left', [0, 0, 1 / 2, 1 / 2], 'quarters', 'Control+Alt+U'),
  at('top-right', 'Top right', [1 / 2, 0, 1 / 2, 1 / 2], 'quarters', 'Control+Alt+I'),
  at('bottom-left', 'Bottom left', [0, 1 / 2, 1 / 2, 1 / 2], 'quarters', 'Control+Alt+J'),
  at('bottom-right', 'Bottom right', [1 / 2, 1 / 2, 1 / 2, 1 / 2], 'quarters', 'Control+Alt+K'),
  at('left-third', 'Left third', [0, 0, 1 / 3, 1], 'thirds', 'Control+Alt+D'),
  at('center-third', 'Middle third', [1 / 3, 0, 1 / 3, 1], 'thirds', 'Control+Alt+F', 'center centre'),
  at('right-third', 'Right third', [2 / 3, 0, 1 / 3, 1], 'thirds', 'Control+Alt+G'),
  at('left-two-thirds', 'Left two thirds', [0, 0, 2 / 3, 1], 'thirds', 'Control+Alt+E'),
  at('right-two-thirds', 'Right two thirds', [1 / 3, 0, 2 / 3, 1], 'thirds', 'Control+Alt+T'),
  at('first-fourth', 'First fourth', [0, 0, 1 / 4, 1], 'fourths', null, 'quarter left'),
  at('second-fourth', 'Second fourth', [1 / 4, 0, 1 / 4, 1], 'fourths', null, 'quarter'),
  at('third-fourth', 'Third fourth', [2 / 4, 0, 1 / 4, 1], 'fourths', null, 'quarter'),
  at('last-fourth', 'Last fourth', [3 / 4, 0, 1 / 4, 1], 'fourths', null, 'quarter right'),
  at('first-three-fourths', 'First three fourths', [0, 0, 3 / 4, 1], 'fourths', null, 'left quarters'),
  at('last-three-fourths', 'Last three fourths', [1 / 4, 0, 3 / 4, 1], 'fourths', null, 'right quarters'),
  ...grid(3, 2, 'sixth', 'sixths'),
  ...grid(3, 3, 'ninth', 'ninths'),
  at('maximize', 'Maximize', [0, 0, 1, 1], 'size', 'Control+Alt+Return', 'full screen fill'),
  at('almost-maximize', 'Almost maximize', [0.05, 0.05, 0.9, 0.9], 'size', null, 'nearly full screen'),
  at('reasonable-size', 'Reasonable size', [0.2, 0.125, 0.6, 0.75], 'size', null, 'comfortable middle'),
  at('center', 'Center', [0.19, 0.14, 0.62, 0.72], 'size', 'Control+Alt+C', 'middle centre'),
  at('center-half', 'Center half', [1 / 4, 0, 1 / 2, 1], 'size', null, 'middle centre'),
  at('center-two-thirds', 'Center two thirds', [1 / 6, 0, 2 / 3, 1], 'size', null, 'middle centre'),
  at('center-three-fourths', 'Center three fourths', [1 / 8, 0, 3 / 4, 1], 'size', null, 'middle centre'),
  { id: 'larger', label: 'Make larger', key: null, box: null, op: 'larger', group: 'size', words: 'bigger grow' },
  { id: 'smaller', label: 'Make smaller', key: null, box: null, op: 'smaller', group: 'size', words: 'shrink' },
  // The window keeps its size and slides to that edge.
  { id: 'move-left', label: 'Move left', key: null, box: null, op: 'move', to: 'left', group: 'move', words: 'slide edge' },
  { id: 'move-right', label: 'Move right', key: null, box: null, op: 'move', to: 'right', group: 'move', words: 'slide edge' },
  { id: 'move-up', label: 'Move up', key: null, box: null, op: 'move', to: 'up', group: 'move', words: 'slide edge' },
  { id: 'move-down', label: 'Move down', key: null, box: null, op: 'move', to: 'down', group: 'move', words: 'slide edge' },
  // The window as it is, on the next (or the one before) screen; with one screen, nothing moves.
  { id: 'next-display', label: 'Next screen', key: 'Control+Alt+Command+Right', box: null, op: 'next-display', group: 'screens', words: 'display monitor screen other move' },
  { id: 'previous-display', label: 'Previous screen', key: null, box: null, op: 'previous-display', group: 'screens', words: 'display monitor screen other move back' },
  { id: 'restore', label: 'Put it back', key: 'Control+Alt+Z', box: null, op: 'restore', group: 'screens', words: 'restore undo previous size' },
]

export const MAX_CUSTOM = 50
const BUILT_IN = new Set(LAYOUTS.map((layout) => layout.id))
const STEP = 0.05 // Make larger / smaller: this much of the screen on each side
const SMALLEST = 0.2 // and never smaller than this share of it

const listOf = (value) => (Array.isArray(value) ? value : [])
const offOf = (windows) => listOf(windows?.off)

export const layoutById = (id) => LAYOUTS.find((layout) => layout.id === id) || null

/* ---------- Nate's own commands: { id: 'custom-…', name, rect: { x, y, w, h } in percent, centered? } ---------- */

const number = (value) => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN)
const percent = (value, low, high) => Math.round(Math.min(high, Math.max(low, value)) * 10) / 10

/* A rectangle in percent that fits the screen: w and h are 1–100, x and y keep it inside. null when a number is missing
   or not a number. `centered` ignores x and y: the rectangle sits in the middle. */
export function cleanRect(rect, centered = false) {
  const [x, y, w, h] = ['x', 'y', 'w', 'h'].map((key) => number(rect?.[key]))
  if (![w, h].every(Number.isFinite) || (!centered && ![x, y].every(Number.isFinite))) return null
  const width = percent(w, 1, 100)
  const height = percent(h, 1, 100)
  return centered
    ? { x: percent((100 - width) / 2, 0, 100), y: percent((100 - height) / 2, 0, 100), w: width, h: height }
    : { x: percent(x, 0, 100 - width), y: percent(y, 0, 100 - height), w: width, h: height }
}

/* What a saved list of custom commands may hold: at most MAX_CUSTOM, valid and unique ids, a name, a rectangle that
   fits. Anything broken is dropped, never mended into something Nate didn't make. */
export function cleanCustom(saved) {
  const list = []
  for (const item of listOf(saved)) {
    const id = typeof item?.id === 'string' ? item.id : ''
    const name = String(item?.name ?? '').trim().slice(0, 40)
    const centered = item?.centered === true
    const rect = cleanRect(item?.rect, centered)
    if (!/^custom-[a-z0-9]{1,16}$/.test(id) || !name || !rect || list.some((other) => other.id === id)) continue
    list.push({ id, name, rect, ...(centered ? { centered: true } : {}) })
    if (list.length >= MAX_CUSTOM) break
  }
  return list
}

export const newCustomId = (taken = []) => {
  let id
  do id = `custom-${Math.random().toString(36).slice(2, 8)}`
  while (taken.some((other) => other.id === id))
  return id
}

/* A custom command, made like a built-in one (a box, a label, a group). */
export const customLayout = (item) => ({ id: item.id, label: item.name, key: null, box: [item.rect.x / 100, item.rect.y / 100, item.rect.w / 100, item.rect.h / 100], group: 'custom', custom: true, words: '' })

/* A built-in command as a rectangle in percent, to start a custom one from. null for the ones that aren't a place. */
export function rectOfLayout(layout) {
  return layout?.box ? cleanRect({ x: layout.box[0] * 100, y: layout.box[1] * 100, w: layout.box[2] * 100, h: layout.box[3] * 100 }) : null
}

/* Every command: Nate's own first, then the built-in ones. `windows` is launcher.json's `windows`. */
export const allLayouts = (windows) => [...listOf(windows?.custom).map(customLayout), ...LAYOUTS]
/* The ones that are on (the bar, the keys and the words use only these). */
export const layoutsOf = (windows) => allLayouts(windows).filter((layout) => !offOf(windows).includes(layout.id))
/* One command by id, built-in or Nate's own. */
export const layoutIn = (windows, id) => (BUILT_IN.has(id) ? layoutById(id) : listOf(windows?.custom).map(customLayout).find((layout) => layout.id === id) || null)

/* ---------- Where a command puts a window ---------- */

/* A box on the screen area { x, y, width, height }: whole points. Edges are rounded, not sizes, so neighbours meet. */
function boxFrame(box, area) {
  const [bx, by, bw, bh] = box
  const left = Math.round(area.x + area.width * bx)
  const top = Math.round(area.y + area.height * by)
  return { x: left, y: top, width: Math.round(area.x + area.width * (bx + bw)) - left, height: Math.round(area.y + area.height * (by + bh)) - top }
}

const between = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high))

/* The window made bigger (by > 0) or smaller around its middle, kept on the screen. */
function resizedFrame(now, area, by) {
  // Whole points first, so rounding can never push an edge past the screen's.
  const width = Math.round(between(now.width + 2 * by * area.width, SMALLEST * area.width, area.width))
  const height = Math.round(between(now.height + 2 * by * area.height, SMALLEST * area.height, area.height))
  return {
    x: Math.round(between(now.x - (width - now.width) / 2, area.x, area.x + area.width - width)),
    y: Math.round(between(now.y - (height - now.height) / 2, area.y, area.y + area.height - height)),
    width,
    height,
  }
}

/* The window slid to one edge, the same size (and kept on the screen). */
function slidFrame(now, area, to) {
  const width = Math.min(now.width, area.width)
  const height = Math.min(now.height, area.height)
  const x = between(now.x, area.x, area.x + area.width - width)
  const y = between(now.y, area.y, area.y + area.height - height)
  return {
    x: Math.round(to === 'left' ? area.x : to === 'right' ? area.x + area.width - width : x),
    y: Math.round(to === 'up' ? area.y : to === 'down' ? area.y + area.height - height : y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

/* Where a command puts a window on the screen area: whole points. A place needs only the area; Make larger / smaller
   and Move need the window as it is now (`now`). Null for a screen change, Put it back, an unknown command and a
   window not given. */
export function frameFor(id, area, now = null, windows = null) {
  const layout = layoutIn(windows, id)
  if (!layout) return null
  if (layout.box) return boxFrame(layout.box, area)
  if (!now) return null
  if (layout.op === 'larger') return resizedFrame(now, area, STEP)
  if (layout.op === 'smaller') return resizedFrame(now, area, -STEP)
  if (layout.op === 'move') return slidFrame(now, area, layout.to)
  return null
}

/* The screen a window is on: the one holding most of it (the first one when it is off every screen). `screens` are
   { workArea } or a bare { x, y, width, height }. */
export function screenFor(rect, screens) {
  const area = (screen) => screen.workArea || screen
  const overlap = (screen) => {
    const a = area(screen)
    const width = Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x)
    const height = Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y)
    return width > 0 && height > 0 ? width * height : 0
  }
  return screens.reduce((best, screen) => (overlap(screen) > overlap(best) ? screen : best), screens[0])
}

/* Where a window goes on the next screen (`screens` in the Mac's order, wrapping round; `by` -1 is the one before):
   the same size if it fits, and the same place in proportion (a window at the left edge stays at the left edge).
   Null with one screen. */
export function nextScreenFrame(rect, screens, by = 1) {
  if (!Array.isArray(screens) || screens.length < 2) return null
  const area = (screen) => screen.workArea || screen
  const from = screenFor(rect, screens)
  const a = area(from)
  const count = screens.length
  const to = area(screens[(((screens.indexOf(from) + by) % count) + count) % count])
  const width = Math.min(rect.width, to.width)
  const height = Math.min(rect.height, to.height)
  const share = (offset, room) => (room > 0 ? Math.min(1, Math.max(0, offset / room)) : 0)
  return {
    x: Math.round(to.x + share(rect.x - a.x, a.width - rect.width) * (to.width - width)),
    y: Math.round(to.y + share(rect.y - a.y, a.height - rect.height) * (to.height - height)),
    width: Math.round(width),
    height: Math.round(height),
  }
}

/* "left half", "max", "top r": the commands every word of the query starts a word of; the ones whose name starts with
   the words come first ("max" is Maximize before Almost maximize). */
export function findLayouts(query, layouts = LAYOUTS) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return layouts
  const typed = words.join(' ')
  const found = layouts.filter((layout) => {
    const own = `${layout.label} ${layout.words || ''}`.toLowerCase().split(/[^a-z]+/)
    return words.every((word) => own.some((part) => part.startsWith(word)))
  })
  const first = (layout) => (layout.label.toLowerCase().startsWith(typed) ? 0 : 1)
  return found.map((layout, index) => [layout, index]).sort((a, b) => first(a[0]) - first(b[0]) || a[1] - b[1]).map(([layout]) => layout)
}

/* What Settings keeps for window keys: every command's key, from the usual one unless Nate changed or took it away.
   Nate's own commands (`custom`) start with none. */
export function cleanWindowKeys(saved, validHotkey = () => true, custom = []) {
  const own = saved && typeof saved === 'object' ? saved : {}
  return Object.fromEntries([...LAYOUTS, ...custom.map((item) => ({ id: item.id, key: null }))]
    .map((layout) => [layout.id, own[layout.id] === null ? null : typeof own[layout.id] === 'string' && validHotkey(own[layout.id]) ? own[layout.id] : layout.key]))
}

/* Everything launcher.json keeps for windows: { on, hotkeys, aliases, off, custom }.
   `aliases` are words typed in the bar (id → word); `off` the commands switched off; `word` is cleanSettings' own, so
   a word is never given twice (it answers null for a word taken or not allowed). */
export function cleanWindows(saved, { validHotkey = () => true, word = (value) => value } = {}) {
  const own = saved && typeof saved === 'object' ? saved : {}
  const custom = cleanCustom(own.custom)
  const ids = [...custom.map((item) => item.id), ...LAYOUTS.map((layout) => layout.id)]
  const aliases = {}
  for (const id of ids) {
    const chosen = word(typeof own.aliases?.[id] === 'string' ? own.aliases[id] : null)
    if (chosen) aliases[id] = chosen
  }
  return {
    on: own.on === true,
    hotkeys: cleanWindowKeys(own.hotkeys, validHotkey, custom),
    aliases,
    off: [...new Set(listOf(own.off).filter((id) => ids.includes(id)))],
    custom,
  }
}
