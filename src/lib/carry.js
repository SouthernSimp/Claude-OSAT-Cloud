import { useEffect, useRef, useSyncExternalStore } from 'react'

/* Picking something up and setting it down somewhere else, anywhere in OSAT: a sticky from
   the desk into a node, a sticky from one pile to another, a node to a new place in the
   row. A press that moves 5 px becomes a carry: a copy of what was picked up follows the
   pointer, the original waits faded, and the place under the pointer that takes it lights
   up (a line shows where in a list it will land). Letting go drops it there; Esc, or
   letting go over nothing that takes it, puts it back.

   Places register with useDrop(id, { accepts, axis, onDrop, spring }): `accepts` lists the
   kinds it takes ('note', 'folder'…), `axis` ('x' or 'y') makes it a list whose children
   with [data-slot] are its items, so a drop has an index; `spring` runs after the pointer
   rests over it (a collapsed pile opens, the dock's Sky button goes up). Holding the
   pointer at the top or bottom edge of the screen asks onEdge to change layers. onDrop also
   says whether ⌥ was held (`alt`: copy instead of move).

   Two ways across the window's edge: files dragged in from Finder fall on the same places
   (`useOutsideFiles`, as `data.files`), and a carried thing that names `out` in carryable is
   handed on when the pointer leaves the window, for the Mac's own drag to take over. */

const targets = new Map()
const subscribers = new Set()
let carrying = null // { kind, id, data }, while something is carried
let edgeHandler = null

const notify = () => subscribers.forEach((listener) => listener())
const subscribe = (listener) => { subscribers.add(listener); return () => subscribers.delete(listener) }
const snapshot = () => carrying

/* What is being carried right now ({ kind, id, data }), or null. */
export function useCarrying() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/* The desk says what the top and bottom edges do ('up' / 'down'). */
export function onCarryEdge(handler) {
  edgeHandler = handler
  return () => { if (edgeHandler === handler) edgeHandler = null }
}

/* A place things can be dropped. Returns the props for its element. */
export function useDrop(id, spec) {
  const latest = useRef(spec)
  latest.current = spec
  useEffect(() => {
    targets.set(id, { get spec() { return latest.current } })
    return () => targets.delete(id)
  }, [id])
  return { 'data-drop': id, ...(spec.axis ? { 'data-axis': spec.axis } : {}) }
}

const OUTSIDE = { kind: 'file', id: 'outside', data: { items: [] } }

/* Files dragged in from Finder or another app fall on the places that take 'file', as
   { kind: 'file', data: { items: [], files: [File…] } }. Spread the result on the element that hears them. */
export function useOutsideFiles() {
  const held = useRef({ over: null, timer: 0 })
  const clear = () => {
    held.current.over?.element.removeAttribute('data-over')
    clearTimeout(held.current.timer)
    held.current = { over: null, timer: 0 }
  }
  useEffect(() => clear, [])
  const hears = (event) => Boolean(event.dataTransfer?.types?.includes('Files'))
  return {
    onDragOver(event) {
      if (!hears(event)) return
      event.preventDefault()
      const found = targetAt(event.clientX, event.clientY, OUTSIDE)
      // A move if the other app allows one and ⌥ isn't held; otherwise a copy.
      event.dataTransfer.dropEffect = !found ? 'none' : !event.altKey && /all|move|uninitialized/i.test(event.dataTransfer.effectAllowed) ? 'move' : 'copy'
      if (found?.element === held.current.over?.element) return
      clear()
      if (!found) return
      found.element.setAttribute('data-over', '')
      held.current = { over: found, timer: found.spec.spring ? setTimeout(() => found.spec.spring(OUTSIDE), 650) : 0 }
    },
    onDragLeave(event) {
      if (!event.currentTarget.contains(event.relatedTarget)) clear()
    },
    onDrop(event) {
      if (!hears(event)) return
      event.preventDefault()
      const target = held.current.over
      const files = Array.from(event.dataTransfer.files)
      const copy = event.altKey || event.dataTransfer.dropEffect === 'copy'
      clear()
      if (target && files.length) target.spec.onDrop({ ...OUTSIDE, data: { items: [], files }, alt: copy })
    },
  }
}

/* Which slot a point falls before, given the slots' boxes in reading order (a row that wraps
   counts: the row under the pointer decides, then left to right within it). */
export function slotIndex(boxes, axis, x, y) {
  const wrapped = axis === 'x' && boxes.some((box) => box.top > boxes[0].bottom - 1)
  const row = wrapped ? boxes.reduce((top, box) => (box.top <= y ? box.top : top), boxes[0]?.top) : 0
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i]
    if (wrapped && box.top < row - 1) continue
    if (wrapped && box.top > row + 1) return i
    if ((axis === 'x' ? x : y) < (axis === 'x' ? box.left + box.width / 2 : box.top + box.height / 2)) return i
  }
  return boxes.length
}

/* Where in a list (the target's own [data-slot] children, not counting the carried one) a
   point falls, and the line that shows it. */
function slotAt(element, axis, x, y) {
  const items = [...element.querySelectorAll('[data-slot]')]
    .filter((item) => item.closest('[data-drop]') === element && !item.matches('.is-carried, .is-lifted') && !item.querySelector('.is-carried, .is-lifted'))
  const index = slotIndex(items.map((item) => item.getBoundingClientRect()), axis, x, y)
  const beside = items[index] || items[index - 1]
  const box = (beside || element).getBoundingClientRect()
  const before = Boolean(items[index])
  const line = !beside
    ? (axis === 'x' ? { left: box.left + 8, top: box.top + 8, width: 3, height: Math.max(24, box.height - 16) } : { left: box.left + 8, top: box.top + 8, width: Math.max(24, box.width - 16), height: 3 })
    : axis === 'x'
      ? { left: before ? box.left - 6 : box.right + 3, top: box.top, width: 3, height: box.height }
      : { left: box.left, top: before ? box.top - 6 : box.bottom + 3, width: box.width, height: 3 }
  return { index, line }
}

/* The innermost place under the point that takes what is carried. `accepts` is a list of
   kinds, or a test given the carried thing. */
function targetAt(x, y, carried) {
  let element = document.elementFromPoint(x, y)?.closest('[data-drop]')
  while (element) {
    const spec = targets.get(element.dataset.drop)?.spec
    const takes = spec && !spec.disabled && (typeof spec.accepts === 'function' ? spec.accepts(carried) : spec.accepts.includes(carried.kind))
    if (takes) return { element, spec }
    element = element.parentElement?.closest('[data-drop]')
  }
  return null
}

let swallowClick = false
globalThis.addEventListener?.('click', (event) => {
  if (!swallowClick) return
  swallowClick = false
  event.preventDefault()
  event.stopPropagation()
}, true)

/* Props for something that can be carried: { kind, id, data }. Plain clicks still reach
   its own onClick; controls inside it (buttons, fields) never start a carry, but the
   thing itself may be a button (a desk icon, a file). With `live` ({ move(dx, dy), end() }),
   nothing is copied: the thing itself is lifted (it lets the pointer through, `is-lifted`)
   and `move` hears how far it has been carried, in screen pixels, so it and whatever hangs
   off it (its lines, its branch) can follow; `end` runs before the drop. */
export function carryable(item, { disabled = false, out = null, live = null } = {}) {
  if (disabled) return {}
  return {
    onPointerDown(event) {
      const control = event.target.closest('button, input, textarea, select, a, [contenteditable="true"], .no-carry')
      if (event.button !== 0 || (control && control !== event.currentTarget && event.currentTarget.contains(control))) return
      begin(event, item, event.currentTarget, out, live)
    },
  }
}

function begin(down, item, source, out, live) {
  const start = { x: down.clientX, y: down.clientY }
  const box = source.getBoundingClientRect()
  const offset = { x: start.x - box.left, y: start.y - box.top }
  // Picked up from a zoomed board: the copy keeps its size on screen.
  const zoom = source.offsetWidth ? box.width / source.offsetWidth : 1
  let ghost = null
  let marker = null
  let over = null
  let spring = null
  let edge = null
  let last = start

  const clear = () => {
    if (over) over.element.removeAttribute('data-over')
    over = null
    if (marker) marker.hidden = true
    clearTimeout(spring?.timer)
    spring = null
  }

  const place = (x, y) => {
    last = { x, y }
    if (live) live.move(x - start.x, y - start.y)
    else ghost.style.translate = `${x - offset.x}px ${y - offset.y}px`
    const found = targetAt(x, y, carrying)
    if (found?.element !== over?.element) {
      clear()
      over = found
      if (over) {
        over.element.setAttribute('data-over', '')
        if (over.spec.spring) {
          const target = over
          spring = { timer: setTimeout(() => { if (over === target) target.spec.spring(carrying) }, 650) }
        }
      }
    }
    if (over?.spec.axis) {
      const { line } = slotAt(over.element, over.spec.axis, x, y)
      marker.hidden = !line
      if (line) Object.assign(marker.style, { left: `${line.left}px`, top: `${line.top}px`, width: `${line.width}px`, height: `${line.height}px` })
    } else if (marker) marker.hidden = true
    // Held at the top or bottom of the screen: up to the Sky, or down again.
    const side = y < 14 ? 'up' : y > innerHeight - 14 ? 'down' : null
    if (side !== edge?.side) {
      clearTimeout(edge?.timer)
      document.documentElement.dataset.carryEdge = side || ''
      edge = side ? { side, timer: setTimeout(() => { edgeHandler?.(side, carrying); document.documentElement.dataset.carryEdge = '' }, 600) } : null
    }
  }

  const move = (event) => {
    if (event.pointerId !== down.pointerId) return
    if (!ghost) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return
      if (live) {
        // Lifted, not copied: it follows by itself (live.move) and lets the pointer through.
        ghost = source
        source.classList.add('is-lifted')
      } else {
        ghost = source.cloneNode(true)
        ghost.classList.add('carry-ghost')
        ghost.removeAttribute('id')
        ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'))
        ghost.setAttribute('aria-hidden', 'true')
        Object.assign(ghost.style, { position: 'fixed', left: '0px', top: '0px', width: `${box.width / zoom}px`, height: `${box.height / zoom}px`, margin: '0', zIndex: '2147483000', pointerEvents: 'none' })
        if (Math.abs(zoom - 1) > 0.01) Object.assign(ghost.style, { transformOrigin: '0 0', scale: String(zoom * 1.03) })
        document.body.append(ghost)
        source.classList.add('is-carried')
      }
      marker = document.createElement('i')
      marker.className = 'carry-line'
      marker.hidden = true
      document.body.append(marker)
      getSelection()?.removeAllRanges()
      carrying = { kind: item.kind, id: item.id, data: item.data }
      document.documentElement.dataset.carrying = item.kind
      notify()
    }
    event.preventDefault()
    // Off the edge of the window: the Mac's own drag takes it from here (to the Dock, another screen…).
    if (out && (event.clientX < 0 || event.clientY < 0 || event.clientX >= innerWidth || event.clientY >= innerHeight)) {
      finish(false)
      out(item)
      return
    }
    place(event.clientX, event.clientY)
  }

  const finish = (drop, alt = false) => {
    removeEventListener('pointermove', move, true)
    removeEventListener('pointerup', up, true)
    removeEventListener('pointercancel', cancel, true)
    removeEventListener('keydown', key, true)
    if (!ghost) return
    const target = drop && over
    const where = target?.spec.axis ? slotAt(target.element, target.spec.axis, last.x, last.y).index : undefined
    clearTimeout(edge?.timer)
    delete document.documentElement.dataset.carryEdge
    delete document.documentElement.dataset.carrying
    clear()
    if (live) {
      source.classList.remove('is-lifted')
      live.end?.()
    } else ghost.remove()
    marker?.remove()
    source.classList.remove('is-carried')
    swallowClick = true
    setTimeout(() => { swallowClick = false })
    const carried = carrying
    carrying = null
    notify()
    if (target) target.spec.onDrop({ ...carried, index: where, alt, x: last.x, y: last.y, offset, size: { width: box.width, height: box.height } })
  }
  const up = (event) => { if (event.pointerId === down.pointerId) finish(true, event.altKey) }
  const cancel = (event) => { if (event.pointerId === down.pointerId) finish(false) }
  const key = (event) => {
    if (event.key !== 'Escape' || !ghost) return
    event.preventDefault()
    event.stopPropagation()
    finish(false)
  }
  addEventListener('pointermove', move, true)
  addEventListener('pointerup', up, true)
  addEventListener('pointercancel', cancel, true)
  addEventListener('keydown', key, true)
}
