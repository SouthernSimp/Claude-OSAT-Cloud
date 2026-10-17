/* What the AI knows about OSAT. Every question carries a short map of the workspace (the
   boards and branches, what waits in Just in, the open board, to-dos, what is coming up
   on the Calendar) and a few lines on how OSAT works, so it can talk about the person's own
   things in OSAT's own words. The map is words only and stays small: the built-in model reads
   about 8,000 tokens in all, and the notes a question matches come on top of it. Pure. */

import { localDateKey } from '../daily-practice.js'
import { nextSteps } from '../next-steps.js'
import { folderChildren, folderPath, isActiveNote } from '../notes-model.js'
import { boardsOf, JUST_IN, stickiesOn } from '../boards/boards-model.js'
import { pileOf } from '../nodes-model.js'
import { linksOf, recordOf } from '../links-model.js'
import { roadmapPhases } from '../lib/roadmap.js'
import { openTodos } from '../today/today-model.js'

/* How OSAT works, as the AI should say it. */
export const OSAT_GUIDE = `You live inside OSAT, the person's private notes app on their Mac.

How OSAT works, in its own words: OSAT is one window with a sidebar. A sticky is one thought (a note). Whatever they write in the bar at the top (or the quick bar, ⌥⇧Space, from any app) lands in Just in, and OSAT works out what it is (an idea, a question, a problem, a to-do, a date, something to buy, a note) and which board it goes on, with Undo for every move. A board is a part of their work or life, like a client, a project or home; it shows its stickies as a Map (a column for each kind), a Board (Later, Next, Doing, Done) or a List. Branches inside a board group its stickies. A line drawn between two stickies is a connection: it only says they relate, and never files or moves either one. Today (⌘1) is the first screen: their to-dos, today's calendar, what waits in Just in, their goals, their habits and the month's money. The sidebar's tiles are Today, Just in (⌘2), Calendar (⌘3) and To do (⌘4); then the boards; then Business (Meetings, Mail), Life (Habits, Goals, Money, Journal), Library (Notes ⌘5, Files ⌘6) and the power tools (Web, Terminal, GitHub, Passwords, the Roadmap). Ask is the panel on the right (the Ask button, or ⌘Return in the bar). Questions, To buy and Coming up are lists OSAT keeps for them. Also on this Mac: the quick bar finds files, what they copied, apps and notes, asks the AI or saves a sticky (⌥Return), and the ring puts quick tools around the pointer; Settings holds their shortcuts.
Use those words (sticky, board, branch, Just in), never "folder", "inbox" or "record" for their notes.
You read text only. For a picture or a scan you get the words in it, not how it looks; if asked about something you cannot see, say so.
When part of your answer comes from something they wrote (it arrives labelled STICKY, SCAN or JOURNAL, with where it lives), say so in plain words, like “in your sticky Call mom” or “in your scan Lease”. Copied items and files arrive as COPIED ITEM or FILE with a number; say so too, like “in something you copied on Oct 5” or “in your file lease.pdf”. Only say what is in what you were given; if it isn't there, say you don't see it.
Just in shows stickies waiting for a home and suggested boards; the person chooses a board to move one, with Undo. To do (⌘4) lists open to-dos by board; tick one off there or on Today, with Undo. Meetings makes a to-do for each promised next step; connected Granola meetings bring their Next steps in too, linked to the meeting.
Only say you changed something after a tool confirms it. When tools are available, OSAT changes have Undo and changes to another app wait for Allow. Otherwise, offer the action buttons described below or explain how the person can do it.`

const one = (value, max) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
const stickies = (count) => `${count} ${count === 1 ? 'sticky' : 'stickies'}`
const stickyLine = (note) => `- ${one(note.title || note.markdown, 90) || 'A sticky'}`

/* `lines` cut to `room` characters at a line boundary, the last line saying how many were
   left out (`noun`). */
function fit(lines, room, noun) {
  const out = []
  let used = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (used + lines[index].length + 1 > room) {
      const omitted = () => `…and ${lines.length - out.length} more ${noun}`
      while (out.length && used + omitted().length > room) used -= out.pop().length + 1
      if (used + omitted().length <= room) out.push(omitted())
      break
    }
    out.push(lines[index])
    used += lines[index].length + 1
  }
  return out
}

/* One line a board: how much is in it, then its branches with theirs. */
function boardLines(state, list) {
  return list.map(({ folder, count }) => {
    const branches = folderChildren(state.folders, folder.id)
    const loose = pileOf(state.notes, folder.id).length
    const head = `- ${folder.name} (${stickies(count)})`
    if (!branches.length) return head
    const inside = branches.map((branch) => `${branch.name} (${stickiesOn(state, branch.id).length})`).join(', ')
    return `${head}, branches: ${inside}${loose ? `; ${stickies(loose)} in no branch yet` : ''}`
  })
}

/* The open boards' stickies, branch by branch. */
function openLines(state, ids, room, allowedNotes = null) {
  const out = []
  for (const node of ids.map((id) => state.folders.find((folder) => folder.id === id)).filter(Boolean)) {
    out.push(`Open board: ${node.name}`)
    const walk = (folder, label) => {
      const own = pileOf(state.notes, folder.id).filter((note) => !allowedNotes || allowedNotes.has(note.id))
      if (own.length) out.push(...(label ? [`  ${label}:`] : []), ...own.slice(0, 12).map((note) => `  ${stickyLine(note)}`))
      folderChildren(state.folders, folder.id).forEach((branch) => walk(branch, label ? `${label} / ${branch.name}` : branch.name))
    }
    walk(node, '')
  }
  return fit(out, room, 'lines')
}

const WHEN = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/* The map: everything the AI may look at, most useful first, in at most `maxChars`.
   `open` holds board ids; the saved `where: 'sky'` still means the boards screen. */
export function boardMap(state, { open = [], focus = null, noteIds = null, scope = 'workspace', where = 'app', maxChars = 3200, now = new Date() } = {}) {
  const parts = [where === 'sky' ? 'THEIR OSAT (they are looking at their boards right now)' : 'THEIR OSAT']
  const room = () => maxChars - parts.join('\n\n').length - 2
  const add = (title, lines, noun = 'lines', limit = Infinity) => {
    if (lines.length && room() > title.length + 30) parts.push([title, ...fit(lines, Math.min(limit, room() - title.length - 1), noun)].join('\n'))
  }
  if (scope === 'none') return `${parts[0]}\nNo workspace notes are shared for this question.`.slice(0, maxChars)
  const shared = state.notes.filter((note) => isActiveNote(note) && noteIds?.includes(note.id))
  add('Selected stickies (the question is about these):', shared.map((note) => `${stickyLine(note)}${note.folderId ? ` [${folderPath(state.folders, note.folderId).join(' / ')}]` : ''}`), 'stickies', 900)
  const viewing = focus ? [focus] : open.filter((id) => !state.folders.find((folder) => folder.id === id)?.parentId)
  if (viewing.length) {
    const lines = openLines(state, viewing, Math.min(1600, room() - 40), noteIds ? new Set(noteIds) : null)
    if (lines.length) parts.push(lines.join('\n'))
  }
  if (scope === 'focus') return parts.join('\n\n').slice(0, maxChars)

  const todos = openTodos(state, now)
  add(`To do (${todos.length} open; Doing, then Next, then soonest):`, todos.map(({ note, board }) => `${stickyLine(note)} [${board || 'Just in'}]`), 'to-dos', 650)

  const today = localDateKey(now)
  const steps = nextSteps(state.notes.filter((note) => note.kind === 'day' && note.date === today && !note.trashedAt)).filter((step) => !step.done)
  add("Today's journal checklist:", steps.slice(0, 5).map((step) => `- ${one(step.text, 90)}`))

  const soon = (state.calendar?.events || [])
    .map((event) => ({ event, at: Date.parse(event.start) }))
    .filter(({ at }) => at >= now.getTime() - 3_600_000 && at <= now.getTime() + 8 * 86_400_000)
    .sort((a, b) => a.at - b.at)
  add('Coming up on the Calendar (next 8 days):', soon.slice(0, 5).map(({ event, at }) => `- ${WHEN.format(new Date(at))}: ${one(event.title, 80)}`))

  const boards = boardsOf(state)
  add(`Boards (${boards.length}):`, boardLines(state, boards), 'boards', 650)
  if (!boards.length) parts.push('They have no boards yet.')
  // Lines between things: only that they relate, by name.
  const name = (key) => one(recordOf(state, key)?.title || recordOf(state, key)?.name, 40)
  add('Connected (a line between two things; nothing was filed by it):', linksOf(state).slice(0, 12).map((link) => `- ${name(link.a)} — ${name(link.b)}`), 'connections')
  const waiting = stickiesOn(state, JUST_IN)
  add(`Just in (${stickies(waiting.length)}, waiting for a board):`, waiting.map(stickyLine), 'stickies', 450)
  if (!waiting.length) parts.push('Nothing is waiting in Just in.')
  return parts.join('\n\n').slice(0, maxChars)
}

/* The plan, one line a phase: the roadmap's Status table, for a question about OSAT itself. */
export function planLines(markdown) {
  const words = { done: 'done', now: 'in progress', planned: 'planned' }
  const phases = roadmapPhases(markdown)
  if (!phases.length) return ''
  return `THE PLAN FOR OSAT (its roadmap: Tools → Roadmap, and its Timeline tab)\n${phases.map((phase) => `- Phase ${phase.id}: ${one(phase.what, 110)} (${words[phase.state]})`).join('\n')}`
}

/* Only a question about OSAT itself gets the plan; the rest of the time it would fill the room. */
const ABOUT_PLAN = /\b(roadmap|road map|timeline|phases?|planned|are we (?:working on|building|making)|is (?:it|that|this) (?:planned|coming)|what(?:'s| is) next for osat|osat(?:'s)? plan)\b/i
export const asksAboutPlan = (question) => ABOUT_PLAN.test(String(question || ''))
