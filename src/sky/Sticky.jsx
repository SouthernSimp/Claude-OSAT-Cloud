import { useEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'

import { carryable } from '../lib/carry.js'
import { linkMentions } from '../nodes-model.js'
import { relinkRenamedNote, updateNote } from '../notes-model.js'

/* The title (the first line) and what's under it, as a sticky shows them: steps as boxes,
   bullets as dots, tags left as written (#N2D is how Nate writes on paper). */
export function stickyText(note) {
  const lines = String(note.markdown || note.title || '').split('\n')
  const first = lines.findIndex((line) => line.trim())
  const boxes = (text) => text
    .replace(/^\s*[-*+]\s+\[[xX]\]\s+/gm, '☑ ')
    .replace(/^\s*[-*+]\s+\[ \]\s+/gm, '☐ ')
    .replace(/^\s*[-*+]\s+/gm, '• ')
  const title = first < 0 ? note.title || '' : boxes(lines[first].replace(/^#{1,6}\s+/, '').trim())
  const body = boxes(lines.slice(first + 1).join('\n').trim())
  return { title, body }
}

/* Saves what was written on a sticky: its first line is its title, and its @s point at
   their nodes (linkMentions). */
export function writeSticky(commit, note, text) {
  const markdown = text.replace(/\s+$/, '')
  const title = markdown.split('\n').find((line) => line.trim())?.replace(/^#{1,6}\s+/, '').trim().slice(0, 120) || note.title
  if (markdown === note.markdown) return
  commit((state) => {
    const next = updateNote(state, note.id, { title, markdown })
    return linkMentions(title !== note.title ? relinkRenamedNote(next, note.title, title) : next, note.id)
  })
}

/* Words with their @s as links, when `mentions` ({ parts(text, note), open(folderId) })
   is given. */
function Words({ text, note, mentions }) {
  if (!mentions) return text
  return mentions.parts(text, note).map((part, index) => (typeof part === 'string'
    ? part
    : <button key={index} type="button" className="sticky-mention" title="Go to this node" onClick={() => mentions.open(part.folderId)}>{part.text}</button>))
}

/* One sticky: a note on colored paper. Click it to write on it; Esc, ⌘Return or clicking
   away keeps what was written, and emptying it deletes it (onToss offers Undo). Its ×
   deletes it too, everywhere. It can be carried
   anywhere that takes stickies (itself, with `live`: see carryable), and right-clicked
   (onMenu). With `mentions`, its @s are links to their nodes. */
export function Sticky({
  note, commit, paper = 'canary', onToss, onMenu, mentions, carry = true, editing: startEditing = false, onEditingDone,
  className = '', style, slot = true, children, live = null,
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
      else writeSticky(commit, note, text)
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
      {...(carry && !editing ? carryable({ kind: 'note', id: note.id, data: { folderId: note.folderId || null } }, { live }) : {})}
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
          <h4><Words text={title || 'Untitled'} note={note} mentions={mentions} /></h4>
          {body && <p><Words text={body} note={note} mentions={mentions} /></p>}
        </>
      )}
      {!editing && onToss && (
        <button type="button" className="sticky-toss" aria-label={`Delete ${title}`} title="Delete (you can Undo)" onClick={onToss}><X weight="bold" /></button>
      )}
      {children}
    </article>
  )
}
