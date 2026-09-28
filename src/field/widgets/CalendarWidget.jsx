import { calendarMonthDays, localDateKey } from '../../daily-practice.js'
import { timeLabel } from '../../lib/ui.js'

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' })
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long' })

/* Calendar: the weekday, the date and the next two things planned today, beside the month
   with today ringed and busy days dotted. Opens the Calendar on today. */
export function CalendarWidget({ workspace, now, today, open }) {
  const all = workspace.calendar.events
  const todays = all.filter((event) => localDateKey(new Date(event.start)) === today)
  const next = todays
    .filter((event) => Date.parse(event.end || event.start) >= now.getTime())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const busy = new Set(all.map((event) => localDateKey(new Date(event.start))))
  const cells = calendarMonthDays(now.getFullYear(), now.getMonth())
  const weeks = Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7)).filter((week) => week.some((day) => day.inMonth))
  const weekday = WEEKDAY.format(now)
  return (
    <>
      <div className="calendar-day">
        <button type="button" className="widget-kicker widget-title" aria-label={`${weekday}. Open the calendar`} onClick={() => open('Calendar', { date: today })}>{weekday}</button>
        <strong className="widget-date">{now.getDate()}</strong>
        {next.length ? (
          <ul>
            {next.slice(0, 2).map((event) => (
              <li key={event.id}><time dateTime={event.start}>{timeLabel(event.start)}</time><span>{event.title}</span></li>
            ))}
          </ul>
        ) : <p className="widget-empty">{todays.length ? 'Nothing else today' : 'Nothing planned'}</p>}
      </div>
      <div className="calendar-month" aria-hidden="true">
        <span className="widget-kicker">{MONTH.format(now)}</span>
        <span className="mini-month">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <b key={index}>{day}</b>)}
          {weeks.flat().map((day) => (
            <i key={day.key} className={`${day.inMonth ? '' : 'is-out'} ${day.key === today ? 'is-today' : ''} ${busy.has(day.key) && day.inMonth ? 'is-busy' : ''}`}>{day.inMonth ? day.date.getDate() : ''}</i>
          ))}
        </span>
      </div>
    </>
  )
}
