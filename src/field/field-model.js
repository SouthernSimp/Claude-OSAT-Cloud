/* Layout for the desk. Pure functions, so they can be tested without a browser. */

import { folderChildren, isActiveNote, relatedNotes } from '../notes-model.js'

export const POSE_KEY = 'osat.field.papers.v1'

const PHASES = {
  morning: ['Good morning.', 'The day has not asked for much yet.'],
  afternoon: ['Good afternoon.', 'Set down what you are carrying.'],
  evening: ['Good evening.', 'The room is yours again.'],
  night: ['Still here.', 'Leave it on the desk. Morning can take the rest.'],
}

export function dayPhase(date = new Date()) {
  const hour = date.getHours()
  if (hour < 5) return 'night'
  if (hour < 11) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

export function phaseCopy(phase) {
  return PHASES[phase] || PHASES.afternoon
}

export function hashUnit(id) {
  let hash = 2166136261
  const text = String(id)
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0) / 4294967296
}

/* Fractions of the desk stage, stable for a given note: a staggered grid
   with a little tilt, so papers look set down by hand and never start stacked. */
export function paperPose(id, index, total, compact = false) {
  const cols = compact ? 2 : 3
  const span = compact ? 0.5 : 0.34
  const rows = Math.max(1, Math.ceil(total / cols))
  const col = index % cols
  const row = Math.floor(index / cols)
  const jitter = (key, size) => (hashUnit(`${id}:${key}`) - 0.5) * size
  const x = 0.02 + col * span + (row % 2 ? span * 0.1 : 0) + jitter('x', 0.05)
  const y = Math.max(0, 3 - rows) * 0.15 + 0.03 + row * 0.31 + (col % 2 ? 0.045 : 0) + jitter('y', 0.05)
  return {
    x: Math.min(compact ? 0.5 : 0.71, Math.max(0, x)),
    y: Math.max(0, y),
    rot: (hashUnit(id) - 0.5) * (compact ? 4 : 8),
  }
}

/* The desktop icons on home, in order: pinned notes, the nodes (top-level
   folders), stickies still in Unsorted gathered into one pile, then the few notes in no node
   touched most recently. Everything else is a click away in its node, so the desk
   stays calm however much you write. Day pages and the scratch page have their
   own places; stickies already out on the desk (`out`) aren't shown twice. */
export const WARM = 4

export function homeItems({ notes = [], folders = [] }, capacity = Infinity, out = new Set()) {
  const active = notes.filter((note) => isActiveNote(note) && !note.kind && !out.has(note.id))
  const recent = [...active].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const loose = recent.filter((note) => note.unsorted && !note.pinned)
  const piled = loose.length > 1 ? loose : []
  // Notes in a node are found in their node.
  const warm = recent.filter((note) => !note.pinned && !piled.includes(note) && !note.folderId).slice(0, WARM)
  const items = [
    ...recent.filter((note) => note.pinned).map((note) => ({ kind: 'note', id: note.id, note })),
    ...folderChildren(folders, null).map((folder) => ({ kind: 'folder', id: folder.id, folder })),
    ...(piled.length ? [{ kind: 'pile', id: 'unsorted', count: piled.length, notes: piled }] : []),
    ...warm.map((note) => ({ kind: 'note', id: note.id, note })),
  ]
  return fitCells(items, capacity)
}

/* Where a new sticky can go on the desk: the first spot, working outward from `near` in
   rings on a grid, that stays inside `area` and clear of every box in `taken` (all as
   { left, top, right, bottom }; `size` is { width, height }). */
export function freeSpot(taken, area, size, near, step = 24, gap = 12) {
  const fits = (x, y) => x >= area.left && y >= area.top && x + size.width <= area.right && y + size.height <= area.bottom
    && !taken.some((box) => x < box.right + gap && x + size.width + gap > box.left && y < box.bottom + gap && y + size.height + gap > box.top)
  for (let ring = 0; ring < 60; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        if (fits(near.x + dx * step, near.y + dy * step)) return { x: near.x + dx * step, y: near.y + dy * step }
      }
    }
  }
  return { x: Math.max(area.left, Math.min(near.x, area.right - size.width)), y: Math.max(area.top, Math.min(near.y, area.bottom - size.height)) }
}

/* As many items as fit; when there are more, the last cell says how many more. */
export function fitCells(items, capacity = Infinity) {
  const room = Math.max(1, Math.floor(capacity))
  if (items.length <= room) return items
  return [...items.slice(0, room - 1), { kind: 'more', id: 'more', count: items.length - room + 1 }]
}

const DAY = 86400000
const noonOf = (dateKey) => Date.parse(`${dateKey}T12:00:00`)

/* From before: one older note (made 30 or more days ago, not touched this week, not a day
   page, not resting after "Not now") that fits what was written this week. When none fits,
   a pick hashed from the date, so the widget keeps the same note all day. */
export function pickSurfacing(notes, today, rested = {}) {
  const now = noonOf(today)
  const age = (value) => (now - Date.parse(value)) / DAY
  const thisWeek = (note) => age(note.updatedAt) < 7
  const resting = (id) => (now - noonOf(rested[id])) / DAY < 30
  const active = notes.filter(isActiveNote)
  const old = active.filter((note) => note.kind !== 'day' && age(note.createdAt) >= 30 && !thisWeek(note) && !resting(note.id))
  if (!old.length) return null
  const written = active.filter(thisWeek).map((note) => `${note.title}\n${note.markdown}`).join('\n').slice(0, 20000)
  return relatedNotes(old, written, 1)[0] || [...old].sort((a, b) => a.id.localeCompare(b.id))[Math.floor(hashUnit(today) * old.length)]
}

/* "Not now" rests a note for 30 days; rests older than that are dropped as this one is kept. */
export function restSurfacing(rested, id, today) {
  const now = noonOf(today)
  return { ...Object.fromEntries(Object.entries(rested || {}).filter(([, day]) => (now - noonOf(day)) / DAY < 30)), [id]: today }
}

/* Where a moment sits on the day ribbon, 6am to midnight, as 0..1. */
export function ribbonAt(date) {
  const hours = date.getHours() + date.getMinutes() / 60
  return Math.min(1, Math.max(0, (hours - 6) / 18))
}

export function clampPose(pose) {
  return {
    x: Math.min(0.82, Math.max(0, pose.x)),
    y: Math.min(0.78, Math.max(0, pose.y)),
    rot: pose.rot || 0,
  }
}

/* The sheet shows a title and the words under it. A leading heading that
   repeats the title is the title, not a second copy of it. Round-trips
   keep the original markdown when nothing was edited. */
function splitTitle(markdown, title) {
  const text = String(markdown ?? '')
  const breakAt = text.indexOf('\n')
  const first = breakAt === -1 ? text : text.slice(0, breakAt)
  const stripped = first.replace(/^#{1,6}\s+/, '').trim()
  if (!String(title || '').trim() || stripped !== String(title).trim()) return null
  const after = breakAt === -1 ? '' : text.slice(breakAt + 1)
  const gap = after.match(/^\n*/)?.[0] ?? ''
  return { heading: first, body: after.slice(gap.length), gap }
}

export function paperFields(note) {
  const title = String(note?.title || '')
  const split = splitTitle(note?.markdown, title)
  if (!split) return { title, body: String(note?.markdown || '') }
  return { title, body: split.body }
}

export function paperWrite(note, title, body) {
  const nextTitle = String(title || '').trim() || String(note?.title || '').trim() || 'Untitled'
  const split = splitTitle(note?.markdown, note?.title)
  const nextBody = String(body ?? '')
  if (!split) {
    const sameLine = String(note?.markdown || '').trim() === String(note?.title || '').trim()
    if (sameLine) {
      const extra = nextBody.replace(/^\n+/, '').trim()
      if (!extra && nextTitle === String(note?.title || '').trim()) return { title: note.title, markdown: note.markdown }
      return { title: nextTitle, markdown: extra ? `${nextTitle}\n\n${extra}` : nextTitle }
    }
    return { title: nextTitle, markdown: nextBody }
  }
  const hashes = split.heading.match(/^(#{1,6}\s+)/)
  const heading = hashes ? `${hashes[1]}${nextTitle}` : nextTitle
  if (!nextBody) {
    if (split.body) return { title: nextTitle, markdown: heading }
    const tail = String(note?.markdown ?? '').slice(split.heading.length)
    return { title: nextTitle, markdown: heading + tail }
  }
  const gap = split.body === '' && split.gap === '' ? '\n' : split.gap
  return { title: nextTitle, markdown: `${heading}\n${gap}${nextBody}` }
}
