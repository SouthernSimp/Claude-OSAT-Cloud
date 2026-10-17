/* Meetings (Phase 57): OSAT listens to a meeting on this Mac, turns what was said into words
   (whisper.cpp, desktop/meetings/), and the AI on this Mac writes it up: a short summary, what was
   decided, what is to do, what is still open. Pure rules, used by main and the tests:
     - the sound: 16 kHz mono PCM, how loud each second was (`levels`), so silence is never "heard";
     - the words: two tracks (the mic is Me, the Mac's sound is Them) become one conversation
       (`mergeTracks`: echo from the speakers dropped, neighbours joined);
     - the AI's jobs: long meetings are read in parts of at most CHUNK_WORDS words, because the
       built-in model reads about 8,000 tokens at once (desktop/ai/runtime.cjs). Each part gives
       notes (NOTES_SCHEMA), the lists are joined in code (an action item is never lost to a second
       summary), and one short last question names the meeting (TITLE_SCHEMA);
     - the notes: a write-up and a transcript, linked with [[ ]]. */

export const RATE = 16000
export const SEGMENT_GAP_MS = 8000
export const CHUNK_WORDS = 2600
// Under this (RMS, 0 to 1) a second counts as silence: about -48 dBFS.
export const QUIET = 0.004
export const MOST_ACTIONS = 20

const wordsIn = (text) => String(text || '').trim().split(/\s+/).filter(Boolean)
const pad = (n) => String(n).padStart(2, '0')

/* ---------- the sound ---------- */

/* Floating-point samples from the microphone (-1 to 1) → 16-bit PCM, the form whisper.cpp reads. */
export function pcm16(floats) {
  const out = new Int16Array(floats.length)
  for (let i = 0; i < floats.length; i += 1) {
    const value = Math.max(-1, Math.min(1, floats[i]))
    out[i] = value < 0 ? value * 0x8000 : value * 0x7fff
  }
  return out
}

/* How loud each second was (RMS, 0 to 1). */
export function levels(pcm, rate = RATE) {
  const out = []
  for (let start = 0; start < pcm.length; start += rate) {
    const end = Math.min(start + rate, pcm.length)
    let sum = 0
    for (let i = start; i < end; i += 1) sum += (pcm[i] / 0x8000) ** 2
    out.push(Math.sqrt(sum / (end - start)))
  }
  return out
}

/* The average loudness between two times (ms) of a track's `levels`. */
export function loudness(lv, startMs, endMs) {
  const first = Math.max(0, Math.floor(startMs / 1000))
  const last = Math.min(lv.length - 1, Math.max(first, Math.ceil(endMs / 1000) - 1))
  let sum = 0
  let count = 0
  for (let i = first; i <= last; i += 1) { sum += lv[i]; count += 1 }
  return count ? sum / count : 0
}

/* The stretches of a track with someone in them: [{ start, end }] in ms. Whisper is only ever shown these, because
   shown a long silence it invents words, often one sentence over and over. Loud seconds a few seconds apart
   are one stretch; each has a second of margin; none is longer than `max` seconds (cut at the quietest second
   near its end), since whisper reads 30 seconds at a time. */
export function speechWindows(lv, { quiet = QUIET, bridge = 3, pad = 1, max = 28 } = {}) {
  const spans = []
  let quietFor = Infinity
  lv.forEach((value, second) => {
    if (value < quiet) { quietFor += 1; return }
    const last = spans[spans.length - 1]
    if (last && quietFor <= bridge) last.end = second + 1
    else spans.push({ start: second, end: second + 1 })
    quietFor = 0
  })
  const out = []
  for (const span of spans) {
    let start = Math.max(0, span.start - pad)
    const end = Math.min(lv.length, span.end + pad)
    while (end - start > max) {
      // The window ends before the quietest of its last ten seconds (the later, between equals).
      let cut = start + max - 1
      for (let second = start + Math.max(1, max - 10); second < start + max; second += 1) if (lv[second] <= lv[cut]) cut = second
      out.push({ start: start * 1000, end: cut * 1000 })
      start = cut
    }
    out.push({ start: start * 1000, end: end * 1000 })
  }
  return out
}

/* ---------- the words ---------- */

// What whisper writes for sounds that aren't speech: [BLANK_AUDIO], (music), ♪.
const NOISE = /^[\s♪]*([[(*].*[\])*])?[\s♪]*$/

/* Whisper sometimes gets stuck and says one sentence again and again: the same sentence three or more times
   running is said once. */
export function collapseRepeats(text) {
  const sentences = String(text).match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || []
  const key = (sentence) => sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const out = []
  for (let i = 0; i < sentences.length; i += 1) {
    let run = 1
    while (i + run < sentences.length && key(sentences[i + run]) === key(sentences[i])) run += 1
    out.push(sentences[i])
    if (run < 3) for (let n = 1; n < run; n += 1) out.push(sentences[i + n])
    i += run - 1
  }
  return out.join('').trim()
}

/* One track's segments ({ start, end, text }, ms) without the empty ones, the sound markers, and
   whatever whisper "heard" in silence (it invents "Thank you." there): a segment over a quiet stretch goes. */
export function cleanSegments(segments, lv = null) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => ({ start: Number(segment?.start) || 0, end: Number(segment?.end) || 0, text: collapseRepeats(String(segment?.text || '').replace(/\s+/g, ' ').trim()) }))
    .filter((segment) => segment.text && !NOISE.test(segment.text) && segment.end >= segment.start)
    .filter((segment) => !lv || loudness(lv, segment.start, segment.end) >= QUIET)
}

const wordSet = (text) => new Set(String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) || [])

/* With speakers (not headphones), the microphone hears the other people too. A segment from the
   microphone that says the same words as the Mac's sound at the same time is that echo: dropped. */
export function dropEcho(mine, theirs) {
  return mine.filter((segment) => {
    const words = wordSet(segment.text)
    if (words.size < 3) return true
    const span = Math.max(1, segment.end - segment.start)
    return !theirs.some((other) => {
      const overlap = Math.min(segment.end, other.end) - Math.max(segment.start, other.start)
      if (overlap < span * 0.4) return false
      const heard = wordSet(other.text)
      let shared = 0
      for (const word of words) if (heard.has(word)) shared += 1
      return shared / words.size >= 0.6
    })
  })
}

/* The two tracks as one conversation: [{ who: 'me' | 'them', start, end, text }], in time order,
   a speaker's neighbouring lines (less than SEGMENT_GAP_MS apart) joined into one turn. */
export function mergeTracks({ me = [], them = [] }) {
  const mine = dropEcho(me, them)
  const all = [...mine.map((s) => ({ ...s, who: 'me' })), ...them.map((s) => ({ ...s, who: 'them' }))]
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const turns = []
  for (const segment of all) {
    const last = turns[turns.length - 1]
    if (last && last.who === segment.who && segment.start - last.end < SEGMENT_GAP_MS) {
      last.text = `${last.text} ${segment.text}`
      last.end = Math.max(last.end, segment.end)
    } else turns.push({ ...segment })
  }
  return turns
}

/* 0:07, 12:03, 1:02:09 */
export function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/* "12 minutes", "1 hr 5 min", "under a minute" */
export function durationWords(ms) {
  const minutes = Math.round(ms / 60000)
  if (ms < 45000) return 'under a minute'
  if (minutes < 60) return `${Math.max(1, minutes)} minute${minutes === 1 ? '' : 's'}`
  return `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`
}

const NAMES = { me: 'Me', them: 'Them' }

/* The turns as text, one line each: "[12:03] Me: …". With one sound only there is nobody to tell apart. */
export function transcriptLines(turns, { labelled = true } = {}) {
  return turns.map((turn) => `[${clock(turn.start)}] ${labelled ? `${NAMES[turn.who]}: ` : ''}${turn.text}`)
}

/* ---------- reading it in parts ---------- */

/* Parts of at most `max` words, cut between turns (a turn longer than that is cut between sentences). */
export function chunkLines(lines, max = CHUNK_WORDS) {
  const pieces = []
  for (const line of lines) {
    if (wordsIn(line).length <= max) { pieces.push(line); continue }
    let current = ''
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      for (let words = wordsIn(sentence); words.length; words = words.slice(max)) {
        const piece = words.slice(0, max).join(' ')
        if (current && wordsIn(`${current} ${piece}`).length > max) { pieces.push(current); current = '' }
        current = current ? `${current} ${piece}` : piece
      }
    }
    if (current) pieces.push(current)
  }
  const parts = []
  let part = []
  let count = 0
  for (const piece of pieces) {
    const n = wordsIn(piece).length
    if (part.length && count + n > max) { parts.push(part.join('\n')); part = []; count = 0 }
    part.push(piece)
    count += n
  }
  if (part.length) parts.push(part.join('\n'))
  return parts
}

const LIST = (maxItems, maxLength) => ({ type: 'array', maxItems, items: { type: 'string', maxLength } })
export const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', maxLength: 900 },
    decisions: LIST(10, 240),
    actions: {
      type: 'array',
      maxItems: MOST_ACTIONS,
      items: { type: 'object', properties: { what: { type: 'string', maxLength: 240 }, who: { type: 'string', maxLength: 60 }, due: { type: 'string', maxLength: 60 } } },
    },
    questions: LIST(6, 240),
  },
}
export const TITLE_SCHEMA = { type: 'object', properties: { title: { type: 'string', maxLength: 70 }, summary: { type: 'string', maxLength: 1100 } } }

const PERSPECTIVE = '"Me" is the person whose Mac recorded the meeting; "Them" is everyone else, who can not be told apart. A transcript with no names may have been written by a program that mishears: names and numbers can be wrong.'

/* The AI's question for one part (`index` from 0 of `count`). */
export function notesMessages(text, { index = 0, count = 1 } = {}) {
  const where = count > 1 ? `This is part ${index + 1} of ${count} of a meeting transcript.` : 'This is a meeting transcript.'
  const system = `You write meeting notes for OSAT, a private notes app. ${where} ${PERSPECTIVE}
Lines look like "[12:03] Me: …" (minutes:seconds into the meeting).
- summary: what this ${count > 1 ? 'part' : 'meeting'} was about and where it ended up, in 2 to 5 plain sentences.
- decisions: things the people agreed or settled. Each in one short sentence. Leave out a decision nobody made.
- actions: things someone said they or another person will do. what: the task, starting with a verb. who: the person's name as said, or "Me" when the person recording said it of themselves, or "" when no one was named. due: the day or date as said ("Friday", "Nov 1"), or "".
- questions: things raised and left unanswered.
Use only what was said. Never invent a name, a number, a date or a task. Use an empty list when there is none.`
  return [{ role: 'system', content: system }, { role: 'user', content: String(text) }]
}

/* The last, short question: a name and one summary for the whole meeting, from the parts' summaries. */
export function titleMessages(partSummaries) {
  const system = `You name a meeting for OSAT, a private notes app, from notes written part by part.
- title: 3 to 8 words saying what the meeting was about. No date and no quotation marks.
- summary: the parts' summaries as one, in 2 to 5 plain sentences.
Use only what the notes say.`
  return [{ role: 'system', content: system }, { role: 'user', content: partSummaries.map((text, i) => `Part ${i + 1}: ${text}`).join('\n\n') }]
}

// A small model sometimes answers "no questions" with a sentence in the list; that is an empty list.
const NOTHING = /^(none|n\/a|nothing|not applicable|no (questions?|decisions?|actions?|action items?|open questions?|items?) (were |was |are |is )?(raised|mentioned|discussed|made|noted|identified|recorded|stated|listed|left open))\.?$/i
const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const same = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
function uniqueBy(list, text) {
  const out = []
  for (const item of list) if (text(item) && !out.some((seen) => same(text(seen), text(item)))) out.push(item)
  return out
}

function parseJson(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  for (const candidate of [text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    try {
      const value = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    } catch { /* try the next */ }
  }
  return null
}

/* The AI's answer for one part, cleaned: { summary, decisions, actions: [{ what, who, due }], questions },
   or null when it holds nothing at all. */
export function readNotes(raw) {
  const value = parseJson(raw)
  if (!value) return null
  const strings = (list, max, most) => uniqueBy((Array.isArray(list) ? list : []).map((item) => clean(item, max)).filter((text) => text && !NOTHING.test(text)).map((text) => ({ text })), (item) => item.text).map((item) => item.text).slice(0, most)
  const actions = uniqueBy(
    (Array.isArray(value.actions) ? value.actions : [])
      .map((item) => ({ what: clean(item?.what, 240), who: clean(item?.who, 60), due: clean(item?.due, 60) }))
      .filter((item) => item.what),
    (item) => item.what,
  ).slice(0, MOST_ACTIONS)
  const notes = { summary: clean(value.summary, 900), decisions: strings(value.decisions, 240, 10), actions, questions: strings(value.questions, 240, 6) }
  return notes.summary || notes.decisions.length || notes.actions.length || notes.questions.length ? notes : null
}

/* The parts' notes as one: the lists are joined here, in code, so an action item is never lost. */
export function joinNotes(parts) {
  const list = (key, text = (item) => item) => uniqueBy(parts.flatMap((part) => part[key]), text)
  return {
    summary: parts.map((part) => part.summary).filter(Boolean).join(' '),
    decisions: list('decisions').slice(0, 14),
    actions: list('actions', (item) => item.what).slice(0, MOST_ACTIONS),
    questions: list('questions').slice(0, 8),
  }
}

/* The last answer: { title, summary }. */
export function readTitle(raw) {
  const value = parseJson(raw)
  const title = clean(value?.title, 70).replace(/^["“]|["”]$/g, '')
  return title ? { title, summary: clean(value?.summary, 1100) } : null
}

/* ---------- the notes ---------- */

const dayWords = (date, timeZone) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(date)
const timeWords = (date, timeZone) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(date)

/* The two notes a meeting becomes. `notes` is joinNotes' result (with `title`, and `summary` when the
   last question gave one), `turns` the conversation. The titles differ, so [[ ]] finds each. */
export function meetingNotes({ notes, turns, startedAt, durationMs, labelled = true, timeZone }) {
  const date = new Date(startedAt)
  const name = clean(notes.title, 70) || 'Meeting'
  const title = `${name} · ${dayWords(date, timeZone)}`
  const transcriptTitle = `${title} · Transcript`
  const when = `${dayWords(date, timeZone)}, ${timeWords(date, timeZone)} · ${durationWords(durationMs)}`
  const bullets = (list) => list.map((item) => `- ${item}`).join('\n')
  const todo = notes.actions.map((item) => `- [ ] ${item.who ? `${item.who}: ` : ''}${item.what}${item.due ? ` (${item.due})` : ''}`).join('\n')
  const sections = [
    `# ${title}`,
    `*${when} · written on this Mac*`,
    notes.summary && `## In short\n\n${notes.summary}`,
    notes.decisions.length && `## Decided\n\n${bullets(notes.decisions)}`,
    notes.actions.length && `## To do\n\n${todo}`,
    notes.questions.length && `## Still open\n\n${bullets(notes.questions)}`,
    `Everything that was said: [[${transcriptTitle}]]`,
    '#meeting',
  ].filter(Boolean)
  const transcript = [
    `# ${transcriptTitle}`,
    `*${when}. Heard by a program on this Mac, so names and numbers may be off.*`,
    transcriptLines(turns, { labelled }).join('\n\n'),
    `Notes: [[${title}]]`,
    '#meeting',
  ]
  return {
    writeUp: { title, markdown: sections.join('\n\n') },
    transcript: { title: transcriptTitle, markdown: transcript.join('\n\n') },
  }
}

/* When there is no AI to write it up, or it didn't answer: the transcript alone, kept. */
export function transcriptOnly({ turns, startedAt, durationMs, labelled = true, timeZone }) {
  const date = new Date(startedAt)
  const title = `Meeting · ${dayWords(date, timeZone)}, ${timeWords(date, timeZone)} · Transcript`
  const when = `${dayWords(date, timeZone)}, ${timeWords(date, timeZone)} · ${durationWords(durationMs)}`
  return {
    title,
    markdown: [`# ${title}`, `*${when}. Heard by a program on this Mac, so names and numbers may be off.*`, transcriptLines(turns, { labelled }).join('\n\n'), '#meeting'].join('\n\n'),
  }
}

/* ---------- follow-ups (Phase 74) ---------- */

/* What someone said will be done, one To-do sticky each, for Just in. Mine (`who` is "Me", the note's writer in `me`,
   or nobody) reads as the task; someone else's as "Sam: send the price list", so it reads as waiting on them. `from`
   goes under the words: where it came from. */
export function followUps(actions, { from = '', me = [] } = {}) {
  const mine = (who) => !who || /^(me|i|you)$/i.test(who) || me.some((name) => name && who.toLowerCase() === name.toLowerCase())
  return uniqueBy((Array.isArray(actions) ? actions : []).map((item) => ({ what: clean(item?.what, 240), who: clean(item?.who, 60), due: clean(item?.due, 60) })), (item) => item.what)
    .slice(0, MOST_ACTIONS)
    .map((item) => {
      // "Sam: send the deck", lower case after the name, unless the first word is a name or a short form ("OSAT").
      const what = mine(item.who) || /^\p{Lu}[\p{Lu}\d]/u.test(item.what) ? item.what : `${item.what[0].toLowerCase()}${item.what.slice(1)}`
      const words = `${mine(item.who) ? '' : `${item.who}: `}${what}${item.due ? ` (${item.due})` : ''}`
      return { title: words.slice(0, 120), markdown: from ? `${words}\n\n${from}` : words, what: 'todo', unsorted: true }
    })
}

/* Granola, through its own MCP server: its answers are text with <meeting …> tags and, for one meeting, its
   <summary> in Markdown. Read here, never trusted as instructions. */
const unescape = (text) => String(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&(apos|#39);/g, '\'').replace(/&amp;/g, '&')
const attr = (tag, name) => unescape(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || '')
const meetingOf = (tag) => ({ id: attr(tag, 'id'), title: clean(attr(tag, 'title'), 120) || 'A Granola meeting', at: attr(tag, 'meeting_at') || attr(tag, 'created_at'), url: attr(tag, 'url') })
const GRANOLA_URL = /^https:\/\/notes\.granola\.ai\/[\w/-]+$/

/* list_meetings' answer: [{ id, title, at, url }]. */
export function granolaMeetings(text) {
  return [...String(text || '').matchAll(/<meeting\s[^>]*>/g)].map(([tag]) => meetingOf(tag)).filter((meeting) => /^[\w-]{8,80}$/.test(meeting.id))
}

/* get_meetings' answer, for the meeting `id`: { title, at, url, creator, summary }, or null. `creator` is the first
   name of whoever wrote the notes ("Nate"), so their own steps read as theirs. */
export function granolaMeeting(text, id) {
  const all = String(text || '')
  const start = [...all.matchAll(/<meeting\s[^>]*>/g)].find(([tag]) => attr(tag, 'id') === id)
  if (!start) return null
  const body = all.slice(start.index, (all.indexOf('</meeting>', start.index) + 1 || all.length + 1) - 1)
  const meeting = meetingOf(start[0])
  return {
    ...meeting,
    url: GRANOLA_URL.test(meeting.url) ? meeting.url : '',
    creator: unescape(body.match(/^\s*([^\n(<]+?)\s*\(note creator\)/m)?.[1] || '').split(/\s+/)[0] || '',
    summary: unescape(body.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] || '').trim(),
  }
}

/* The steps a Granola summary lists under Next steps (or Action items, To-dos, Follow-ups): [{ what, who, due }].
   "- **Send the deck** (Sam)" is Sam's; a ticked one is done; the lines under a step only explain it.
   ponytail: Granola's own list only; a summary written without that heading gives none (an AI pass with
   notesMessages could read those if Granola templates vary). */
export function granolaSteps(summary) {
  const lines = String(summary || '').split('\n')
  const start = lines.findIndex((line) => /^#{1,4}\s*(next steps|action items|to-?dos?|follow[- ]?ups?)\b/i.test(line.trim()))
  if (start < 0) return []
  const level = lines[start].trim().match(/^#+/)[0].length
  const out = []
  for (const line of lines.slice(start + 1)) {
    const head = line.trim().match(/^(#+)\s/)
    if (head && head[1].length <= level) break
    const item = line.match(/^[-*]\s+(\[([ xX])\]\s*)?(.+)$/)
    if (!item || /x/i.test(item[2] || '')) continue
    let what = item[3].replace(/\*\*|__/g, '').trim()
    const owner = what.match(/\s*\(([A-Z][\w'’.-]*(?:\s[A-Z][\w'’.-]*){0,2})\)\s*$/)
    if (owner) what = what.slice(0, owner.index).trim()
    what = what.replace(/[.;:]+$/, '')
    if (what) out.push({ what, who: owner?.[1] || '', due: '' })
  }
  return out
}
