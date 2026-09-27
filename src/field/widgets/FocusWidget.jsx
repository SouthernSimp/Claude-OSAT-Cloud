import { FOCUS_MINUTES, focusRemaining } from '../../focus-session.js'
import { openSteps } from './NextWidget.jsx'

const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

/* Focus: twenty-five quiet minutes for the first open step. While a session runs a thin
   ring fills, a little each minute; it never counts seconds. Opens the Focus screen. */
export function FocusWidget({ workspace, notes, now, today, open }) {
  const session = workspace.focus
  const left = focusRemaining(session, now.getTime())
  const running = session?.status === 'running' && left > 0
  const paused = session?.status === 'paused'
  const step = openSteps(notes, today).find((item) => !item.done)
  return (
    <>
      <button type="button" className="widget-kicker widget-title" aria-label="Focus. Open the Focus screen" onClick={() => open('Focus')}>Focus</button>
      <div className="focus-row">
        <svg className="focus-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" />
          {(running || paused) && <circle cx="18" cy="18" r="15" pathLength="1" className="is-done" style={{ strokeDashoffset: left / (FOCUS_MINUTES * 60000) }} />}
        </svg>
        <div className="focus-text">
          <strong>{running ? `Quiet until ${TIME.format(session.endsAt)}` : paused ? 'Paused for now' : `${FOCUS_MINUTES} quiet minutes`}</strong>
          <span>{step ? step.text : 'Nothing else needs you'}</span>
        </div>
      </div>
    </>
  )
}
