/* The brain (Phase 112): what OSAT remembers from talking with you, and everything it knows drawn as one graph.
   Learning: after an answer, the AI that answered lists up to three lasting facts from that exchange (`learnMessages`,
   read by `readLearned`), kept in MEMORY.md (`settings.memory`, soul.js) with the chat they came from, so Settings and
   the Brain room can show and forget each. Recall: before answering, the memories that share words with the question
   come first (`memoryFor`), so a long memory never crowds out what matters now. The graph (`brainGraph`) is boards,
   stickies and notes, chats and memories, joined where one names, holds or read another. Pure. */
import { WIKILINK, titleKey } from '../../shared/note-core.mjs'
import { folderChildren, isActiveNote } from '../notes-model.js'
import { deriveTitle } from '../assistant/chats.js'

const STOP = new Set('a an and are as at be but by can do for from has have how i if in is it its me my of on or our so that the their them then there these they this to us was we were what when where which who why will with you your'.split(' '))
// Words that carry meaning, with "Nate’s" read as "nate".
export const wordsOf = (text) => new Set(String(text || '').toLowerCase().replace(/['’]s\b/g, '').match(/[a-z0-9][a-z0-9'’-]{2,}/g)?.filter((word) => !STOP.has(word)) || [])

/* Is this memory already known? Most of its words already in one line. */
function known(text, lines) {
  const words = wordsOf(text)
  if (!words.size) return true
  return lines.some((line) => {
    const other = wordsOf(line)
    let shared = 0
    for (const word of words) if (other.has(word)) shared += 1
    return shared / words.size >= 0.8
  })
}

export function learnMessages(question, answer, memory = []) {
  return [
    { role: 'system', content: 'You keep a short memory about the person you help, so you never forget what matters to them. From ONE exchange, write down only facts worth remembering for weeks: their work, clients, people and who they are, plans and dates, decisions, preferences. Never general knowledge, never what the assistant said about itself, never secrets such as passwords or card numbers. Write each fact as one short plain sentence about the person ("Nate\'s client Fortis launches in December."). Reply with at most 3 lines, each starting with "- ", or the single word none.' },
    { role: 'user', content: `${memory.length ? `Already remembered (do not repeat):\n${memory.slice(-40).map((line) => `- ${line}`).join('\n')}\n\n` : ''}The person asked:\n${String(question).slice(0, 2000)}\n\nThe assistant answered:\n${String(answer).slice(0, 2000)}` },
  ]
}

/* The model's lines, cleaned: at most three short sentences, none already known, nothing that looks like a secret. */
export function readLearned(text, memory = []) {
  const kept = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim()
    if (!line || /^none\b/i.test(line) || line.length < 8 || line.length > 220) continue
    if (/password|passcode|\bpin\b|card number|ssn|social security|api key|token/i.test(line)) continue
    if (known(line, [...memory, ...kept])) continue
    kept.push(line)
    if (kept.length === 3) break
  }
  return kept
}

/* The memory lines to read before answering `question`: those sharing its words first, then the newest, `limit` in all. */
export function memoryFor(memory, question, limit = 30) {
  if (memory.length <= limit) return memory
  const words = wordsOf(question)
  const scored = memory.map((line, index) => {
    let shared = 0
    for (const word of wordsOf(line.text)) if (words.has(word)) shared += 1
    return { line, index, shared }
  })
  const picked = new Set(scored.filter((entry) => entry.shared > 0).sort((a, b) => b.shared - a.shared || b.index - a.index).slice(0, limit).map((entry) => entry.index))
  for (let index = memory.length - 1; index >= 0 && picked.size < limit; index -= 1) picked.add(index)
  return memory.filter((_, index) => picked.has(index))
}

const hasWord = (text, name) => name.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text)

/* Everything as one graph: { nodes: [{ id, kind, label, ref }], links: [{ source, target }] }. kind is board, note,
   chat or memory; ref is what opening it needs. `most` keeps it drawable: the newest notes and chats first.
   ponytail: names are matched by whole words, a board named "Home" links every note that says home. */
export function brainGraph(state, memory = [], most = 320) {
  const nodes = []
  const links = []
  const ids = new Set()
  const add = (node) => { if (!ids.has(node.id)) { ids.add(node.id); nodes.push(node) } }
  const link = (source, target) => { if (source !== target && ids.has(source) && ids.has(target)) links.push({ source, target }) }

  const folders = state.folders || []
  const boards = folderChildren(folders, null)
  const topOf = (folderId) => {
    let folder = folders.find((item) => item.id === folderId)
    for (let step = 0; folder?.parentId && step < 20; step += 1) folder = folders.find((item) => item.id === folder.parentId)
    return folder?.id || null
  }
  for (const board of boards) add({ id: `board:${board.id}`, kind: 'board', label: board.name, ref: { folderId: board.id } })

  const newest = (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
  const notes = (state.notes || []).filter((note) => isActiveNote(note) && note.kind !== 'day').sort(newest).slice(0, most)
  const byTitle = new Map(notes.filter((note) => note.title).map((note) => [titleKey(note.title), note]))
  for (const note of notes) add({ id: `note:${note.id}`, kind: 'note', label: note.title || String(note.markdown || '').split('\n')[0].slice(0, 60) || 'Untitled', ref: { noteId: note.id } })
  for (const note of notes) {
    const top = topOf(note.folderId)
    if (top) link(`note:${note.id}`, `board:${top}`)
    for (const folderId of Object.values(note.refs || {})) link(`note:${note.id}`, `board:${topOf(folderId) || folderId}`)
    for (const match of String(note.markdown || '').matchAll(WIKILINK)) {
      const other = byTitle.get(titleKey(match[1]))
      if (other) link(`note:${note.id}`, `note:${other.id}`)
    }
  }

  const chats = [...(state.chats || [])].sort(newest).slice(0, Math.round(most / 3))
  for (const chat of chats) {
    const title = deriveTitle(chat)
    add({ id: `chat:${chat.id}`, kind: 'chat', label: title, ref: { chatId: chat.id } })
    for (const message of chat.messages) for (const noteId of message.noteIds || []) link(`chat:${chat.id}`, `note:${noteId}`)
    const said = `${title} ${chat.messages.filter((message) => message.role === 'user').map((message) => message.content).join(' ')}`.slice(0, 4000)
    for (const board of boards) if (hasWord(said, board.name)) link(`chat:${chat.id}`, `board:${board.id}`)
  }

  for (const line of memory) {
    add({ id: `memory:${line.id}`, kind: 'memory', label: line.text, ref: { memoryId: line.id } })
    if (line.chatId) link(`memory:${line.id}`, `chat:${line.chatId}`)
    for (const board of boards) if (hasWord(line.text, board.name)) link(`memory:${line.id}`, `board:${board.id}`)
  }
  return { nodes, links }
}
