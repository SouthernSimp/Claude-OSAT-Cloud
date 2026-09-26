/* Layout for the desk and the sky. Pure functions so the motion can be tested
   without a browser. Positions stay finite; pinned stars do not get moved. */

import { excerpt, folderChildren, isActiveNote, wikilinkPairs } from '../notes-model.js'

export const WORLD = { width: 1600, height: 1000 }
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

/* The desktop icons on home, in order: pinned notes, top-level folders, the
   Mindmap, loose thoughts gathered into one pile, then the few notes touched
   most recently. Everything else is a click away in its folder, so the desk
   stays calm however much you write. Daily pages have their own place. */
export const WARM = 4

export function homeItems({ notes = [], folders = [], boards = [] }, capacity = Infinity) {
  const active = notes.filter((note) => isActiveNote(note) && note.kind !== 'day')
  const recent = [...active].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const board = board0(boards)
  const loose = recent.filter((note) => note.unsorted && !note.pinned)
  const piled = loose.length > 1 ? loose : []
  const warm = recent.filter((note) => !note.pinned && !piled.includes(note)).slice(0, WARM)
  const items = [
    ...recent.filter((note) => note.pinned).map((note) => ({ kind: 'note', id: note.id, note })),
    ...folderChildren(folders, null).map((folder) => ({ kind: 'folder', id: folder.id, folder })),
    ...(board ? [{ kind: 'board', id: board.id, board }] : []),
    ...(piled.length ? [{ kind: 'pile', id: 'unsorted', count: piled.length, notes: piled }] : []),
    ...warm.map((note) => ({ kind: 'note', id: note.id, note })),
  ]
  return fitCells(items, capacity)
}

function board0(boards) {
  return boards.find((item) => item?.scope?.kind === 'all') || boards[0]
}

/* As many items as fit; when there are more, the last cell says how many more. */
export function fitCells(items, capacity = Infinity) {
  const room = Math.max(1, Math.floor(capacity))
  if (items.length <= room) return items
  return [...items.slice(0, room - 1), { kind: 'more', id: 'more', count: items.length - room + 1 }]
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

export function noteHeat(updatedAt, now = Date.now()) {
  const then = Date.parse(updatedAt)
  if (!Number.isFinite(then)) return 0
  const days = (now - then) / 86400000
  if (days <= 1.5) return 1
  if (days <= 8) return 0.45
  return 0
}

function spiral(index, count, bounds) {
  const angle = index * 2.399963229728653
  const radius = Math.sqrt((index + 0.5) / Math.max(count, 1)) * Math.min(bounds.width, bounds.height) * 0.46
  return {
    x: bounds.width / 2 + Math.cos(angle) * radius,
    y: bounds.height / 2 + Math.sin(angle) * radius * 0.72,
  }
}

/* Notes become stars. Wikilinks are strong ties. Shared tags form a chain,
   not a clique, so a tag with twenty notes does not become a hairball. */
/* `keepId` is a note that must have a star even when it is older than the newest
   `limit` ("See in the Sky" on an old note). */
export function buildSkyGraph(notes, bounds = WORLD, limit = 180, keepId = null) {
  const active = (Array.isArray(notes) ? notes : [])
    .filter(isActiveNote)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const chosen = active.slice(0, limit)
  const kept = keepId && active.slice(limit).find((note) => note.id === keepId)
  if (kept) chosen.splice(limit - 1, 1, kept)
  const ids = new Set(chosen.map((note) => note.id))
  const wiki = wikilinkPairs(chosen)
    .filter((pair) => ids.has(pair.a) && ids.has(pair.b))
    .map((pair) => ({ a: pair.a, b: pair.b, kind: 'wiki' }))
  const seen = new Set(wiki.map((link) => [link.a, link.b].sort().join('|')))
  const byTag = new Map()
  chosen.forEach((note) => {
    ;(note.tags || []).forEach((tag) => {
      if (!byTag.has(tag)) byTag.set(tag, [])
      byTag.get(tag).push(note.id)
    })
  })
  const links = [...wiki]
  byTag.forEach((group) => {
    const ordered = group.slice(0, 10)
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const key = [ordered[i], ordered[i + 1]].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ a: ordered[i], b: ordered[i + 1], kind: 'tag' })
    }
  })
  const degree = new Map()
  links.forEach((link) => {
    degree.set(link.a, (degree.get(link.a) || 0) + 1)
    degree.set(link.b, (degree.get(link.b) || 0) + 1)
  })
  const nodes = chosen.map((note, index) => {
    const at = spiral(index, chosen.length, bounds)
    return {
      id: note.id,
      title: note.title || 'Untitled',
      excerpt: excerpt(note.markdown, 160).replace(/☐/g, '').replace(/\s+/g, ' ').trim(),
      tags: note.tags || [],
      updatedAt: note.updatedAt,
      heat: noteHeat(note.updatedAt),
      degree: degree.get(note.id) || 0,
      r: 7 + Math.min(degree.get(note.id) || 0, 7) * 1.5,
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      pinned: false,
    }
  })
  return { nodes, links }
}

export function stepSky(nodes, links, bounds = WORLD) {
  const next = nodes.map((node) => ({ ...node, vx: node.vx || 0, vy: node.vy || 0 }))
  const byId = new Map(next.map((node) => [node.id, node]))
  const cx = bounds.width / 2
  const cy = bounds.height / 2
  for (let i = 0; i < next.length; i += 1) {
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i]
      const b = next[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let dist2 = dx * dx + dy * dy
      if (dist2 < 36) {
        dx = (i % 2 === 0 ? 1 : -1) * 6
        dy = 4
        dist2 = dx * dx + dy * dy
      }
      const dist = Math.sqrt(dist2)
      const force = 980 / dist2
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }
  }
  links.forEach((link) => {
    const a = byId.get(link.a)
    const b = byId.get(link.b)
    if (!a || !b) return
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy) || 1
    const rest = link.kind === 'wiki' ? 150 : 230
    const pull = (dist - rest) * (link.kind === 'wiki' ? 0.011 : 0.0035)
    const fx = (dx / dist) * pull
    const fy = (dy / dist) * pull
    a.vx += fx
    a.vy += fy
    b.vx -= fx
    b.vy -= fy
  })
  next.forEach((node) => {
    node.vx += (cx - node.x) * 0.0014
    node.vy += (cy - node.y) * 0.0014
    node.vx *= 0.8
    node.vy *= 0.8
    node.vx = Math.max(-22, Math.min(22, node.vx))
    node.vy = Math.max(-22, Math.min(22, node.vy))
    if (node.pinned) {
      node.vx = 0
      node.vy = 0
      return
    }
    node.x += node.vx
    node.y += node.vy
  })
  return next
}

export function runSky(nodes, links, steps, bounds = WORLD) {
  let current = nodes.map((node) => ({ ...node }))
  const count = Math.max(0, steps | 0)
  for (let i = 0; i < count; i += 1) current = stepSky(current, links, bounds)
  return current
}

export function skyEnergy(nodes) {
  return nodes.reduce((sum, node) => sum + Math.abs(node.vx || 0) + Math.abs(node.vy || 0), 0)
}

export function constellationLabels(nodes) {
  const groups = new Map()
  nodes.forEach((node) => {
    const tag = node.tags?.[0]
    if (!tag) return
    if (!groups.has(tag)) groups.set(tag, [])
    groups.get(tag).push(node)
  })
  return [...groups.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([tag, list]) => ({
      tag,
      count: list.length,
      x: list.reduce((sum, node) => sum + node.x, 0) / list.length,
      y: Math.min(...list.map((node) => node.y)) - 56,
    }))
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

export function fitCamera(nodes, viewW, viewH, padding = 96) {
  if (!nodes.length || viewW < 40 || viewH < 40) return { x: 0, y: 0, z: 1 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  nodes.forEach((node) => {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x)
    maxY = Math.max(maxY, node.y)
  })
  const width = Math.max(280, maxX - minX)
  const height = Math.max(200, maxY - minY)
  const z = Math.max(0.34, Math.min(1.25, (viewW - padding * 2) / width, (viewH - padding * 2) / height))
  return {
    x: viewW / 2 - ((minX + maxX) / 2) * z,
    y: viewH / 2 - ((minY + maxY) / 2) * z - 10,
    z,
  }
}
