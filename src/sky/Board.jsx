import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ArrowRight, At, Check, DotsThree, Eye, Minus, Plus, Sparkle } from '@phosphor-icons/react'

import { hashUnit } from '../field/field-model.js'
import { carryable, useDrop } from '../lib/carry.js'
import { folderChildren, folderSubtree } from '../notes-model.js'
import {
  addFolder, boardSpots, CARD, makeRoom, mentionedIn, moveFolder, nodesOf, pileOf, placeNodes, stickiesIn,
} from '../nodes-model.js'
import { NameField, StickyList } from './Piles.jsx'

const CAMERA_KEY = 'osat.sky.camera.v1'
const ZOOM = { min: 0.2, max: 1.6 }
// Further out than this, a card shows its name big and what's inside it faintly.
const FAR = 0.5
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

/* Branches inside a folder, deepest last, each with how deep it sits. */
function branchTree(folders, parentId, depth = 0) {
  return folderChildren(folders, parentId).flatMap((folder) => [{ folder, depth }, ...branchTree(folders, folder.id, depth + 1)])
}

/* The Sky's whiteboard: every node is a card you can put anywhere, on a board that goes
   on forever. Drag the board (or two-finger scroll) to look around, pinch or ⌘-scroll to
   zoom; double-click it to start a node there. A card's paper is its handle: drag it to
   move the node, click it to open or close it, double-click to fly to it. Open, a node
   shows its branches as lanes and its own stickies still to sort (its Unsorted); a node
   that grows slides its neighbours aside. Nodes a note @mentions are joined by lines.
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
  const seen = useRef(new Map())

  const nodes = nodesOf(workspace.folders)
  const spots = useMemo(() => boardSpots(workspace.folders, sizes), [workspace.folders, sizes])
  const mentions = useMemo(() => mentionedIn(workspace), [workspace])
  const unsorted = pileOf(workspace.notes, null)
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

  /* A node that grew (opened, or a sticky added) slides the cards it now covers aside. */
  useEffect(() => {
    const before = seen.current
    seen.current = sizes
    if (drag) return
    const grown = nodes.filter(({ folder }) => {
      const was = before.get(folder.id)
      const now = sizes.get(folder.id)
      return was && now && (now.w > was.w + 2 || now.h > was.h + 2)
    })
    if (!grown.length) return
    const boxes = new Map(nodes.map(({ folder }) => [folder.id, boxOf(folder.id)]))
    const moved = new Map()
    grown.forEach(({ folder }) => makeRoom(boxes, folder.id).forEach((spot, id) => {
      moved.set(id, spot)
      boxes.set(id, { ...boxes.get(id), ...spot })
    }))
    if (moved.size) place(moved)
  }, [sizes]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Fly to a node (or a branch's node, or Unsorted), opening it; a sticky in it glows. */
  function goTo({ folderId = null, noteId = null } = {}) {
    const root = folderId ? rootOf(latest.current.folders, folderId) : null
    if (root) toggle(root, true)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = view.current?.querySelector(`[data-card="${root || 'unsorted'}"]`)
      const spot = latest.current.spots.get(root)
      if (card && spot) fly(frame({ x: spot.x, y: spot.y, w: card.offsetWidth, h: card.offsetHeight }, 1))
      const sticky = noteId && view.current?.querySelector(`[data-note="${noteId}"]`)
      if (!sticky) return
      sticky.classList.add('is-found')
      setTimeout(() => sticky.classList.remove('is-found'), 1800)
    }))
  }

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

  /* A branch let go on the open board becomes a node right there. */
  const drop = useDrop('sky:board', {
    accepts: (carried) => carried.kind === 'folder' && Boolean(carried.data?.parentId),
    onDrop: ({ id, x, y, offset }) => {
      const box = view.current.getBoundingClientRect()
      const at = toWorld(x - offset.x - box.left, y - offset.y - box.top)
      actions.commit((state) => {
        const moved = moveFolder(state, id, null)
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
          <UnsortedHead actions={actions} count={unsorted.length} />
          <div className="card-body">
            <StickyList id="sky:unsorted" folderId={null} notes={unsorted} actions={actions} empty="Stickies from the desk land here." />
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

      <p className="board-hint" aria-hidden="true">Double-click for a new node · drag the board to look around · pinch to zoom</p>
      <div className="board-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Minus weight="bold" /></button>
        <button type="button" className="board-zoom-fit" title="See everything" onClick={fit}>{Math.round(camera.z * 100)}%</button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus weight="bold" /></button>
      </div>
    </div>
  )
})

function UnsortedHead({ actions, count }) {
  const drop = useDrop('sky:unsorted-head', { accepts: ['note'], onDrop: ({ id }) => actions.moveSticky(id, null, 0) })
  return (
    <div className="node-head is-unsorted" data-layers={layersFor(count)} {...drop}>
      <strong>Unsorted</strong>
    </div>
  )
}

function NodeCard({ folder, index, spot, isOpen, workspace, actions, toggle, sorting, mentioned, drag, onGrab, onZoom, wasDragged, measure }) {
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
        data-paper={folder.color || 'canary'}
        data-layers={isOpen ? 0 : layersFor(count)}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-label={`Node: ${folder.name}`}
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
          ? <NameField initial={folder.name} placeholder="Name the node" onDone={(name) => actions.endRename(folder.id, name)} />
          : <strong>{folder.name}</strong>}
        {(folder.fresh || folder.packed || folder.from?.source) && (
          <span className="node-origin">
            {folder.fresh && <em>New</em>}
            {[folder.from?.source && `from ${folder.from.source}`, folder.packed && 'packed'].filter(Boolean).join(' · ')}
          </span>
        )}
        {!isOpen && branches.length > 0 && <small>{branches.slice(0, 3).map((branch) => branch.name).join(', ')}</small>}
        <span className="node-tools">
          <button type="button" aria-label={`More for ${folder.name}`} title="More" onClick={(event) => actions.nodeMenu(event, folder)}><DotsThree weight="bold" /></button>
        </span>
      </div>
      {isOpen && (
        <div className="card-body">
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

/* A node's branches as lanes, and its own stickies still to sort (its Unsorted) last. */
function NodeLanes({ folder, workspace, actions, sorting }) {
  const [naming, setNaming] = useState(false)
  const branches = branchTree(workspace.folders, folder.id)
  const lanes = useDrop(`sky:lanes:${folder.id}`, {
    accepts: (carried) => carried.kind === 'folder' && !folderSubtree(workspace.folders, carried.id).has(folder.id),
    axis: 'y',
    onDrop: ({ id, index }) => actions.moveFolder(id, folder.id, index),
  })
  return (
    <div className="lanes is-across" {...lanes}>
      {folder.from?.proposal && (
        <div className="packed-bar is-proposal" role="note">
          <p>OSAT suggests <strong>{folder.from.proposal.name}</strong>{folder.from.proposal.summary ? `: ${folder.from.proposal.summary}` : ''}</p>
          <button type="button" className="is-primary" onClick={() => actions.acceptName(folder.id)}><Check weight="bold" /> Use this</button>
          <button type="button" onClick={() => actions.keepName(folder.id)}>Keep “{folder.name}”</button>
          {folder.from.scan && actions.showScan && <button type="button" onClick={() => actions.showScan(folder)}><Eye weight="bold" /> Show the scan</button>}
        </div>
      )}
      {folder.packed && (
        <div className="packed-bar" role="note">
          <p>{actions.unpacking?.id === folder.id ? actions.unpacking.line : 'Packed: only a summary so far. Unpack it into branches when you’re ready.'}</p>
          {actions.unpackWithAi && (
            <button type="button" className="is-primary" disabled={actions.unpacking?.busy} title={`Asks ${actions.answering}`} onClick={() => actions.unpackWithAi(folder)}>
              <Sparkle weight="bold" /> Unpack with AI
            </button>
          )}
          <button type="button" onClick={() => { actions.unpack(folder.id); setNaming(true) }}>{actions.unpackWithAi ? 'By hand' : 'Unpack'}</button>
        </div>
      )}
      {branches.map(({ folder: branch, depth }) => (
        <Lane key={branch.id} folder={branch} depth={depth} notes={pileOf(workspace.notes, branch.id)} actions={actions} />
      ))}
      {naming
        ? <div className="lane is-naming"><NameField placeholder="Name the branch" onDone={(name) => { setNaming(false); if (name) actions.addBranch(name, folder.id) }} /></div>
        : <button type="button" className="lane-add" onClick={() => setNaming(true)}><Plus weight="bold" /> New branch</button>}
      <Lane key="loose" loose folder={folder} notes={pileOf(workspace.notes, folder.id)} actions={actions} sorting={sorting?.id === folder.id ? sorting : null} workspace={workspace} />
    </div>
  )
}

function Lane({ folder, notes, actions, depth = 0, loose = false, sorting, workspace }) {
  const [renaming, setRenaming] = useState(false)
  const head = useDrop(`sky:lane-head:${loose ? 'loose:' : ''}${folder.id}`, {
    accepts: ['note'],
    onDrop: ({ id }) => actions.moveSticky(id, folder.id),
  })
  return (
    <section className={`lane ${loose ? 'is-loose' : ''}`} data-slot={loose || depth ? undefined : ''} style={{ '--depth': depth }} aria-label={loose ? 'Stickies' : folder.name}>
      <div
        className="lane-head"
        data-paper={loose ? undefined : folder.color || 'bone'}
        {...head}
        {...(loose ? {} : carryable({ kind: 'folder', id: folder.id, data: { parentId: folder.parentId } }))}
        onDoubleClick={() => { if (!loose) setRenaming(true) }}
        onContextMenu={loose ? undefined : (event) => actions.branchMenu(event, folder)}
      >
        {loose
          ? <strong>Stickies</strong>
          : renaming
            ? <NameField initial={folder.name} placeholder="Name" onDone={(name) => { setRenaming(false); if (name) actions.rename(folder.id, name) }} />
            : <strong>{depth > 0 ? '↳ ' : ''}{folder.name}</strong>}
        {!loose && <button type="button" className="lane-more" aria-label={`More for ${folder.name}`} onClick={(event) => actions.branchMenu(event, folder)}><DotsThree weight="bold" /></button>}
      </div>
      <StickyList
        id={`sky:${loose ? 'loose' : 'lane'}:${folder.id}`}
        folderId={folder.id}
        notes={notes}
        axis="x"
        actions={actions}
        paper={!loose && folder.color && folder.color !== 'bone' ? folder.color : 'canary'}
      />
      {sorting && <SortHelp sorting={sorting} workspace={workspace} actions={actions} />}
    </section>
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
