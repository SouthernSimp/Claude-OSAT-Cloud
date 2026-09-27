import { useState } from 'react'
import { MoonStars } from '@phosphor-icons/react'

import { localDateKey } from '../../daily-practice.js'
import { bringForward, earlierSteps, nextSteps, toggleNextStep } from '../../next-steps.js'
import { dayNoteId } from '../../notes-model.js'
import { dayPhase } from '../field-model.js'

/* The evening invitation shows once a day, and never again that day once opened. */
function readEvening() {
  try { return localStorage.getItem('osat.evening') } catch { return null }
}
function markEvening(date) {
  try { localStorage.setItem('osat.evening', date) } catch { /* a convenience only */ }
}

/* Open steps, today's page first. Steps left on earlier daily pages wait to be
   brought forward, not piled on here. */
export function openSteps(notes, today) {
  const planId = dayNoteId(today)
  const earlierIds = new Set(earlierSteps(notes, today).map((step) => step.id))
  return nextSteps(notes)
    .filter((step) => !earlierIds.has(step.id))
    .sort((a, b) => (b.noteId === planId) - (a.noteId === planId))
}

/* Next: up to five steps with rings. A ticked step stays a moment, then leaves. In the
   evening the foot offers to close the day. Opens today's page. */
export function NextWidget({ notes, now, today, commit, navigate, onOpenNote, open }) {
  const [ghosts, setGhosts] = useState(() => new Set())
  const [eveningSeenOn, setEveningSeenOn] = useState(readEvening)
  const earlier = earlierSteps(notes, today)
  const steps = openSteps(notes, today).filter((step) => !step.done || ghosts.has(step.id))
  const evening = ['evening', 'night'].includes(dayPhase(now)) && eveningSeenOn !== today

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
    <>
      <button type="button" id="widget-next" className="widget-kicker widget-title" aria-label="Next. Open today’s page" onClick={() => open('Journal')}>Next</button>
      {steps.length ? (
        <ul>
          {steps.slice(0, 5).map((step) => (
            <li key={step.id} className={step.done ? 'is-done' : ''}>
              <button type="button" className="ring" aria-label={`Complete ${step.text}`} aria-pressed={step.done} onClick={() => toggleStep(step)} />
              <button type="button" className="step-text" onClick={() => onOpenNote(step.noteId)}>{step.text}</button>
            </li>
          ))}
        </ul>
      ) : <p className="widget-empty">Nothing waiting. Write one in the line and press ⌥↵.</p>}
      {(steps.length > 5 || earlier.length > 0 || evening) && (
        <div className="widget-next-foot">
          {steps.length > 5 && <button type="button" onClick={() => open('Journal')}>{steps.length - 5} more on today’s page</button>}
          {earlier.length > 0 && (
            <button type="button" className="bring" onClick={() => commit((state) => bringForward(state, localDateKey()))}>
              Bring {earlier.length} from earlier days
            </button>
          )}
          {evening && (
            <button
              type="button"
              className="evening"
              onClick={(event) => {
                markEvening(today)
                setEveningSeenOn(today)
                navigate('Reflection', null, { from: event.currentTarget.getBoundingClientRect() })
              }}
            >
              <MoonStars weight="fill" /> Close the day <span>three quiet questions</span>
            </button>
          )}
        </div>
      )}
    </>
  )
}
