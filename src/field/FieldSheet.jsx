import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight } from '@phosphor-icons/react'

import { wordCount } from '../notes-model.js'
import { useFocusTrap } from '../lib/use-focus-trap.js'
import { paperFields, paperWrite } from './field-model.js'

function remember(snapshot, note, title, body) {
  if (snapshot.current?.id === note.id) {
    snapshot.current.note = note
    snapshot.current.title = title
    snapshot.current.body = body
  }
}

/* `inline` drops the backdrop and focus trap, for a note that opens as a pop-out on the layer. */
export function FieldSheet({ note, onClose, onCommit, onOpenNotes, inline = false }) {
  const origin = paperFields(note)
  const [title, setTitle] = useState(origin.title)
  const [body, setBody] = useState(origin.body)
  const titleRef = useRef(null)
  const bodyRef = useRef(null)
  const snapshot = useRef(null)
  const commitRef = useRef(onCommit)
  const closeRef = useRef(onClose)
  if (!snapshot.current) snapshot.current = { id: note.id, note, title: origin.title, body: origin.body }
  remember(snapshot, note, title, body)
  commitRef.current = onCommit
  closeRef.current = onClose

  function flush(snap = snapshot.current) {
    if (!snap) return
    const patch = paperWrite(snap.note, snap.title, snap.body)
    if (patch.title === snap.note.title && patch.markdown === snap.note.markdown) return
    commitRef.current(snap.note.id, patch)
  }

  useEffect(() => {
    if (snapshot.current.id !== note.id) {
      flush(snapshot.current)
      const fields = paperFields(note)
      snapshot.current = { id: note.id, note, title: fields.title, body: fields.body }
      setTitle(fields.title)
      setBody(fields.body)
    }
    const focus = window.setTimeout(() => {
      const fields = paperFields(note)
      if (fields.body) bodyRef.current?.focus()
      else titleRef.current?.focus()
    }, 30)
    return () => window.clearTimeout(focus)
  }, [note.id])

  useEffect(() => {
    const handle = window.setTimeout(() => flush(), 280)
    return () => window.clearTimeout(handle)
  }, [title, body, note.id])

  useEffect(() => () => flush(), [])

  // Escape sets the sheet down, Tab stays inside it, and focus returns where it came from.
  const dialog = useRef(null)
  const close = useCallback(() => { flush(); closeRef.current() }, [])
  useFocusTrap(dialog, !inline, close)

  const words = wordCount(paperWrite(note, title, body).markdown)
  const tag = note.tags?.[0]

  const paper = (
    <article ref={dialog} className="field-sheet-paper" onPointerDown={(event) => event.stopPropagation()}>
      <small>{tag ? `#${tag}` : 'A thought'}</small>
      <textarea
        ref={titleRef}
        rows={1}
        className="field-sheet-title"
        aria-label="Title"
        value={title}
        placeholder="A title"
        onChange={(event) => setTitle(event.target.value.replace(/\s*\n\s*/g, ' '))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            bodyRef.current?.focus()
          }
        }}
      />
      <textarea
        ref={bodyRef}
        aria-label="Note"
        value={body}
        placeholder="The rest can wait."
        onChange={(event) => setBody(event.target.value)}
      />
      <footer>
        <span>{words === 1 ? '1 word' : `${words} words`}</span>
        <button type="button" onClick={() => { flush(); onOpenNotes() }}>Open in Notes <ArrowRight /></button>
        <button type="button" className="field-sheet-down" onClick={() => { flush(); onClose() }}>Set it down</button>
      </footer>
    </article>
  )
  if (inline) return paper

  return (
    <div
      className="field-sheet"
      role="dialog"
      aria-label={title.trim() || 'Open note'}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        flush()
        onClose()
      }}
    >
      {paper}
    </div>
  )
}
