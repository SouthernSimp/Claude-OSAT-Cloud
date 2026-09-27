import { Plus } from '@phosphor-icons/react'

import { timeLabel } from '../../lib/ui.js'

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' })

/* Today: the weekday, the date, and the next two things planned. */
export function DayWidget({ now, events, onOpen, move }) {
  return (
    <section className="glass widget widget-day" aria-label="Today" {...move}>
      <p className="widget-kicker">{WEEKDAY.format(now)}</p>
      <strong className="widget-date">{now.getDate()}</strong>
      <div className="widget-day-foot">
        {events.length ? (
          <ul>
            {events.slice(0, 2).map((event) => (
              <li key={event.id}><time dateTime={event.start}>{timeLabel(event.start)}</time><span>{event.title}</span></li>
            ))}
          </ul>
        ) : <p className="widget-empty">Nothing planned</p>}
        <button type="button" aria-label="Open today in Calendar" title="Open today in Calendar" onClick={onOpen}><Plus weight="bold" /></button>
      </div>
    </section>
  )
}
