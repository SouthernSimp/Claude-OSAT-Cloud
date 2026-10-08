/* Webhooks (Phase 46): OSAT tells other services when something happens here, and services
   add stickies through an ntfy topic (a relay OSAT reads, so the Mac never opens to the internet).
   Pure: which moments a change holds, the message each one sends, the addresses OSAT accepts,
   the settings file's shape, and the stickies an ntfy reply carries. desktop/bots/webhooks.cjs
   does the sending, the waiting and the reading. */

export const MOMENTS = [
  { id: 'sticky.added', label: 'A sticky is added' },
  { id: 'sticky.filed', label: 'A sticky is filed into a topic' },
  { id: 'topic.added', label: 'A topic is added' },
  { id: 'journal.written', label: 'Something is written in the journal' },
]
export const NTFY_SERVER = 'https://ntfy.sh'
export const SOURCE = 'Webhook'

const MOMENT_IDS = new Set(MOMENTS.map((moment) => moment.id))
export const MAX_HOOKS = 20
const MAX_TEXT = 8000
// Only what was made a moment ago counts as added: an Undo, an import or another device catching up isn't news.
const FRESH_MS = 10 * 60 * 1000
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/
const TOPIC = /^[A-Za-z0-9_-]{24,64}$/
const NTFY_ID = /^[A-Za-z0-9]{1,64}$/
const ID = /^[\w-]{1,64}$/

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const words = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const iso = (value) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null)

/* One plain line, short enough for a chat message. */
export function oneLine(text, max = 200) {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/* A web address OSAT may send to: https, or plain http only to this Mac. Throws a plain sentence. */
export function webhookAddress(value) {
  const text = words(value, 2000)
  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error('That isn’t a web address. Paste the whole address, starting with https://.')
  }
  const local = LOOPBACK.test(url.hostname) || url.hostname.endsWith('.localhost')
  if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.href
  if (url.protocol === 'http:') throw new Error('Use an https:// address. Plain http is only for addresses on this Mac.')
  throw new Error('That isn’t a web address. Paste the whole address, starting with https://.')
}

/* An ntfy server: the same rule, without a trailing slash, a question or a #. */
export function ntfyServer(value) {
  const url = new URL(webhookAddress(value))
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/* "hooks.zapier.com" → "Zapier"; this Mac's own addresses → "This Mac". */
export function hookName(address) {
  let host = ''
  try {
    host = new URL(address).hostname
  } catch {
    return 'Webhook'
  }
  if (LOOPBACK.test(host) || host.endsWith('.localhost')) return 'This Mac'
  const labels = host.split('.')
  const name = labels.length > 1 ? labels.at(-2) : labels[0]
  return name ? name[0].toUpperCase() + name.slice(1) : 'Webhook'
}

function cleanHook(hook) {
  if (!isObject(hook) || !ID.test(hook.id)) return []
  let url
  try {
    url = webhookAddress(hook.url)
  } catch {
    return []
  }
  const last = isObject(hook.last) && iso(hook.last.at) ? { at: hook.last.at, ok: hook.last.ok === true, text: words(hook.last.text, 300) } : null
  return [{
    id: hook.id,
    name: words(hook.name, 40) || hookName(url),
    url,
    on: hook.on !== false,
    events: [...new Set(Array.isArray(hook.events) ? hook.events.filter((event) => MOMENT_IDS.has(event)) : [])],
    last,
  }]
}

/* <data folder>/webhooks.json: the addresses OSAT sends to, and the ntfy topic it reads. */
export function cleanHookSettings(value) {
  const input = isObject(value) ? value : {}
  const inbox = isObject(input.inbox) ? input.inbox : {}
  let server = NTFY_SERVER
  try {
    if (inbox.server) server = ntfyServer(inbox.server)
  } catch {
    // An unusable server falls back to ntfy.sh's own.
  }
  const topic = TOPIC.test(inbox.topic) ? inbox.topic : ''
  return {
    hooks: (Array.isArray(input.hooks) ? input.hooks : []).flatMap(cleanHook).slice(0, MAX_HOOKS),
    inbox: {
      on: inbox.on === true && Boolean(topic),
      server,
      topic,
      // Where reading picks up: the last message's id, or at first the time it was turned on.
      since: NTFY_ID.test(inbox.since) ? inbox.since : '',
      after: Number.isFinite(inbox.after) ? inbox.after : 0,
      lastAt: iso(inbox.lastAt),
    },
  }
}

const ntfyBase = ({ server, topic }) => `${server}/${topic}`
/* The address services send their words to. */
export const ntfyAddress = (inbox) => (inbox?.topic ? ntfyBase(inbox) : '')
/* Asks for what arrived since `since` (the last id, or a time); poll=1 answers at once. */
export const ntfyPollUrl = (inbox) => `${ntfyBase(inbox)}/json?poll=1${inbox.since ? `&since=${encodeURIComponent(inbox.since)}` : ''}`

/* An ntfy reply (one JSON message per line) → the stickies it carries (its title, if any, as the
   first line) and the newest id to read from next time. Anything sent before `after` (seconds) is left. */
export function readNtfy(body, { after = 0 } = {}) {
  const texts = []
  let last = null
  for (const line of String(body || '').split('\n')) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(message) || message.event !== 'message' || !NTFY_ID.test(message.id)) continue
    last = message.id
    if (Number(message.time) < after) continue
    const text = [words(message.title, 200), words(message.message, MAX_TEXT)].filter(Boolean).join('\n')
    if (text) texts.push(text.slice(0, MAX_TEXT))
  }
  return { texts, last }
}

/* ---------- moments: what a change to the workspace says happened ---------- */

const fresh = (record, now) => now - Date.parse(record?.createdAt) < FRESH_MS
const isSticky = (note) => note && !note.kind && !note.trashedAt && !note.archived && Boolean(String(note.markdown || '').trim())

/* The moments in one commit, from the workspace before and after it: a sticky added (with words,
   made just now), a sticky filed (it lands in a topic or branch), a topic added, the journal
   written. A sticky a service sent (source Webhook) is never sent back out, so nothing can loop. */
export function momentsOf(before, after, ops, { now = Date.now() } = {}) {
  const out = []
  const seen = new Set()
  const find = (doc, collection, id) => (doc?.[collection] || []).find((item) => item?.id === id)
  for (const op of ops || []) {
    if ((op?.t !== 'add' && op?.t !== 'patch') || (op.c !== 'notes' && op.c !== 'folders')) continue
    const id = op.t === 'add' ? op.v?.id : op.id
    if (seen.has(`${op.c}:${id}`)) continue
    seen.add(`${op.c}:${id}`)
    const old = find(before, op.c, id)
    const next = find(after, op.c, id)
    if (!next) continue
    if (op.c === 'folders') {
      if (!old && !next.parentId && next.kind !== 'branch' && fresh(next, now)) out.push({ event: 'topic.added', id })
    } else if (next.kind === 'day') {
      if (next.markdown !== old?.markdown && String(next.markdown || '').trim()) out.push({ event: 'journal.written', date: next.date })
    } else if (isSticky(next) && next.source !== SOURCE) {
      if (!old && fresh(next, now)) out.push({ event: 'sticky.added', id })
      else if (old && next.folderId && next.folderId !== old.folderId) out.push({ event: 'sticky.filed', id })
    }
  }
  return out
}

/* Where a folder sits: its topic and a branch path ("Beds › Raised"). A loose branch has no topic. */
function placeOf(folders, folderId) {
  const chain = []
  for (let folder = folders.find((item) => item.id === folderId); folder && chain.length < 12; folder = folders.find((item) => item.id === folder.parentId)) chain.unshift(folder)
  if (!chain.length) return { topic: null, branch: null }
  const top = chain[0].kind === 'branch' ? null : chain.shift()
  return { topic: top ? top.name : null, branch: chain.map((folder) => folder.name).join(' › ') || null }
}

/* The newest line of a journal page, without a list mark. */
export function journalLine(markdown) {
  const line = String(markdown || '').split('\n').map((item) => item.trim()).filter(Boolean).at(-1) || ''
  return line.replace(/^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').trim()
}

const dayWords = (date) => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))

/* What OSAT sends for a moment: { event, at, text, content, sticky? | topic? | journal? }. `text` and
   `content` are the same plain line, so Slack (text) and Discord (content) show it with no setup.
   Null when there is nothing to say (the record is gone, the journal line is empty). */
export function payloadFor(moment, doc, { at = new Date().toISOString() } = {}) {
  const folders = doc?.folders || []
  const send = (text, more) => ({ event: moment.event, at, text: oneLine(text, 300), content: oneLine(text, 300), ...more })
  if (moment.event === 'test') return send('OSAT is connected. This is a test from Settings → Bots.', {})
  if (moment.event === 'topic.added') {
    const folder = folders.find((item) => item.id === moment.id)
    return folder ? send(`New topic: ${folder.name}`, { topic: { id: folder.id, name: folder.name } }) : null
  }
  if (moment.event === 'journal.written') {
    const page = (doc?.notes || []).find((note) => note?.id === `day-${moment.date}`)
    const line = oneLine(journalLine(page?.markdown), 1000)
    return line ? send(`Journal, ${dayWords(moment.date)}: ${line}`, { journal: { date: moment.date, line } }) : null
  }
  const note = (doc?.notes || []).find((item) => item?.id === moment.id)
  if (!note) return null
  const { topic, branch } = placeOf(folders, note.folderId)
  const where = [topic, branch].filter(Boolean).join(' › ')
  const sticky = { id: note.id, title: note.title, text: String(note.markdown || '').trim(), topic, branch, source: note.source || null }
  if (moment.event === 'sticky.filed') return send(`Filed into ${where}: ${note.title}`, { sticky })
  return send(where ? `New sticky in ${where}: ${note.title}` : `New sticky: ${note.title}`, { sticky })
}
