/* The small jobs OSAT gives the model chosen in Settings → Bots (a cloud model, or the AI on
   this Mac): unpack a packed node into branches, and suggest where stickies still to sort
   belong (Help me sort). Each is a question in plain words and a forgiving
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

/* ---------- Sort Unsorted ---------- */

const plain = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/* Every sticky in Unsorted against every place it could go (a node or a branch, with a
   couple of the stickies already in it as examples). `places` are { name, peek: [words] },
   `stickies` the words of each. */
export function sortUnsortedMessages({ places, stickies }) {
  return [SYSTEM, {
    role: 'user',
    content: `These are someone's notes. A sticky is one thought. A node is a topic, and a branch is a group inside a node.

Places a sticky can go:
${places.map(({ name, peek = [] }, index) => `${index + 1}. ${clip(name, 80)}${peek.length ? ` (has: ${peek.slice(0, 2).map((words) => clip(words, 30).replace(/\s+/g, ' ')).join('; ')})` : ''}`).join('\n') || '(none yet)'}

Stickies that have no place yet:
${stickies.map((words, index) => `${index + 1}. ${clip(words, 160).replace(/\s+/g, ' ')}`).join('\n')}

For each sticky, write one line: its number, a colon, and the number of the place it belongs in. If two or more stickies belong together but no place fits, give them the same new name, like "new: Cats". If you are not sure, write "none". For example:
1: 2
2: new: Cats
3: none`,
  }]
}

/* What the model said for each sticky: { homes: [{ sticky, place }], made: [{ name, stickies }] }
   (0-based; each sticky once). A new name given to only one sticky is dropped: a single
   leftover never becomes a node of its own. A "new" name that is really a place, or a place
   written as its name, is that place. */
export function readSortUnsortedAnswer(text, placeNames, stickyCount) {
  const byName = new Map()
  placeNames.forEach((name, index) => {
    for (const key of [plain(name), plain(String(name).split('/').pop())]) if (key && !byName.has(key)) byName.set(key, index)
  })
  const seen = new Set()
  const homes = []
  const fresh = new Map()
  for (const line of unwrap(text).split('\n')) {
    const match = /^\s*(?:sticky\s*)?#?(\d+)\s*(?:[:.)=→]|-+>?)+\s*(.+?)\s*$/i.exec(line)
    if (!match) continue
    const sticky = Number(match[1]) - 1
    if (sticky < 0 || sticky >= stickyCount || seen.has(sticky)) continue
    const value = match[2].replace(/[*_`]/g, '').trim()
    if (/^(none|n\/a|unsure|unknown|skip|no place|-+)(\s|$|[.,])/i.test(value)) { seen.add(sticky); continue }
    const number = /^(?:place\s*)?#?(\d+)\b/i.exec(value)
    const named = /^(?:a\s+)?(?:new|make|create)\b\s*(?:node|place|branch)?\s*[:\-–—]?\s*(.+)$/i.exec(value)
    let place = -1
    let name = ''
    if (number) place = Number(number[1]) - 1
    else if (named) name = named[1].replace(/^["“'‘]+|["”'’.]+$/g, '').replace(/^(?:node|place)\s*[:\-–—]?\s*/i, '').trim().slice(0, 60)
    else place = byName.get(plain(value)) ?? -1
    if (name && byName.has(plain(name))) { place = byName.get(plain(name)); name = '' }
    if (place >= 0 && place < placeNames.length) homes.push({ sticky, place })
    else if (name && plain(name)) fresh.set(plain(name), { name: fresh.get(plain(name))?.name || name, stickies: [...(fresh.get(plain(name))?.stickies || []), sticky] })
    else continue
    seen.add(sticky)
  }
  return { homes, made: [...fresh.values()].filter((group) => group.stickies.length > 1) }
}

/* ---------- Where does this branch belong? ---------- */

/* One branch against every place it could go (as in Sort Unsorted: `places` are { name, peek }).
   `peek` is a few words from inside the branch. */
export function whereMessages({ branch, peek = [], places }) {
  return [SYSTEM, {
    role: 'user',
    content: `These are someone's notes. A sticky is one thought. A node is a topic, and a branch is a group inside a node.

The branch "${clip(branch, 80)}" is a group of stickies${peek.length ? ` about: ${peek.slice(0, 5).map((words) => clip(words, 40).replace(/\s+/g, ' ')).join('; ')}` : ''}.

Places it could go:
${places.map(({ name, peek: inside = [] }, index) => `${index + 1}. ${clip(name, 80)}${inside.length ? ` (has: ${inside.slice(0, 2).map((words) => clip(words, 30).replace(/\s+/g, ' ')).join('; ')})` : ''}`).join('\n') || '(none yet)'}

Write one line: the exact name of the place it belongs in (copy it from the list), a colon, and a few words saying why. If no place fits, write "none". For example:
Clients / Ana: both are about clients`,
  }]
}

/* { place (0-based), why } for the place the model picked, or null for "none" or an answer that
   names no place there is. A place written as its name counts as that place. */
export function readWhereAnswer(text, placeNames) {
  const line = unwrap(text).split('\n').map((value) => value.replace(/[*_`]/g, '').trim()).find(Boolean) || ''
  if (!line || /^(none|n\/a|unsure|unknown|skip|no place|no\b)/i.test(line)) return null
  const reason = (rest) => clip(rest.replace(/^[\s\-–—:.]+/, ''), 140)
  const names = placeNames.map((name, index) => ({ index, name: String(name), key: plain(name) })).filter(({ key }) => key)
  // Its name starts the line: the longest one that does ("Clients / Ana" is not "Clients"), colon or not.
  const key = plain(line)
  const named = [...names].sort((a, b) => b.key.length - a.key.length).find((place) => key.startsWith(place.key))
  if (named) {
    const same = line.toLowerCase().startsWith(named.name.toLowerCase())
    return { place: named.index, why: reason(same ? line.slice(named.name.length) : line.split(/\s*(?::|—|–|\s-\s)\s*/).slice(1).join(': ')) }
  }
  // Or its number (some models answer with the number they were shown).
  const number = /^(?:place\s*)?#?(\d+)\b\s*(?:[:.)=→]|-+>?)*\s*(.*)$/i.exec(line)
  if (number) {
    const place = Number(number[1]) - 1
    if (place < 0 || place >= placeNames.length) return null
    const own = plain(placeNames[place])
    const rest = number[2]
    return { place, why: reason(own && plain(rest).startsWith(own) ? rest.split(/\s*(?::|—|–|\s-\s)\s*/).slice(1).join(': ') : rest) }
  }
  // Or the last part of a name ("Ana" for "Clients / Ana").
  const [head, ...rest] = line.split(/\s*(?::|—|–|\s-\s)\s*/)
  const place = placeNames.findIndex((name) => plain(String(name).split('/').pop()) === plain(head))
  return place < 0 ? null : { place, why: reason(rest.join(': ')) }
}
