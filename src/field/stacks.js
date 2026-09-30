/* Stacks on the desk (Phase 27): drop one sticky on another and they stand in a neat
   column, like a list on a kanban board, in the order you put them. A stack only arranges
   the desk: its stickies keep their homes (a node, a branch, Unsorted). It lives in this
   Mac's places like a sticky's spot, 'stack:<id>' → { x, y, ids, name?, folded? } (x and y
   are fractions of the desk). Each function takes the places and gives back new ones;
   `changes` lists what differs, for saving and for Undo. Pure. */

export const isStack = (key) => key.startsWith('stack:')

/* The stack a sticky stands in, or null. */
export function stackOf(places, noteId) {
  return Object.keys(places).find((key) => isStack(key) && places[key]?.ids?.includes(noteId)) || null
}

/* Out of whatever stack holds it. A stack left with one sticky gives it the stack's spot;
   an empty one goes. */
function leave(places, noteId) {
  const key = stackOf(places, noteId)
  if (!key) return places
  const stack = places[key]
  const ids = stack.ids.filter((id) => id !== noteId)
  const next = { ...places }
  if (ids.length > 1) next[key] = { ...stack, ids }
  else {
    delete next[key]
    if (ids.length) next[`note:${ids[0]}`] = { x: stack.x, y: stack.y }
  }
  return next
}

/* `droppedId` set down on `targetId`: they stack where the target lay (or, when the target
   already stands in a stack, the dropped one joins it at the end). `id` names a new stack. */
export function stackUp(places, targetId, droppedId, id) {
  if (targetId === droppedId) return places
  const held = stackOf(places, targetId)
  if (held) return addToStack(places, held, droppedId)
  const spot = places[`note:${targetId}`]
  if (!spot) return places
  const next = { ...leave(places, droppedId) }
  delete next[`note:${targetId}`]
  delete next[`note:${droppedId}`]
  next[`stack:${id}`] = { x: spot.x, y: spot.y, ids: [targetId, droppedId] }
  return next
}

/* Into a stack at `index` (the end when left out); within the same stack, a new place in
   its order. */
export function addToStack(places, key, noteId, index = Infinity) {
  if (!places[key]) return places
  const next = { ...(stackOf(places, noteId) === key ? places : leave(places, noteId)) }
  const stack = next[key]
  if (!stack) return places
  const ids = stack.ids.filter((id) => id !== noteId)
  ids.splice(Math.max(0, Math.min(Number.isFinite(index) ? index : ids.length, ids.length)), 0, noteId)
  next[key] = { ...stack, ids }
  delete next[`note:${noteId}`]
  return next
}

/* A sticky set down on the desk by itself, at `spot` (null takes it off the desk). */
export function setDown(places, noteId, spot) {
  const next = { ...leave(places, noteId) }
  if (spot) next[`note:${noteId}`] = spot
  else delete next[`note:${noteId}`]
  return next
}

/* Every sticky in the stack back on the desk by itself, fanned out from where it stood. */
export function unstack(places, key) {
  const stack = places[key]
  if (!stack) return places
  const next = { ...places }
  delete next[key]
  stack.ids.forEach((id, index) => {
    next[`note:${id}`] = { x: Math.min(0.9, stack.x + index * 0.012), y: Math.min(0.9, stack.y + index * 0.06) }
  })
  return next
}

/* What differs between two sets of places: [[key, spot or null]]. */
export function changes(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].flatMap((key) => (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null) ? [] : [[key, after[key] ?? null]]))
}
