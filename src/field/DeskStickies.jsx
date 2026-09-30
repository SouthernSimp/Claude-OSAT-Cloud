import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CaretDown, DotsThree } from '@phosphor-icons/react'

import { carryable, useDrop } from '../lib/carry.js'
import { edgePath } from '../links-model.js'
import { NameField } from '../sky/Piles.jsx'
import { Sticky } from '../sky/Sticky.jsx'
import { hashUnit } from './field-model.js'

export const STICKY = { w: 208, h: 150 }
export const GRID = 16

const snapTo = (value) => Math.round(value / GRID) * GRID

/* The spot for a sticky whose top-left corner lands at (left, top) on `box` (the surface's
   rectangle), snapped to the grid, as the fractions places keep. */
export function spotOn(box, left, top, size) {
  const x = Math.max(0, Math.min(snapTo(left - box.left), box.width - 60))
  const y = Math.max(0, Math.min(snapTo(top - box.top), box.height - 60))
  return { x: x / box.width, y: y / box.height, ...(size ? { w: size.w, h: size.h } : {}) }
}

/* The desk takes stickies and stacks dropped on it wherever they land: `onSet(carried,
   spot)`, the spot as the fractions places keep (use the result on the surface). */
export function useStickySurface({ id, surface, onSet }) {
  return useDrop(id, {
    accepts: ['note', 'stack'],
    onDrop: (carried) => {
      const box = surface.current?.getBoundingClientRect()
      if (box) onSet(carried, spotOn(box, carried.x - carried.offset.x, carried.y - carried.offset.y, null))
    },
  })
}

/* Drawing a connection: press the dot on something with [data-link] and let go on another.
   The line follows the pointer (`linking`: { from, x, y } in the surface's own points, from
   `toLocal`); a press that barely moves is a click (`onMenu`, the keyboard's way too). Esc
   lets go. Shared by the desk and the Sky. */
export function useLinking({ toLocal, onLink, onMenu }) {
  const [linking, setLinking] = useState(null)
  function start(event, from) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const origin = { x: event.clientX, y: event.clientY }
    let moved = false
    let over = null
    const light = (element) => {
      if (element === over) return
      over?.removeAttribute('data-link-over')
      over = element
      over?.setAttribute('data-link-over', '')
    }
    const targetAt = (x, y) => {
      const element = document.elementFromPoint(x, y)?.closest('[data-link]')
      return element && element.dataset.link !== from ? element : null
    }
    const stop = () => {
      removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      removeEventListener('keydown', key, true)
      light(null)
      setLinking(null)
    }
    const move = (next) => {
      if (!moved && Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < 4) return
      moved = true
      light(targetAt(next.clientX, next.clientY))
      setLinking({ from, ...toLocal(next.clientX, next.clientY) })
    }
    const up = (next) => {
      const target = moved ? targetAt(next.clientX, next.clientY) : null
      stop()
      if (!moved) onMenu?.(next, from)
      else if (target) onLink(from, target.dataset.link)
    }
    const key = (next) => {
      if (next.key !== 'Escape') return
      next.preventDefault()
      next.stopPropagation()
      stop()
    }
    addEventListener('pointermove', move, true)
    addEventListener('pointerup', up, true)
    addEventListener('keydown', key, true)
  }
  return { linking, start }
}

/* The small dot on an edge that draws a connection (drag it to another sticky), or, clicked
   or pressed with the keyboard, lists what it can be connected to. */
export function LinkDot({ linkKey, label, onStart, onMenu }) {
  return (
    <button
      type="button"
      className="link-dot"
      aria-label={`Connect ${label} to…`}
      title="Drag to another sticky to connect them"
      onPointerDown={(event) => onStart(event, linkKey)}
      onClick={(event) => { if (event.detail === 0) onMenu(event, linkKey) }}
    />
  )
}

/* A menu's spot for something picked with the keyboard: beside it, not the corner. */
export function menuEvent(event) {
  if (event.clientX || event.clientY) return event
  const box = event.currentTarget?.getBoundingClientRect?.()
  return { preventDefault() {}, stopPropagation() {}, clientX: box ? box.right : innerWidth / 2, clientY: box ? box.top : innerHeight / 2 }
}

/* Stickies set down on the desk: each is a note with a place (`note:<id>` in the Mac's
   places, fractions of the desk) and maybe a size; stacks stand in columns (`stacks`). A
   sticky is carried itself (its lines follow it: `drag`, `onDrag`), dropped on another to
   stack them (`onStack`), on the desk to set it down. Its corner resizes it; its × deletes
   it (onToss, with Undo). A new one is written where the desk was double-clicked (`draft`,
   in points on the desk; onDraft hears the words, or nothing). `links` are the connections,
   drawn between whatever of them is on the desk. */
export function StickyLayer({
  stickies, stacks = [], links = [], commit, onPlace, onToss, onMenu, mentions, draft, onDraft, fresh,
  drag, onDrag, onStack, stackProps, linking, onLinkStart, onLinkMenu, onLineMenu,
}) {
  const layer = useRef(null)
  return (
    <div ref={layer} className="sticky-layer">
      <DeskLines layer={layer} links={links} linking={linking} onLineMenu={onLineMenu} />
      {stacks.map((stack) => (
        <DeskStack
          key={stack.key}
          stack={stack}
          drag={drag?.key === stack.key ? drag : null}
          onDrag={onDrag}
          commit={commit}
          onToss={onToss}
          onMenu={onMenu}
          mentions={mentions}
          onLinkStart={onLinkStart}
          onLinkMenu={onLinkMenu}
          {...stackProps}
          renaming={stackProps?.renamingKey === stack.key}
        />
      ))}
      {stickies.map(({ note, spot }) => (
        <DeskSticky
          key={note.id}
          note={note}
          spot={spot}
          fresh={fresh === note.id}
          commit={commit}
          drag={drag?.key === `note:${note.id}` ? drag : null}
          onDrag={onDrag}
          onStack={onStack}
          onResize={(size) => onPlace(`note:${note.id}`, { x: spot.x, y: spot.y, ...size })}
          onToss={() => onToss(note)}
          onMenu={(event) => onMenu(event, note)}
          mentions={mentions}
          onLinkStart={onLinkStart}
          onLinkMenu={onLinkMenu}
        />
      ))}
      {draft && <DraftSticky draft={draft} onDone={onDraft} />}
    </div>
  )
}

/* Carrying a sticky or a stack itself, so what hangs off it follows. */
const liveFor = (key, onDrag) => ({ move: (dx, dy) => onDrag?.({ key, dx, dy }), end: () => onDrag?.(null) })

function DeskSticky({ note, spot, fresh, commit, drag, onDrag, onStack, onResize, onToss, onMenu, mentions, onLinkStart, onLinkMenu }) {
  const [size, setSize] = useState(null)
  const shown = size || (spot.w ? { w: spot.w, h: spot.h } : null)
  // A little tilt, the same every time, like paper put down by hand.
  const tilt = (hashUnit(note.id) - 0.5) * 3
  // Another sticky dropped on this one: they stack.
  const drop = useDrop(`desk:on:${note.id}`, {
    accepts: (carried) => carried.kind === 'note' && carried.id !== note.id,
    onDrop: ({ id }) => onStack(note.id, id),
  })

  function resize(event) {
    event.preventDefault()
    event.stopPropagation()
    const element = event.currentTarget.parentElement
    const start = { x: event.clientX, y: event.clientY, w: element.offsetWidth, h: element.offsetHeight }
    let last = null
    const move = (next) => {
      last = {
        w: Math.max(120, Math.min(720, snapTo(start.w + next.clientX - start.x))),
        h: Math.max(90, Math.min(720, snapTo(start.h + next.clientY - start.y))),
      }
      setSize(last)
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      if (last) onResize(last)
      setSize(null)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  return (
    <div
      className={`desk-sticky ${fresh ? 'is-fresh' : ''} ${shown ? 'is-sized' : ''} ${drag ? 'is-moving' : ''}`}
      data-link={`note:${note.id}`}
      style={{
        left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: shown?.w || STICKY.w, height: shown?.h, '--tilt': `${tilt}deg`,
        translate: drag ? `${drag.dx}px ${drag.dy}px` : undefined,
      }}
      {...drop}
    >
      <Sticky note={note} commit={commit} paper={note.color || 'canary'} slot={false} onToss={onToss} onMenu={onMenu} mentions={mentions} live={liveFor(`note:${note.id}`, onDrag)} />
      <span className="desk-sticky-size" role="presentation" title="Drag to resize" onPointerDown={resize} />
      <LinkDot linkKey={`note:${note.id}`} label={note.title} onStart={onLinkStart} onMenu={onLinkMenu} />
    </div>
  )
}

/* A stack: stickies in a column, in the order they were put there, like a list on a
   kanban board. Carry a sticky within it to reorder, out of it to set it down alone, or
   another one in. Its name (double-click, or the menu) is optional; folded, it is one card
   with its first stickies peeking out. Carried by its head. */
function DeskStack({ stack, drag, onDrag, commit, onToss, onMenu, mentions, onLinkStart, onLinkMenu, onJoin, onFold, onStackMenu, renaming, onRename, renamingKey: _renamingKey }) {
  const drop = useDrop(`desk:stack:${stack.key}`, {
    accepts: ['note'],
    axis: 'y',
    onDrop: ({ id, index }) => onJoin(stack.key, id, index),
  })
  const name = stack.name || 'Stack'
  return (
    <section
      className={`desk-stack ${stack.folded ? 'is-folded' : ''} ${drag ? 'is-moving' : ''}`}
      style={{ left: `${stack.x * 100}%`, top: `${stack.y * 100}%`, translate: drag ? `${drag.dx}px ${drag.dy}px` : undefined }}
      aria-label={`Stack: ${name}`}
      data-link-folded={stack.folded ? stack.notes.map((note) => `note:${note.id}`).join(' ') : undefined}
    >
      <header className="stack-head" {...carryable({ kind: 'stack', id: stack.key }, { live: liveFor(stack.key, onDrag) })} onDoubleClick={() => onRename(stack.key, true)} onContextMenu={(event) => onStackMenu(event, stack)}>
        <button type="button" className="stack-fold" aria-expanded={!stack.folded} aria-label={stack.folded ? `Open ${name}` : `Fold ${name}`} title={stack.folded ? 'Open the stack' : 'Fold the stack'} onClick={() => onFold(stack.key)}>
          <CaretDown weight="bold" />
        </button>
        {renaming
          ? <NameField initial={stack.name || ''} placeholder="Name the stack" onDone={(value) => onRename(stack.key, false, value)} />
          : <strong className={stack.name ? '' : 'is-unnamed'}>{name}</strong>}
        <button type="button" className="stack-more" aria-label={`More for ${name}`} onClick={(event) => onStackMenu(menuEvent(event), stack)}><DotsThree weight="bold" /></button>
      </header>
      {stack.folded
        ? (
          <button type="button" className="stack-pile" title="Open the stack" onClick={() => onFold(stack.key)} {...drop}>
            {stack.notes.slice(0, 3).map((note) => <span key={note.id} className="stack-strip" data-paper={note.color || 'canary'}>{note.title}</span>)}
            {stack.notes.length > 3 && <span className="stack-more-line">and {stack.notes.length - 3} more</span>}
          </button>
        )
        : (
          <div className="stack-list" {...drop}>
            {stack.notes.map((note) => (
              <div key={note.id} className="stack-item" data-slot="" data-link={`note:${note.id}`}>
                <Sticky note={note} commit={commit} paper={note.color || 'canary'} slot={false} onToss={() => onToss(note)} onMenu={(event) => onMenu(event, note)} mentions={mentions} />
                <LinkDot linkKey={`note:${note.id}`} label={note.title} onStart={onLinkStart} onMenu={onLinkMenu} />
              </div>
            ))}
          </div>
        )}
    </section>
  )
}

/* The connections between things on the desk, measured where they lie (a sticky being
   carried included, so its lines follow it). A line to a sticky in a folded stack ends at
   the stack; a line to something not on the desk isn't drawn. Right-click or click a line
   for its menu. */
function DeskLines({ layer, links, linking, onLineMenu }) {
  const [boxes, setBoxes] = useState(() => new Map())
  const [, remeasure] = useState(0)
  const signature = useRef('')

  useLayoutEffect(() => {
    const root = layer.current
    if (!root) return
    const base = root.getBoundingClientRect()
    const next = new Map()
    const box = (element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height }
    }
    root.querySelectorAll('[data-link]').forEach((element) => next.set(element.dataset.link, box(element)))
    root.querySelectorAll('[data-link-folded]').forEach((element) => {
      const shape = box(element)
      element.dataset.linkFolded.split(' ').forEach((key) => { if (!next.has(key)) next.set(key, shape) })
    })
    const text = JSON.stringify([...next])
    if (text !== signature.current) {
      signature.current = text
      setBoxes(next)
    }
  })

  // Measured again when the window changes size (the desk's places are fractions of it).
  useEffect(() => {
    const again = () => remeasure((value) => value + 1)
    addEventListener('resize', again)
    return () => removeEventListener('resize', again)
  }, [])

  const drawn = links.filter((link) => boxes.has(link.a) && boxes.has(link.b) && boxes.get(link.a) !== boxes.get(link.b))
  const from = linking && boxes.get(linking.from)
  if (!drawn.length && !from) return null
  return (
    <svg className="link-lines" aria-hidden="true">
      {drawn.map((link) => {
        const { d } = edgePath(boxes.get(link.a), boxes.get(link.b))
        return (
          <g key={link.key}>
            <path className="link-line" d={d} />
            <path className="link-hit" d={d} onClick={(event) => onLineMenu(event, link)} onContextMenu={(event) => onLineMenu(event, link)} />
          </g>
        )
      })}
      {from && <path className="link-line is-drawing" d={edgePath(from, { x: linking.x, y: linking.y, w: 0, h: 0 }).d} />}
    </svg>
  )
}

export function DraftSticky({ draft, onDone }) {
  const field = useRef(null)
  const settled = useRef(false)
  useEffect(() => { field.current?.focus() }, [])
  const finish = () => {
    if (settled.current) return
    settled.current = true
    onDone(field.current?.value || '')
  }
  return (
    <div className="desk-sticky is-draft" style={{ left: draft.x, top: draft.y, width: STICKY.w, '--tilt': '0deg' }}>
      <div className="sticky is-editing" data-paper="canary">
        <textarea
          ref={field}
          className="sticky-field"
          placeholder="Write it down"
          aria-label="A new sticky"
          maxLength={8000}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
              event.preventDefault()
              event.stopPropagation()
              finish()
            }
          }}
        />
      </div>
    </div>
  )
}
