/* The note record itself. Kept dependency-free so the organization and board
   models can import it without pulling in the whole workspace normalizer. */

const HAS_LETTER = /\p{L}/u
const TAG_PATTERN = /(^|[^\p{L}\p{N}_-])#([\p{L}\p{N}_-]+)/gu

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const cleanString = (value, fallback = '') => (typeof value === 'string' ? value : fallback)
const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

export function parseTags(text) {
  const tags = []
  TAG_PATTERN.lastIndex = 0
  let match
  while ((match = TAG_PATTERN.exec(String(text || ''))) !== null) {
    const tag = match[2].toLowerCase()
    if (HAS_LETTER.test(tag) && !tags.includes(tag)) tags.push(tag)
  }
  return tags
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/* Sticky-note paper colours, for stickies and nodes. */
export const PAPERS = ['canary', 'apricot', 'rose', 'lilac', 'sky', 'mint', 'lime', 'bone']

/* Where a note or folder sits among its siblings. A missing rank is its creation time,
   so things never ranked by hand keep the order they were made in. */
export const rankOf = (item) => (Number.isFinite(item?.rank) ? item.rank : Date.parse(item?.createdAt) || 0)

export function normalizeNote(value, index = 0) {
  if (!isObject(value)) return null
  const markdown = cleanString(value.markdown)
  const title = cleanString(value.title, markdown.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '') || 'Untitled note')
  const stamp = new Date(Date.now() + index).toISOString()
  return {
    id: cleanString(value.id) || uid('note'),
    title,
    markdown,
    tags: [...new Set([...(Array.isArray(value.tags) ? value.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.toLowerCase()) : []), ...parseTags(`${title}\n${markdown}`)])],
    createdAt: cleanString(value.createdAt, stamp),
    updatedAt: cleanString(value.updatedAt, stamp),
    folderId: cleanString(value.folderId) || null,
    pinned: Boolean(value.pinned),
    archived: Boolean(value.archived),
    trashedAt: cleanString(value.trashedAt) || null,
    // A thought that arrived without a home (overlay, quick capture, AI, a clip) until it is sorted.
    unsorted: value.unsorted === true,
    source: cleanString(value.source) || null,
    // The one note per day: its journal page and that day's next steps.
    kind: value.kind === 'day' && DATE_KEY.test(value.date) ? 'day' : null,
    date: value.kind === 'day' && DATE_KEY.test(value.date) ? value.date : null,
    // Only kept once it was ranked by hand (see rankOf), so older notes don't all change.
    ...(Number.isFinite(value.rank) ? { rank: value.rank } : {}),
    ...(PAPERS.includes(value.color) ? { color: value.color } : {}),
    // A sticky set down freely on the Sky, in board points (not screen pixels).
    ...(Number.isFinite(value.at?.x) && Number.isFinite(value.at?.y) ? { at: { x: value.at.x, y: value.at.y } } : {}),
    // Which node each @ in it means, by id, so a renamed node never changes its words.
    ...refsOf(value.refs),
    // A day it names (from a scan), until Nate adds it to the Calendar or says Not now.
    ...askOf(value.ask),
    // What it is connected to (schema 10), drawn as a line; it never files or moves either end.
    ...linksOf(value.links),
    // Schema 12: the AI filed it for Nate (`filed`: when, and where it went), and a short
    // version of a long sticky in the AI's words (`gist`); the sticky's own words never change.
    ...filedOf(value.filed),
    ...(typeof value.gist === 'string' && value.gist.trim() ? { gist: value.gist.trim().slice(0, 400) } : {}),
  }
}

function filedOf(value) {
  if (!isObject(value) || value.by !== 'ai' || typeof value.at !== 'string' || typeof value.into !== 'string' || !value.into) return {}
  return { filed: { by: 'ai', at: value.at, into: value.into } }
}

/* Connections (schema 10): the other ends of the lines drawn from a note or a folder, as
   'note:<id>' or 'folder:<id>'. A connection only says two things relate. */
const LINK = /^(note|folder):[\w.-]{1,120}$/
export function linksOf(value) {
  if (!Array.isArray(value)) return {}
  const links = [...new Set(value.filter((key) => typeof key === 'string' && LINK.test(key)))].slice(0, 60)
  return links.length ? { links } : {}
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function askOf(value) {
  const event = isObject(value) && isObject(value.event) ? value.event : null
  if (!event || !DATE_KEY.test(event.date) || typeof event.title !== 'string' || !event.title.trim()) return {}
  return { ask: { event: { title: event.title.trim().slice(0, 120), date: event.date, time: TIME.test(event.time) ? event.time : '' } } }
}

function refsOf(value) {
  if (!isObject(value)) return {}
  const refs = Object.entries(value).filter(([name, id]) => name && name.length <= 120 && typeof id === 'string' && id).slice(0, 50)
  return refs.length ? { refs: Object.fromEntries(refs) } : {}
}
