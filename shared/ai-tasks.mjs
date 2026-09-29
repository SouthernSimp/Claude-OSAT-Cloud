/* The small jobs OSAT gives the model chosen in Settings → Bots (a cloud model, or the AI on
   this Mac): unpack a packed node into branches, suggest where stickies still to sort
   belong (Help me sort), and name a scan. Each is a question in plain words and a forgiving
   reader of the answer, since small models don't always keep to the format. Pure. */

import { markdownTree, NodeFileError } from './node-file.mjs'

const clip = (value, max) => String(value || '').trim().slice(0, max)
const SYSTEM = { role: 'system', content: 'You help someone organise their own notes in OSAT. Keep their words where you can, never invent facts, and answer only in the form asked, with no introduction.' }

/* Code fences and a leading "Here is…" line go; the rest is the answer. */
const unwrap = (text) => String(text || '').replace(/```[a-z]*\n?/gi, '').replace(/^\s*(here(’|')?s|here is|sure)[^\n]*\n/i, '').trim()

/* ---------- Unpack with AI ---------- */

export function unpackMessages({ title, summary, branches = [] }) {
  return [SYSTEM, {
    role: 'user',
    content: `Unpack this note into 2 to 6 branches, each with a few short stickies (one line each).
Write "## " before each branch name and "- " before each sticky. Nothing else.${branches.length ? `\nIt already has these branches, so don't repeat them: ${branches.join(', ')}.` : ''}

Note: ${clip(title, 120)}
${clip(summary, 6000)}`,
  }]
}

/* The answer as { branches, leaves } to add to the node. Throws a plain sentence when the
   model suggested nothing usable. */
export function readUnpackAnswer(text, title = 'Node') {
  let tree
  try {
    tree = markdownTree(`# ${clip(title, 72) || 'Node'}\n\n${unwrap(text)}`)
  } catch (error) {
    if (!(error instanceof NodeFileError)) throw error
    tree = null
  }
  if (!tree || (!tree.branches.length && !tree.leaves.length)) throw new Error('The AI didn’t suggest any branches. Try again, or unpack it by hand.')
  return { branches: tree.branches, leaves: tree.leaves }
}

/* ---------- Help me sort ---------- */

export function sortMessages({ node, branches, stickies }) {
  return [SYSTEM, {
    role: 'user',
    content: `The node "${clip(node, 80)}" has these branches:
${branches.map((name, index) => `${index + 1}. ${clip(name, 80)}`).join('\n')}

These stickies in it still need a branch:
${stickies.map((words, index) => `${index + 1}. ${clip(words, 300).replace(/\s+/g, ' ')}`).join('\n')}

For each sticky, write one line: its number, a colon, and the number of the branch it belongs in, or "none" if no branch fits. For example:
1: 2
2: none`,
  }]
}

/* [{ sticky, branch }] (0-based), each sticky once, only numbers that exist. */
export function readSortAnswer(text, branchCount, stickyCount) {
  const found = new Map()
  for (const line of unwrap(text).split('\n')) {
    const match = /^\s*(?:sticky\s*)?#?(\d+)\s*(?:[:.)=→]|-+>?)+\s*(?:branch\s*)?#?(\d+|none)\b/i.exec(line)
    if (!match) continue
    const sticky = Number(match[1]) - 1
    const branch = /none/i.test(match[2]) ? -1 : Number(match[2]) - 1
    if (sticky < 0 || sticky >= stickyCount || found.has(sticky)) continue
    found.set(sticky, branch)
  }
  return [...found].filter(([, branch]) => branch >= 0 && branch < branchCount).map(([sticky, branch]) => ({ sticky, branch }))
}

/* ---------- a scan's name ---------- */

export function nameMessages({ text, file = '' }) {
  return [SYSTEM, {
    role: 'user',
    content: `This is the text of a scanned page${file ? ` (the file is called "${clip(file, 120)}")` : ''}:
"""
${clip(text, 6000)}
"""
Give it a short name, a few words a person would pick (like "Car insurance renewal"), and a one-paragraph summary of what it is and anything that needs doing. Answer exactly like this:
Name: …
Summary: …`,
  }]
}

/* { name, summary } from the answer. Throws a plain sentence when there is no name. */
export function readNameAnswer(text) {
  const body = unwrap(text).replace(/\*\*/g, '')
  const name = /^\s*name\s*:\s*(.+)$/im.exec(body)?.[1]?.replace(/^["“]|["”]$/g, '').trim().slice(0, 80) || ''
  const summary = /^\s*summary\s*:\s*([\s\S]+)$/im.exec(body)?.[1]?.trim().slice(0, 1600) || ''
  if (!name) throw new Error('The AI didn’t suggest a name. Name it yourself, or try again.')
  return { name, summary }
}
