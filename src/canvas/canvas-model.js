/* Canvases (Phase 85): whiteboards of shapes, text, arrows (mind maps), stickies and kanbans. Each is
   { id, name, elements, createdAt, updatedAt } in `workspace.canvases` (schema 17); `elements` are Excalidraw's own,
   saved as they are, without the ones deleted. A kanban on a canvas is an embed whose link names a board
   (`kanbanLink`), drawn live from that board's stickies, so it is the same kanban as the board's own tab. */
import { makeId } from '../lib/ui.js'

// ponytail: the whole list is saved on each change; split it per element if canvases get huge.
export const MOST_ELEMENTS = 5000
const KANBAN = /^osat:\/\/board\/([\w-]{1,80})$/

export const kanbanLink = (boardId) => `osat://board/${boardId}`
export const boardOfLink = (link) => KANBAN.exec(String(link || ''))?.[1] || null

export function canvasesOf(state) {
  return Array.isArray(state.canvases) ? state.canvases : []
}

export function addCanvas(state, name, now = new Date().toISOString()) {
  const canvas = { id: makeId('canvas'), name: String(name).trim().slice(0, 80) || 'Canvas', elements: [], createdAt: now, updatedAt: now }
  return { state: { ...state, canvases: [...canvasesOf(state), canvas] }, canvas }
}

export function renameCanvas(state, id, name) {
  const value = String(name || '').trim().slice(0, 80)
  if (!value) return state
  return { ...state, canvases: canvasesOf(state).map((canvas) => (canvas.id === id ? { ...canvas, name: value } : canvas)) }
}

export function removeCanvas(state, id) {
  return { ...state, canvases: canvasesOf(state).filter((canvas) => canvas.id !== id) }
}

/* What Excalidraw has now, kept: no deleted elements, at most MOST_ELEMENTS. Unchanged state when nothing moved. */
export function saveElements(state, id, elements, now = new Date().toISOString()) {
  const kept = (elements || []).filter((element) => element && !element.isDeleted).slice(0, MOST_ELEMENTS)
  const canvas = canvasesOf(state).find((item) => item.id === id)
  if (!canvas || sameElements(canvas.elements, kept)) return state
  const plain = JSON.parse(JSON.stringify(kept))
  return { ...state, canvases: canvasesOf(state).map((item) => (item.id === id ? { ...item, elements: plain, updatedAt: now } : item)) }
}

function sameElements(a = [], b = []) {
  return a.length === b.length && a.every((element, index) => element.id === b[index].id && element.version === b[index].version)
}

/* The middle of what's on screen, in the canvas's own coordinates. `step` staggers stickies added one after another. */
export function middleOf(appState, step = 0) {
  const zoom = appState?.zoom?.value || 1
  const x = (appState?.width || 1000) / 2 / zoom - (appState?.scrollX || 0)
  const y = (appState?.height || 700) / 2 / zoom - (appState?.scrollY || 0)
  const nudge = (step % 8) * 24
  return { x: Math.round(x + nudge), y: Math.round(y + nudge) }
}

/* A sticky: a yellow note with its words inside, as Excalidraw's skeleton (convertToExcalidrawElements). */
export const STICKY = { width: 220, height: 150 }
export function stickySkeleton({ x, y }, text = '') {
  return {
    type: 'rectangle',
    x: x - STICKY.width / 2,
    y: y - STICKY.height / 2,
    width: STICKY.width,
    height: STICKY.height,
    backgroundColor: '#ffec99',
    strokeColor: '#e8b100',
    fillStyle: 'solid',
    strokeWidth: 1,
    roughness: 0,
    roundness: { type: 3 },
    customData: { sticky: true },
    label: { text: String(text).slice(0, 2000), fontSize: 20, strokeColor: '#1e1e1e' },
  }
}

/* A kanban: one board's Later / Next / Doing / Done, as an embed. `base` is any element made by Excalidraw itself
   (a rectangle from convertToExcalidrawElements), so every field it expects is there. */
export const KANBAN_SIZE = { width: 960, height: 520 }
export function kanbanElement(base, boardId) {
  return { ...base, type: 'embeddable', link: kanbanLink(boardId), backgroundColor: 'transparent', strokeColor: 'transparent', roundness: null, customData: { kanban: boardId } }
}

/* Each canvas kept as it should be: a name, its elements, its dates. */
export function normalizeCanvases(value) {
  const seen = new Set()
  return (Array.isArray(value) ? value : []).flatMap((canvas) => {
    if (!canvas || typeof canvas !== 'object' || typeof canvas.id !== 'string' || !canvas.id || seen.has(canvas.id)) return []
    seen.add(canvas.id)
    return [{
      id: canvas.id,
      name: String(canvas.name || '').trim().slice(0, 80) || 'Canvas',
      elements: (Array.isArray(canvas.elements) ? canvas.elements : []).filter((element) => element && typeof element === 'object' && typeof element.id === 'string').slice(0, MOST_ELEMENTS),
      createdAt: typeof canvas.createdAt === 'string' ? canvas.createdAt : '',
      updatedAt: typeof canvas.updatedAt === 'string' ? canvas.updatedAt : '',
    }]
  })
}
