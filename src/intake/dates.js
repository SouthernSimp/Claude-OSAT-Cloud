/* Dates go on the calendar (Phase 67). A sticky that is a date (shared/what-model.mjs), written since
   this first ran, goes on Nate's calendar on its own once it has been quiet for a moment: on the
   Mac calendar he chose (which passes it on to Google, Outlook or iCloud), else on OSAT's own.
   One line says so, with Undo; Coming up can take it off and put it back. One taken off is never
   put back on its own. Pure: useDates.js runs it. */

import { whatOf, whenOf } from '../../shared/what-model.mjs'
import { isActiveNote, uid } from '../notes-model.js'
import { QUIET_MS } from '../sky/auto-file.js'

/* `settings.dates`: on unless turned off; `since` is when it first ran (stickies from before only go
   on by hand); `calendar` is a Mac calendar's id, 'osat' for OSAT's own, or (unless chosen, Phase 103) 'default':
   the Mac's own default calendar, so a new person's dates reach iCloud or Google without a setting. Until the Mac
   is allowed, 'default' lands on OSAT's own (putOnCalendar). */
export function datesSettings(settings) {
  const own = settings?.dates || {}
  return {
    on: own.on !== false,
    since: typeof own.since === 'string' ? own.since : null,
    calendar: typeof own.calendar === 'string' && own.calendar ? own.calendar : 'default',
  }
}

export const setDates = (state, patch) => ({ ...state, settings: { ...(state.settings || {}), dates: { ...(state.settings?.dates || {}), ...patch } } })

/* Still ahead: a time later than now, or a day with no time that is today or later. */
export function ahead(when, now = Date.now()) {
  if (when.time) return when.start.getTime() > now
  const today = new Date(now)
  return when.start.getTime() >= new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
}

/* The date stickies written since `since` that aren't on a calendar yet: { ready: [{ note, when }],
   wait } — `ready` once each has been quiet for QUIET_MS (never mid-sentence), else `wait` ms until one is. */
export function datesToAdd(state, { since, now = Date.now(), tried = new Set() }) {
  const from = Date.parse(since)
  if (!Number.isFinite(from)) return { ready: [], wait: 0 }
  const pending = state.notes
    .filter((note) => isActiveNote(note) && !note.doneAt && !note.cal && !tried.has(note.id) && (Date.parse(note.createdAt) || 0) >= from && whatOf(note) === 'date')
    .flatMap((note) => {
      const when = whenOf(note)
      return when && ahead(when, now) ? [{ note, when }] : []
    })
  const quietAt = ({ note }) => Math.max(Date.parse(note.createdAt) || 0, Date.parse(note.updatedAt) || 0) + QUIET_MS
  const ready = pending.filter((item) => quietAt(item) <= now)
  return { ready, wait: ready.length || !pending.length ? 0 : Math.min(...pending.map(quietAt)) - now }
}

/* The event a sticky's day becomes: an hour at its time; with no time, half an hour at 9 in the
   morning (ponytail: the Mac bridge makes no all-day events; add `allDay` to it when one is wanted). */
export function eventFor(note, when) {
  const end = new Date(when.start.getTime() + (when.time ? 3600000 : 1800000))
  return { title: when.title, start: when.start.toISOString(), end: end.toISOString(), notes: `From a sticky in OSAT:\n${note.markdown}`.slice(0, 1000) }
}

/* The sticky remembers its event (`cal`); its words and dates don't change. */
export function withCal(state, noteId, cal) {
  return { ...state, notes: state.notes.map((note) => (note.id === noteId ? { ...note, cal } : note)) }
}

/* On OSAT's own calendar (the Calendar room). */
export function addOwnEvent(state, noteId, event) {
  const id = uid('event')
  const events = [...state.calendar.events, { id, ...event }].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return withCal({ ...state, calendar: { ...state.calendar, events } }, noteId, { id, where: 'osat', start: event.start })
}

/* Taken off: OSAT's own event goes; a Mac one is the caller's to remove (its id is returned as `mac`).
   The sticky remembers it was taken off. */
export function takeOff(state, noteId) {
  const cal = state.notes.find((note) => note.id === noteId)?.cal
  if (!cal || cal.off) return { state, mac: null }
  const events = cal.where === 'osat' ? state.calendar.events.filter((event) => event.id !== cal.id) : state.calendar.events
  return { state: withCal({ ...state, calendar: { ...state.calendar, events } }, noteId, { off: true }), mac: cal.where === 'mac' ? cal.id : null }
}

/* "Thu, Oct 15, 2:00 PM", or "Sun, Nov 1" with no time. */
export function whenLine(when) {
  const day = when.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return when.time ? `${day}, ${when.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : day
}

/* One calm line for a run. */
export function addedLine(items) {
  if (items.length === 1) return `Put “${items[0].when.title}” on your calendar · ${whenLine(items[0].when)}`
  return `Put ${items.length} dates on your calendar`
}
