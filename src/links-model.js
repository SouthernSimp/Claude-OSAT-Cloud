/* Connections (Phase 27): a line between any two things (stickies, branches, nodes) that says
   they relate. A connection never files, moves or copies anything: each end keeps its one
   home. It is kept once, on the thing it was drawn from (`links`: 'note:<id>' or
   'folder:<id>', schema 10), and shown only while both ends are there. Pure, like
   nodes-model.js. */

import { isActiveNote } from './notes-model.js'

export const keyOf = (kind, id) => `${kind}:${id}`
export const noteKey = (id) => keyOf('note', id)
export const folderKey = (id) => keyOf('folder', id)

export function partsOf(key) {
  const at = String(key).indexOf(':')
  return { kind: String(key).slice(0, at), id: String(key).slice(at + 1) }
}

const listFor = (state, kind) => (kind === 'note' ? state.notes : kind === 'folder' ? state.folders : null) || []

/* The note or folder a key names, while it is there (a note in the Bin is not). */
export function recordOf(state, key) {
  const { kind, id } = partsOf(key)
  const record = listFor(state, kind).find((item) => item.id === id) || null
  return kind === 'note' && !isActiveNote(record) ? null : record
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/* Every connection whose two ends are both there, once each: [{ a, b, key }]. */
export function linksOf(state) {
  const seen = new Set()
  const out = []
  const from = (kind, list) => list.forEach((item) => {
    if (!item.links?.length) return
    const a = keyOf(kind, item.id)
    if (!recordOf(state, a)) return
    item.links.forEach((b) => {
      const key = pairKey(a, b)
      if (a === b || seen.has(key) || !recordOf(state, b)) return
      seen.add(key)
      out.push({ a, b, key })
    })
  })
  from('note', state.notes || [])
  from('folder', state.folders || [])
  return out
}

/* What one thing is connected to (keys). */
export const linksAt = (state, key) => linksOf(state).flatMap((link) => (link.a === key ? [link.b] : link.b === key ? [link.a] : []))

export const connected = (state, a, b) => linksOf(state).some((link) => link.key === pairKey(a, b))

const patch = (state, key, change) => {
  const { kind, id } = partsOf(key)
  const collection = kind === 'note' ? 'notes' : 'folders'
  return { ...state, [collection]: state[collection].map((item) => (item.id === id ? change(item) : item)) }
}

/* Draws a line from `a` to `b` (kept on `a`). Nothing changes for a line to itself, to
   something not there, or one that is already drawn. */
export function connect(state, a, b) {
  if (!a || !b || a === b || !recordOf(state, a) || !recordOf(state, b) || connected(state, a, b)) return state
  return patch(state, a, (item) => ({ ...item, links: [...(item.links || []), b] }))
}

/* Takes the line between `a` and `b` away, whichever end it was drawn from. */
export function disconnect(state, a, b) {
  const drop = (other) => (item) => {
    if (!item.links?.includes(other)) return item
    const links = item.links.filter((key) => key !== other)
    const { links: _gone, ...rest } = item
    return links.length ? { ...rest, links } : rest
  }
  let next = state
  if (recordOf(state, a)) next = patch(next, a, drop(b))
  if (recordOf(next, b)) next = patch(next, b, drop(a))
  return next
}

/* A soft curve between two boxes ({ x, y, w, h }), from the sides that face each other:
   left and right when they sit side by side, top and bottom when one is above the other.
   Returns the path and its middle point. */
export function edgePath(from, to) {
  const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const across = Math.abs(b.x - a.x) - (from.w + to.w) / 2 >= Math.abs(b.y - a.y) - (from.h + to.h) / 2
  let start
  let end
  let bend
  if (across) {
    const right = b.x >= a.x
    start = { x: right ? from.x + from.w : from.x, y: a.y }
    end = { x: right ? to.x : to.x + to.w, y: b.y }
    const pull = Math.max(24, Math.abs(end.x - start.x) / 2) * (right ? 1 : -1)
    bend = [{ x: start.x + pull, y: start.y }, { x: end.x - pull, y: end.y }]
  } else {
    const down = b.y >= a.y
    start = { x: a.x, y: down ? from.y + from.h : from.y }
    end = { x: b.x, y: down ? to.y : to.y + to.h }
    const pull = Math.max(24, Math.abs(end.y - start.y) / 2) * (down ? 1 : -1)
    bend = [{ x: start.x, y: start.y + pull }, { x: end.x, y: end.y - pull }]
  }
  const r = (value) => Math.round(value * 10) / 10
  return {
    d: `M${r(start.x)} ${r(start.y)} C${r(bend[0].x)} ${r(bend[0].y)},${r(bend[1].x)} ${r(bend[1].y)},${r(end.x)} ${r(end.y)}`,
    mid: { x: r((start.x + end.x) / 2), y: r((start.y + end.y) / 2) },
  }
}
