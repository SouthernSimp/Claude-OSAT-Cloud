import { useMemo } from 'react'

import { excerpt } from '../../notes-model.js'
import { paperFields, pickSurfacing, restSurfacing } from '../field-model.js'

const WHEN = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
const WHEN_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })

/* From before: one older note that fits what was written this week (the same one all day).
   Not now rests it for 30 days. Opens that note. */
export function FromBeforeWidget({ workspace, commit, now, today, open }) {
  const rested = workspace.settings?.surfacing
  const note = useMemo(() => pickSurfacing(workspace.notes, today, rested), [workspace.notes, today, rested])
  if (!note) {
    return (
      <>
        <button type="button" className="widget-kicker widget-title" aria-label="From before. Open Notes" onClick={() => open('Notes')}>From before</button>
        <p className="widget-empty">Notes from a month ago and longer come back here, one a day.</p>
      </>
    )
  }
  const made = new Date(note.createdAt)
  const line = excerpt(paperFields(note).body, 120)
  return (
    <>
      <button type="button" className="widget-kicker widget-title" aria-label={`From before: ${note.title}. Open it`} onClick={() => open('Notes', { noteId: note.id })}>
        From before <small>{(made.getFullYear() === now.getFullYear() ? WHEN : WHEN_YEAR).format(made)}</small>
      </button>
      <strong className="before-title">{note.title || 'Untitled note'}</strong>
      {line && <p className="before-line">{line}</p>}
      <button
        type="button"
        className="before-later"
        onClick={() => commit((state) => ({ ...state, settings: { ...(state.settings || {}), surfacing: restSurfacing(state.settings?.surfacing, note.id, today) } }))}
      >
        Not now
      </button>
    </>
  )
}
