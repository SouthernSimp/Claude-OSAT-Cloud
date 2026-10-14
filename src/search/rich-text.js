/* The quick sticky's rich text (Hyper N) → Markdown, the one way notes are kept. It reads only what a sticky can hold:
   words, line breaks, **bold**, *italic*, bullet and numbered lists (nested too). Anything else gives its words.
   Works on any DOM-like tree ({ nodeType, nodeName, childNodes, textContent }), so it is tested without a browser. */

const TEXT = 3
// A browser's childNodes is a NodeList, not an array.
const kids = (node) => Array.from(node?.childNodes || [])
const BLOCKS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE'])

function inline(node) {
  let out = ''
  for (const child of kids(node)) {
    if (child.nodeType === TEXT) { out += String(child.textContent || '').replace(/\u00a0/g, ' '); continue }
    const name = String(child.nodeName || '').toUpperCase()
    if (name === 'BR') { out += '\n'; continue }
    if (name === 'UL' || name === 'OL') continue // a list inside a line is its own block (see `list`)
    const words = inline(child)
    if (!words.trim()) { out += words; continue }
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(words)
    if (name === 'B' || name === 'STRONG') out += `${lead}**${core}**${trail}`
    else if (name === 'I' || name === 'EM') out += `${lead}*${core}*${trail}`
    else out += words
  }
  return out
}

function list(node, depth) {
  const ordered = String(node.nodeName).toUpperCase() === 'OL'
  const lines = []
  let n = 0
  for (const item of kids(node)) {
    if (String(item.nodeName || '').toUpperCase() !== 'LI') continue
    n += 1
    const marker = ordered ? `${n}.` : '-'
    const words = inline(item).replace(/\n+/g, ' ').trim()
    lines.push(`${'   '.repeat(depth)}${marker} ${words}`)
    for (const inner of kids(item)) {
      const name = String(inner.nodeName || '').toUpperCase()
      if (name === 'UL' || name === 'OL') lines.push(...list(inner, depth + 1))
    }
  }
  return lines
}

/* → the Markdown for everything under `root`. */
export function toMarkdown(root) {
  const blocks = []
  let line = ''
  const flush = () => { blocks.push(line); line = '' }
  for (const child of kids(root)) {
    const name = child.nodeType === TEXT ? '#text' : String(child.nodeName || '').toUpperCase()
    if (name === 'UL' || name === 'OL') { if (line) flush(); blocks.push(...list(child, 0)); continue }
    if (BLOCKS.has(name)) {
      if (line) flush()
      // A block holding a list (Chromium puts one inside a <div> sometimes) keeps it as a list.
      const nested = kids(child).some((inner) => ['UL', 'OL'].includes(String(inner.nodeName || '').toUpperCase()))
      if (nested) blocks.push(toMarkdown(child))
      else blocks.push(inline(child))
      continue
    }
    if (name === 'BR') { flush(); continue }
    line += name === '#text' ? String(child.textContent || '').replace(/\u00a0/g, ' ') : inline({ childNodes: [child] })
  }
  if (line) flush()
  // Spaces at the ends of lines go; at the start too, except a nested list's indent.
  return blocks.join('\n').replace(/[ \t]+$/gm, '').replace(/^[ \t]+(?=[^-\d\s])/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

/* What typing at the start of a line turns it into, as in Notes and Notion: "- " or "* " a bullet list, "1. " a numbered
   one. → 'insertUnorderedList' | 'insertOrderedList' | null. */
export function listFromTyping(lineText) {
  if (/^[-*•]\s$/.test(lineText)) return 'insertUnorderedList'
  if (/^1[.)]\s$/.test(lineText)) return 'insertOrderedList'
  return null
}
