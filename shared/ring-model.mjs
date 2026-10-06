/* The ring (Phase 13): quick tools in a circle around the pointer. It opens from a key over any app (Hyper R), and
   with ⌘ + middle-click inside OSAT's own windows. Which tools, in what order, and where each one sits on the
   circle. (⌘ + middle-click over other apps would need a global mouse hook, which OSAT doesn't have: see the roadmap.)
   Pure. */

/* Every tool the ring can hold. `layout` ones move the window you were in (they need Accessibility, and only make sense
   over another app); `inDesk: false` is left out of the ring on the desk. */
export const RING_ITEMS = [
  { id: 'search', label: 'Quick bar' },
  { id: 'clipboard', label: 'Clipboard' },
  { id: 'sticky', label: 'New sticky' },
  { id: 'chat', label: 'Ask' },
  { id: 'desk', label: 'The desk' },
  { id: 'sky', label: 'The Sky' },
  { id: 'files', label: 'Files' },
  { id: 'left', label: 'Left half', layout: 'left-half', inDesk: false },
  { id: 'right', label: 'Right half', layout: 'right-half', inDesk: false },
  { id: 'maximize', label: 'Maximize', layout: 'maximize', inDesk: false },
]
export const DEFAULT_RING = ['search', 'clipboard', 'sticky', 'chat', 'desk', 'left', 'right', 'maximize']
export const MAX_RING = 8

/* The tools to draw, from what Settings kept (null: the usual eight); unknown ids and repeats go. */
export function ringItems(ids, { desk = false } = {}) {
  const wanted = Array.isArray(ids) ? ids : DEFAULT_RING
  const seen = new Set()
  return wanted
    .map((id) => RING_ITEMS.find((item) => item.id === id))
    .filter((item) => item && !seen.has(item.id) && seen.add(item.id) && !(desk && item.inDesk === false))
    .slice(0, MAX_RING)
}

/* Where each of `count` tools sits: the first at the top, then clockwise, `radius` from the middle. */
export function ringPositions(count, radius) {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(count, 1)
    return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) }
  })
}

/* The window for the ring: centred on the pointer, kept inside the screen it is on. */
export function ringBounds(point, area, size = 340) {
  const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high))
  return {
    x: Math.round(clamp(point.x - size / 2, area.x, area.x + area.width - size)),
    y: Math.round(clamp(point.y - size / 2, area.y, area.y + area.height - size)),
    width: size,
    height: size,
  }
}
