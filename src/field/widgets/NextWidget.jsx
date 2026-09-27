import { useState } from 'react'

import { localDateKey } from '../../daily-practice.js'
import { bringForward, earlierSteps, nextSteps, toggleNextStep } from '../../next-steps.js'
import { dayNoteId } from '../../notes-model.js'

/* Open steps, today's page first. Steps left on earlier daily pages wait to be
   brought forward, not piled on here. */
export function openSteps(notes, today) {
  const planId = dayNoteId(today)
  const earlierIds = new Set(earlierSteps(notes, today).map((step) => step.id))
  return nextSteps(notes)
    .filter((step) => !earlierIds.has(step.id))
    .sort((a, b) => (b.noteId === planId) - (a.noteId === planId))
}

/* Next: up to five steps with rings. A ticked step stays a moment, then leaves. */
export function NextWidget({ notes, today, commit, navigate, onOpen, move }) {
  const [ghosts, setGhosts] = useState(() => new Set())
  const earlier = earlierSteps(notes, today)
  const steps = openSteps(notes, today).filter((step) => !step.done || ghosts.has(step.id))

  function toggleStep(step) {
    commit((state) => ({ ...state, notes: toggleNextStep(state.notes, step) }))
    if (step.done) return
    setGhosts((value) => new Set(value).add(step.id))
    window.setTimeout(() => {
      if (document.activeElement?.closest('.widget-next li.is-done')) document.getElementById('widget-next')?.focus()
    }, 1380)
    window.setTimeout(() => setGhosts((value) => {
      const next = new Set(value)
      next.delete(step.id)
      return next
    }), 1400)
  }

  return (
    <section className="glass widget widget-next" aria-labelledby="widget-next" {...move}>
      <h2 id="widget-next" tabIndex={-1} className="widget-kicker">Next</h2>
      {steps.length ? (
        <ul>
          {steps.slice(0, 5).map((step) => (
            <li key={step.id} className={step.done ? 'is-done' : ''}>
              <button type="button" className="ring" aria-label={`Complete ${step.text}`} aria-pressed={step.done} onClick={() => toggleStep(step)} />
              <button type="button" className="step-text" onClick={() => onOpen(step.noteId)}>{step.text}</button>
            </li>
          ))}
        </ul>
      ) : <p className="widget-empty">Nothing waiting. Write one in the line and press ⌥↵.</p>}
      {(steps.length > 5 || earlier.length > 0) && (
        <div className="widget-next-foot">
          {steps.length > 5 && <button type="button" onClick={() => navigate('Journal')}>{steps.length - 5} more on today’s page</button>}
          {earlier.length > 0 && (
            <button type="button" className="bring" onClick={() => commit((state) => bringForward(state, localDateKey()))}>
              Bring {earlier.length} from earlier days
            </button>
          )}
        </div>
      )}
    </section>
  )
}
