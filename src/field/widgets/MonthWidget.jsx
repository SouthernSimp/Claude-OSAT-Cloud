import { calendarMonthDays, localDateKey } from '../../daily-practice.js'

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long' })

/* The month at a glance: today ringed, busy days dotted. */
export function MonthWidget({ now, today, events, onOpen, move }) {
  const busy = new Set(events.map((event) => localDateKey(new Date(event.start))))
  const cells = calendarMonthDays(now.getFullYear(), now.getMonth())
  const weeks = Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7)).filter((week) => week.some((day) => day.inMonth))
  return (
    <button type="button" className="glass widget widget-month" aria-label={`${MONTH.format(now)}. Open the calendar`} onClick={onOpen} {...move}>
      <span className="widget-kicker">{MONTH.format(now)}</span>
      <span className="mini-month" aria-hidden="true">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <b key={index}>{day}</b>)}
        {weeks.flat().map((day) => (
          <i key={day.key} className={`${day.inMonth ? '' : 'is-out'} ${day.key === today ? 'is-today' : ''} ${busy.has(day.key) && day.inMonth ? 'is-busy' : ''}`}>{day.inMonth ? day.date.getDate() : ''}</i>
        ))}
      </span>
    </button>
  )
}
