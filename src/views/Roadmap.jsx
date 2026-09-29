import { useMemo, useRef, useState } from 'react'
import { CheckCircle, Circle, CircleHalf } from '@phosphor-icons/react'

import roadmap from '../../docs/ROADMAP.md?raw'
import { Markdown } from '../lib/markdown.jsx'
import { phaseAnchor, roadmapPhases, timelineSummary } from '../lib/roadmap.js'
import '../styles/roadmap.css'

const VIEW_KEY = 'osat.roadmap.view.v1'
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'timeline' ? 'timeline' : 'roadmap' } catch { return 'roadmap' } }

/* Where OSAT is going: docs/ROADMAP.md, built into the app, read-only. Two views of the one
   text: the Roadmap itself, and a Timeline of its Status table (phases in order, done, in
   progress or planned). Picking a phase on the Timeline opens its part of the Roadmap. */
export function RoadmapView() {
  const [view, setView] = useState(readView)
  const room = useRef(null)
  const phases = useMemo(() => roadmapPhases(roadmap), [])

  function pick(next) {
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* a convenience only */ }
    if (room.current) room.current.scrollTop = 0
  }

  function open(phase) {
    pick('roadmap')
    requestAnimationFrame(() => {
      const box = room.current
      const heading = box?.querySelector(`[id^="${phaseAnchor(phase.id)}"]`)
      if (heading) box.scrollTop += heading.getBoundingClientRect().top - box.getBoundingClientRect().top - 12
    })
  }

  return (
    <div className="roadmap-room" ref={room}>
      <div className="roadmap-views segmented" role="tablist" aria-label="Roadmap view">
        {[['roadmap', 'Roadmap'], ['timeline', 'Timeline']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => pick(id)}>{label}</button>
        ))}
      </div>
      {view === 'timeline'
        ? <Timeline phases={phases} onOpen={open} />
        : <Markdown text={roadmap} headingOffset={1} headingIds />}
    </div>
  )
}

const ICONS = { done: CheckCircle, now: CircleHalf, planned: Circle }
const WORDS = { done: 'Done', now: 'In progress', planned: 'Planned' }

/* Every phase, in order, at a glance. Nothing to drag, edit or keep up. */
function Timeline({ phases, onOpen }) {
  if (!phases.length) return <p className="timeline-empty">The roadmap has no Status table to show yet.</p>
  return (
    <section className="timeline" aria-label="Timeline">
      <p className="timeline-summary">{timelineSummary(phases)}</p>
      <ol className="timeline-strip" aria-hidden="true">
        {phases.map((phase) => <li key={phase.id} data-state={phase.state} title={`${phase.id}: ${phase.label}`}><span>{phase.id}</span></li>)}
      </ol>
      <ol className="timeline-list">
        {phases.map((phase) => {
          const Icon = ICONS[phase.state]
          return (
            <li key={phase.id} data-state={phase.state}>
              <Icon className="timeline-mark" weight={phase.state === 'planned' ? 'regular' : 'fill'} aria-label={WORDS[phase.state]} />
              <button type="button" onClick={() => onOpen(phase)}>
                <span className="timeline-phase">Phase {phase.id}</span>
                <span className="timeline-what">{phase.what}</span>
                <span className="timeline-state">{phase.label}{phase.date && !phase.label.includes(phase.date) ? ` · ${phase.date}` : ''}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
