import { useEffect, useRef, useState } from 'react'
import { Plus } from '@phosphor-icons/react'

import { useDrop } from '../lib/carry.js'
import { Sticky } from './Sticky.jsx'

/* A run of stickies you can drop into at any place: down a pile, or across a lane. It
   ends with a way to write the next one. `actions` are the Sky's (Sky.jsx). */
export function StickyList({ id, folderId, notes, axis = 'y', actions, paper, adding = 'Add a sticky', suggestions, className = '', empty }) {
  const drop = useDrop(id, {
    accepts: ['note'],
    axis,
    onDrop: ({ id: noteId, index }) => actions.moveSticky(noteId, folderId, index),
  })
  return (
    <div className={`sticky-list is-${axis} ${className}`} {...drop}>
      {notes.map((note) => {
        const suggestion = suggestions?.get(note.id)
        return (
          <Sticky
            key={note.id}
            note={note}
            commit={actions.commit}
            paper={note.color || paper}
            onToss={() => actions.toss(note)}
            onMenu={(event) => actions.stickyMenu(event, note)}
            suggestion={suggestion}
            onAccept={() => actions.acceptSuggestion(note.id)}
            onDecline={() => actions.declineSuggestion(note.id)}
          />
        )
      })}
      {!notes.length && empty && <p className="sticky-empty">{empty}</p>}
      {adding && <AddSticky placeholder={adding} onAdd={(text) => actions.addSticky(text, folderId)} />}
    </div>
  )
}

/* "Add a sticky": a blank sticky to write on. Return keeps it and gives a fresh one right
   away, so a whole pile can be typed in a row; Shift-Return is a new line; Esc stops. */
export function AddSticky({ placeholder = 'Add a sticky', onAdd }) {
  const [open, setOpen] = useState(false)
  const field = useRef(null)
  useEffect(() => { if (open) field.current?.focus() }, [open])
  if (!open) {
    return (
      <button type="button" className="add-sticky" onClick={() => setOpen(true)}>
        <Plus weight="bold" /> {placeholder}
      </button>
    )
  }
  return (
    <div className="sticky is-new" data-paper="bone">
      <textarea
        ref={field}
        className="sticky-field"
        placeholder="Write, then Return"
        aria-label={placeholder}
        maxLength={8000}
        onBlur={(event) => {
          if (event.target.value.trim()) onAdd(event.target.value)
          setOpen(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (event.target.value.trim()) onAdd(event.target.value)
            event.target.value = ''
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (event.target.value.trim()) onAdd(event.target.value)
            setOpen(false)
          }
        }}
      />
    </div>
  )
}

/* A name typed in place (a new node, a new branch, a rename). Return keeps it; Esc or an
   empty name leaves things as they were. */
export function NameField({ initial = '', placeholder, onDone, className = '' }) {
  const field = useRef(null)
  const settled = useRef(false)
  useEffect(() => { field.current?.focus(); field.current?.select() }, [])
  const finish = (keep) => {
    if (settled.current) return
    settled.current = true
    const value = field.current.value.trim()
    onDone(keep && value && value !== initial ? value : null)
  }
  return (
    <input
      ref={field}
      className={`name-field ${className}`}
      defaultValue={initial}
      placeholder={placeholder}
      aria-label={placeholder}
      maxLength={80}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true) }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false) }
      }}
    />
  )
}
