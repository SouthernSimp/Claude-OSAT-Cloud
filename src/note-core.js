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

export function normalizeNote(value, index = 0) {
  if (!isObject(value)) return null
  const markdown = cleanString(value.markdown, cleanString(value.text, cleanString(value.body)))
  const title = cleanString(value.title, markdown.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '') || 'Untitled note')
  const stamp = new Date(Date.now() + index).toISOString()
  return {
    id: cleanString(value.id) || uid('note'),
    title,
    markdown,
    tags: [...new Set([...(Array.isArray(value.tags) ? value.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.toLowerCase()) : []), ...parseTags(`${title}\n${markdown}`)])],
    createdAt: cleanString(value.createdAt, cleanString(value.created, stamp)),
    updatedAt: cleanString(value.updatedAt, cleanString(value.updated, stamp)),
    folderId: cleanString(value.folderId) || null,
    originCaptureId: cleanString(value.originCaptureId) || null,
    pinned: Boolean(value.pinned),
    archived: Boolean(value.archived),
    trashedAt: cleanString(value.trashedAt) || null,
  }
}
