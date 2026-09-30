/* Resizing widgets (Phase 13): a widget grows by its bottom right corner. The size is kept with the other places on this
   Mac (`places['size:widget:<id>']`, { x: 0, y: 0, w, h }; "Put everything back where it was" clears it). A widget in the
   column keeps the column's width and only grows taller; one set down on the desk can grow both ways. It never gets
   smaller than its own content. A taller widget shows more (`roomFor`: extra rows of steps, habits). Pure. */

export const COLUMN = 311
export const MAX_W = 720
export const MAX_H = 720
const MIN_W = 240

export const sizeKey = (id) => `size:widget:${id}`

/* What a widget was resized to, or null. */
export function sizeOf(places, id) {
  const saved = places?.[sizeKey(id)]
  return saved && Number.isFinite(saved.w) && Number.isFinite(saved.h) ? { w: saved.w, h: saved.h } : null
}

/* The size after a drag of `delta` ({ x, y }) from `start` ({ w, h }); `floor` is the least height (the widget's own
   content); `placed` widgets can change width, the column's can't. */
export function resize(start, delta, { placed = false, floor = 0 } = {}) {
  const clamp = (value, low, high) => Math.round(Math.min(Math.max(value, low), high))
  return {
    w: placed ? clamp(start.w + delta.x, MIN_W, MAX_W) : COLUMN,
    h: clamp(start.h + delta.y, Math.max(90, floor), MAX_H),
  }
}

// About how tall each widget is on its own; anything taller has room to show more.
export const BASE = { calendar: 176, next: 200, media: 110, focus: 140, habits: 140, 'from-before': 170 }

/* How many extra rows a widget of height `h` has room for (0 at its usual size). */
export const roomFor = (h, id) => (Number.isFinite(h) ? Math.max(0, Math.floor((h - (BASE[id] ?? 140)) / 30)) : 0)
