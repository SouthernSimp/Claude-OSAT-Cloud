/* The Mac's own Calendar and Reminders, as OSAT's Calendar room shows them (Phase 14, step one).
   Pure rules only: turning what the Mac answers into OSAT's shapes, the dates to ask for,
   what merges with OSAT's own events, and the plain words for each answer. The Mac calls live
   in desktop/mac-calendar.cjs. Mac events are never copied into the workspace. */

const DAY = 86400000

const pad = (n) => String(n).padStart(2, '0')
export const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/* What the room asks the Mac for: the six weeks its month grid draws. */
export function gridRange(year, month) {
  const first = new Date(year, month, 1)
  const from = new Date(year, month, 1 - first.getDay())
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 42)
  return { from: from.toISOString(), to: to.toISOString() }
}

const STATUSES = new Set(['allowed', 'notAsked', 'denied', 'restricted', 'unavailable'])
export const accessOf = (value) => (STATUSES.has(value) ? value : 'unavailable')

/* One calm line for an access that isn't there, with the way forward. null when it is fine. */
export function accessLine(status, what = 'calendars') {
  const pane = what === 'reminders' ? 'Reminders' : 'Calendars'
  if (status === 'denied') return `OSAT can’t see your Mac’s ${what} yet. You can turn them on in System Settings → Privacy & Security → ${pane}.`
  if (status === 'restricted') return `This Mac doesn’t let apps see its ${what}. Your Mac’s administrator can change that.`
  if (status === 'unavailable') return `Your Mac’s ${what} aren’t reachable from here.`
  return null
}

const text = (value, max = 500) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))

export function macCalendars(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && text(row.id))
    .map((row) => ({
      id: text(row.id, 200),
      name: text(row.title, 120) || 'Calendar',
      source: text(row.source, 120),
      color: /^#[0-9a-f]{6}$/i.test(row.color || '') ? row.color : '',
      writable: row.writable === true,
    }))
}

/* Events in the room's own shape ({ id, title, start, end, notes }) plus what marks them as the Mac's. */
export function macEvents(rows, calendars = []) {
  const byId = new Map(calendars.map((calendar) => [calendar.id, calendar]))
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !text(row.id) || !validIso(row.start)) continue
    const calendar = byId.get(row.calendar)
    out.push({
      id: `mac:${text(row.id, 300)}`,
      title: text(row.title, 200) || 'Untitled',
      start: new Date(row.start).toISOString(),
      end: validIso(row.end) ? new Date(row.end).toISOString() : '',
      notes: text(row.notes, 2000),
      allDay: row.allDay === true,
      mac: true,
      calendarId: text(row.calendar, 200),
      calendarName: calendar?.name || '',
      color: calendar?.color || '',
    })
  }
  return out
}

/* OSAT's events and the Mac's together, by start; calendars switched off in the room are left out. */
export function mergeEvents(own, mac, hidden = []) {
  const off = new Set(hidden)
  return [...own, ...mac.filter((event) => !off.has(event.calendarId))]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (b.allDay === true) - (a.allDay === true))
}

export const macCalendarChoices = (calendars) => calendars.filter((calendar) => calendar.writable)

/* What goes to the Mac when an event is put on one of its calendars. */
export function newMacEvent({ calendar, title, start, end, notes }) {
  if (!text(calendar) || !text(title) || !validIso(start)) return null
  const from = new Date(start)
  const to = validIso(end) && Date.parse(end) > from.getTime() ? new Date(end) : new Date(from.getTime() + 3600000)
  return { calendar: text(calendar, 200), title: text(title, 200), start: from.toISOString(), end: to.toISOString(), notes: text(notes, 2000) }
}

/* ---- Reminders ---- */

export function macReminders(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && text(row.id) && text(row.title))
    .map((row) => ({
      id: text(row.id, 300),
      title: text(row.title, 300),
      due: /^\d{4}-\d{2}-\d{2}$/.test(row.due || '') ? row.due : '',
      time: /^\d{2}:\d{2}$/.test(row.time || '') ? row.time : '',
      list: text(row.list, 120),
    }))
}

/* Due soon (a week, and anything late) or with no date; dated ones first, soonest first. */
export function soonReminders(reminders, now = new Date(), days = 7, limit = 8) {
  const last = dayKey(new Date(now.getTime() + days * DAY))
  const key = (r) => (r.due ? `${r.due}T${r.time || '00:00'}` : '9999')
  return reminders
    .filter((r) => !r.due || r.due <= last)
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    .slice(0, limit)
}

const DAY_NAME = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export function dueLabel(reminder, now = new Date()) {
  if (!reminder.due) return 'No date'
  const today = dayKey(now)
  if (reminder.due < today) return 'Earlier'
  if (reminder.due === today) return reminder.time ? `Today ${reminder.time}` : 'Today'
  if (reminder.due === dayKey(new Date(now.getTime() + DAY))) return 'Tomorrow'
  return DAY_NAME.format(new Date(`${reminder.due}T12:00:00`))
}

export function newReminder({ title, due } = {}) {
  const clean = text(title, 300)
  if (!clean) return null
  return { title: clean, due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : '' }
}
