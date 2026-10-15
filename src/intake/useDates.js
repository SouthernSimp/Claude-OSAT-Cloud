import { useEffect, useRef, useState } from 'react'

import { newMacEvent } from '../../shared/mac-calendar-model.mjs'
import { addedLine, addOwnEvent, datesSettings, datesToAdd, eventFor, setDates, takeOff, withCal } from './dates.js'

/* Runs dates.js on the desk, which is always open: a new sticky that is a date goes on the calendar
   once it has been quiet for a moment, and one line says so, with Undo. The Mac calendar Nate chose
   gets it when the Mac lets OSAT write there; otherwise (or in the browser preview) OSAT's own does,
   so a date is never lost. */

const TRIED = 'osat.dates.tried.v1'
function readTried() {
  try { return new Set(JSON.parse(localStorage.getItem(TRIED) || '[]')) } catch { return new Set() }
}
function keepTried(set) {
  try { localStorage.setItem(TRIED, JSON.stringify([...set].slice(-2000))) } catch { /* only a convenience */ }
}

/* Takes a sticky's event off whichever calendar has it (Coming up's "Take off", and Undo). */
export async function takeOffCalendar(commit, noteId) {
  let mac = null
  commit((state) => { const result = takeOff(state, noteId); mac = result.mac; return result.state })
  if (mac) await window.osatMacCalendar?.removeEvent(mac).catch(() => {})
}

/* Puts one sticky's day on the calendar now (Coming up's "Put on calendar", and filing on its own). */
export async function putOnCalendar(commit, note, when, calendar) {
  const event = eventFor(note, when)
  const bridge = window.osatMacCalendar
  if (calendar !== 'osat' && bridge) {
    try {
      const made = await bridge.addEvent(newMacEvent({ calendar, ...event }))
      if (made?.id) { commit((state) => withCal(state, note.id, { id: made.id, where: 'mac', start: event.start })); return 'mac' }
    } catch { /* not allowed or not reachable: OSAT's own calendar keeps it */ }
  }
  commit((state) => addOwnEvent(state, note.id, event))
  return 'osat'
}

export function useDates({ workspace, commit, hydrated, onToast }) {
  const { on, since, calendar } = datesSettings(workspace?.settings)
  const tried = useRef(null)
  const busy = useRef(false)
  const [tick, setTick] = useState(0)
  const latest = useRef(onToast)
  latest.current = onToast

  // It counts from the first time it runs: dates written before only go on by hand, from Coming up.
  useEffect(() => {
    if (hydrated && on && !since) commit((state) => setDates(state, { since: new Date().toISOString() }))
  }, [hydrated, on, since]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hydrated || !workspace || !on || !since || busy.current) return undefined
    tried.current ??= readTried()
    const { ready, wait } = datesToAdd(workspace, { since, tried: tried.current })
    if (wait > 0) {
      const timer = setTimeout(() => setTick((n) => n + 1), wait + 50)
      return () => clearTimeout(timer)
    }
    if (ready.length) add(ready)
    return undefined
  }, [workspace, hydrated, on, since, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add(items) {
    busy.current = true
    try {
      for (const { note, when } of items) {
        tried.current.add(note.id)
        await putOnCalendar(commit, note, when, calendar)
      }
      keepTried(tried.current)
      latest.current?.(addedLine(items), () => items.forEach(({ note }) => takeOffCalendar(commit, note.id)))
    } finally {
      busy.current = false
      setTick((n) => n + 1)
    }
  }
}
