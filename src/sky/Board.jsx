import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ArrowRight, At, CalendarPlus, CaretDown, CornersOut, Crosshair, DotsThree, Minus, Plus, Sparkle } from '@phosphor-icons/react'

import { freeSpot, hashUnit } from '../field/field-model.js'
import { DraftSticky, LinkDot, STICKY, menuEvent, useLinking } from '../field/DeskStickies.jsx'
import { carryable, useDrop } from '../lib/carry.js'
import { edgePath, linksOf, partsOf } from '../links-model.js'
import { folderChildren, folderSubtree, isBranch } from '../notes-model.js'
import {
  addFolder, addSticky, asksIn, askStart, boardSpots, CARD, mentionedIn, moveFolder, nodesOf, pileOf, placeNodes, stickiesIn,
} from '../nodes-model.js'
import { branchOf, hangAt, layoutTree } from './map-layout.js'
import { AddSticky, NameField } from './Piles.jsx'
import { Sticky } from './Sticky.jsx'

const CAMERA_KEY = 'osat.sky.camera.v1'
const ZOOM = { min: 0.2, max: 1.6 }
// Further out than this, a card shows its name big and what's inside it faintly.
const FAR = 0.5
const READABLE = 0.85 // the smallest an opened node is shown at
const clampZoom = (z) => Math.min(ZOOM.max, Math.max(ZOOM.min, z))
// What a click on the board itself ignores: the cards and controls on it.
const ON_CARD = '.board-card, .board-sticky, .board-sticky-draft, .board-naming, .board-zoom, .map-card, .board-focus, .link-hit'

/* How thick a pile looks: a layer of paper for every few stickies, never a number. */
const layersFor = (count) => Math.min(4, Math.ceil(count / 3))

function readCamera() {
  try {
    const value = JSON.parse(localStorage.getItem(CAMERA_KEY))
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) && Number.isFinite(value?.z) ? { x: value.x, y: value.y, z: clampZoom(value.z) } : null
  } catch {
    return null
  }
}

/* The node a folder sits in (itself, for a node). */
function rootOf(folders, id) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  let folder = byId.get(id)
  for (let guard = 0; folder?.parentId && guard < 64; guard += 1) folder = byId.get(folder.parentId)
  return folder?.id || null
}

/* A connection's end ('note:<id>' / 'folder:<id>') as a card's key on the board. */
const cardKey = (key) => (key.startsWith('folder:') ? key.slice(7) : key)

/* The Sky's whiteboard, drawn as a mind map (Phase 27): every node is a card you can put
   anywhere, on a board that goes on forever. Drag the board (or two-finger scroll) to look
   around, pinch or ⌘-scroll to zoom; double-click it to write a sticky there. Click a node
   to open it: its branches and stickies spread out around it, joined by lines, and the
   other nodes step back without moving. Fold a branch to tuck its things away; drag any card
   and what hangs off it comes along; drop it on a node or a branch to give it a home there.
   Double-click a node to focus on it alone (Done comes back). Connections (a dot on each
   card's edge) join any two things; @mentions join nodes. Unsorted waits on the far left. */
export const Board = forwardRef(function Board({ workspace, actions, open, toggle, sorting, focus, onFocus, onOpenUnsorted }, ref) {
  const view = useRef(null)
  const stored = useRef(readCamera())
  const [camera, setCamera] = useState(() => stored.current || { x: 120, y: 160, z: 1 })
  const [sizes, setSizes] = useState(() => new Map())
  // What is being carried itself ({ key, dx, dy } in screen pixels): it and what hangs off it follow.
  const [drag, setDrag] = useState(null)
  const [naming, setNaming] = useState(null)
  const [draft, setDraft] = useState(null)
  const [adding, setAdding] = useState(null)
  const [flying, setFlying] = useState(false)
  const [panning, setPanning] = useState(false)
  const flyTimer = useRef(0)
  const before = useRef({ focusHome: null })
  const destination = useRef(null)

  const roots = nodesOf(workspace.folders).map(({ folder }) => folder)
  const shownRoots = focus ? roots.filter((folder) => folder.id === focus) : roots
  const spots = useMemo(() => boardSpots(workspace.folders, sizes), [workspace.folders, sizes])
  const mentions = useMemo(() => mentionedIn(workspace), [workspace])
  const loose = focus ? [] : pileOf(workspace.notes, null).filter((note) => note.at)

  /* The open nodes, laid out as maps (map-layout.js): every card's box, by key. */
  const trees = useMemo(() => {
    const all = new Map()
    roots.forEach((folder) => {
      // The overview shows topics and free stickies. Expanding a topic is an
      // isolated view, so unrelated trees can never overlap it.
      if (focus !== folder.id) return
      layoutTree(workspace, folder, spots.get(folder.id), { sizes, folds: actions.folds }).forEach((box, key) => all.set(key, box))
    })
    return all
  }, [workspace, spots, sizes, open, actions.folds, focus]) // eslint-disable-line react-hooks/exhaustive-deps

  const latest = useRef(null)
  latest.current = { camera, spots, sizes, trees, visibleRoots: shownRoots.map((folder) => folder.id), loose, folders: workspace.folders, notes: workspace.notes }

  /* Each card's size, as laid out (the zoom doesn't change it). */
  const observer = useRef(null)
  if (!observer.current && typeof ResizeObserver !== 'undefined') {
    observer.current = new ResizeObserver((entries) => setSizes((current) => {
      let next = null
      for (const { target } of entries) {
        const key = target.dataset.card === 'unsorted' ? null : target.dataset.card
        const size = { w: target.offsetWidth, h: target.offsetHeight }
        const was = current.get(key)
        if (!size.w || (was?.w === size.w && was?.h === size.h)) continue
        next ??= new Map(current)
        next.set(key, size)
      }
      return next || current
    }))
  }
  useEffect(() => () => observer.current?.disconnect(), [])
  const measure = (element) => { if (element) observer.current?.observe(element) }

  /* Where a card is: in an open map, a node's spot, a free sticky's, or Unsorted's. */
  const boxOf = (key, from = latest.current) => {
    if (from.trees.has(key)) return from.trees.get(key)
    if (key === null || key === 'unsorted') return { ...from.spots.get(null), ...(from.sizes.get(null) || CARD) }
    if (from.spots.has(key)) return { ...from.spots.get(key), ...(from.sizes.get(key) || CARD) }
    const note = key.startsWith('note:') && from.notes.find((item) => item.id === key.slice(5))
    return note?.at ? { ...note.at, ...(from.sizes.get(key) || STICKY) } : null
  }
  function boxes() {
    const from = latest.current
    return [
      ...from.visibleRoots.map((id) => boxOf(id)),
      ...from.trees.values(),
      ...from.loose.map((note) => boxOf(`note:${note.id}`)),
    ].filter(Boolean)
  }
  const union = (list) => {
    if (!list.length) return { x: 0, y: 0, w: 0, h: 0 }
    const left = Math.min(...list.map((box) => box.x))
    const top = Math.min(...list.map((box) => box.y))
    return { x: left, y: top, w: Math.max(...list.map((box) => box.x + box.w)) - left, h: Math.max(...list.map((box) => box.y + box.h)) - top }
  }
  const bounds = () => union(boxes())
  /* A node and its open map. */
  const treeBounds = (id) => {
    const from = latest.current
    const keys = from.trees.has(id) ? [...branchOf(from.trees, id)] : [id]
    return union(keys.map((key) => boxOf(key)).filter(Boolean))
  }
  function newSpot() {
    const viewBox = view.current.getBoundingClientRect()
    const top = toWorld(24, 24)
    const bottom = toWorld(viewBox.width - 24, viewBox.height - 80)
    const middle = toWorld(viewBox.width / 2, viewBox.height / 2)
    return freeSpot(
      boxes().map((box) => ({ left: box.x, top: box.y, right: box.x + box.w, bottom: box.y + box.h })),
      { left: top.x, top: top.y, right: bottom.x, bottom: bottom.y },
      { width: STICKY.w, height: STICKY.h },
      { x: middle.x - STICKY.w / 2, y: middle.y - 40 },
    )
  }

  /* The camera that shows `rect` (in board points) in the middle of the view. */
  function frame(rect, most = 1) {
    const box = view.current.getBoundingClientRect()
    const pad = Math.min(96, box.width * 0.08)
    const z = clampZoom(Math.min(most, (box.width - pad * 2) / Math.max(rect.w, 1), (box.height - pad * 2) / Math.max(rect.h, 1)))
    return { x: box.width / 2 - (rect.x + rect.w / 2) * z, y: box.height / 2 - (rect.y + rect.h / 2) * z, z }
  }
  /* A map bigger than the view is shown at a size you can read, around its node. */
  function frameMap(id) {
    const next = frame(treeBounds(id), 1)
    if (next.z >= READABLE) return next
    const node = boxOf(id)
    const box = view.current.getBoundingClientRect()
    return { x: box.width / 2 - (node.x + node.w / 2) * READABLE, y: box.height / 2 - (node.y + node.h / 2) * READABLE, z: READABLE }
  }
  function fly(next) {
    setFlying(true)
    setCamera(next)
    clearTimeout(flyTimer.current)
    flyTimer.current = setTimeout(() => setFlying(false), 760)
  }
  const fit = () => fly(frame(bounds()))
  function zoomBy(factor, at) {
    const box = view.current.getBoundingClientRect()
    const point = at || { x: box.width / 2, y: box.height / 2 }
    setCamera((current) => {
      const z = clampZoom(current.z * factor)
      return { x: point.x - (point.x - current.x) * (z / current.z), y: point.y - (point.y - current.y) * (z / current.z), z }
    })
  }
  const toWorld = (x, y, at = latest.current.camera) => ({ x: (x - at.x) / at.z, y: (y - at.y) / at.z })

  /* Enter at an overview of the cards, not a camera left inside an old tree. */
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => { if (view.current && !latest.current.trees.size) setCamera(frame(bounds())) }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)) } catch { /* a convenience only */ } }, 300)
    return () => clearTimeout(timer)
  }, [camera])

  /* Two fingers (or a wheel) move around; a pinch, or ⌘ with the wheel, zooms. */
  useEffect(() => {
    const element = view.current
    const wheel = (event) => {
      if (event.target.closest('.context-menu')) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      const box = element.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) zoomBy(Math.exp(-event.deltaY * unit * 0.008), { x: event.clientX - box.left, y: event.clientY - box.top })
      else setCamera((current) => ({ ...current, x: current.x - event.deltaX * unit, y: current.y - event.deltaY * unit }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* Nodes set down somewhere new; everything else keeps its place. */
  const place = (changes) => actions.canvasCommit('Moved topics on Sky', (state) => placeNodes(state, boardSpots(state.folders, latest.current.sizes), changes))

  /* Fly to a node (or a branch's node, or Unsorted), opening it and every folded branch on
     the way down; a sticky in it glows. */
  function goTo({ folderId = null, noteId = null } = {}) {
    const state = latest.current
    const note = noteId && state.notes.find((item) => item.id === noteId)
    const free = note?.at && !note.folderId
    const home = note?.folderId || folderId
    const root = home ? rootOf(state.folders, home) : null
    destination.current = root
    if (root) {
      toggle(root, true)
      for (let id = home, guard = 0; id && id !== root && guard < 64; guard += 1) {
        actions.fold(id, false)
        id = state.folders.find((folder) => folder.id === id)?.parentId
      }
    } else onFocus(null)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!view.current) return
      const key = noteId ? `note:${noteId}` : null
      const box = key && (free || latest.current.trees.has(key)) ? boxOf(key) : null
      if (box) fly(frame(box, 1))
      else if (home && home !== root && latest.current.trees.has(home)) fly(frameMap(home))
      else if (root) fly(frameMap(root))
      else onOpenUnsorted?.(noteId)
      destination.current = null
      const sticky = noteId && view.current.querySelector(`[data-note="${noteId}"]`)
      if (!sticky) return
      sticky.classList.add('is-found')
      setTimeout(() => sticky.classList.remove('is-found'), 1800)
    }))
  }

  /* Focus: one node alone, its map framed; Done goes back to where the board was. */
  useEffect(() => {
    if (focus) {
      before.current.focusHome ??= latest.current.camera
      // A search/branch jump owns its destination; don't override it with a
      // second camera flight to the root of the topic.
      if (destination.current !== focus) requestAnimationFrame(() => requestAnimationFrame(() => { if (view.current && latest.current.trees.has(focus)) fly(frameMap(focus)) }))
    } else if (before.current.focusHome) {
      fly(before.current.focusHome)
      before.current.focusHome = null
    }
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    goTo,
    sizes: () => latest.current.sizes,
    freeSpot: newSpot,
    /* A new node in the middle of what's in view. */
    newNode() {
      const box = view.current.getBoundingClientRect()
      const middle = toWorld(box.width / 2, box.height / 2)
      setNaming({ x: middle.x - CARD.w / 2, y: middle.y - 70 })
    },
    newSticky() {
      if (focus) { setAdding(focus); fly(frame(boxOf(focus))); return }
      startSticky(newSpot())
    },
    placeSticky(noteId) {
      const at = newSpot()
      actions.placeSticky(noteId, at)
      fly(frame({ ...at, ...STICKY }))
    },
    /* A stack from the desk, as a branch set down near the middle of the view. */
    placeStack(detail) {
      const at = newSpot()
      const made = actions.sendStack(detail, (state, id) => placeNodes(state, boardSpots(state.folders, latest.current.sizes), new Map([[id, at]])))
      if (made) fly(frame({ ...at, ...CARD }))
    },
    back() {
      if (draft) { setDraft(null); return true }
      if (adding) { setAdding(null); return true }
      if (!naming) return false
      setNaming(null)
      return true
    },
    fit,
  }))

  function startSticky(at) {
    setDraft(at)
    if (latest.current.camera.z < READABLE) fly(frame({ ...at, ...STICKY }))
  }

  function makeSticky(text) {
    const at = draft
    setDraft(null)
    if (at) actions.commit((state) => addSticky(state, text, focus || null, { at: focus ? hangAt(boxOf(focus), at) : at, source: 'Sky', index: Infinity }).state)
  }

  function makeNode(name) {
    const at = naming
    setNaming(null)
    if (!name || !at) return
    actions.commit((state) => {
      const made = addFolder(state, name)
      return made.folder ? placeNodes(made.state, boardSpots(made.state.folders, latest.current.sizes), new Map([[made.folder.id, at]])) : state
    })
  }

  /* Dragging the board itself looks around. */
  function onPointerDown(event) {
    if (event.button !== 0 || event.target.closest(ON_CARD)) return
    const start = { x: event.clientX, y: event.clientY, camera: latest.current.camera }
    let moved = false
    const move = (next) => {
      if (!moved && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 3) return
      if (!moved) setPanning(true)
      moved = true
      setCamera({ ...start.camera, x: start.camera.x + next.clientX - start.x, y: start.camera.y + next.clientY - start.y })
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setPanning(false)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  /* A new sticky (or, from the menu, a node) at the point picked on the board. */
  function spotAt(event, width = CARD.w) {
    const box = view.current.getBoundingClientRect()
    const at = toWorld(event.clientX - box.left, event.clientY - box.top)
    return { x: at.x - width / 2, y: at.y - 40 }
  }
  function onDoubleClick(event) {
    if (!event.target.closest(ON_CARD)) startSticky(spotAt(event, STICKY.w))
  }
  function onContextMenu(event) {
    if (event.target.closest(ON_CARD)) return
    const at = spotAt(event)
    const stickyAt = spotAt(event, STICKY.w)
    actions.boardMenu(event, { fit, newNode: () => setNaming(at), newSticky: () => startSticky(stickyAt) })
  }

  /* Carrying a card itself: it, and what hangs off it, follow the pointer (and so do their lines). */
  const liveFor = (key) => ({ move: (dx, dy) => setDrag({ key, dx, dy }), end: () => setDrag(null) })

  /* Set down on the open board: a sticky or branch in a map stays in it, hanging where it was
     left; a node (or a branch on its own) moves; a sticky from Unsorted is set down freely. */
  const drop = useDrop('sky:board', {
    accepts: (carried) => carried.kind === 'note' || carried.kind === 'folder',
    onDrop: ({ kind, id, x, y, offset }) => {
      const box = view.current.getBoundingClientRect()
      const at = toWorld(x - offset.x - box.left, y - offset.y - box.top)
      const { trees: shown, notes, folders } = latest.current
      // Its brothers and sisters keep exactly where they are now, so nothing else moves.
      const stay = (parentKey, key) => [...shown].filter(([other, box]) => box.parent === parentKey && other !== key && !box.record.at)
        .map(([, box]) => ({ kind: box.kind, id: box.record.id, at: hangAt(shown.get(parentKey), box) }))
      if (kind === 'note') {
        const note = notes.find((item) => item.id === id)
        const parent = note?.folderId && shown.get(note.folderId)
        if (parent) actions.hang([{ kind: 'note', id, at: hangAt(parent, at) }, ...stay(note.folderId, `note:${id}`)])
        else actions.placeSticky(id, at)
        return
      }
      const folder = folders.find((item) => item.id === id)
      if (!folder) return
      const parent = folder.parentId && shown.get(folder.parentId)
      if (parent) { actions.hang([{ kind: 'folder', id, at: hangAt(parent, at) }, ...stay(folder.parentId, id)]); return }
      if (!folder.parentId) { place(new Map([[id, at]])); return }
      // A branch whose node isn't open: set down on its own.
      actions.canvasCommit('Set a branch on Sky', (state) => {
        const moved = moveFolder(state, id, null, Infinity, { loose: true })
        return placeNodes(moved, boardSpots(moved.folders, latest.current.sizes), new Map([[id, at]]))
      })
    },
  })

  function nudgeSticky(event, note) {
    if (event.target !== event.currentTarget.querySelector('.sticky')) return
    const by = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!by || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? 40 : 10
    actions.placeSticky(note.id, { x: note.at.x + by[0] * step, y: note.at.y + by[1] * step })
  }

  /* What is moving with the carried card, and by how much, in board points. */
  const moving = useMemo(() => (drag ? (trees.has(drag.key) ? branchOf(trees, drag.key) : new Set([drag.key])) : null), [drag, trees])
  const shiftOf = (key) => (moving?.has(key) ? { x: drag.dx / camera.z, y: drag.dy / camera.z } : null)
  const shown = (key) => {
    const box = boxOf(key, { camera, spots, sizes, trees, notes: workspace.notes, folders: workspace.folders })
    const shift = box && shiftOf(key)
    return shift ? { ...box, x: box.x + shift.x, y: box.y + shift.y } : box
  }

  /* Drawing a connection from a card's dot. */
  const linker = useLinking({
    toLocal: (x, y) => {
      const box = view.current.getBoundingClientRect()
      return toWorld(x - box.left, y - box.top)
    },
    onLink: actions.link,
    onMenu: (event, key) => actions.connectMenu(event, key),
  })

  /* What is on the board right now, by card key. */
  const visible = new Set([
    ...shownRoots.map((folder) => folder.id),
    ...[...trees.keys()],
    ...loose.map((note) => `note:${note.id}`),
  ])
  /* A connection's end as it shows: the card itself, or (folded away, or in a closed node)
     the nearest card it is tucked inside. Nothing when it isn't on the board. */
  function endOf(key) {
    const card = cardKey(key)
    if (visible.has(card)) return card
    const { kind, id } = partsOf(key)
    const record = kind === 'note' ? workspace.notes.find((item) => item.id === id) : workspace.folders.find((item) => item.id === id)
    if (!record) return null
    let folderId = kind === 'note' ? record.folderId : record.parentId
    if (kind === 'note' && !folderId) return record.at || !visible.has('unsorted') ? null : 'unsorted'
    for (let guard = 0; folderId && guard < 64; guard += 1) {
      if (visible.has(folderId)) return folderId
      folderId = workspace.folders.find((item) => item.id === folderId)?.parentId
    }
    return null
  }

  /* The lines: a map's branches (solid), connections (the accent), and @mentions between
     nodes (dotted, flowing). */
  const lines = []
  trees.forEach((box, key) => {
    if (!box.parent) return
    const from = shown(box.parent)
    const to = shown(key)
    if (from && to) lines.push({ key: `tree:${key}`, kind: 'tree', d: edgePath(from, to).d })
  })
  const drawn = new Set()
  linksOf(workspace).forEach((link) => {
    const a = endOf(link.a)
    const b = endOf(link.b)
    const pair = [a, b].sort().join('|')
    if (!a || !b || a === b || drawn.has(pair)) return
    drawn.add(pair)
    const from = shown(a)
    const to = shown(b)
    if (from && to) lines.push({ key: `link:${link.key}`, kind: 'link', d: edgePath(from, to).d, link })
  })
  if (!focus) {
    const pairs = new Set()
    mentions.forEach((notes, folderId) => notes.forEach((note) => {
      if (!note.folderId) return
      const a = rootOf(workspace.folders, note.folderId)
      const b = rootOf(workspace.folders, folderId)
      const pair = [a, b].sort().join('|')
      if (!a || !b || a === b || pairs.has(pair)) return
      pairs.add(pair)
      const from = shown(a)
      const to = shown(b)
      if (from && to) lines.push({ key: `mention:${pair}`, kind: 'mention', d: edgePath(from, to).d })
    }))
  }
  const drawing = linker.linking && shown(cardKey(linker.linking.from))

  const far = camera.z < FAR
  // The dots thin out as the board zooms out, so they never turn to haze.
  const dot = 28 * camera.z * 2 ** Math.max(0, Math.ceil(Math.log2(16 / (28 * camera.z))))
  const common = { workspace, actions, measure, liveFor, linker, adding, setAdding }

  return (
    <div
      ref={view}
      className={`board ${panning ? 'is-panning' : ''} ${flying ? 'is-flying' : ''} ${focus ? 'is-focused' : ''}`}
      data-far={far || undefined}
      style={{ '--cx': `${camera.x}px`, '--cy': `${camera.y}px`, '--z': camera.z, '--dot': `${dot}px` }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      {...drop}
    >
      <div className="board-world">
        <svg className="board-lines" aria-hidden="true">
          {lines.map((line) => (line.kind === 'link'
            ? (
              <g key={line.key}>
                <path className="is-link" d={line.d} />
                <path className="link-hit" d={line.d} onClick={(event) => actions.lineMenu(event, line.link)} onContextMenu={(event) => actions.lineMenu(event, line.link)} />
              </g>
            )
            : <path key={line.key} className={`is-${line.kind}`} d={line.d} />))}
          {drawing && <path className="is-link is-drawing" d={edgePath(drawing, { x: linker.linking.x, y: linker.linking.y, w: 0, h: 0 }).d} />}
        </svg>

        {shownRoots.map((folder, index) => (
          <RootCard
            key={folder.id}
            {...common}
            folder={folder}
            index={index + 1}
            box={shown(folder.id)}
            moving={Boolean(shiftOf(folder.id))}
            isOpen={trees.has(folder.id)}
            toggle={toggle}
            sorting={sorting}
            mentioned={mentions.get(folder.id)}
            onFocus={onFocus}
          />
        ))}

        {[...trees].map(([key, box]) => {
          if (!box.parent) return null
          const at = shown(key)
          const moved = Boolean(shiftOf(key))
          return box.kind === 'folder'
            ? <BranchCard key={key} {...common} folder={box.record} box={at} moving={moved} />
            : <MapSticky key={key} {...common} note={box.record} box={at} moving={moved} />
        })}

        {loose.map((note) => {
          const at = shown(`note:${note.id}`)
          return (
            <div
              key={note.id}
              ref={measure}
              className={`board-sticky ${shiftOf(`note:${note.id}`) ? 'is-moving' : ''}`}
              data-card={`note:${note.id}`}
              data-link={`note:${note.id}`}
              style={{ translate: `${at.x}px ${at.y}px` }}
              onKeyDown={(event) => nudgeSticky(event, note)}
            >
              <Sticky
                note={note}
                commit={actions.commit}
                paper={note.color || 'canary'}
                slot={false}
                onToss={() => actions.toss(note)}
                onMenu={(event) => actions.stickyMenu(event, note)}
                mentions={actions.mentions}
                live={liveFor(`note:${note.id}`)}
              />
              <LinkDot linkKey={`note:${note.id}`} label={note.title} onStart={linker.start} onMenu={actions.connectMenu} />
            </div>
          )
        })}
        {draft && <div className="board-sticky-draft"><DraftSticky draft={draft} onDone={makeSticky} /></div>}

        {naming && (
          <div className="board-naming" style={{ translate: `${naming.x}px ${naming.y}px` }}>
            <div className="node-head is-naming" data-paper="canary">
              <NameField placeholder="Name the node" onDone={makeNode} />
            </div>
          </div>
        )}
      </div>

      {!roots.length && !loose.length && <div className="sky-empty-canvas"><h2>A little room to think.</h2><p>Start with a sticky. Make a node when a topic takes shape.</p><button type="button" className="is-primary" onClick={() => startSticky(newSpot())}>Write your first sticky</button></div>}
      {!focus && roots.length > 0 && <div className="sky-canvas-caption"><strong>See the connections.</strong><span>Open a topic to work with its branches and stickies.</span></div>}
      <p className="board-hint" aria-hidden="true">
        {trees.size
          ? 'Drag to move · scroll to explore · ⌘ scroll to zoom'
          : 'Double-click to capture · drag a dot to connect'}
      </p>
      <div className="board-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Minus weight="bold" /></button>
        <button type="button" className="board-zoom-fit" title="Actual size" aria-label="Reset zoom to 100%" onClick={() => zoomBy(1 / camera.z)}>{Math.round(camera.z * 100)}%</button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus weight="bold" /></button>
        <button type="button" aria-label="Fit canvas in view" title="Fit view" onClick={fit}><CornersOut /></button>
      </div>
    </div>
  )
})

/* A sticky or a branch (never one that holds this folder) dropped on a folder goes into it. */
function useFolderDrop(id, folder, workspace, actions, spring) {
  return useDrop(id, {
    accepts: (carried) => carried.kind === 'note' || (carried.kind === 'folder' && Boolean(carried.data?.parentId || carried.data?.loose) && !folderSubtree(workspace.folders, carried.id).has(folder.id)),
    onDrop: (carried) => (carried.kind === 'note' ? actions.moveSticky(carried.id, folder.id) : actions.moveFolder(carried.id, folder.id)),
    spring,
  })
}

/* A node (or a branch on the Sky on its own): the middle of its map. Click it to open it
   (its things spread out around it) or close it; double-click to focus on it; Tab or + to
   write a sticky in it. What it asks (packed, a day for the Calendar, sorting help, where a
   branch belongs, who mentions it) shows under its name. */
function RootCard({ folder, index, box, moving, isOpen, workspace, actions, toggle, sorting, mentioned, onFocus, measure, liveFor, linker, adding, setAdding }) {
  const loose = isBranch(folder)
  const count = stickiesIn(workspace, folder.id).length
  const branches = folderChildren(workspace.folders, folder.id)
  const head = useFolderDrop(`sky:head:${folder.id}`, folder, workspace, actions, () => toggle(folder.id, true))
  const sortingHere = sorting?.id === folder.id ? sorting : null
  const asks = asksIn(workspace, folder.id)
  const naming = actions.branching === folder.id
  const panels = isOpen && (folder.packed || asks.length || sortingHere || actions.placing?.id === folder.id || mentioned?.length || naming || adding === folder.id)
  return (
    <div
      ref={measure}
      className={`board-card ${isOpen ? 'is-open' : ''} ${moving ? 'is-dragging' : ''}`}
      data-card={folder.id}
      data-link={`folder:${folder.id}`}
      style={{ translate: `${box.x}px ${box.y}px`, '--i': index, '--drift': `${(hashUnit(folder.id) * -9).toFixed(2)}s` }}
    >
      <div
        className="node-head"
        data-node-head={folder.id}
        data-paper={folder.color || (loose ? 'bone' : 'canary')}
        data-layers={isOpen ? 0 : layersFor(count)}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-label={`${loose ? 'Branch' : 'Node'}: ${folder.name}`}
        {...head}
        {...carryable({ kind: 'folder', id: folder.id, data: { parentId: null, loose } }, { live: liveFor(folder.id) })}
        onClick={(event) => { if (event.detail < 2 && !event.target.closest('button, input, textarea')) toggle(folder.id) }}
        onDoubleClick={(event) => { if (!event.target.closest('button, input, textarea')) onFocus(folder.id) }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(folder.id) }
          if (event.key === 'Tab' && !event.shiftKey && !event.metaKey) { event.preventDefault(); toggle(folder.id, true); setAdding(folder.id) }
        }}
        onContextMenu={(event) => actions.nodeMenu(event, folder)}
      >
        <span className="node-kind"><i />{loose ? 'Branch' : 'Topic'}<ArrowRight /></span>
        {actions.renaming === folder.id
          ? <NameField initial={folder.name} placeholder={loose ? 'Name the branch' : 'Name the node'} onDone={(name) => actions.endRename(folder.id, name)} />
          : <strong>{folder.name}</strong>}
        {(folder.fresh || folder.packed || folder.from?.source) && (
          <span className="node-origin">
            {folder.fresh && <em>New</em>}
            {[folder.from?.source && `from ${folder.from.source}`, folder.packed && 'packed'].filter(Boolean).join(' · ')}
          </span>
        )}
        {!isOpen && branches.length > 0 && (
          <ul className="node-peek" aria-label={`Branches: ${branches.map((branch) => branch.name).join(', ')}`}>
            {branches.slice(0, 3).map((branch) => <li key={branch.id} data-paper={branch.color || 'bone'}>{branch.name}</li>)}
            {branches.length > 3 && <li className="is-more">and {branches.length - 3} more</li>}
          </ul>
        )}
        {!isOpen && !branches.length && <p className="node-preview">{pileOf(workspace.notes, folder.id).slice(0, 2).map((note) => note.title).join(' · ') || 'A place for related ideas.'}</p>}
        <div className="node-card-footer"><small className="node-summary">{count} {count === 1 ? 'sticky' : 'stickies'}</small>
        <span className="node-tools">
          <button type="button" aria-label={`Focus on ${folder.name}`} title="Focus on this topic" onClick={() => onFocus(folder.id)}><Crosshair /></button>
          <button type="button" aria-label={`Write a sticky in ${folder.name}`} title="Write a sticky here  Tab" onClick={() => { toggle(folder.id, true); setAdding(folder.id) }}><Plus weight="bold" /></button>
          <button type="button" aria-label={`More for ${folder.name}`} title="More" onClick={(event) => actions.nodeMenu(menuEvent(event), folder)}><DotsThree weight="bold" /></button>
        </span>
        </div>
      </div>
      {panels && (
        <div className="card-body">
          {folder.packed && (
            <div className="packed-bar" role="note">
              <p>{actions.unpacking?.id === folder.id ? actions.unpacking.line : 'Packed: only a summary so far. Unpack it into branches when you’re ready.'}</p>
              {actions.unpacking?.id === folder.id && actions.unpacking.proposal && <div className="unpack-proposal"><textarea aria-label="Suggested branches and stickies" value={actions.unpacking.proposal} onChange={(event) => actions.editUnpack(event.target.value)} /><div><button type="button" className="is-primary" onClick={actions.acceptUnpack}>Add these branches and stickies</button><button type="button" onClick={actions.dismissUnpack}>Dismiss</button></div></div>}
              {actions.unpackWithAi && !actions.unpacking?.proposal && (
                <button type="button" className="is-primary" disabled={actions.unpacking?.busy} title={`Asks ${actions.answering}`} onClick={() => actions.unpackWithAi(folder)}>
                  <Sparkle weight="bold" /> Unpack with AI
                </button>
              )}
              <button type="button" onClick={() => { actions.unpack(folder.id); actions.startBranch(folder.id) }}>{actions.unpackWithAi ? 'By hand' : 'Unpack'}</button>
            </div>
          )}
          <AskHelp notes={asks} actions={actions} />
          {actions.placing?.id === folder.id && <PlaceHelp placing={actions.placing} actions={actions} />}
          {sortingHere && <SortHelp sorting={sortingHere} workspace={workspace} actions={actions} />}
          {naming && <NameField placeholder="Name the branch" onDone={(name) => actions.endBranch(folder.id, name)} />}
          {adding === folder.id && <AddSticky startOpen placeholder={`Write a sticky in ${folder.name}`} onAdd={(text) => actions.addSticky(text, folder.id)} onClose={() => setAdding(null)} />}
          {mentioned?.length > 0 && (
            <div className="card-mentions">
              <span><At weight="bold" /> Mentioned in</span>
              {mentioned.map((note) => <button key={note.id} type="button" onClick={() => actions.openNote(note.id)}>{note.title}</button>)}
            </div>
          )}
        </div>
      )}
      <LinkDot linkKey={`folder:${folder.id}`} label={folder.name} onStart={linker.start} onMenu={actions.connectMenu} />
      <b className="card-far" aria-hidden="true">{folder.name}</b>
    </div>
  )
}

/* A branch in a map: its name on its paper. The arrow folds what hangs off it away (it then
   looks like a little pile); + (or Tab) writes a sticky in it; drop a sticky or a branch on
   it to put it inside. Double-click the name to rename it. */
function BranchCard({ folder, box, moving, workspace, actions, measure, liveFor, linker, adding, setAdding }) {
  const inside = folderChildren(workspace.folders, folder.id).length + pileOf(workspace.notes, folder.id).length
  const folded = actions.folds.has(folder.id)
  const drop = useFolderDrop(`sky:branch:${folder.id}`, folder, workspace, actions, () => actions.fold(folder.id, false))
  const renaming = actions.renaming === folder.id
  return (
    <div
      ref={measure}
      className={`map-card map-folder ${moving ? 'is-moving' : ''}`}
      data-card={folder.id}
      data-link={`folder:${folder.id}`}
      style={{ translate: `${box.x}px ${box.y}px` }}
    >
      <div
        className="branch-card"
        data-paper={folder.color || 'bone'}
        data-layers={folded ? layersFor(inside) : undefined}
        role="group"
        tabIndex={0}
        aria-label={`Branch: ${folder.name}`}
        {...drop}
        {...carryable({ kind: 'folder', id: folder.id, data: { parentId: folder.parentId } }, { live: liveFor(folder.id) })}
        onDoubleClick={(event) => { if (!event.target.closest('button, input, textarea')) actions.startRename(folder.id) }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Tab' && !event.shiftKey && !event.metaKey) { event.preventDefault(); actions.fold(folder.id, false); setAdding(folder.id) }
          if (event.key === 'Enter') { event.preventDefault(); actions.startRename(folder.id) }
        }}
        onContextMenu={(event) => actions.branchMenu(event, folder)}
      >
        {inside > 0 && (
          <button type="button" className="branch-fold" aria-expanded={!folded} aria-label={`${folded ? 'Open' : 'Fold'} ${folder.name}`} title={folded ? 'Open this branch' : 'Fold this branch away'} onClick={() => actions.fold(folder.id)}>
            <CaretDown weight="bold" />
          </button>
        )}
        {renaming
          ? <NameField initial={folder.name} placeholder="Name the branch" onDone={(name) => actions.endRename(folder.id, name)} />
          : <strong>{folder.name}</strong>}
        {folded && <small className="branch-summary">{inside}</small>}
        <span className="map-tools">
          <button type="button" aria-label={`Write a sticky in ${folder.name}`} title="Write a sticky here  Tab" onClick={() => { actions.fold(folder.id, false); setAdding(folder.id) }}><Plus weight="bold" /></button>
          <button type="button" aria-label={`More for ${folder.name}`} title="More" onClick={(event) => actions.branchMenu(menuEvent(event), folder)}><DotsThree weight="bold" /></button>
        </span>
      </div>
      {actions.branching === folder.id && <NameField placeholder="Name the branch inside" onDone={(name) => actions.endBranch(folder.id, name)} />}
      {adding === folder.id && <AddSticky startOpen placeholder={`Write a sticky in ${folder.name}`} onAdd={(text) => actions.addSticky(text, folder.id)} onClose={() => setAdding(null)} />}
      {actions.placing?.id === folder.id && <PlaceHelp placing={actions.placing} actions={actions} />}
      <LinkDot linkKey={`folder:${folder.id}`} label={folder.name} onStart={linker.start} onMenu={actions.connectMenu} />
    </div>
  )
}

/* A sticky in a map. */
function MapSticky({ note, box, moving, actions, measure, liveFor, linker }) {
  return (
    <div
      ref={measure}
      className={`map-card map-sticky ${moving ? 'is-moving' : ''}`}
      data-card={`note:${note.id}`}
      data-link={`note:${note.id}`}
      style={{ translate: `${box.x}px ${box.y}px` }}
    >
      <Sticky
        note={note}
        commit={actions.commit}
        paper={note.color || 'canary'}
        slot={false}
        onToss={() => actions.toss(note)}
        onMenu={(event) => actions.stickyMenu(event, note)}
        mentions={actions.mentions}
        live={liveFor(`note:${note.id}`)}
      />
      <LinkDot linkKey={`note:${note.id}`} label={note.title} onStart={linker.start} onMenu={actions.connectMenu} />
    </div>
  )
}

/* A day a sticky names (from a scan), offered to the Calendar a few at a time. */
function AskHelp({ notes, actions }) {
  if (!notes.length) return null
  const when = (event) => new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(event.date.startsWith(String(new Date().getFullYear())) ? {} : { year: 'numeric' }),
  }).format(askStart(event))
  return (
    <div className="sort-help" role="status">
      {notes.slice(0, 3).map((note) => (
        <div key={note.id} className="sort-suggestion">
          <p><CalendarPlus weight="bold" /> “{note.ask.event.title}” is on <strong>{when(note.ask.event)}</strong>. Add it to your Calendar?</p>
          <button type="button" className="is-primary" onClick={() => actions.addEvent(note)}>Add to Calendar</button>
          <button type="button" onClick={() => actions.skipAsk(note)}>Not now</button>
        </div>
      ))}
    </div>
  )
}

/* Where does this belong?, in plain words: the place the model picked and why, with Move and Dismiss. */
function PlaceHelp({ placing, actions }) {
  if (!placing.place) {
    return (
      <div className="sort-help" role="status">
        <p>{placing.asking || placing.line}</p>
        <button type="button" onClick={actions.dismissPlace}>{placing.asking ? 'Stop' : 'OK'}</button>
      </div>
    )
  }
  return (
    <div className="sort-help" role="status">
      <div className="sort-suggestion">
        <p>This looks like it belongs in <strong>{placing.place.name}</strong>{placing.place.why ? `: ${placing.place.why}` : '.'}</p>
        <button type="button" className="is-primary" onClick={actions.acceptPlace}><ArrowRight weight="bold" /> Move</button>
        <button type="button" onClick={actions.dismissPlace}>Dismiss</button>
      </div>
    </div>
  )
}

/* Help me sort, in plain words: one line per branch, with Move and Dismiss. */
function SortHelp({ sorting, workspace, actions }) {
  const title = (id) => workspace.notes.find((note) => note.id === id)?.title || 'a sticky'
  const name = (id) => workspace.folders.find((folder) => folder.id === id)?.name || 'a branch'
  if (!sorting.groups.length) {
    return (
      <div className="sort-help" role="status">
        <p>{sorting.asking || sorting.line}</p>
        <button type="button" onClick={actions.endSort}>{sorting.asking ? 'Stop' : 'OK'}</button>
      </div>
    )
  }
  return (
    <div className="sort-help" role="status">
      {sorting.groups.map((group) => (
        <div key={group.folderId} className="sort-suggestion">
          <p>
            {group.noteIds.length === 1 ? 'This sticky looks like it belongs' : 'These stickies look like they belong'} in <strong>{name(group.folderId)}</strong>:
            {' '}{group.noteIds.slice(0, 3).map((id) => `“${title(id).slice(0, 40)}”`).join(', ')}{group.noteIds.length > 3 ? ` and ${group.noteIds.length - 3} more` : ''}.
          </p>
          <button type="button" className="is-primary" onClick={() => actions.acceptGroup(group)}><ArrowRight weight="bold" /> Move</button>
          <button type="button" onClick={() => actions.dismissGroup(group)}>Dismiss</button>
        </div>
      ))}
      {sorting.asking && <p className="sort-asking">{sorting.asking}</p>}
    </div>
  )
}
