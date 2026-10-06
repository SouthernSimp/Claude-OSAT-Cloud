/* Seeing what a connection connects (Phase 27h). The Sky's camera is the only thing that moves: nodes and
   stickies are never rearranged to make two ends fit. Pure. Boxes are { x, y, w, h } in board points; the
   camera is { x, y, z } (screen = board * z + camera). */

/* One box around all of them. */
export function unionBoxes(list) {
  const boxes = list.filter(Boolean)
  if (!boxes.length) return null
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  return { x: left, y: top, w: Math.max(...boxes.map((box) => box.x + box.w)) - left, h: Math.max(...boxes.map((box) => box.y + box.h)) - top }
}

/* Is the box wholly outside the view (a view of `size` = { w, h } pixels)? */
export function offscreen(box, camera, size) {
  const left = box.x * camera.z + camera.x
  const top = box.y * camera.z + camera.y
  return left + box.w * camera.z < 0 || top + box.h * camera.z < 0 || left > size.w || top > size.h
}

/* Where the line from `from` (inside the view) towards `to` (outside it) leaves the view, kept `inset` pixels in
   from the edge, in screen pixels: the place for a label that says where the line goes. Both are box centres on
   screen. */
export function edgeSpot(from, to, size, inset = 14) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const room = {
    left: inset, right: size.w - inset, top: inset, bottom: size.h - inset,
  }
  let t = Infinity
  if (dx > 0) t = Math.min(t, (room.right - from.x) / dx)
  if (dx < 0) t = Math.min(t, (room.left - from.x) / dx)
  if (dy > 0) t = Math.min(t, (room.bottom - from.y) / dy)
  if (dy < 0) t = Math.min(t, (room.top - from.y) / dy)
  if (!Number.isFinite(t) || t < 0) t = 0
  const at = { x: from.x + dx * Math.min(t, 1), y: from.y + dy * Math.min(t, 1) }
  return { x: Math.min(Math.max(at.x, room.left), room.right), y: Math.min(Math.max(at.y, room.top), room.bottom) }
}

/* Which side of the view the label sits on, for its little arrow. */
export function sideOf(spot, size, inset = 14) {
  if (spot.x <= inset + 1) return 'left'
  if (spot.x >= size.w - inset - 1) return 'right'
  return spot.y <= inset + 1 ? 'top' : 'bottom'
}
