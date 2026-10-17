/* To-dos from Granola (Phase 74): when Granola is connected (Settings → Connections, its own MCP server, signed in in the
   browser), OSAT looks once an hour while online for meetings that have notes since it last looked, reads each one's
   Next steps (shared/meeting-model.mjs: granolaMeetings, granolaMeeting, granolaSteps) and puts each step in Just in
   as a To-do sticky (source Granola), with a link back to the meeting. A meeting is read once (`seen`); one without
   notes yet is read again next time. The first look goes back a week only, so an old history doesn't flood Just in.
   Nothing is written to Granola, and nothing is read while OSAT is offline.
   granola.json in the data folder: { on, since, seen, last: { at, count, meetings, ids } }.
     meeting:granola (status) · meeting:granola-set (on) · meeting:granola-now · meeting:granola-undo */
const fs = require('node:fs/promises')
const path = require('node:path')

const HOUR = 60 * 60 * 1000
const FIRST_LOOK = 7 * 24 * HOUR
const MOST_MEETINGS = 10
const NO_ANSWER = 'Granola didn’t answer just now. OSAT looks again within the hour.'

// Granola reads a day as a date where you are.
const localDay = (ms) => { const day = new Date(ms); return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}` }

async function createGranola({ dataDir, sharedModule, apps, commitNotes, removeNotes, offline = () => false, handle, fail, send = () => {}, now = () => Date.now(), timers = { setTimeout, setInterval, clearTimeout, clearInterval } }) {
  const model = await sharedModule('meeting-model.mjs')
  const file = path.join(dataDir, 'granola.json')
  let state = { on: true, since: 0, seen: [], last: null }
  try { state = { ...state, ...JSON.parse(await fs.readFile(file, 'utf8')) } } catch { /* none yet */ }
  let busy = false
  let problem = ''
  let connected = null // unknown until the first look
  let first = null
  let every = null

  const save = () => fs.writeFile(file, JSON.stringify(state), { mode: 0o600 }).catch(() => {})
  const status = () => ({ on: state.on, connected, busy, problem, last: state.last ? { at: state.last.at, count: state.last.count, meetings: state.last.meetings, undo: Boolean(state.last.ids?.length) } : null })
  const changed = () => send('meeting:granola-changed', status())
  // An app's answer is text; Granola saying no is an error like any other.
  const ask = async (app, tool, args) => {
    const answer = await apps.call(app, tool, args)
    if (answer?.isError) throw new Error(String(answer.text || 'Granola said no.'))
    return String(answer?.text || '')
  }

  /* Granola, when it is connected and on: the app whose tools read meetings. */
  async function granola() {
    const tools = await apps.tools()
    const list = tools.find((tool) => tool.name === 'list_meetings' && /granola/i.test(tool.appName))
    return list && tools.some((tool) => tool.name === 'get_meetings' && tool.app === list.app) ? list.app : null
  }

  async function look() {
    if (busy || !state.on || offline()) return status()
    busy = true
    problem = ''
    changed()
    try {
      const app = await granola()
      connected = Boolean(app)
      if (!app) return status()
      // An hour of overlap; the meetings already read are known by their ids.
      const from = Math.max(state.since || 0, now() - FIRST_LOOK) - HOUR
      const listed = model.granolaMeetings(await ask(app, 'list_meetings', { time_range: 'custom', custom_start: localDay(from), custom_end: localDay(now()), involvement: { captured_by_me: true } }))
      const fresh = listed.filter((meeting) => !state.seen.includes(meeting.id) && (Date.parse(meeting.at) || now()) >= from).slice(0, MOST_MEETINGS)
      const made = []
      let meetings = 0
      for (const meeting of fresh) {
        const one = model.granolaMeeting(await ask(app, 'get_meetings', { meeting_ids: [meeting.id] }), meeting.id)
        if (!one?.summary) continue // no notes yet: next time
        const link = one.url ? `From Granola: [${one.title}](${one.url})` : `From Granola: ${one.title}`
        const steps = model.followUps(model.granolaSteps(one.summary), { from: link, me: one.creator ? [one.creator] : [] })
        // Written on the meeting's day, so "tomorrow" in a step means the day after the meeting.
        made.push(...steps.map((step) => ({ ...step, createdAt: one.at })))
        if (steps.length) meetings += 1
        state.seen = [...state.seen, meeting.id].slice(-500)
      }
      const ids = made.length ? await commitNotes(made, 'Granola') : []
      state = { ...state, since: now(), last: ids.length ? { at: now(), count: ids.length, meetings, ids } : state.last }
      await save()
    } catch (error) {
      console.error('Granola:', error?.message || error)
      problem = NO_ANSWER
    } finally {
      busy = false
      changed()
    }
    return status()
  }

  /* Takes the last look's to-dos back (to the Bin, where Notes can bring them back). */
  async function undo() {
    if (!state.last?.ids?.length) fail('There is nothing to take back.')
    await removeNotes(state.last.ids)
    state = { ...state, last: { ...state.last, count: 0, ids: [] } }
    await save()
    changed()
    return status()
  }

  function start() {
    first = timers.setTimeout(look, 60 * 1000)
    every = timers.setInterval(look, HOUR)
  }
  function stop() {
    timers.clearTimeout(first)
    timers.clearInterval(every)
  }

  handle('meeting:granola', () => status(), { from: 'app' })
  handle('meeting:granola-set', async (on) => { state = { ...state, on: on === true }; await save(); if (state.on) look(); changed(); return status() }, { from: 'app' })
  handle('meeting:granola-now', async () => (offline() ? fail('Granola waits until you’re back online.') : look()), { from: 'app' })
  handle('meeting:granola-undo', () => undo(), { from: 'app' })

  return { look, status, start, stop }
}

module.exports = { createGranola, localDay }
