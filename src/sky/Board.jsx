import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ArrowRight, At, CalendarPlus, CaretDown, DotsThree, Minus, Plus, Question, Sparkle } from '@phosphor-icons/react'

import { hashUnit } from '../field/field-model.js'
import { carryable, useDrop } from '../lib/carry.js'
import { folderChildren, folderSubtree, isBranch } from '../notes-model.js'
import {
  addFolder, asksIn, askStart, boardSpots, CARD, mentionedIn, moveFolder, nodesOf, pileOf, placeNodes, stickiesIn,
} from '../nodes-model.js'
import { NameField, StickyList } from './Piles.jsx'

const CAMERA_KEY = 'osat.sky.camera.v1'
const ZOOM = { min: 0.2, max: 1.6 }
// Further out than this, a card shows its name big and what's inside it faintly.
const FAR = 0.5
const READABLE = 0.6 // the smallest an opened node is shown at
const clampZoom = (z) => Math.min(ZOOM.max, Math.max(ZOOM.min, z))

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

/* The Sky's whiteboard: every node is a card you can put anywhere, on a board that goes
   on forever. Drag the board (or two-finger scroll) to look around, pinch or ⌘-scroll to
   zoom; double-click it to start a node there. A card's paper is its handle: drag it to
   move the node, click it to open or close it, double-click to fly to it. Open, a node
   shows its branches as lanes and its own stickies still to sort (its Unsorted); a node
   that opens never moves its neighbours: they dim, and the view goes to it. Nodes a note @mentions are joined by lines.
   Unsorted waits on the far left. */
export const Board = forwardRef(function Board({ workspace, actions, open, toggle, sorting }, ref) {
  const view = useRef(null)
  const stored = useRef(readCamera())
  const [camera, setCamera] = useState(() => stored.current || { x: 120, y: 160, z: 1 })
  const [sizes, setSizes] = useState(() => new Map())
  const [drag, setDrag] = useState(null)
  const [naming, setNaming] = useState(null)
  const [flying, setFlying] = useState(false)
  const [panning, setPanning] = useState(false)
  const flyTimer = useRef(0)
  const dragged = useRef(false)
  const flown = useRef(null)
  const before = useRef({ open: new Set(open), home: null })

  const nodes = nodesOf(workspace.folders)
  const spots = useMemo(() => boardSpots(workspace.folders, sizes), [workspace.folders, sizes])
  const mentions = useMemo(() => mentionedIn(workspace), [workspace])
  const unsorted = pileOf(workspace.notes, null)
  // Folded, Unsorted is a pile that shows its first few stickies.
  const folded = actions.folds.has('unsorted') && unsorted.length > 0
  const latest = useRef(null)
  latest.current = { camera, spots, sizes, folders: workspace.folders }

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

  const boxOf = (id, from = latest.current) => ({ ...(from.spots.get(id) || { x: 0, y: 0 }), ...(from.sizes.get(id) || CARD) })
  function bounds() {
    const boxes = [...latest.current.spots.keys()].map((id) => boxOf(id))
    const left = Math.min(...boxes.map((box) => box.x))
    const top = Math.min(...boxes.map((box) => box.y))
    return { x: left, y: top, w: Math.max(...boxes.map((box) => box.x + box.w)) - left, h: Math.max(...boxes.map((box) => box.y + box.h)) - top }
  }

  /* The camera that shows `rect` (in board points) in the middle of the view. */
  function frame(rect, most = 1) {
    const box = view.current.getBoundingClientRect()
    const pad = Math.min(96, box.width * 0.08)
    const z = clampZoom(Math.min(most, (box.width - pad * 2) / Math.max(rect.w, 1), (box.height - pad * 2) / Math.max(rect.h, 1)))
    return { x: box.width / 2 - (rect.x + rect.w / 2) * z, y: box.height / 2 - (rect.y + rect.h / 2) * z, z }
  }
  function fly(next) {
    flown.current = next
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

  /* The first time, everything in view; after that, where it was left. */
  useEffect(() => {
    if (!stored.current) requestAnimationFrame(() => { if (view.current) setCamera(frame(bounds())) })
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
  const place = (changes) => actions.commit((state) => placeNodes(state, boardSpots(state.folders, latest.current.sizes), changes))

  /* Fly to a node (or a branch's node, or Unsorted), opening it; a sticky in it glows. */
  function goTo({ folderId = null, noteId = null } = {}) {
    const root = folderId ? rootOf(latest.current.folders, folderId) : null
    if (root) toggle(root, true)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = view.current?.querySelector(`[data-card="${root || 'unsorted'}"]`)
      const spot = latest.current.spots.get(root)
      const sticky = noteId && view.current?.querySelector(`[data-note="${noteId}"]`)
      if (card && spot) fly(sticky ? frame(inside(card, sticky, spot), 1) : frameTop({ x: spot.x, y: spot.y, w: card.offsetWidth, h: card.offsetHeight }))
      if (!sticky) return
      sticky.classList.add('is-found')
      setTimeout(() => sticky.classList.remove('is-found'), 1800)
    }))
  }

  /* Where `element` lies on the board, from its offsets inside `card` (not its pixels, which move mid-flight). */
  function inside(card, element, spot) {
    let x = 0
    let y = 0
    for (let at = element; at && at !== card; at = at.offsetParent) { x += at.offsetLeft; y += at.offsetTop }
    return { x: spot.x + x, y: spot.y + y, w: element.offsetWidth, h: element.offsetHeight }
  }

  /* A node taller than the view shows its top at a size you can read; the rest is a scroll away. */
  function frameTop(rect) {
    const next = frame(rect, 1)
    if (next.z >= READABLE) return next
    const box = view.current.getBoundingClientRect()
    return { x: box.width / 2 - (rect.x + rect.w / 2) * READABLE, y: Math.min(96, box.width * 0.08) - rect.y * READABLE, z: READABLE }
  }

  /* Opening a node brings it into view; closing the last one goes back to where the board
     was, unless it has been moved since. Nothing else on the board moves. */
  useEffect(() => {
    const was = before.current
    const now = new Set(nodes.filter(({ folder }) => open.has(folder.id)).map(({ folder }) => folder.id))
    before.current = { open: now, home: was.home }
    const opened = [...now].filter((id) => !was.open.has(id))
    if (opened.length) {
      if (!was.open.size) before.current.home = latest.current.camera
      goTo({ folderId: opened[opened.length - 1] })
    } else if (was.open.size && !now.size && was.home) {
      if (flown.current === latest.current.camera) fly(was.home)
      before.current.home = null
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    goTo,
    /* A new node in the middle of what's in view. */
    newNode() {
      const box = view.current.getBoundingClientRect()
      const middle = toWorld(box.width / 2, box.height / 2)
      setNaming({ x: middle.x - CARD.w / 2, y: middle.y - 70 })
    },
    back() {
      if (!naming) return false
      setNaming(null)
      return true
    },
    fit,
  }))

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
    if (event.button !== 0 || event.target.closest('.board-card, .board-naming, .board-zoom')) return
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

  /* Where a new node goes when the board is double-clicked (or right-clicked) there. */
  function spotAt(event) {
    const box = view.current.getBoundingClientRect()
    const at = toWorld(event.clientX - box.left, event.clientY - box.top)
    return { x: at.x - CARD.w / 2, y: at.y - 40 }
  }
  function onDoubleClick(event) {
    if (!event.target.closest('.board-card, .board-naming, .board-zoom')) setNaming(spotAt(event))
  }
  function onContextMenu(event) {
    if (event.target.closest('.board-card, .board-naming, .board-zoom')) return
    const at = spotAt(event)
    actions.boardMenu(event, { fit, newNode: () => setNaming(at) })
  }

  /* Picking a node up by its paper: it follows the pointer, leaning the way it's pulled. */
  function grab(event, id) {
    if (event.button !== 0 || event.target.closest('button, input, textarea')) return
    const start = { x: event.clientX, y: event.clientY }
    const { z } = latest.current.camera
    let last = start
    let moved = false
    let rest = 0
    const move = (next) => {
      if (!moved && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 4) return
      moved = true
      const tilt = Math.max(-8, Math.min(8, (next.clientX - last.x) * 0.7))
      last = { x: next.clientX, y: next.clientY }
      setDrag({ id, dx: (next.clientX - start.x) / z, dy: (next.clientY - start.y) / z, tilt })
      clearTimeout(rest)
      rest = setTimeout(() => setDrag((value) => (value ? { ...value, tilt: 0 } : value)), 90)
    }
    const up = (next) => {
      removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      clearTimeout(rest)
      if (!moved) return
      dragged.current = true
      setTimeout(() => { dragged.current = false })
      const spot = latest.current.spots.get(id)
      place(new Map([[id, { x: spot.x + (next.clientX - start.x) / z, y: spot.y + (next.clientY - start.y) / z }]]))
      setDrag(null)
    }
    addEventListener('pointermove', move, true)
    addEventListener('pointerup', up, true)
  }

  /* A branch let go on the open board stays a branch, set down right there. */
  const drop = useDrop('sky:board', {
    accepts: (carried) => carried.kind === 'folder' && Boolean(carried.data?.parentId),
    onDrop: ({ id, x, y, offset }) => {
      const box = view.current.getBoundingClientRect()
      const at = toWorld(x - offset.x - box.left, y - offset.y - box.top)
      actions.commit((state) => {
        const moved = moveFolder(state, id, null, Infinity, { loose: true })
        return placeNodes(moved, boardSpots(moved.folders, latest.current.sizes), new Map([[id, at]]))
      })
    },
  })

  /* Lines between nodes: a note in one node that @mentions another. */
  const lines = useMemo(() => {
    const pairs = []
    const keys = new Set()
    const add = (from, to, kind) => {
      const a = rootOf(workspace.folders, from)
      const b = rootOf(workspace.folders, to)
      const key = [a, b].sort().join('|')
      if (!a || !b || a === b || keys.has(key)) return
      keys.add(key)
      pairs.push({ a, b, kind, key })
    }
    mentions.forEach((notes, folderId) => notes.forEach((note) => { if (note.folderId) add(note.folderId, folderId, 'mention') }))
    return pairs
  }, [workspace.folders, mentions])

  const head = (id) => {
    const spot = spots.get(id)
    const moving = drag?.id === id ? drag : null
    return spot && { x: spot.x + (moving?.dx || 0) + CARD.w / 2, y: spot.y + (moving?.dy || 0) + 66 }
  }
  const path = ({ a, b }) => {
    let from = head(a)
    let to = head(b)
    if (!from || !to) return ''
    if (to.x < from.x) [from, to] = [to, from]
    const bend = Math.max(80, (to.x - from.x) / 2)
    return `M${from.x} ${from.y} C${from.x + bend} ${from.y},${to.x - bend} ${to.y},${to.x} ${to.y}`
  }

  const far = camera.z < FAR
  // The dots thin out as the board zooms out, so they never turn to haze.
  const dot = 28 * camera.z * 2 ** Math.max(0, Math.ceil(Math.log2(16 / (28 * camera.z))))

  return (
    <div
      ref={view}
      className={`board ${panning ? 'is-panning' : ''} ${flying ? 'is-flying' : ''}`}
      data-far={far || undefined}
      style={{ '--cx': `${camera.x}px`, '--cy': `${camera.y}px`, '--z': camera.z, '--dot': `${dot}px` }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      {...drop}
    >
      <div className="board-world">
        <svg className="board-lines" aria-hidden="true">
          {lines.map((line) => <path key={line.key} className={`is-${line.kind}`} d={path(line)} />)}
        </svg>

        <div ref={measure} className="board-card is-unsorted" data-card="unsorted" style={{ translate: `${spots.get(null).x}px ${spots.get(null).y}px`, '--i': 0 }}>
          <UnsortedHead actions={actions} count={unsorted.length} folded={folded} />
          <div className="card-body">
            {folded
              ? <FoldedPile notes={unsorted} actions={actions} />
              : <StickyList id="sky:unsorted" folderId={null} notes={unsorted} actions={actions} empty="Stickies from the desk land here." />}
          </div>
          <b className="card-far" aria-hidden="true">Unsorted</b>
        </div>

        {nodes.map(({ folder }, index) => (
          <NodeCard
            key={folder.id}
            folder={folder}
            index={index + 1}
            spot={spots.get(folder.id)}
            isOpen={open.has(folder.id)}
            workspace={workspace}
            actions={actions}
            toggle={toggle}
            sorting={sorting}
            mentioned={mentions.get(folder.id)}
            drag={drag?.id === folder.id ? drag : null}
            onGrab={grab}
            onZoom={(id) => goTo({ folderId: id })}
            wasDragged={() => dragged.current}
            measure={measure}
          />
        ))}

        {naming && (
          <div className="board-naming" style={{ translate: `${naming.x}px ${naming.y}px` }}>
            <div className="node-head is-naming" data-paper="canary">
              <NameField placeholder="Name the node" onDone={makeNode} />
            </div>
          </div>
        )}
      </div>

      <p className="board-hint" aria-hidden="true">
        {nodes.some(({ folder }) => open.has(folder.id))
          ? 'Drag a sticky onto a branch to move it · drop a branch on another to put it inside · right-click anything for more'
          : 'Click a node to open it · double-click the board for a new node · drag the board to look around'}
      </p>
      <div className="board-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="How the Sky works" title="How the Sky works" onClick={actions.showGuide}><Question weight="bold" /></button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Minus weight="bold" /></button>
        <button type="button" className="board-zoom-fit" title="See everything" onClick={fit}>{Math.round(camera.z * 100)}%</button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus weight="bold" /></button>
      </div>
    </div>
  )
})

function UnsortedHead({ actions, count, folded }) {
  const drop = useDrop('sky:unsorted-head', { accepts: ['note'], onDrop: ({ id }) => actions.moveSticky(id, null, 0) })
  return (
    <div className="node-head is-unsorted" data-layers={layersFor(count)} {...drop}>
      {count > 0
        ? (
          <button type="button" className="fold-name" aria-expanded={!folded} title={folded ? 'Open Unsorted' : 'Fold Unsorted into a pile'} onClick={() => actions.fold('unsorted')}>
            <CaretDown className="fold-caret" weight="bold" /><strong>Unsorted</strong>
          </button>
        )
        : <strong>Unsorted</strong>}
      <small>Stickies in no node yet</small>
    </div>
  )
}

/* Unsorted, folded: its first few stickies, then "and N more"; a click opens it, and a sticky can still be dropped on it. */
function FoldedPile({ notes, actions }) {
  const drop = useDrop('sky:unsorted-fold', { accepts: ['note'], onDrop: ({ id }) => actions.moveSticky(id, null, 0) })
  return (
    <button type="button" className="fold-pile" title="Open Unsorted" onClick={() => actions.fold('unsorted', false)} {...drop}>
      {notes.slice(0, 3).map((note) => <span key={note.id} className="fold-strip" data-paper={note.color || 'canary'}>{note.title}</span>)}
      {notes.length > 3 && <span className="fold-more">and {notes.length - 3} more</span>}
    </button>
  )
}

function NodeCard({ folder, index, spot, isOpen, workspace, actions, toggle, sorting, mentioned, drag, onGrab, onZoom, wasDragged, measure }) {
  // A branch set down on the Sky on its own is drawn like a node, on the paper of a branch.
  const loose = isBranch(folder)
  const count = stickiesIn(workspace, folder.id).length
  const branches = folderChildren(workspace.folders, folder.id)
  const head = useDrop(`sky:head:${folder.id}`, {
    // A sticky goes into its pile to sort; a branch (never a whole node) joins its branches.
    accepts: (carried) => carried.kind === 'note' || (carried.kind === 'folder' && Boolean(carried.data?.parentId) && !folderSubtree(workspace.folders, carried.id).has(folder.id)),
    onDrop: (carried) => (carried.kind === 'note' ? actions.moveSticky(carried.id, folder.id) : actions.moveFolder(carried.id, folder.id)),
    spring: () => toggle(folder.id, true),
  })
  const x = spot.x + (drag?.dx || 0)
  const y = spot.y + (drag?.dy || 0)
  return (
    <div
      ref={measure}
      className={`board-card ${isOpen ? 'is-open' : ''} ${drag ? 'is-dragging' : ''}`}
      data-card={folder.id}
      style={{ translate: `${x}px ${y}px`, '--i': index, '--tilt': `${drag?.tilt || 0}deg`, '--drift': `${(hashUnit(folder.id) * -9).toFixed(2)}s` }}
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
        onPointerDown={(event) => onGrab(event, folder.id)}
        onClick={(event) => { if (!wasDragged() && event.detail < 2 && !event.target.closest('button, input')) toggle(folder.id) }}
        onDoubleClick={(event) => { if (!event.target.closest('button, input')) onZoom(folder.id) }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(folder.id) }
        }}
        onContextMenu={(event) => actions.nodeMenu(event, folder)}
      >
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
        <span className="node-tools">
          <button type="button" aria-label={`More for ${folder.name}`} title="More" onClick={(event) => actions.nodeMenu(event, folder)}><DotsThree weight="bold" /></button>
        </span>
      </div>
      {isOpen && (
        <div className="card-body">
          {actions.placing?.id === folder.id && <PlaceHelp placing={actions.placing} actions={actions} />}
          <NodeLanes folder={folder} workspace={workspace} actions={actions} sorting={sorting} />
          {mentioned?.length > 0 && (
            <div className="card-mentions">
              <span><At weight="bold" /> Mentioned in</span>
              {mentioned.map((note) => <button key={note.id} type="button" onClick={() => actions.openNote(note.id)}>{note.title}</button>)}
            </div>
          )}
        </div>
      )}
      <b className="card-far" aria-hidden="true">{folder.name}</b>
    </div>
  )
}

/* Inside an open node, drawn as the tree it is. The node's own stickies come first (under
   "Not in a branch yet" once it has branches, and only while there are some); then each
   branch hangs off one line, its stickies in a row after its name, and its own branches on
   a line under it. Only stickies are paper; node and branch names are labels. A branch
   dragged between branches changes their order; dropped on a branch's name, it goes inside. */
function NodeLanes({ folder, workspace, actions, sorting }) {
  const branches = folderChildren(workspace.folders, folder.id)
  const loose = pileOf(workspace.notes, folder.id)
  const sortingHere = sorting?.id === folder.id ? sorting : null
  const lanes = useDrop(`sky:lanes:${folder.id}`, {
    accepts: (carried) => carried.kind === 'folder' && !folderSubtree(workspace.folders, carried.id).has(folder.id),
    axis: 'y',
    onDrop: ({ id, index }) => actions.moveFolder(id, folder.id, index),
  })
  const naming = actions.branching === folder.id
  return (
    <div className="lanes is-across" {...lanes}>
      {folder.packed && (
        <div className="packed-bar" role="note">
          <p>{actions.unpacking?.id === folder.id ? actions.unpacking.line : 'Packed: only a summary so far. Unpack it into branches when you’re ready.'}</p>
          {actions.unpackWithAi && (
            <button type="button" className="is-primary" disabled={actions.unpacking?.busy} title={`Asks ${actions.answering}`} onClick={() => actions.unpackWithAi(folder)}>
              <Sparkle weight="bold" /> Unpack with AI
            </button>
          )}
          <button type="button" onClick={() => { actions.unpack(folder.id); actions.startBranch(folder.id) }}>{actions.unpackWithAi ? 'By hand' : 'Unpack'}</button>
        </div>
      )}
      <AskHelp notes={asksIn(workspace, folder.id)} actions={actions} />
      {(!branches.length || loose.length > 0 || sortingHere) && (
        <Lane loose labelled={branches.length > 0} folder={folder} notes={loose} actions={actions} sorting={sortingHere} workspace={workspace} />
      )}
      {(branches.length > 0 || naming) && <Branches parentId={folder.id} list={branches} depth={0} workspace={workspace} actions={actions} />}
      {!naming && <button type="button" className="lane-add" onClick={() => actions.startBranch(folder.id)}><Plus weight="bold" /> New branch</button>}
    </div>
  )
}

/* The branches of a node or of a branch, joined by one line; a new one is named at the end. */
function Branches({ parentId, list, depth, workspace, actions }) {
  return (
    <ul className="branch-tree">
      {list.map((branch) => {
        const inner = folderChildren(workspace.folders, branch.id)
        const folded = actions.folds.has(branch.id)
        return (
          <li key={branch.id} className="branch" data-slot={depth ? undefined : ''}>
            <Lane folder={branch} depth={depth} notes={pileOf(workspace.notes, branch.id)} actions={actions} workspace={workspace} folded={folded} />
            {!folded && (inner.length > 0 || actions.branching === branch.id) && <Branches parentId={branch.id} list={inner} depth={depth + 1} workspace={workspace} actions={actions} />}
          </li>
        )
      })}
      {actions.branching === parentId && (
        <li className="branch is-naming">
          <NameField placeholder={depth ? 'Name the branch inside' : 'Name the branch'} onDone={(name) => actions.endBranch(parentId, name)} />
        </li>
      )}
    </ul>
  )
}

/* What a folded branch says in its one line: the branches inside it, then its stickies. */
function foldedLine(workspace, folder, notes) {
  const parts = [...folderChildren(workspace.folders, folder.id).map((branch) => branch.name), ...notes.map((note) => note.title)]
  return parts.length ? parts.join(' · ') : 'Nothing in it yet'
}

function Lane({ folder, notes, actions, depth = 0, loose = false, labelled = true, sorting, workspace, folded = false }) {
  const head = useDrop(`sky:lane-head:${loose ? 'loose:' : ''}${folder.id}`, {
    // A sticky goes in; another branch (never one that holds this one) goes inside.
    accepts: (carried) => carried.kind === 'note' || (!loose && carried.kind === 'folder' && !folderSubtree(workspace.folders, carried.id).has(folder.id)),
    onDrop: (carried) => (carried.kind === 'note' ? actions.moveSticky(carried.id, folder.id) : actions.moveFolder(carried.id, folder.id)),
  })
  const renaming = !loose && actions.renaming === folder.id
  return (
    <section className={`lane ${loose ? 'is-loose' : ''} ${loose && !labelled ? 'is-bare' : ''}`} style={{ '--depth': depth }} aria-label={loose ? (labelled ? 'Not in a branch yet' : `Stickies in ${folder.name}`) : `Branch: ${folder.name}`}>
      {(!loose || labelled) && (
        <div
          className="lane-head"
          data-paper={loose ? undefined : folder.color || 'bone'}
          {...head}
          {...(loose ? {} : carryable({ kind: 'folder', id: folder.id, data: { parentId: folder.parentId } }))}
          onDoubleClick={() => { if (!loose) actions.startRename(folder.id) }}
          onContextMenu={loose ? undefined : (event) => actions.branchMenu(event, folder)}
        >
          {!loose && (
            <button type="button" className="lane-fold" aria-expanded={!folded} aria-label={`${folded ? 'Open' : 'Fold'} ${folder.name}`} title={folded ? 'Open this branch' : 'Fold this branch to one line'} onClick={() => actions.fold(folder.id)} onDoubleClick={(event) => event.stopPropagation()}>
              <CaretDown weight="bold" />
            </button>
          )}
          {loose
            ? <strong>Not in a branch yet</strong>
            : renaming
              ? <NameField initial={folder.name} placeholder="Name the branch" onDone={(name) => actions.endRename(folder.id, name)} />
              : <strong>{folder.name}</strong>}
          {!loose && <button type="button" className="lane-more" aria-label={`More for ${folder.name}`} onClick={(event) => actions.branchMenu(event, folder)}><DotsThree weight="bold" /></button>}
        </div>
      )}
      {folded
        ? <p className="lane-folded">{foldedLine(workspace, folder, notes)}</p>
        : (
          <StickyList
            id={`sky:${loose ? 'loose' : 'lane'}:${folder.id}`}
            folderId={folder.id}
            notes={notes}
            axis="x"
            actions={actions}
            paper={!loose && folder.color && folder.color !== 'bone' ? folder.color : 'canary'}
            empty={loose && !labelled ? 'Nothing here yet. Write a sticky, or add a branch to group stickies.' : undefined}
          />
        )}
      {sorting && !folded && <SortHelp sorting={sorting} workspace={workspace} actions={actions} />}
      {!loose && actions.placing?.id === folder.id && <PlaceHelp placing={actions.placing} actions={actions} />}
    </section>
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
