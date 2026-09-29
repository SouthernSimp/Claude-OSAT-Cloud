import { useEffect, useRef, useState } from 'react'
import { Check, X } from '@phosphor-icons/react'

import { carryable } from '../lib/carry.js'
import { fileByMentions, filedAs } from '../nodes-model.js'
import { relinkRenamedNote, updateNote } from '../notes-model.js'

/* The title (the first line) and what's under it, as a sticky shows them: steps as boxes,
   bullets as dots, tags left as written (#N2D is how Nate writes on paper). */
export function stickyText(note) {
  const lines = String(note.markdown || note.title || '').split('\n')
  const first = lines.findIndex((line) => line.trim())
  const title = first < 0 ? note.title || '' : lines[first].replace(/^#{1,6}\s+/, '').trim()
  const body = lines.slice(first + 1).join('\n').trim()
    .replace(/^\s*[-*+]\s+\[[xX]\]\s+/gm, '☑ ')
    .replace(/^\s*[-*+]\s+\[ \]\s+/gm, '☐ ')
    .replace(/^\s*[-*+]\s+/gm, '• ')
  return { title, body }
}

/* Saves what was written on a sticky: its first line is its title, and a new @node files
   it there. Returns what filing did ({ where, made }, see filedAs), or null. */
export function writeSticky(commit, note, text) {
  const markdown = text.replace(/\s+$/, '')
  const title = markdown.split('\n').find((line) => line.trim())?.replace(/^#{1,6}\s+/, '').trim().slice(0, 120) || note.title
  if (markdown === note.markdown) return null
  let filing = null
  commit((state) => {
    const next = updateNote(state, note.id, { title, markdown })
    const filed = fileByMentions(title !== note.title ? relinkRenamedNote(next, note.title, title) : next, note.id, note.markdown)
    filing = filedAs(state, filed, note.id)
    return filed
  })
  return filing
}

/* One sticky: a note on coloured paper. Click it to write on it; Esc, ⌘Return or clicking
   away keeps what was written, and emptying it tosses it (onToss offers Undo). Its × tosses
   it too, or, with `onAway`, only takes it off the desk. It can be carried anywhere that
   takes stickies, and right-clicked (onMenu). A `suggestion` from sorting shows under it,
   with a tick and a cross. `onFiled` hears where an @node sent it ({ where, made }). */
export function Sticky({
  note, commit, paper = 'canary', onToss, onAway, awayLabel = 'Put away', onMenu, onFiled, carry = true, editing: startEditing = false, onEditingDone,
  suggestion, onAccept, onDecline, className = '', style, slot = true, children,
}) {
  const [editing, setEditing] = useState(startEditing)
  const field = useRef(null)
  const { title, body } = stickyText(note)

  useEffect(() => {
    if (!editing) return
    const element = field.current
    element?.focus()
    element?.setSelectionRange(element.value.length, element.value.length)
  }, [editing])

  function done(save = true) {
    const text = field.current?.value ?? ''
    setEditing(false)
    if (save) {
      if (!text.trim()) onToss?.()
      else {
        const filing = writeSticky(commit, note, text)
        if (filing?.where) onFiled?.(filing)
      }
    }
    onEditingDone?.()
  }

  return (
    <article
      className={`sticky ${editing ? 'is-editing' : ''} ${className}`}
      data-paper={paper}
      data-note={note.id}
      data-slot={slot ? '' : undefined}
      style={style}
      tabIndex={editing ? -1 : 0}
      aria-label={title || 'Sticky'}
      {...(carry && !editing ? carryable({ kind: 'note', id: note.id, data: { folderId: note.folderId || null } }) : {})}
      onClick={(event) => { if (!editing && !event.target.closest('button')) setEditing(true) }}
      onContextMenu={onMenu}
      onKeyDown={(event) => {
        if (editing || event.target !== event.currentTarget) return
        if (event.key === 'Enter') { event.preventDefault(); setEditing(true) }
        if ((event.key === 'Backspace' || event.key === 'Delete') && onToss) { event.preventDefault(); onToss() }
      }}
    >
      {editing ? (
        <textarea
          ref={field}
          className="sticky-field"
          defaultValue={note.markdown || note.title}
          aria-label="Write on the sticky"
          maxLength={8000}
          onBlur={() => done(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
              event.preventDefault()
              event.stopPropagation()
              field.current.blur()
            }
          }}
        />
      ) : (
        <>
          <h4>{title || 'Untitled'}</h4>
          {body && <p>{body}</p>}
        </>
      )}
      {!editing && (onAway || onToss) && (
        <button type="button" className="sticky-toss" aria-label={`${onAway ? awayLabel : 'Toss'} ${title}`} title={onAway ? awayLabel : 'Toss (you can Undo)'} onClick={onAway || onToss}><X weight="bold" /></button>
      )}
      {suggestion && !editing && (
        <div className="sticky-suggest">
          <span>→ {suggestion.label}</span>
          <button type="button" aria-label={`Move to ${suggestion.label}`} title="Move it there" onClick={onAccept}><Check weight="bold" /></button>
          <button type="button" aria-label="Leave it here" title="Leave it" onClick={onDecline}><X weight="bold" /></button>
        </div>
      )}
      {children}
    </article>
  )
}
