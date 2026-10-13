/* The morning brief (Phase 49): each morning OSAT's AI writes Nate a short plan for the day at the
   top of today's journal page. Pure: desktop/brief.cjs reads the settings (brief.json), gathers what
   OSAT and the Mac know, runs Ask's agent with read-only tools, and commits `briefOps`.
   The brief is one block on the day page, written again in place:
     **Morning brief**
     <a few plain sentences>
     *Written for you by OSAT’s AI.*
   The last line is the marker: words Nate can read, and how the code finds the block again. */

import { normalizeNote, parseTags } from './note-core.mjs'

export const BRIEF_START = '**Morning brief**'
export const BRIEF_END = '*Written for you by OSAT’s AI.*'
export const BRIEF_WORDS = 150
export const DEFAULT_SETTINGS = { on: false, time: '07:00' }

const BLOCK = /^\*\*Morning brief\*\*[ \t]*\n[\s\S]*?^\*Written for you by OSAT’s AI\.\*[ \t]*(\n|$)/m
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

export const cleanSettings = (value = {}) => ({
  on: value?.on === true,
  time: TIME.test(value?.time) ? value.time : DEFAULT_SETTINGS.time,
})

/* The day and the time ("2026-10-08", "07:30") at `now` on a clock: this Mac's, or `timeZone`'s. */
export function localParts(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map((part) => [part.type, part.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

/* Today's brief is due once the time has come and none was written today (or on a later day:
   flying west must not bring a second one). */
export function due(now, settings, lastDate, timeZone) {
  const { on, time } = cleanSettings(settings)
  if (!on) return false
  const today = localParts(now, timeZone)
  return today.time >= time && !(DAY.test(lastDate) && lastDate >= today.day)
}

export const dayBefore = (day) => new Date(Date.parse(`${day}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
const dayLabel = (day, options) => new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))

/* OSAT's older words as Nate reads them (the tools still say node and Sky). */
const plainWords = (text) => String(text || '').replace(/\bnodes\b/g, 'topics').replace(/\bnode\b/g, 'topic').replace(/\bSky\b/g, 'canvas')
const firstLine = (note) => (note.title || note.markdown?.split('\n').find((line) => line.trim()) || '').replace(/^#+\s*/, '').trim().slice(0, 80)
const sticky = (note) => note && !note.trashedAt && !note.archived && !note.kind && note.markdown?.trim()

export const briefBlock = (markdown) => (String(markdown || '').match(BLOCK)?.[0] || '').replace(/\n$/, '')

export const withoutBrief = (markdown) => String(markdown || '').replace(BLOCK, '').replace(/^\n+/, '')

/* The Mac's own Calendar and Reminders, as mac-calendar.cjs reads them, in lines. */
export function macText({ events = [], reminders = [] } = {}, day, timeZone) {
  const at = (iso) => localParts(iso, timeZone).time
  const lines = [
    ...events.slice(0, 20).map((event) => `- ${event.allDay ? 'all day' : `${at(event.start)}–${at(event.end)}`}: ${String(event.title || 'An event').slice(0, 120)}`),
    ...reminders.slice(0, 20).map((item) => `- Reminder: ${String(item.title || 'A reminder').slice(0, 120)}${item.due && item.due < day ? ` (due ${item.due})` : item.time ? ` (today at ${item.time})` : ' (today)'}`),
  ]
  return lines.join('\n')
}

/* What the model is asked, with what OSAT already knows (so a small model needn't look it all up):
   `known` = { events, mac, topics, journal } as words, and the workspace for Unsorted and yesterday. */
export function briefMessages({ day, doc, known = {}, timeZone }) {
  const yesterday = dayBefore(day)
  const notes = (doc?.notes || []).filter(sticky)
  const newest = (a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))
  const waiting = notes.filter((note) => !note.folderId).sort(newest)
  const touched = notes.filter((note) => note.updatedAt && localParts(note.updatedAt, timeZone).day === yesterday).sort(newest)
  const sections = [
    ['Today on OSAT’s calendar', known.events],
    ['Today on the Mac’s Calendar and Reminders', known.mac],
    ['Waiting in Unsorted', waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'sticky' : 'stickies'}, the newest: ${waiting.slice(0, 5).map((note) => `“${firstLine(note)}”`).join(', ')}` : 'Nothing: Unsorted is empty.'],
    ['Stickies Nate changed yesterday', touched.slice(0, 8).map((note) => `“${firstLine(note)}”`).join(', ')],
    ['Yesterday’s journal', withoutBrief(known.journal).slice(0, 1500)],
    ['Ideas OSAT left on the canvas last night', known.ideas],
    ['The topics', plainWords(known.topics).slice(0, 1500)],
  ].filter(([, text]) => String(text || '').trim())
  return [
    { role: 'system', content: `You are OSAT’s AI, on Nate’s Mac. Each morning you write Nate a short brief for his day, at the top of his journal. Today is ${dayLabel(day, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.` },
    {
      role: 'user',
      content: `Write my morning brief for today. In this order: what’s on today (events and reminders; if nothing is, say the day is open), what waits in Unsorted, what I was working on yesterday, any ideas OSAT left on my canvas last night (in a few words; they wait for me to keep or wave away), and one gentle suggestion for the day. At most ${BRIEF_WORDS} words, in plain, warm sentences to me, like a note from a friend: no title, no headings, no lists. Use only what is known; leave out what isn’t. Say topic, never node.
What OSAT already knows is below. Look something up with a tool only if it isn’t here (a connected app’s calendar, for example).

${sections.map(([label, text]) => `[${label}]\n${String(text).trim()}`).join('\n\n')}`,
    },
  ]
}

/* The model's answer, as it goes on the page: no title it added, no headings, no stray marker, not too long. */
export function cleanBrief(text) {
  const lines = String(text || '').replace(/```[\s\S]*?```/g, '').split('\n')
    .map((line) => line.replace(/^\s*#{1,6}\s+/, '').trimEnd())
    .filter((line) => !/^\**\s*morning brief\s*:?\s*\**:?$/i.test(line.trim()) && line.trim() !== BRIEF_END)
  const plain = plainWords(lines.join('\n')).replace(/\n{3,}/g, '\n\n').trim()
  const words = plain.split(/(?<=\s)/)
  return words.length > BRIEF_WORDS + 40 ? `${words.slice(0, BRIEF_WORDS + 40).join('').trim()}…` : plain
}

/* The page with the brief on top: an earlier brief is replaced where it stands, the rest kept as it was. */
export function placeBrief(markdown, text) {
  const block = `${BRIEF_START}\n${text}\n${BRIEF_END}`
  const page = String(markdown || '')
  if (BLOCK.test(page)) return page.replace(BLOCK, (_found, end) => `${block}${end}`)
  return page ? `${block}\n\n${page}` : block
}

/* The store operations: today's page made if missing (the shape the journal tools make), else patched.
   Like the journal's own writing, a trashed or archived page comes back. */
export function briefOps(doc, text, { day, now }) {
  const id = `day-${day}`
  const page = (doc?.notes || []).find((note) => note?.id === id)
  if (!page) {
    const title = dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })
    return [{ t: 'add', c: 'notes', v: normalizeNote({ id, kind: 'day', date: day, title, markdown: placeBrief('', text), createdAt: now, updatedAt: now }), at: 0 }]
  }
  const markdown = placeBrief(page.markdown, text)
  return [{ t: 'patch', c: 'notes', id, v: { markdown, tags: parseTags(`${page.title}\n${markdown}`), trashedAt: null, archived: false, updatedAt: now } }]
}
