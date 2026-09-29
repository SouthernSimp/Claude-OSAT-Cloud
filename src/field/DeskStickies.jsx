import { useEffect, useRef, useState } from 'react'

import { useDrop } from '../lib/carry.js'
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

/* Stickies set down on a surface: the desk, or the scratch page under it. Each is a note
   with a place (`<prefix>:<id>` in the Mac's places, fractions of the surface) and maybe a
   size. Dragging one around sets it down again (on the grid); its corner resizes
   it; its × deletes it (onToss, with Undo). A new one is written where the surface was
   double-clicked (`draft`, in points on the surface; onDraft hears the words, or nothing).
   The surface takes stickies dropped on it wherever they land (use `drop` on it). */
export function useStickySurface({ id, surface, prefix, places, onPlace }) {
  return useDrop(id, {
    accepts: ['note'],
    onDrop: ({ id: noteId, x, y, offset }) => {
      const box = surface.current?.getBoundingClientRect()
      if (!box) return
      const before = places[`${prefix}:${noteId}`]
      onPlace(`${prefix}:${noteId}`, spotOn(box, x - offset.x, y - offset.y, before?.w ? { w: before.w, h: before.h } : null))
    },
  })
}

export function StickyLayer({ stickies, prefix, commit, onPlace, onToss, onMenu, mentions, draft, onDraft, fresh }) {
  return (
    <div className="sticky-layer">
      {stickies.map(({ note, spot }) => (
        <DeskSticky
          key={note.id}
          note={note}
          spot={spot}
          fresh={fresh === note.id}
          commit={commit}
          onResize={(size) => onPlace(`${prefix}:${note.id}`, { x: spot.x, y: spot.y, ...size })}
          onToss={() => onToss(note)}
          onMenu={(event) => onMenu(event, note)}
          mentions={mentions}
        />
      ))}
      {draft && <DraftSticky draft={draft} onDone={onDraft} />}
    </div>
  )
}

function DeskSticky({ note, spot, fresh, commit, onResize, onToss, onMenu, mentions }) {
  const [size, setSize] = useState(null)
  const shown = size || (spot.w ? { w: spot.w, h: spot.h } : null)
  // A little tilt, the same every time, like paper put down by hand.
  const tilt = (hashUnit(note.id) - 0.5) * 3

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
      className={`desk-sticky ${fresh ? 'is-fresh' : ''} ${shown ? 'is-sized' : ''}`}
      style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: shown?.w || STICKY.w, height: shown?.h, '--tilt': `${tilt}deg` }}
    >
      <Sticky note={note} commit={commit} paper={note.color || 'canary'} slot={false} onToss={onToss} onMenu={onMenu} mentions={mentions} />
      <span className="desk-sticky-size" role="presentation" title="Drag to resize" onPointerDown={resize} />
    </div>
  )
}

function DraftSticky({ draft, onDone }) {
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
