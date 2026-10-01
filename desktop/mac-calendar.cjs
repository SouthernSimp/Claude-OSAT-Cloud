/* Your Mac's own Calendar and Reminders (Phase 14, step one). EventKit, the Mac's calendar
   engine, is reached through `osascript -l JavaScript`, the way mac-files.cjs reaches PDFKit and
   Vision. Nothing is read until Nate presses "Show my Mac's calendars" (macOS asks once); a status
   check never asks. Events and reminders are answered as they are on the Mac and never copied
   into the workspace; a write goes to the Mac's own store, which syncs wherever that calendar does.
   The renderer's side (shapes, merging, words) is shared/mac-calendar-model.mjs. */
const { execFile } = require('node:child_process')

const NOT_ASKED = 'Your Mac hasn’t been asked yet. Press “Show my Mac’s calendars” first.'
const COULD_NOT = 'Your Mac’s calendars couldn’t be reached just now.'

/* One script, one command per run: argv[0] is the command, argv[1] its JSON. It always prints one
   JSON line: the answer, or { error }. Statuses: 0 not asked, 1 restricted, 2 denied, 3 allowed
   (full access; on macOS 14 and later "write only" is 4, which can't read, so it counts as denied). */
const SCRIPT = `ObjC.import("EventKit"); ObjC.import("Foundation"); ObjC.import("AppKit")
const store = $.EKEventStore.alloc.init
const NAMES = { 0: "notAsked", 1: "restricted", 2: "denied", 3: "allowed", 4: "denied" }
const KINDS = { events: 0, reminders: 1 }
const str = (x) => (x === null || x === undefined || (x.isNil && x.isNil()) ? "" : String(ObjC.unwrap(x)))
const status = (kind) => NAMES[$.EKEventStore.authorizationStatusForEntityType(KINDS[kind])] || "unavailable"
const spin = (done, seconds) => {
  const end = Date.now() + seconds * 1000
  while (!done() && Date.now() < end) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05))
}
const when = (iso) => $.NSDate.dateWithTimeIntervalSince1970(new Date(iso).getTime() / 1000)
const iso = (d) => new Date(d.timeIntervalSince1970 * 1000).toISOString()
const hex = (c) => {
  try {
    const rgb = c.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace)
    const h = (v) => ("0" + Math.round(v * 255).toString(16)).slice(-2)
    return "#" + h(rgb.redComponent) + h(rgb.greenComponent) + h(rgb.blueComponent)
  } catch (e) { return "" }
}
const each = (list, fn) => { const out = []; if (list && !(list.isNil && list.isNil())) for (let i = 0; i < list.count; i++) out.push(fn(list.objectAtIndex(i))); return out }

function allow(kind) {
  if (status(kind) !== "notAsked") return status(kind)
  let answered = false
  const ask = (done) => {
    try { kind === "events" ? store.requestFullAccessToEventsWithCompletion(done) : store.requestFullAccessToRemindersWithCompletion(done) }
    catch (e) { store.requestAccessToEntityTypeCompletion(KINDS[kind], done) }
  }
  ask(() => { answered = true })
  spin(() => answered, 110)
  return status(kind)
}

function calendars() {
  return each(store.calendarsForEntityType(0), (c) => ({
    id: str(c.calendarIdentifier), title: str(c.title), source: str(c.source.title), color: hex(c.color), writable: c.allowsContentModifications === true,
  }))
}

function run(argv) {
  try {
    const cmd = argv[0]
    const a = JSON.parse(argv[1] || "{}")
    if (cmd === "status") return JSON.stringify({ events: status("events"), reminders: status("reminders") })
    if (cmd === "allow") return JSON.stringify({ status: allow(a.kind) })
    const kind = /reminder/.test(cmd) ? "reminders" : "events"
    if (status(kind) !== "allowed") return JSON.stringify({ error: "notAllowed" })
    if (cmd === "calendars") return JSON.stringify(calendars())
    if (cmd === "events") {
      const found = store.eventsMatchingPredicate(store.predicateForEventsWithStartDateEndDateCalendars(when(a.from), when(a.to), null))
      return JSON.stringify(each(found, (e) => ({
        id: str(e.eventIdentifier), title: str(e.title), start: iso(e.startDate), end: iso(e.endDate), allDay: e.isAllDay === true,
        notes: str(e.notes), calendar: str(e.calendar.calendarIdentifier),
      })).slice(0, 2000))
    }
    if (cmd === "add-event") {
      const cal = store.calendarWithIdentifier(a.calendar)
      if (!cal || cal.isNil() || cal.allowsContentModifications !== true) return JSON.stringify({ error: "notWritable" })
      const e = $.EKEvent.eventWithEventStore(store)
      e.title = a.title; e.startDate = when(a.start); e.endDate = when(a.end); e.notes = a.notes || ""; e.calendar = cal
      if (!store.saveEventSpanCommitError(e, 0, true, null)) return JSON.stringify({ error: "notSaved" })
      return JSON.stringify({ id: str(e.eventIdentifier) })
    }
    if (cmd === "remove-event") {
      const e = store.eventWithIdentifier(a.id)
      if (e && !e.isNil() && !store.removeEventSpanCommitError(e, 0, true, null)) return JSON.stringify({ error: "notSaved" })
      return JSON.stringify({ ok: true })
    }
    if (cmd === "reminders") {
      let got = null, ready = false
      store.fetchRemindersMatchingPredicateCompletion(store.predicateForIncompleteRemindersWithDueDateStartingEndingCalendars(null, null, null), (list) => { got = list; ready = true })
      spin(() => ready, 25)
      if (!ready) return JSON.stringify({ error: "slow" })
      return JSON.stringify(each(got, (r) => {
        const d = r.dueDateComponents
        const has = d && !d.isNil() && d.year < 100000 && d.month < 100 && d.day < 100
        const pad = (n) => ("0" + n).slice(-2)
        return {
          id: str(r.calendarItemIdentifier), title: str(r.title), list: str(r.calendar.title),
          due: has ? d.year + "-" + pad(d.month) + "-" + pad(d.day) : "", time: has && d.hour < 100 ? pad(d.hour) + ":" + pad(d.minute) : "",
        }
      }).slice(0, 300))
    }
    if (cmd === "add-reminder") {
      const r = $.EKReminder.reminderWithEventStore(store)
      r.title = a.title
      r.calendar = store.defaultCalendarForNewReminders
      if (a.due) {
        const d = $.NSDateComponents.alloc.init
        const p = a.due.split("-")
        d.year = +p[0]; d.month = +p[1]; d.day = +p[2]
        r.dueDateComponents = d
      }
      if (!store.saveReminderCommitError(r, true, null)) return JSON.stringify({ error: "notSaved" })
      return JSON.stringify({ id: str(r.calendarItemIdentifier) })
    }
    if (cmd === "set-reminder-done" || cmd === "remove-reminder") {
      const r = store.calendarItemWithIdentifier(a.id)
      if (!r || r.isNil()) return JSON.stringify({ error: "gone" })
      if (cmd === "remove-reminder") { if (!store.removeReminderCommitError(r, true, null)) return JSON.stringify({ error: "notSaved" }) }
      else { r.completed = a.done === true; if (!store.saveReminderCommitError(r, true, null)) return JSON.stringify({ error: "notSaved" }) }
      return JSON.stringify({ ok: true })
    }
    return JSON.stringify({ error: "unknown" })
  } catch (e) {
    return JSON.stringify({ error: String(e) })
  }
}`

function osascript(command, args, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT, command, JSON.stringify(args)], { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))))
  })
}

const isoOk = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const word = (value, max = 300) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null)

/* `run` is passed in so tests can answer as the Mac would. Off the Mac nothing is asked. */
function createMacCalendar({ handle, fail, run = osascript, platform = process.platform }) {
  async function ask(command, args = {}, options) {
    let answer
    try {
      answer = JSON.parse(await run(command, args, options))
    } catch (error) {
      console.error(`Mac calendar (${command}) failed:`, error.message)
      fail(COULD_NOT)
    }
    if (answer && answer.error === 'notAllowed') fail(NOT_ASKED)
    if (answer && answer.error) fail(COULD_NOT)
    return answer
  }

  const kindOf = (kind) => (kind === 'reminders' ? 'reminders' : 'events')
  const need = (value) => value ?? fail('That doesn’t look right. Nothing was changed.')

  handle('maccal:status', async () => {
    if (platform !== 'darwin') return { events: 'unavailable', reminders: 'unavailable' }
    try {
      return await ask('status')
    } catch {
      return { events: 'unavailable', reminders: 'unavailable' }
    }
  })
  handle('maccal:allow', async (kind) => (await ask('allow', { kind: kindOf(kind) }, { timeout: 130000 })).status)
  handle('maccal:calendars', () => ask('calendars'))
  handle('maccal:events', async (range) => {
    need(range && isoOk(range.from) && isoOk(range.to) && Date.parse(range.to) - Date.parse(range.from) < 120 * 86400000 ? true : null)
    return ask('events', { from: range.from, to: range.to })
  })
  handle('maccal:add-event', async (event) => {
    need(event && word(event.calendar, 200) && word(event.title, 200) && isoOk(event.start) && isoOk(event.end) ? true : null)
    return ask('add-event', { calendar: event.calendar, title: event.title.trim(), start: event.start, end: event.end, notes: typeof event.notes === 'string' ? event.notes.slice(0, 2000) : '' })
  })
  handle('maccal:remove-event', async (id) => ask('remove-event', { id: need(word(id, 300)) }))
  handle('maccal:reminders', () => ask('reminders', {}, { timeout: 40000 }))
  handle('maccal:add-reminder', async (reminder) => {
    const title = need(word(reminder && reminder.title))
    const due = reminder.due && /^\d{4}-\d{2}-\d{2}$/.test(reminder.due) ? reminder.due : ''
    return ask('add-reminder', { title, due })
  })
  handle('maccal:remove-reminder', async (id) => ask('remove-reminder', { id: need(word(id, 300)) }))
  handle('maccal:reminder-done', async (id, done) => ask('set-reminder-done', { id: need(word(id, 300)), done: done === true }))
}

module.exports = { SCRIPT, createMacCalendar }
