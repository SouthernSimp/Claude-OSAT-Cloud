/* What the AI knows about OSAT. Every question carries a short map of the workspace (the
   nodes and branches, what waits in Unsorted, what is open in the Sky, Next, what is coming up
   on the Calendar) and a few lines on how OSAT works, so it can talk about the person's own
   things in OSAT's own words. The map is words only and stays small: the built-in model reads
   about 8,000 tokens in all, and the notes a question matches come on top of it. Pure. */

import { localDateKey } from '../daily-practice.js'
import { nextSteps } from '../next-steps.js'
import { folderChildren, folderPath, isActiveNote, isBranch } from '../notes-model.js'
import { nodesOf, pileOf, stickiesIn } from '../nodes-model.js'
import { linksOf, recordOf } from '../links-model.js'
import { roadmapPhases } from '../lib/roadmap.js'

/* How OSAT works, as the AI should say it. */
export const OSAT_GUIDE = `You live inside OSAT, the person's private notes app on their Mac.

How OSAT works, in its own words: a sticky is one thought (a note). A node is a topic, like a trip, a project or a person. Branches group stickies and can hold smaller branches. A branch can also sit on the Sky on its own, in no node yet, until it is given a home. Stickies can be placed freely on the Sky by double-clicking it or pressing New sticky; other captures wait in Unsorted. A sticky on the canvas is still in no node and is available to Sort Unsorted. Nodes are optional: putting a sticky on the canvas never creates one. The desk is where they write, with one line at the bottom to write, find or ask. The Sky is a mind map above the desk (⌘3): click a node and its branches and stickies spread out around it, joined by lines; double-click a node to focus on just it. A line drawn between two things (they drag the dot on a card) is a connection: it only says they relate, and never files or moves either one. On the desk, dropping a sticky on another makes a stack, a column that only arranges the desk; the stickies keep their homes. Also on this Mac: quick search (⌘⇧Space) finds files, what they copied, apps and notes, and the ring puts quick tools around the pointer; Settings holds their shortcuts. Other rooms: Notes (⌘2), Ask (⌘4), Files (⌘5), and under Tools: Journal, Calendar, Habits, Money, Sort a pile, Browser, Terminal and the Roadmap (the plan for OSAT, with a Timeline).
Use those words (sticky, node, branch, Unsorted), never "folder", "inbox" or "record" for their notes.
You read text only. For a picture or a scan you get the words in it, not how it looks; if asked about something you cannot see, say so.
You can suggest, but you never move or change anything yourself: say where something could go and the person does it. In the Sky, "Sort Unsorted" suggests a home for every sticky in Unsorted, with one click to accept.`

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

/* One line a node: how much is in it, then its branches with theirs. */
function nodeLines(state, list) {
  return list.map(({ folder }) => {
    const branches = folderChildren(state.folders, folder.id)
    const loose = pileOf(state.notes, folder.id).length
    const head = `- ${folder.name} (${stickies(stickiesIn(state, folder.id).length)})`
    if (!branches.length) return head
    const inside = branches.map((branch) => `${branch.name} (${stickiesIn(state, branch.id).length})`).join(', ')
    return `${head}, branches: ${inside}${loose ? `; ${stickies(loose)} in no branch yet` : ''}`
  })
}

/* What is open in the Sky: each open node's stickies, branch by branch. */
function openLines(state, ids, room) {
  const out = []
  for (const node of ids.map((id) => state.folders.find((folder) => folder.id === id)).filter(Boolean)) {
    out.push(`Open in the Sky: ${node.name}`)
    const walk = (folder, label) => {
      const own = pileOf(state.notes, folder.id)
      if (own.length) out.push(...(label ? [`  ${label}:`] : []), ...own.slice(0, 12).map((note) => `  ${stickyLine(note)}`))
      folderChildren(state.folders, folder.id).forEach((branch) => walk(branch, label ? `${label} / ${branch.name}` : branch.name))
    }
    walk(node, '')
  }
  return fit(out, room, 'lines')
}

const WHEN = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/* The map: everything the AI may look at, most useful first, in at most `maxChars`.
   `open` is the ids of the nodes open in the Sky; `where: 'sky'` says they are up there. */
export function boardMap(state, { open = [], focus = null, noteIds = [], scope = 'workspace', where = 'desk', maxChars = 3200, now = new Date(), stacks = [] } = {}) {
  const parts = [where === 'sky' ? 'THEIR OSAT (they are looking at the Sky right now)' : 'THEIR OSAT']
  const room = () => maxChars - parts.join('\n\n').length - 2
  const add = (title, lines, noun = 'lines', limit = Infinity) => {
    if (lines.length && room() > title.length + 30) parts.push([title, ...fit(lines, Math.min(limit, room() - title.length - 1), noun)].join('\n'))
  }
  if (scope === 'none') return `${parts[0]}\nNo workspace notes are shared for this question.`.slice(0, maxChars)
  const shared = state.notes.filter((note) => isActiveNote(note) && noteIds.includes(note.id))
  add('Selected stickies (the question is about these):', shared.map((note) => `${stickyLine(note)}${note.folderId ? ` [${folderPath(state.folders, note.folderId).join(' / ')}]` : ''}`), 'stickies', 900)
  const viewing = focus ? [focus] : open.filter((id) => !state.folders.find((folder) => folder.id === id)?.parentId)
  if (viewing.length) {
    const lines = openLines(state, viewing, Math.min(1600, room() - 40))
    if (lines.length) parts.push(lines.join('\n'))
  }
  if (scope === 'focus') return parts.join('\n\n').slice(0, maxChars)

  const today = localDateKey(now)
  const steps = nextSteps(state.notes.filter((note) => note.kind === 'day' && note.date === today && !note.trashedAt)).filter((step) => !step.done)
  add('Next (steps for today):', steps.slice(0, 5).map((step) => `- ${one(step.text, 90)}`))

  const soon = (state.calendar?.events || [])
    .map((event) => ({ event, at: Date.parse(event.start) }))
    .filter(({ at }) => at >= now.getTime() - 3_600_000 && at <= now.getTime() + 8 * 86_400_000)
    .sort((a, b) => a.at - b.at)
  add('Coming up on the Calendar (next 8 days):', soon.slice(0, 5).map(({ event, at }) => `- ${WHEN.format(new Date(at))}: ${one(event.title, 80)}`))

  const top = nodesOf(state.folders)
  const nodes = top.filter(({ folder }) => !isBranch(folder))
  const alone = top.filter(({ folder }) => isBranch(folder))
  add(`Nodes (${nodes.length}):`, nodeLines(state, nodes), 'nodes', 650)
  if (!nodes.length) parts.push('They have no nodes yet.')
  add(`Branches on the Sky on their own (${alone.length}), in no node yet:`, nodeLines(state, alone), 'branches', 350)
  // Lines between things: only that they relate, by name.
  const name = (key) => one(recordOf(state, key)?.title || recordOf(state, key)?.name, 40)
  add('Connected (a line between two things; nothing was filed by it):', linksOf(state).slice(0, 12).map((link) => `- ${name(link.a)} — ${name(link.b)}`), 'connections')
  // Stacks on the desk (kept on this Mac, so the desk hands them in).
  add('Stacks on the desk (stickies standing in a column; they only arrange the desk):', stacks.slice(0, 6).map((stack) => `- ${one(stack.name, 40) || 'A stack'}: ${(stack.titles || []).slice(0, 6).map((title) => one(title, 40)).join(' · ')}`), 'stacks')
  const unsorted = pileOf(state.notes, null)
  add(`Unsorted (${stickies(unsorted.length)}, in no node yet):`, unsorted.map(stickyLine), 'stickies', 450)
  if (!unsorted.length) parts.push('Unsorted is empty.')
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
