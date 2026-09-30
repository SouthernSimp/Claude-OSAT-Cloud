/* Where the dock lives (Phase 13): the bottom of the desk, or its left or right edge. (Not the top: that is where the
   line rises to when a room covers it.) Nate drags it by its grip, or picks a side in Tools; it is remembered on this
   Mac. Pure, so the rooms, the desk's stickies and the line can all leave it room. */

export const DOCK_SIDES = ['bottom', 'left', 'right']
export const DOCK_KEY = 'osat.dock.side.v1'
// The strip the dock keeps clear along its edge (it is about 68px, 12px in).
export const DOCK_BAND = 96
const EDGE = 12

export const cleanSide = (value) => (DOCK_SIDES.includes(value) ? value : 'bottom')

/* The edge nearest the pointer while the dock is carried. Bottom is favoured a little: it is where the dock belongs. */
export function nearestSide(point, view) {
  const toSide = Math.min(point.x, view.width - point.x)
  const toBottom = view.height - point.y
  if (toBottom < toSide * 1.4) return 'bottom'
  return point.x < view.width / 2 ? 'left' : 'right'
}

/* A room that fills the screen leaves the dock's strip alone: { left, top, width, height }. */
export function fullBox(view, side = 'bottom') {
  const left = EDGE + (side === 'left' ? DOCK_BAND - EDGE : 0)
  const right = view.width - EDGE - (side === 'right' ? DOCK_BAND - EDGE : 0)
  const bottom = view.height - (side === 'bottom' ? DOCK_BAND : EDGE)
  return { left, top: EDGE, width: right - left, height: bottom - EDGE }
}

/* The part of the desk a sticky may be set down in (`box` is the desk's rectangle). */
export function deskArea(box, side = 'bottom') {
  return {
    left: box.left + (side === 'left' ? DOCK_BAND : EDGE),
    top: box.top + EDGE,
    right: box.right - (side === 'right' ? DOCK_BAND : EDGE),
    bottom: box.bottom - (side === 'bottom' ? DOCK_BAND : EDGE),
  }
}
