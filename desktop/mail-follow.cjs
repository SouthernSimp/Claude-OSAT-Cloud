/* To-dos from email (Phase 84): once Nate turns it on in Tools → Mail, OSAT looks at the inbox once an hour (through
   desktop/mac-mail.cjs, the Mac's own Mail app) for messages that came in since it last looked. Each one from a person
   (not a robot, a list or a bounce: `worthReading`) is read by the AI on this Mac only (`chat`, never a cloud model),
   quoted as untrusted data with no tools (`followMessages`); what it says Nate has to do becomes a To-do sticky in Just
   in (source Mail, so the AI never files it on its own), saying which email. A message is read once (`seen`). When the
   AI is asleep or busy, the message waits for the next look. Nothing is sent, moved or marked in Mail. Mail is on this
   Mac, so it works offline too. The first look goes back two days only.
   mail-follow.json in the data folder: { on, since, seen, last: { at, count, emails, ids } }.
     mail:follow (status) · mail:follow-set (on) · mail:follow-now · mail:follow-undo */
const fs = require('node:fs/promises')
const path = require('node:path')

const HOUR = 60 * 60 * 1000
const FIRST_LOOK = 2 * 24 * HOUR
const MOST_EMAILS = 8

async function createMailFollow({ dataDir, sharedModule, mail, chat, commitNotes, removeNotes, handle, fail, send = () => {}, now = () => Date.now(), timers = { setTimeout, setInterval, clearTimeout, clearInterval } }) {
  const model = await sharedModule('mail-model.mjs')
  const file = path.join(dataDir, 'mail-follow.json')
  let state = { on: false, since: 0, seen: [], last: null }
  try { state = { ...state, ...JSON.parse(await fs.readFile(file, 'utf8')) } } catch { /* none yet */ }
  let busy = false
  let problem = ''
  let first = null
  let every = null

  const save = () => fs.writeFile(file, JSON.stringify(state), { mode: 0o600 }).catch(() => {})
  const status = () => ({ on: state.on, busy, problem, last: state.last ? { at: state.last.at, count: state.last.count, emails: state.last.emails, undo: Boolean(state.last.ids?.length) } : null })
  const changed = () => send('mail:follow-changed', status())

  async function look() {
    if (busy || !state.on) return status()
    busy = true
    problem = ''
    changed()
    try {
      const from = Math.max(state.since || 0, now() - FIRST_LOOK) - HOUR
      const fresh = (await mail.list())
        .filter((row) => !state.seen.includes(row.id) && (Date.parse(row.date) || 0) >= from)
        .reverse() // oldest first, so a look cut short leaves the newest for next time
        .slice(0, MOST_EMAILS)
      const made = []
      let emails = 0
      let held = now()
      for (const row of fresh) {
        if (model.worthReading(row)) {
          let found
          try {
            const message = await mail.read(row.id)
            found = model.followStickies(model.readFollow(await chat(model.followMessages(message), model.FOLLOW_SCHEMA)), message)
          } catch (error) {
            // Asleep or busy: this one, and the newer ones, wait for the next look. A message gone from the inbox is passed.
            if (error?.message !== model.GONE) {
              console.error('To-dos from email:', String(error?.message || error).slice(0, 200))
              held = Math.min(held, Date.parse(row.date) || now())
              break
            }
            found = []
          }
          made.push(...found)
          if (found.length) emails += 1
        }
        state.seen = [...state.seen, row.id].slice(-500)
      }
      const ids = made.length ? await commitNotes(made, 'Mail') : []
      state = { ...state, since: Math.min(now(), held), last: ids.length ? { at: now(), count: ids.length, emails, ids } : state.last }
      await save()
    } catch (error) {
      problem = String(error?.message || '') || 'Mail couldn’t be read just now. OSAT looks again within the hour.'
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
    first = timers.setTimeout(look, 2 * 60 * 1000)
    every = timers.setInterval(look, HOUR)
  }
  function stop() {
    timers.clearTimeout(first)
    timers.clearInterval(every)
  }

  handle('mail:follow', () => status(), { from: 'app' })
  handle('mail:follow-set', async (on) => { state = { ...state, on: on === true }; await save(); if (state.on) look(); changed(); return status() }, { from: 'app' })
  handle('mail:follow-now', () => look(), { from: 'app' })
  handle('mail:follow-undo', () => undo(), { from: 'app' })

  return { look, status, start, stop }
}

module.exports = { createMailFollow }
