/* While you sleep (Phase 53): once a night OSAT's AI on this Mac looks over what Nate wrote lately
   and leaves a few ideas on the canvas, which he keeps with a tap or waves away. It never changes
   anything by itself. Pure: desktop/overnight.cjs runs it, the Sky shows the ideas.
   Two kinds of idea:
     { id: 'link:<a>|<b>', kind: 'link', a, b, why }       a faint line between two things
     { id: 'topic:<name>', kind: 'topic', name, notes, why } stickies that share a subject
                                                            no topic has yet
   Code shortlists the pairs (words they share that are rare in the rest of OSAT), so the model
   only judges a dozen; it also names subjects that keep coming up. */

import { localParts } from './brief-model.mjs'

export const DEFAULT_SETTINGS = { on: true }
// The night starts at 1:00; a pass is due until 7:00, or later whenever the Mac sits idle.
export const START_HOUR = 1
export const END_HOUR = 7
export const IDLE_SECONDS = 20 * 60
export const RECENT_DAYS = 7
export const MOST_PAIRS = 12
export const MOST_LINKS = 6
export const MOST_TOPICS = 2
export const MOST_TOPIC_STICKIES = 40
export const MOST_DISMISSED = 500
const DAY_MS = 86400000

export const cleanSettings = (value = {}) => ({ on: value?.on !== false })

/* Which night it is: the day the night began, so 00:30 still belongs to yesterday's. */
export const nightOf = (now, timeZone) => localParts(new Date(new Date(now).getTime() - START_HOUR * 3600000), timeZone).day

/* Due once a night: on, on the charger, not done this night, and either deep in the night or the
   Mac has sat idle a while (a Mac that slept through the night catches up the next quiet moment). */
export function due({ now, settings, last, idleSeconds = 0, onBattery = false, timeZone }) {
  if (!cleanSettings(settings).on || onBattery) return false
  const night = nightOf(now, timeZone)
  if (typeof last === 'string' && last >= night) return false
  const hour = Number(localParts(now, timeZone).time.slice(0, 2))
  return (hour >= START_HOUR && hour < END_HOUR) || idleSeconds >= IDLE_SECONDS
}

const STOP = new Set(`about above after again against also among another anything around because been before being below
between both could does doing done down during each else even every from have having here into just know like made make
many more most much must need never next only other over same should since some still such than that their them then there
these they thing things think this those though through today tomorrow under until very want were what when where which
while will with would your yours yesterday week weeks month really maybe also ready needs going gonna sure call later note
notes sticky stickies topic topics branch todo done`.split(/\s+/))

/* The words that say what a text is about: four letters or more, not common, a plural folded in. */
export function wordsOf(text) {
  const words = new Set()
  const plain = String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ')
  for (const raw of plain.split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 4 || /^\d+$/.test(raw) || STOP.has(raw)) continue
    const word = raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw
    if (!STOP.has(word)) words.add(word)
  }
  return words
}

export const isSticky = (note) => Boolean(note && !note.trashedAt && !note.archived && !note.kind && note.markdown?.trim())
const stamp = (record) => Math.max(Date.parse(record.createdAt) || 0, Date.parse(record.updatedAt) || 0)
export const pairId = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const firstLine = (note) => (note.title || note.markdown.split('\n').find((line) => line.trim()) || '').replace(/^#+\s*/, '').trim()

/* Every sticky (filed ones; the AI files Unsorted on its own) and every topic and branch, as
   { key, kind, record, words, recent, folder (where a sticky lives), chain (a folder and the ones above it) }. */
function itemsOf(doc, now) {
  const folders = Array.isArray(doc?.folders) ? doc.folders : []
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const chainOf = (id) => {
    const chain = []
    for (let at = id; at && byId.has(at) && !chain.includes(at); at = byId.get(at).parentId) chain.push(at)
    return chain
  }
  const since = new Date(now).getTime() - RECENT_DAYS * DAY_MS
  const notes = (Array.isArray(doc?.notes) ? doc.notes : []).filter((note) => isSticky(note) && note.folderId && byId.has(note.folderId))
  return [
    ...notes.map((note) => ({ key: `note:${note.id}`, kind: 'note', record: note, words: wordsOf(note.markdown), recent: stamp(note) >= since, chain: chainOf(note.folderId) })),
    ...folders.filter((folder) => folder.name?.trim()).map((folder) => ({ key: `folder:${folder.id}`, kind: 'folder', record: folder, words: wordsOf(folder.name), recent: stamp(folder) >= since, chain: chainOf(folder.id) })),
  ]
}

const linked = (doc) => {
  const pairs = new Set()
  const from = (kind, list) => (Array.isArray(list) ? list : []).forEach((item) => (item.links || []).forEach((other) => pairs.add(pairId(`${kind}:${item.id}`, other))))
  from('note', doc?.notes)
  from('folder', doc?.folders)
  return pairs
}

/* Pairs worth asking about, best first: at least one end new this week, not already together
   (side by side in one branch, one inside the other, or connected), not waved away before, and
   sharing words that are rare across OSAT. Each thing is in two pairs at most. */
export function candidatePairs(doc, { now = new Date(), dismissed = [] } = {}) {
  const items = itemsOf(doc, now)
  const df = new Map()
  items.forEach((item) => item.words.forEach((word) => df.set(word, (df.get(word) || 0) + 1)))
  const idf = (word) => Math.log((items.length + 1) / (df.get(word) || 1))
  const weight = new Map(items.map((item) => [item.key, Math.sqrt([...item.words].reduce((sum, word) => sum + idf(word) ** 2, 0)) || 1]))
  const index = new Map()
  items.forEach((item) => item.words.forEach((word) => { if (!index.has(word)) index.set(word, []); index.get(word).push(item) }))
  const skip = new Set([...linked(doc), ...dismissed])
  const together = (a, b) => {
    if (a.kind === 'note' && b.kind === 'note') return a.record.folderId === b.record.folderId
    if (a.kind === 'folder' && b.kind === 'folder') return a.chain.includes(b.record.id) || b.chain.includes(a.record.id)
    const [note, folder] = a.kind === 'note' ? [a, b] : [b, a]
    return note.chain.includes(folder.record.id)
  }
  const scored = new Map()
  for (const a of items.filter((item) => item.recent)) {
    for (const word of a.words) {
      // A word on most of OSAT says nothing about two things in particular.
      if (index.get(word).length > Math.max(8, items.length / 10)) continue
      for (const b of index.get(word)) {
        if (b === a) continue
        const id = pairId(a.key, b.key)
        if (scored.has(id) || skip.has(id) || together(a, b)) continue
        const shared = [...a.words].filter((w) => b.words.has(w))
        const folderSide = [a, b].find((item) => item.kind === 'folder')
        // Two things share two rare words, or a sticky names a whole topic or branch.
        if (shared.length < 2 && !(folderSide && folderSide.words.size && [...folderSide.words].every((w) => shared.includes(w)))) {
          scored.set(id, null)
          continue
        }
        const score = shared.reduce((sum, w) => sum + idf(w) ** 2, 0) / (weight.get(a.key) * weight.get(b.key))
        scored.set(id, { a: a.key, b: b.key, score, shared })
      }
    }
  }
  const uses = new Map()
  const out = []
  for (const pair of [...scored.values()].filter((pair) => pair && pair.score >= 0.12).sort((x, y) => y.score - x.score)) {
    if ((uses.get(pair.a) || 0) >= 2 || (uses.get(pair.b) || 0) >= 2) continue
    uses.set(pair.a, (uses.get(pair.a) || 0) + 1)
    uses.set(pair.b, (uses.get(pair.b) || 0) + 1)
    out.push({ id: pairId(pair.a, pair.b), a: pair.a, b: pair.b, shared: pair.shared })
    if (out.length >= MOST_PAIRS) break
  }
  return out
}

/* A thing in a few words, with where it is: “Buy oat milk” (a sticky in Groceries). */
export function describe(doc, key) {
  const at = String(key).indexOf(':')
  const kind = String(key).slice(0, at)
  const id = String(key).slice(at + 1)
  const folders = doc?.folders || []
  if (kind === 'folder') {
    const folder = folders.find((item) => item.id === id)
    return folder ? `“${folder.name.slice(0, 60)}” (${folder.parentId ? 'a branch' : 'a topic'})` : ''
  }
  const note = (doc?.notes || []).find((item) => item.id === id)
  if (!note) return ''
  const home = folders.find((item) => item.id === note.folderId)?.name
  return `“${note.markdown.replace(/\s+/g, ' ').trim().slice(0, 200)}” (a sticky${home ? ` in ${home.slice(0, 40)}` : ''})`
}

const SYSTEM = 'You help Nate see how his own notes fit together. Speak to him as “you”. Answer only in the format asked, nothing else.'

export function pairMessages(doc, pairs) {
  const lines = pairs.map((pair, index) => `${index + 1}. ${describe(doc, pair.a)} and ${describe(doc, pair.b)}`)
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `For each numbered pair, say whether the two are about the same thing, person, project or plan, so you would want a line connecting them on your canvas. Sharing a word is not enough.\nAnswer one line per pair, like:\n1: yes: both are about the Fortis demo\n2: no\n\nThe pairs:\n${lines.join('\n')}`,
    },
  ]
}

const cleanWhy = (text) => String(text || '').replace(/^["“'”\s]+|["”'“\s.]+$/g, '').replace(/\s+/g, ' ').slice(0, 100)

/* "n: yes: why" lines → Map(n → why). Anything else (a "no", an n out of range, chatter) is left out. */
export function readPairAnswer(text, count) {
  const out = new Map()
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^\s*(\d+)\s*[:.)-]\s*\**(yes|no)\b\**\s*[:,—–-]?\s*(.*)$/i)
    if (!match) continue
    const n = Number(match[1])
    if (n < 1 || n > count || out.has(n) || match[2].toLowerCase() !== 'yes') continue
    out.set(n, cleanWhy(match[3]) || 'These look like the same subject.')
  }
  return out
}

/* The stickies to name subjects from: this week's, newest first, filed or not. */
export function recentStickies(doc, now = new Date()) {
  const since = new Date(now).getTime() - RECENT_DAYS * DAY_MS
  return (doc?.notes || []).filter((note) => isSticky(note) && stamp(note) >= since).sort((a, b) => stamp(b) - stamp(a)).slice(0, MOST_TOPIC_STICKIES)
}

const topicNames = (doc) => (doc?.folders || []).filter((folder) => !folder.parentId && folder.name).map((folder) => folder.name)

export function topicMessages(doc, stickies) {
  const names = topicNames(doc)
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Here are the stickies you wrote this week, numbered. Name at most ${MOST_TOPICS} subjects that come up in three or more of them and are not already one of your topics${names.length ? ` (${names.slice(0, 60).join(', ')})` : ''}. A subject is a project, person, place or plan in one to four words, not a general idea like “work” or “ideas”.\nOne line per subject, the name, a colon, then the sticky numbers, like:\nFortis demo: 2, 5, 9\nIf there is none, answer: none\n\nThe stickies:\n${stickies.map((note, index) => `${index + 1}. ${firstLine(note).slice(0, 140)}`).join('\n')}`,
    },
  ]
}

/* "Name: 2, 5, 9" lines → [{ name, notes: [ids] }]: three stickies or more, not an existing topic's
   name, not waved away, not stickies that already share one home. */
export function readTopicAnswer(text, doc, stickies, { dismissed = [] } = {}) {
  const taken = new Set([...topicNames(doc).map((name) => name.trim().toLowerCase()), ...dismissed.filter((id) => id.startsWith('topic:')).map((id) => id.slice(6))])
  const out = []
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^\s*(?:[-*]\s*)?\**([^:\d][^:]{0,40}?)\**\s*:\s*([\d,\s]+)$/)
    if (!match) continue
    const name = match[1].replace(/^["“']|["”']$/g, '').trim()
    if (!name || name.toLowerCase() === 'none' || taken.has(name.toLowerCase())) continue
    const picks = [...new Set(match[2].split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= stickies.length))].map((n) => stickies[n - 1])
    if (picks.length < 3) continue
    const homes = new Set(picks.map((note) => note.folderId || ''))
    if (homes.size === 1 && !homes.has('')) continue
    taken.add(name.toLowerCase())
    out.push({ name, notes: picks.map((note) => note.id) })
    if (out.length >= MOST_TOPICS) break
  }
  return out
}

/* The ideas still worth showing: both ends there (a sticky not in the Bin), not connected since,
   a topic's name still free and two of its stickies still there. */
export function liveIdeas(doc, ideas) {
  const notes = new Map((doc?.notes || []).filter(isSticky).map((note) => [`note:${note.id}`, note]))
  const folders = new Map((doc?.folders || []).map((folder) => [`folder:${folder.id}`, folder]))
  const there = (key) => notes.has(key) || folders.has(key)
  const links = linked(doc)
  const names = new Set(topicNames(doc).map((name) => name.trim().toLowerCase()))
  return (Array.isArray(ideas) ? ideas : []).flatMap((idea) => {
    if (idea?.kind === 'link') return there(idea.a) && there(idea.b) && !links.has(pairId(idea.a, idea.b)) ? [idea] : []
    if (idea?.kind === 'topic') {
      const kept = (idea.notes || []).filter((id) => notes.has(`note:${id}`))
      return kept.length >= 2 && !names.has(String(idea.name).toLowerCase()) ? [{ ...idea, notes: kept }] : []
    }
    return []
  })
}

/* The ideas in a line for the morning brief: “2 ideas: connect “A” and “B”; make Hendrix plumber a topic”. */
export function ideaWords(doc, ideas) {
  const live = liveIdeas(doc, ideas)
  if (!live.length) return ''
  const name = (key) => describe(doc, key).replace(/ \(.*\)$/, '').slice(0, 70)
  const parts = live.slice(0, 4).map((idea) => (idea.kind === 'link' ? `connect ${name(idea.a)} and ${name(idea.b)}` : `make ${idea.name} a topic`))
  return `${live.length} ${live.length === 1 ? 'idea' : 'ideas'}: ${parts.join('; ')}${live.length > 4 ? '; and more' : ''}`
}

export const linkIdea = (pair, why) => ({ id: `link:${pair.id}`, kind: 'link', a: pair.a, b: pair.b, why })
export const topicIdea = ({ name, notes }) => ({ id: `topic:${name.toLowerCase()}`, kind: 'topic', name, notes, why: `It comes up in ${notes.length} of this week’s stickies.` })

/* What waving an idea away remembers, so it isn't offered again: the pair, or the topic's name. */
export const dismissKey = (idea) => (idea.kind === 'link' ? pairId(idea.a, idea.b) : `topic:${String(idea.name).toLowerCase()}`)
