/* Where a room opens on the desk: beside the line where thoughts are left, never on it.
   `line` is the line's resting box ({ left, top, right, bottom }). The side with more
   room (and fewer rooms already on it) wins; each new room on a side steps down a little.
   A room that can't keep most of its size beside the line opens in the middle, under the
   band the line rises into (`raised` in Desk.jsx lifts it there). A room opened from a
   widget `prefer`s the widget's side ('left' or 'right'): that side, or else the middle. */

const EDGE = 16
const DOCK = 96 // the dock's band at the foot of the desk
const RAISED = 170 // the band at the top the line rises into
const STEP = 28

export function placeRoom(view, [w, h], line, pops = [], { prefer } = {}) {
  const bottom = view.height - DOCK
  const sides = line ? [
    { name: 'right', left: line.right + EDGE, right: view.width - EDGE },
    { name: 'left', left: EDGE, right: line.left - EDGE },
  ] : []
  const fits = sides
    .filter((side) => !prefer || side.name === prefer)
    .map((side) => ({ ...side, room: side.right - side.left, taken: pops.filter((pop) => pop.x < side.right && pop.x + pop.w > side.left).length }))
    .filter((side) => side.room >= Math.min(w, Math.max(560, w * 0.7)))
    .sort((a, b) => a.taken - b.taken || b.room - a.room)
  if (fits.length) {
    const side = fits[0]
    const width = Math.min(w, side.room)
    const height = Math.min(h, bottom - EDGE)
    const step = (side.taken * STEP) % 140
    return {
      w: width,
      h: height,
      x: Math.round(Math.min(side.left + (side.room - width) / 2 + step, side.right - width)),
      y: Math.round(Math.min(EDGE + Math.max(0, (bottom - EDGE - height) / 2) + step, bottom - height)),
    }
  }
  const width = Math.min(w, view.width - EDGE * 4)
  const height = Math.min(h, bottom - RAISED)
  const step = (pops.length * STEP) % 140
  return {
    w: width,
    h: height,
    x: Math.round(Math.min((view.width - width) / 2 + step, view.width - width - EDGE)),
    y: Math.round(Math.min(RAISED + step, bottom - height)),
  }
}

/* The transform that lays a box `to` over the rectangle `from` (both { left, top, width,
   height }; origin at the top left), so a room can grow out of the widget or dock button
   it came from, and shrink back into it. */
export const shrinkTo = (from, to) => `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`

/* Plays `element` growing out of the rectangle `from` (or, `back`, shrinking into it and
   staying there until it is removed). Only a transform moves, so nothing inside reflows.
   With reduced motion, or from nowhere in particular, it only fades. Returns the Animation. */
export function grow(element, from, { back = false } = {}) {
  const still = !from || matchMedia('(prefers-reduced-motion: reduce)').matches
  const small = still ? { opacity: 0 } : { transformOrigin: '0 0', transform: shrinkTo(from, element.getBoundingClientRect()), opacity: 0 }
  const full = still ? { opacity: 1 } : { transformOrigin: '0 0', transform: 'none', opacity: 1 }
  return back
    ? element.animate([full, { opacity: 1, offset: 0.55 }, small], { duration: still ? 140 : 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' })
    : element.animate([small, { opacity: 1, offset: 0.3 }, full], { duration: still ? 160 : 320, easing: 'cubic-bezier(0.3, 0.5, 0.1, 1)' })
}

/* A room covers the line when their boxes meet. */
export const covers = (pop, line) => Boolean(line) && pop.x < line.right && pop.x + pop.w > line.left && pop.y < line.bottom && pop.y + pop.h > line.top
