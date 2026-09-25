/* Mindmap boards: sticky-note cards laid out on a desk.
   Every card is a note from Notes; the board only owns geometry, links,
   frames (groups), saved views and paper colours. Pure functions, no DOM. */

import { normalizeNote } from './note-core.js'
import { folderSubtree, isActiveNote, isVisibleNote, uid } from './notes-model.js'

export const PAPERS = ['canary', 'apricot', 'rose', 'lilac', 'sky', 'mint', 'lime', 'bone']
export const PAPER_LABEL = { canary: 'Canary', apricot: 'Apricot', rose: 'Rose', lilac: 'Lilac', sky: 'Sky', mint: 'Mint', lime: 'Lime', bone: 'Bone' }
const AUTO_PAPERS = ['canary', 'sky', 'rose', 'mint', 'lilac', 'apricot', 'lime']
export const GRID = 20
export const CARD = { minW: 120, minH: 96, maxW: 720, maxH: 720 }
export const ZOOM = { min: 0.18, max: 3.2 }
export const BOARD_SCHEMA = 2

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const clean = (value, fallback = '') => (typeof value === 'string' ? value : fallback)
const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
export const snap = (value) => Math.round(value / GRID) * GRID

export function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export const paperName = (value) => PAPERS.includes(value) ? value : null
export const autoPaper = (tag) => AUTO_PAPERS[hash(tag) % AUTO_PAPERS.length]

/* ---------- sizing ---------- */

const LIST_LINE = /^\s*([-*•–]|\d+[.)]|\[[ xX]?\])\s+/

export function looksLikeList(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return false
  const marked = lines.filter((line) => LIST_LINE.test(line)).length
  return marked >= 2 && marked >= lines.length * 0.6
}

/* The sheet is chosen to suit what is written on it. */
export function stockFor(text) {
  const trimmed = String(text || '').trim()
  if (looksLikeList(trimmed)) {
    const lines = trimmed.split('\n').filter((line) => line.trim()).length
    return { w: 268, h: clamp(80 + lines * 28, 148, 440), ruled: true }
  }
  const length = trimmed.length
  if (length <= 44) return { w: 176, h: 144, ruled: false }
  if (length <= 132) return { w: 208, h: 172, ruled: false }
  if (length <= 300) return { w: 248, h: 212, ruled: false }
  return { w: 292, h: 252, ruled: false }
}

/* ---------- normalization ---------- */

function normalizeCard(card, index) {
  if (!isObject(card) || !clean(card.id)) return null
  return {
    id: card.id,
    x: finite(card.x, (index % 4) * 260),
    y: finite(card.y, Math.floor(index / 4) * 220),
    w: clamp(finite(card.w, 208), CARD.minW, CARD.maxW),
    h: clamp(finite(card.h, 168), CARD.minH, CARD.maxH),
    rot: clamp(finite(card.rot, 0), -3, 3),
    color: paperName(card.color),
    created: finite(card.created, Date.now()),
    updated: finite(card.updated, Date.now()),
  }
}

function normalizeView(view) {
  if (!isObject(view) || !clean(view.name).trim()) return null
  const cam = isObject(view.cam) ? view.cam : isObject(view.viewport) ? view.viewport : null
  return {
    id: clean(view.id) || uid('view'),
    name: view.name.trim().slice(0, 60),
    tags: Array.isArray(view.tags) ? view.tags.filter((tag) => typeof tag === 'string') : [],
    mode: view.mode === 'all' ? 'all' : 'any',
    query: clean(view.query),
    untagged: Boolean(view.untagged ?? view.flags?.untagged),
    unconnected: Boolean(view.unconnected ?? view.flags?.unconnected),
    cam: cam ? { x: finite(cam.x, 0), y: finite(cam.y, 0), z: clamp(finite(cam.z ?? cam.zoom, 1), ZOOM.min, ZOOM.max) } : null,
  }
}

function normalizeGroup(group) {
  if (!isObject(group) || !clean(group.id)) return null
  return {
    id: group.id,
    name: clean(group.name).slice(0, 80),
    x: finite(group.x, 0),
    y: finite(group.y, 0),
    w: Math.max(120, finite(group.w, 400)),
    h: Math.max(90, finite(group.h, 300)),
    color: paperName(group.color),
    auto: group.auto === 'tag' || group.auto === 'folder' ? group.auto : null,
  }
}

export function newBoard(name, scope = { kind: 'manual', folderId: null }) {
  const now = Date.now()
  return {
    id: uid('board'), name: name || 'Board', created: now, updated: now,
    scope, notes: [], links: [], groups: [], views: [], tagColors: {}, hidden: [], cam: { x: 0, y: 0, z: 1 },
  }
}

export function normalizeBoard(value, index = 0) {
  if (!isObject(value)) return null
  const cards = (Array.isArray(value.notes) ? value.notes : []).map(normalizeCard).filter(Boolean)
  const seen = new Set()
  const uniqueCards = cards.filter((card) => !seen.has(card.id) && seen.add(card.id))
  const ids = new Set(uniqueCards.map((card) => card.id))
  const scope = isObject(value.scope) && ['all', 'folder', 'manual'].includes(value.scope.kind)
    ? { kind: value.scope.kind, folderId: clean(value.scope.folderId) || null }
    : { kind: index === 0 ? 'all' : 'manual', folderId: null }
  if (scope.kind === 'folder' && !scope.folderId) scope.kind = 'manual'
  const tagColors = {}
  Object.entries(isObject(value.tagColors) ? value.tagColors : {}).forEach(([tag, color]) => {
    const paper = paperName(color)
    if (paper) tagColors[tag] = paper
  })
  return {
    id: clean(value.id) || uid('board'),
    name: clean(value.name).trim().slice(0, 60) || `Board ${index + 1}`,
    created: finite(value.created, Date.now()),
    updated: finite(value.updated, Date.now()),
    scope,
    notes: uniqueCards,
    links: (Array.isArray(value.links) ? value.links : []).flatMap((link) => {
      if (!isObject(link) || !ids.has(link.a) || !ids.has(link.b) || link.a === link.b) return []
      return [{ id: clean(link.id) || uid('link'), a: link.a, b: link.b, label: clean(link.label).slice(0, 80), arrow: link.arrow !== false }]
    }),
    groups: (Array.isArray(value.groups) ? value.groups : []).map(normalizeGroup).filter(Boolean),
    views: (Array.isArray(value.views) ? value.views : []).map(normalizeView).filter(Boolean),
    tagColors,
    hidden: [...new Set((Array.isArray(value.hidden) ? value.hidden : []).filter((id) => typeof id === 'string' && id))],
    cam: {
      x: finite(value.cam?.x, 0),
      y: finite(value.cam?.y, 0),
      z: clamp(finite(value.cam?.z, 1), ZOOM.min, ZOOM.max),
    },
  }
}

export function normalizeBoardDoc(value) {
  const input = isObject(value) ? value : {}
  let boards = (Array.isArray(input.boards) ? input.boards : []).map((board, index) => normalizeBoard(board, index)).filter(Boolean)
  const seen = new Set()
  boards = boards.filter((board) => !seen.has(board.id) && seen.add(board.id))
  if (!boards.length) boards = [{ ...newBoard('Desk', { kind: 'all', folderId: null }), id: 'osat-board' }]
  const activeId = boards.some((board) => board.id === input.activeId) ? input.activeId : boards[0].id
  return { schema: BOARD_SCHEMA, activeId, boards, showWikilinks: input.showWikilinks !== false }
}

/* ---------- reconciliation with Notes ---------- */

export function boardScopeNotes(board, state) {
  if (board.scope.kind === 'manual') return []
  const active = state.notes.filter(isActiveNote)
  if (board.scope.kind === 'folder') {
    const folder = state.folders.find((item) => item.id === board.scope.folderId)
    if (!folder) return active.filter((note) => note.folderId === board.scope.folderId)
    const scope = folderSubtree(state.folders, folder.id)
    return active.filter((note) => scope.has(note.folderId))
  }
  return active
}

function overlaps(a, b, gap = 16) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

/* Spiral outward from an origin on the grid until a card of this size fits. */
export function findFreeSpot(cards, w, h, origin = { x: 0, y: 0 }) {
  const step = GRID * 2
  const fits = (x, y) => !cards.some((card) => overlaps({ x, y, w, h }, card))
  const ox = snap(origin.x), oy = snap(origin.y)
  if (fits(ox, oy)) return { x: ox, y: oy }
  for (let ring = 1; ring < 200; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (const dy of dx === -ring || dx === ring ? Array.from({ length: ring * 2 + 1 }, (_, i) => i - ring) : [-ring, ring]) {
        const x = ox + dx * step, y = oy + dy * step
        if (fits(x, y)) return { x, y }
      }
    }
  }
  return { x: ox + cards.length * step, y: oy }
}

const isBoardDoc = (value) => isObject(value) && value.schema === BOARD_SCHEMA && Array.isArray(value.boards) && value.boards.length > 0

/* Keep every board's cards in step with Notes: auto boards gain a card for
   each note in scope and lose cards whose notes left it; manual boards only
   lose cards for trashed notes. Links and frames never survive their cards.
   Returns the same object when nothing needed to change, so typing in a note
   never rewrites the boards. */
export function reconcileBoards(state) {
  const doc = isBoardDoc(state.sorter) ? state.sorter : normalizeBoardDoc(state.sorter)
  const notesById = new Map(state.notes.map((note) => [note.id, note]))
  const boards = doc.boards.map((board) => {
    const inScope = board.scope.kind === 'manual' ? null : boardScopeNotes(board, state)
    const scoped = inScope ? new Set(inScope.map((note) => note.id)) : null
    const hidden = new Set(board.hidden)
    const cards = board.notes.filter((card) => {
      const note = notesById.get(card.id)
      if (!note || !isVisibleNote(note)) return false
      return scoped ? scoped.has(card.id) : true
    })
    const present = new Set(cards.map((card) => card.id))
    const placed = [...cards]
    const additions = (inScope || [])
      .filter((note) => !present.has(note.id) && !hidden.has(note.id))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((note) => {
        const stock = stockFor(note.markdown || note.title)
        const spot = findFreeSpot(placed, stock.w, stock.h)
        const created = Date.parse(note.createdAt) || Date.now()
        const card = { id: note.id, x: spot.x, y: spot.y, w: stock.w, h: stock.h, rot: (hash(note.id) % 240) / 100 - 1.2, color: null, created, updated: created }
        placed.push(card)
        return card
      })
    const ids = new Set([...present, ...additions.map((card) => card.id)])
    const links = board.links.filter((link) => ids.has(link.a) && ids.has(link.b))
    const keptHidden = board.hidden.filter((id) => notesById.has(id))
    if (cards.length === board.notes.length && !additions.length && links.length === board.links.length && keptHidden.length === board.hidden.length) return board
    return { ...board, notes: [...cards, ...additions], links, hidden: keptHidden }
  })
  return boards.every((board, index) => board === doc.boards[index]) ? doc : { ...doc, boards }
}

/* ---------- colours and tags ---------- */

export function cardPaper(card, note, board) {
  if (card.color) return card.color
  const tag = note?.tags?.[0]
  if (!tag) return 'canary'
  return board.tagColors[tag] || autoPaper(tag)
}

export const tagPaper = (board, tag) => board.tagColors[tag] || autoPaper(tag)

/* Give each new tag the least-used colour on the board, so the first handful
   of tags are easy to tell apart. Returns the same object when nothing changed. */
export function ensureTagColors(board, notesById) {
  const tags = new Set()
  board.notes.forEach((card) => notesById.get(card.id)?.tags.forEach((tag) => tags.add(tag)))
  const missing = [...tags].filter((tag) => !board.tagColors[tag])
  if (!missing.length) return board
  const tagColors = { ...board.tagColors }
  missing.forEach((tag) => {
    const used = Object.fromEntries(AUTO_PAPERS.map((paper) => [paper, 0]))
    Object.values(tagColors).forEach((paper) => { if (used[paper] != null) used[paper] += 1 })
    const least = Math.min(...AUTO_PAPERS.map((paper) => used[paper]))
    const pool = AUTO_PAPERS.filter((paper) => used[paper] === least)
    tagColors[tag] = pool[hash(tag) % pool.length]
  })
  return { ...board, tagColors }
}

export function boardTagIndex(board, notesById) {
  const counts = new Map()
  board.notes.forEach((card) => notesById.get(card.id)?.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)))
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }))
}

/* ---------- filters ---------- */

export const EMPTY_FILTER = { tags: [], mode: 'any', query: '', untagged: false, unconnected: false }
export const filterActive = (filter) => filter.tags.length > 0 || Boolean(filter.query.trim()) || filter.untagged || filter.unconnected

export function cardMatches(card, note, board, filter) {
  if (!note) return false
  if (!filterActive(filter)) return true
  const tags = note.tags
  if (filter.untagged && tags.length) return false
  if (filter.unconnected && board.links.some((link) => link.a === card.id || link.b === card.id)) return false
  if (filter.tags.length) {
    const hits = filter.tags.filter((tag) => tags.includes(tag)).length
    if (filter.mode === 'all' ? hits < filter.tags.length : hits === 0) return false
  }
  const query = filter.query.trim().toLowerCase()
  if (query && !`${note.title}\n${note.markdown}`.toLowerCase().includes(query)) return false
  return true
}

/* ---------- geometry ---------- */

export function contentBounds(items) {
  if (!items.length) return null
  const x1 = Math.min(...items.map((item) => item.x)), y1 = Math.min(...items.map((item) => item.y))
  const x2 = Math.max(...items.map((item) => item.x + item.w)), y2 = Math.max(...items.map((item) => item.y + item.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function fitCamera(bounds, viewport, pad = 60) {
  if (!bounds || !viewport.w || !viewport.h) return { x: 0, y: 0, z: 1 }
  const z = clamp(Math.min((viewport.w - pad * 2) / Math.max(bounds.w, 1), (viewport.h - pad * 2) / Math.max(bounds.h, 1), 1.6), ZOOM.min, ZOOM.max)
  return {
    x: Math.round((viewport.w - bounds.w * z) / 2 - bounds.x * z),
    y: Math.round((viewport.h - bounds.h * z) / 2 - bounds.y * z),
    z,
  }
}

export function zoomCamera(cam, factor, at, viewport) {
  const z = clamp(cam.z * factor, ZOOM.min, ZOOM.max)
  const px = at?.x ?? viewport.w / 2, py = at?.y ?? viewport.h / 2
  const wx = (px - cam.x) / cam.z, wy = (py - cam.y) / cam.z
  return { x: px - wx * z, y: py - wy * z, z }
}

/* Which edge of a card a wire should leave from, given the other end. */
export function anchor(card, other) {
  const cx = card.x + card.w / 2, cy = card.y + card.h / 2
  const ox = other.x + other.w / 2, oy = other.y + other.h / 2
  const dx = ox - cx, dy = oy - cy
  if (Math.abs(dx) * card.h > Math.abs(dy) * card.w) {
    return dx > 0 ? { x: card.x + card.w, y: cy, nx: 1, ny: 0 } : { x: card.x, y: cy, nx: -1, ny: 0 }
  }
  return dy > 0 ? { x: cx, y: card.y + card.h, nx: 0, ny: 1 } : { x: cx, y: card.y, nx: 0, ny: -1 }
}

export function wirePath(a, b) {
  const d = clamp(Math.hypot(b.x - a.x, b.y - a.y) * 0.4, 30, 170)
  const c1 = { x: a.x + a.nx * d, y: a.y + a.ny * d }
  const c2 = { x: b.x + b.nx * d, y: b.y + b.ny * d }
  const round = (value) => Math.round(value * 10) / 10
  return {
    d: `M${round(a.x)} ${round(a.y)}C${round(c1.x)} ${round(c1.y)},${round(c2.x)} ${round(c2.y)},${round(b.x)} ${round(b.y)}`,
    mid: { x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x, y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y },
    tip: b,
    tan: { x: b.x - c2.x, y: b.y - c2.y },
  }
}

export function arrowPoints(tip, tan) {
  const length = Math.hypot(tan.x, tan.y) || 1
  const ux = tan.x / length, uy = tan.y / length
  const size = 9, width = 5
  const bx = tip.x - ux * size, by = tip.y - uy * size
  return [tip.x, tip.y, bx - uy * width, by + ux * width, bx + uy * width, by - ux * width].map((value) => Math.round(value * 10) / 10).join(' ')
}

export const cardCenterInside = (card, group) => {
  const cx = card.x + card.w / 2, cy = card.y + card.h / 2
  return cx >= group.x && cx <= group.x + group.w && cy >= group.y && cy <= group.y + group.h
}

/* ---------- layouts ---------- */

const GAP = 24, COLGAP = 76, ROWGAP = 64, HEAD = 54, FRAME_PAD = 22

/* Arrange cards into one cluster per key, biggest first, and return the moved
   cards plus a frame per cluster. `keyOf` returns '' for "no group". */
export function clusterCards(cards, keyOf, labelOf, paperOf, auto) {
  if (!cards.length) return { cards: [], groups: [] }
  const groups = new Map()
  cards.forEach((card) => {
    const key = keyOf(card) || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(card)
  })
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    return groups.get(b).length - groups.get(a).length || a.localeCompare(b)
  })
  const plans = keys.map((key) => {
    const members = groups.get(key)
    const cellW = Math.max(...members.map((card) => card.w))
    const cellH = Math.max(...members.map((card) => card.h))
    const cols = clamp(Math.ceil(Math.sqrt(members.length)), 1, 4)
    const rows = Math.ceil(members.length / cols)
    return { key, members, cellW, cellH, cols, w: cols * (cellW + GAP) - GAP, h: rows * (cellH + GAP) - GAP + HEAD }
  })
  const gcols = clamp(Math.ceil(Math.sqrt(plans.length)), 1, 4)
  const colW = [], rowH = []
  plans.forEach((plan, index) => {
    const c = index % gcols, r = Math.floor(index / gcols)
    colW[c] = Math.max(colW[c] || 0, plan.w + FRAME_PAD * 2)
    rowH[r] = Math.max(rowH[r] || 0, plan.h + FRAME_PAD * 2)
  })
  const colX = [], rowY = []
  let acc = 0
  colW.forEach((w, c) => { colX[c] = acc; acc += w + COLGAP })
  acc = 0
  rowH.forEach((h, r) => { rowY[r] = acc; acc += h + ROWGAP })
  const moved = [], frames = []
  plans.forEach((plan, index) => {
    const x = colX[index % gcols] + FRAME_PAD, y = rowY[Math.floor(index / gcols)] + FRAME_PAD
    frames.push({
      id: uid('group'), name: labelOf(plan.key), auto,
      x: x - FRAME_PAD, y: y - FRAME_PAD, w: plan.w + FRAME_PAD * 2, h: plan.h + FRAME_PAD * 2,
      color: plan.key === '' ? 'bone' : paperOf(plan.key),
    })
    plan.members.forEach((card, j) => {
      moved.push({
        ...card,
        x: snap(x + (j % plan.cols) * (plan.cellW + GAP) + Math.round((plan.cellW - card.w) / 2)),
        y: snap(y + HEAD + Math.floor(j / plan.cols) * (plan.cellH + GAP)),
        rot: ((hash(`${card.id}:${j}`) % 160) / 100 - 0.8),
      })
    })
  })
  return { cards: moved, groups: frames }
}

export function tidyGrid(cards) {
  if (!cards.length) return []
  const list = [...cards].sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const cellW = Math.max(...list.map((card) => card.w)) + 26
  const cellH = Math.max(...list.map((card) => card.h)) + 26
  const cols = clamp(Math.ceil(Math.sqrt(list.length * 1.5)), 1, 8)
  return list.map((card, index) => ({ ...card, x: snap((index % cols) * cellW), y: snap(Math.floor(index / cols) * cellH), rot: ((hash(`${card.id}:${index}`) % 120) / 100 - 0.6) }))
}

/* ---------- export / import ---------- */

const firstLine = (text) => String(text || '').split('\n')[0].trim() || '(empty note)'

export function boardToJson(board, notesById) {
  return {
    app: 'osat-board', schema: BOARD_SCHEMA, exportedAt: new Date().toISOString(),
    board: {
      ...board,
      notes: board.notes.map((card) => ({ ...card, text: notesById.get(card.id)?.markdown || notesById.get(card.id)?.title || '' })),
    },
  }
}

export function boardToMarkdown(board, notesById) {
  const groups = new Map()
  board.notes.forEach((card) => {
    const note = notesById.get(card.id)
    const tag = note?.tags?.[0] || ''
    if (!groups.has(tag)) groups.set(tag, [])
    groups.get(tag).push(note)
  })
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === '') return 1
    if (b === '') return -1
    return groups.get(b).length - groups.get(a).length || a.localeCompare(b)
  })
  let out = `# ${board.name}\n\n_${board.notes.length} notes · exported ${new Date().toLocaleString()}_\n`
  keys.forEach((tag) => {
    out += `\n## ${tag === '' ? 'Untagged' : `#${tag}`}\n\n`
    groups.get(tag).forEach((note) => {
      if (!note) return
      const lines = (note.markdown || note.title).split('\n')
      out += `- ${lines[0]}\n${lines.slice(1).map((line) => `  ${line}`).join('\n')}${lines.length > 1 ? '\n' : ''}`
    })
  })
  if (board.links.length) {
    out += '\n## Connections\n\n'
    board.links.forEach((link) => {
      const a = notesById.get(link.a), b = notesById.get(link.b)
      if (!a || !b) return
      out += `- ${firstLine(a.title).slice(0, 60)}${link.arrow ? ' → ' : ' — '}${firstLine(b.title).slice(0, 60)}${link.label ? `  _(${link.label})_` : ''}\n`
    })
  }
  return out
}

/* Accepts a V2 board export, a Sticky Note Sorter board/document, or plain
   text (one note per line or paragraph). Returns notes + cards + links that
   the caller adds to the workspace and the active board. */
export function importBoardText(text) {
  const raw = String(text || '').trim()
  if (!raw) return { error: 'Paste JSON or plain text first.' }
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { /* plain text handled below */ }
  const stamp = new Date().toISOString()
  if (!parsed) {
    const blocks = raw.includes('\n\n') ? raw.split(/\n{2,}/) : raw.split('\n')
    const notes = blocks.map((block) => block.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean)
      .map((markdown) => normalizeNote({ id: uid('note'), title: markdown.split('\n')[0].replace(/^#+\s*/, ''), markdown, createdAt: stamp, updatedAt: stamp }))
    return { notes, cards: notes.map((note) => ({ id: note.id, ...stockFor(note.markdown), rot: 0, color: null })), links: [], error: '' }
  }
  const source = parsed.board || (Array.isArray(parsed.boards) ? parsed.boards[0] : null) || parsed
  if (!isObject(source) || !Array.isArray(source.notes)) return { error: 'No notes were found in that JSON.' }
  const idMap = new Map()
  const notes = [], cards = []
  source.notes.forEach((card, index) => {
    if (!isObject(card)) return
    const markdown = clean(card.text, clean(card.markdown, clean(card.body)))
    const note = normalizeNote({ id: uid('note'), title: clean(card.title) || markdown.split('\n')[0].replace(/^#+\s*/, '') || 'Imported note', markdown, createdAt: stamp, updatedAt: stamp }, index)
    idMap.set(card.id, note.id)
    notes.push(note)
    const stock = stockFor(markdown)
    cards.push({
      id: note.id,
      x: finite(card.x, (index % 4) * 250), y: finite(card.y, Math.floor(index / 4) * 190),
      w: clamp(finite(card.w, stock.w), CARD.minW, CARD.maxW), h: clamp(finite(card.h, stock.h), CARD.minH, CARD.maxH),
      rot: clamp(finite(card.rot, 0), -3, 3), color: paperName(card.color),
    })
  })
  const links = (Array.isArray(source.links) ? source.links : []).flatMap((link) => {
    const a = idMap.get(link?.a), b = idMap.get(link?.b)
    return a && b && a !== b ? [{ id: uid('link'), a, b, label: clean(link.label).slice(0, 80), arrow: link.arrow !== false }] : []
  })
  return { notes, cards, links, error: notes.length ? '' : 'That file has no notes to import.' }
}

/* ---------- board mutations (return a new workspace) ---------- */

export function updateBoard(state, boardId, updater) {
  const doc = normalizeBoardDoc(state.sorter)
  return {
    ...state,
    sorter: { ...doc, boards: doc.boards.map((board) => board.id === boardId ? { ...updater(board), updated: Date.now() } : board) },
  }
}

export function addCardsToBoard(board, cards) {
  const present = new Set(board.notes.map((card) => card.id))
  const placed = [...board.notes]
  cards.forEach((card) => {
    if (present.has(card.id)) return
    const spot = card.x === undefined ? findFreeSpot(placed, card.w, card.h) : { x: card.x, y: card.y }
    const full = { created: Date.now(), updated: Date.now(), rot: 0, color: null, ...card, ...spot }
    placed.push(full)
    present.add(card.id)
  })
  return { ...board, notes: placed, hidden: board.hidden.filter((id) => !present.has(id)) }
}

export function removeCards(board, ids) {
  const set = new Set(ids)
  return {
    ...board,
    notes: board.notes.filter((card) => !set.has(card.id)),
    links: board.links.filter((link) => !set.has(link.a) && !set.has(link.b)),
    hidden: board.scope.kind === 'manual' ? board.hidden : [...new Set([...board.hidden, ...ids])],
  }
}
