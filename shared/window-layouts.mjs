/* Window snapping (Phase 13): the layouts (halves, thirds, corners, maximize, centre), where each one puts a window
   on a screen, which screen a window is on, and the words that find a layout. Restore is not a place: OSAT
   remembers where a window was before it moved it (desktop/launcher/snap.cjs). Pure. */

/* `key` is the usual key for it when window keys are on (Settings → Launcher); the same keys Rectangle uses. */
export const LAYOUTS = [
  { id: 'left-half', label: 'Left half', key: 'Control+Alt+Left', box: [0, 0, 1 / 2, 1] },
  { id: 'right-half', label: 'Right half', key: 'Control+Alt+Right', box: [1 / 2, 0, 1 / 2, 1] },
  { id: 'top-half', label: 'Top half', key: 'Control+Alt+Up', box: [0, 0, 1, 1 / 2] },
  { id: 'bottom-half', label: 'Bottom half', key: 'Control+Alt+Down', box: [0, 1 / 2, 1, 1 / 2] },
  { id: 'top-left', label: 'Top left', key: 'Control+Alt+U', box: [0, 0, 1 / 2, 1 / 2] },
  { id: 'top-right', label: 'Top right', key: 'Control+Alt+I', box: [1 / 2, 0, 1 / 2, 1 / 2] },
  { id: 'bottom-left', label: 'Bottom left', key: 'Control+Alt+J', box: [0, 1 / 2, 1 / 2, 1 / 2] },
  { id: 'bottom-right', label: 'Bottom right', key: 'Control+Alt+K', box: [1 / 2, 1 / 2, 1 / 2, 1 / 2] },
  { id: 'left-third', label: 'Left third', key: 'Control+Alt+D', box: [0, 0, 1 / 3, 1] },
  { id: 'center-third', label: 'Middle third', key: 'Control+Alt+F', box: [1 / 3, 0, 1 / 3, 1] },
  { id: 'right-third', label: 'Right third', key: 'Control+Alt+G', box: [2 / 3, 0, 1 / 3, 1] },
  { id: 'left-two-thirds', label: 'Left two thirds', key: 'Control+Alt+E', box: [0, 0, 2 / 3, 1] },
  { id: 'right-two-thirds', label: 'Right two thirds', key: 'Control+Alt+T', box: [1 / 3, 0, 2 / 3, 1] },
  { id: 'maximize', label: 'Maximize', key: 'Control+Alt+Return', box: [0, 0, 1, 1], words: 'full screen fill' },
  { id: 'center', label: 'Center', key: 'Control+Alt+C', box: [0.19, 0.14, 0.62, 0.72], words: 'middle centre' },
  { id: 'restore', label: 'Put it back', key: 'Control+Alt+Z', box: null, words: 'restore undo previous size' },
]

export const layoutById = (id) => LAYOUTS.find((layout) => layout.id === id) || null

/* Where a layout puts a window on the screen area { x, y, width, height }: whole points. Null for restore. */
export function frameFor(id, area) {
  const layout = layoutById(id)
  if (!layout?.box) return null
  const [bx, by, bw, bh] = layout.box
  const left = Math.round(area.x + area.width * bx)
  const top = Math.round(area.y + area.height * by)
  return { x: left, y: top, width: Math.round(area.x + area.width * (bx + bw)) - left, height: Math.round(area.y + area.height * (by + bh)) - top }
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

/* "left half", "max", "top r": the layouts every word of the query starts a word of. */
export function findLayouts(query, layouts = LAYOUTS) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return layouts
  return layouts.filter((layout) => {
    const own = `${layout.label} ${layout.words || ''}`.toLowerCase().split(/[^a-z]+/)
    return words.every((word) => own.some((part) => part.startsWith(word)))
  })
}

/* What Settings keeps for window keys: every layout's key, from the usual one unless Nate changed or took it away. */
export function cleanWindowKeys(saved, validHotkey = () => true) {
  const own = saved && typeof saved === 'object' ? saved : {}
  return Object.fromEntries(LAYOUTS.map((layout) => [layout.id, own[layout.id] === null ? null : typeof own[layout.id] === 'string' && validHotkey(own[layout.id]) ? own[layout.id] : layout.key]))
}
