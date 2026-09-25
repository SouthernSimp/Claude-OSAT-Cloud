/* Text edits for the Markdown editor, as pure functions over
   { text, start, end } so they can be unit-tested without a textarea.
   Every function returns { text, start, end } describing the new value and
   where the caret/selection should land. */

const LIST_PREFIX = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/
const QUOTE_PREFIX = /^(\s*>\s?)/

const lineBounds = (text, index) => {
  const start = text.lastIndexOf('\n', index - 1) + 1
  const endBreak = text.indexOf('\n', index)
  return { start, end: endBreak === -1 ? text.length : endBreak }
}

/* Wrap the selection (or the word at the caret) in `before`…`after`; unwrap if already wrapped. */
export function wrapSelection({ text, start, end }, before, after = before, placeholder = 'text') {
  let from = start, to = end
  if (from === to) {
    while (from > 0 && /[\p{L}\p{N}_]/u.test(text[from - 1])) from -= 1
    while (to < text.length && /[\p{L}\p{N}_]/u.test(text[to])) to += 1
  }
  const selected = text.slice(from, to)
  const outerBefore = text.slice(Math.max(0, from - before.length), from)
  const outerAfter = text.slice(to, to + after.length)
  if (outerBefore === before && outerAfter === after) {
    const next = `${text.slice(0, from - before.length)}${selected}${text.slice(to + after.length)}`
    return { text: next, start: from - before.length, end: to - before.length }
  }
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length)
    return { text: `${text.slice(0, from)}${inner}${text.slice(to)}`, start: from, end: from + inner.length }
  }
  const body = selected || placeholder
  const next = `${text.slice(0, from)}${before}${body}${after}${text.slice(to)}`
  return { text: next, start: from + before.length, end: from + before.length + body.length }
}

/* Apply a per-line transform to every line touched by the selection. */
function mapLines({ text, start, end }, transform) {
  const first = lineBounds(text, start).start
  const last = lineBounds(text, Math.max(start, end - (end > start && text[end - 1] === '\n' ? 1 : 0))).end
  const block = text.slice(first, last)
  const lines = block.split('\n').map(transform)
  const next = lines.join('\n')
  const delta = next.length - block.length
  return {
    text: `${text.slice(0, first)}${next}${text.slice(last)}`,
    start: start === end ? Math.max(first, start + (lines[0].length - block.split('\n')[0].length)) : first,
    end: start === end ? Math.max(first, start + (lines[0].length - block.split('\n')[0].length)) : last + delta,
  }
}

const stripPrefix = (line) => line.replace(LIST_PREFIX, '$1').replace(QUOTE_PREFIX, '')

/* Toggle a list marker ("- ", "1. ", "- [ ] ") or a quote on the selected lines. */
export function toggleLinePrefix(state, kind) {
  const first = lineBounds(state.text, state.start)
  const firstLine = state.text.slice(first.start, first.end)
  const has = {
    bullet: /^\s*[-*+]\s+(?!\[[ xX]\]\s)/.test(firstLine),
    ordered: /^\s*\d+[.)]\s+/.test(firstLine),
    task: /^\s*[-*+]\s+\[[ xX]\]\s+/.test(firstLine),
    quote: QUOTE_PREFIX.test(firstLine),
  }[kind]
  let counter = 0
  return mapLines(state, (line) => {
    const indent = line.match(/^\s*/)[0]
    const body = stripPrefix(line).replace(/^\s*/, '')
    if (has) return `${indent}${body}`
    if (!line.trim() && kind !== 'quote') return line
    if (kind === 'bullet') return `${indent}- ${body}`
    if (kind === 'task') return `${indent}- [ ] ${body}`
    if (kind === 'ordered') { counter += 1; return `${indent}${counter}. ${body}` }
    return `> ${line}`
  })
}

export function setHeading(state, level) {
  return mapLines(state, (line) => {
    const body = line.replace(/^#{1,6}\s+/, '')
    return level ? `${'#'.repeat(level)} ${body}` : body
  })
}

export function indentLines(state, outdent = false) {
  return mapLines(state, (line) => outdent ? line.replace(/^ {1,2}/, '').replace(/^\t/, '') : `  ${line}`)
}

/* Enter inside a list continues it; Enter on an empty item ends the list. */
export function continueList({ text, start, end }) {
  if (start !== end) return null
  const { start: lineStart } = lineBounds(text, start)
  const line = text.slice(lineStart, start)
  const match = line.match(LIST_PREFIX)
  if (!match) {
    const quote = line.match(QUOTE_PREFIX)
    if (!quote) return null
    if (line.trim() === '>') {
      const next = `${text.slice(0, lineStart)}${text.slice(start)}`
      return { text: next, start: lineStart, end: lineStart }
    }
    const insert = `\n${quote[1]}`
    return { text: `${text.slice(0, start)}${insert}${text.slice(end)}`, start: start + insert.length, end: start + insert.length }
  }
  const [prefix, indent, marker, space, task] = match
  if (line.trim() === prefix.trim()) {
    // Empty item: leave the list.
    const next = `${text.slice(0, lineStart)}${text.slice(start)}`
    return { text: next, start: lineStart, end: lineStart }
  }
  const nextMarker = /\d/.test(marker) ? `${Number.parseInt(marker, 10) + 1}${marker.slice(-1)}` : marker
  const insert = `\n${indent}${nextMarker}${space}${task ? '[ ] ' : ''}`
  return { text: `${text.slice(0, start)}${insert}${text.slice(end)}`, start: start + insert.length, end: start + insert.length }
}

export function toggleTaskAt(text, lineIndex) {
  const lines = String(text).split('\n')
  const line = lines[lineIndex]
  if (line === undefined) return text
  const match = line.match(/^(\s*[-*+]\s+)\[([ xX])\](\s.*)?$/)
  if (!match) return text
  lines[lineIndex] = `${match[1]}[${match[2] === ' ' ? 'x' : ' '}]${match[3] || ''}`
  return lines.join('\n')
}

/* Toggle the checkbox on the caret's line; turn a plain line into a task if it has none. */
export function toggleTaskAtCaret(state) {
  const { text, start } = state
  const lineIndex = text.slice(0, start).split('\n').length - 1
  const lines = text.split('\n')
  if (/^\s*[-*+]\s+\[[ xX]\]/.test(lines[lineIndex])) {
    return { text: toggleTaskAt(text, lineIndex), start, end: state.end }
  }
  return toggleLinePrefix(state, 'task')
}

export function insertAtCaret({ text, start, end }, snippet, selectFrom = null, selectTo = null) {
  const next = `${text.slice(0, start)}${snippet}${text.slice(end)}`
  const from = selectFrom === null ? start + snippet.length : start + selectFrom
  const to = selectTo === null ? from : start + selectTo
  return { text: next, start: from, end: to }
}

/* The token being typed before the caret for `[[` or `#` autocomplete. */
export function autocompleteContext(text, caret) {
  const before = text.slice(0, caret)
  const wiki = before.match(/\[\[([^\]\n]*)$/)
  if (wiki) return { kind: 'wikilink', query: wiki[1], from: caret - wiki[0].length }
  const tag = before.match(/(?:^|[^\p{L}\p{N}_/#-])#([\p{L}\p{N}_-]*)$/u)
  if (tag) return { kind: 'tag', query: tag[1], from: caret - tag[1].length - 1 }
  return null
}

export function applyAutocomplete({ text, end }, context, value) {
  const replacement = context.kind === 'wikilink' ? `[[${value}]]` : `#${value} `
  const next = `${text.slice(0, context.from)}${replacement}${text.slice(end)}`
  const caret = context.from + replacement.length
  return { text: next, start: caret, end: caret }
}
