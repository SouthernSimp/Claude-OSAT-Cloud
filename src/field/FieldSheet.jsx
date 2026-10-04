import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from '@phosphor-icons/react'

import { SaveStatus } from '../store/SaveStatus.jsx'
import { wordCount } from '../notes-model.js'
import { paperFields, paperWrite } from './field-model.js'

function remember(snapshot, note, title, body) {
  if (snapshot.current?.id === note.id) {
    snapshot.current.note = note
    snapshot.current.title = title
    snapshot.current.body = body
  }
}

/* A sticky opened as a pop-out on the desk: its title and words, saved as they're written. */
export function FieldSheet({ note, onClose, onCommit, onOpenNotes }) {
  const origin = paperFields(note)
  const [title, setTitle] = useState(origin.title)
  const [body, setBody] = useState(origin.body)
  const titleRef = useRef(null)
  const bodyRef = useRef(null)
  const snapshot = useRef(null)
  const commitRef = useRef(onCommit)
  if (!snapshot.current) snapshot.current = { id: note.id, note, title: origin.title, body: origin.body }
  remember(snapshot, note, title, body)
  commitRef.current = onCommit

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

  const words = wordCount(paperWrite(note, title, body).markdown)
  const tag = note.tags?.[0]

  return (
    <article className="field-sheet-paper" onPointerDown={(event) => event.stopPropagation()}>
      <small><SaveStatus /> · {tag ? `#${tag}` : 'A sticky'}</small>
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
}
