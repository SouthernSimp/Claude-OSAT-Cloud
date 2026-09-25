/* What a sticky card shows: the note's title on top and a lightly cleaned
   version of its Markdown underneath. Raw enough to feel like paper, tidy
   enough to read at a glance. */

const TAG = /((?:^|[^\p{L}\p{N}_/#-])#[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*)/gu

const plain = (text) => String(text || '').replace(/^#+\s*/, '').replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, ' ').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

export function cardBody(note) {
  if (!note) return ''
  const lines = String(note.markdown || '').split('\n')
  const firstIndex = lines.findIndex((line) => line.trim())
  // A first line that only restates the title is noise on a small sheet.
  const start = firstIndex >= 0 && plain(lines[firstIndex]) === plain(note.title) ? firstIndex + 1 : 0
  return lines.slice(start).join('\n')
    .replace(/^\s*[-*+]\s+\[[xX]\]\s+/gm, '☑ ')
    .replace(/^\s*[-*+]\s+\[ \]\s+/gm, '☐ ')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*\n])\*([^*\n]+)\*/g, '$1$2')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, alias) => `→ ${alias || target}`)
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

/* Split text into plain runs and #tag runs for highlighting. */
export function tagRuns(text) {
  const runs = []
  let last = 0
  for (const match of String(text || '').matchAll(TAG)) {
    const token = match[1]
    const lead = token.startsWith('#') ? '' : token[0]
    const index = match.index + lead.length
    if (index > last) runs.push({ text: text.slice(last, index) })
    runs.push({ text: token.slice(lead.length), tag: true })
    last = index + token.length - lead.length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs
}

export const firstLine = (text) => String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || ''

/* Text typed into the composer becomes a note: a first line as the title,
   the whole thing as the body. */
export function composedNote(text) {
  const raw = String(text || '').trim()
  const first = firstLine(raw).replace(/^#+\s*/, '')
  const title = first.replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 120) || first.slice(0, 120) || 'Untitled note'
  return { title, markdown: raw }
}
