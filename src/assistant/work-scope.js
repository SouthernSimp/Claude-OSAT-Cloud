import { parseFileQuery } from '../../shared/file-query.mjs'
import { folderSubtree, isActiveNote, relatedNotes } from '../notes-model.js'
import { stickiesIn } from '../nodes-model.js'

const newest = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/* The node or branch a question names ("what's in my notes about Jordan?"): the longest name that
   appears as whole words. ponytail: a node called "Ideas" is also found by "any ideas for dinner?";
   it only adds that node's newest three stickies, and the chips say so. */
export function namedFolder(folders, question) {
  let best = null
  for (const folder of folders) {
    const name = String(folder.name || '').trim()
    if (name.length < 3 || folder.trashedAt || (best && name.length <= best.name.length)) continue
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'iu').test(question)) best = folder
  }
  return best
}

/* "last month", "this week", "since…": read from the start of the question, else from its end
   (parseFileQuery reads 100 characters). → { since: Date | null, words }. */
function readTime(question, now) {
  const first = parseFileQuery(question, now)
  if (first.since || question.length <= 100) return first
  const last = parseFileQuery(question.slice(-100), now)
  return last.since ? last : first
}

/* The notes a question is about, best first, at most six: the words it uses (the notes that share
   the rarer ones), the node or branch it names (that one's newest stickies), and a time it names
   ("last month": only what was touched since). A question that is only a time ("what did I write last
   week?") gets the newest stickies from then. */
export function relatedForAsk(workspace, question, now = new Date()) {
  const { since, words } = readTime(question, now)
  const inTime = (note) => !since || Date.parse(note.updatedAt) >= since.getTime()
  const active = workspace.notes.filter((note) => isActiveNote(note) && inTime(note))
  const text = since ? words.join(' ') : question
  const found = relatedNotes(active, text)
  const named = namedFolder(workspace.folders, question)
  const fromNode = named ? stickiesIn(workspace, named.id).filter(inTime).sort(newest).slice(0, 3) : []
  const recent = since && !found.length && !named ? active.filter((note) => note.kind !== 'day').sort(newest).slice(0, 5) : []
  return [...new Map([...found, ...fromNode, ...recent].map((note) => [note.id, note])).values()].slice(0, 6)
}

// Explicit scope wins over keyword retrieval. The outbound prompt still applies
// its content budget; the UI names any sources omitted from that budget.
export function notesForQuestion(workspace, question, context = {}) {
  const active = workspace.notes.filter(isActiveNote)
  if (context.scope === 'none') return []
  if (context.noteIds?.length) return active.filter((note) => context.noteIds.includes(note.id))
  if (context.scope === 'focus' && context.focus) {
    const inside = folderSubtree(workspace.folders, context.focus)
    return active.filter((note) => inside.has(note.folderId) && note.kind !== 'day')
  }
  return relatedForAsk(workspace, question)
}
