/* The small jobs OSAT gives the model chosen in Settings → Bots (a cloud model, or the AI on
   this Mac): unpack a packed node into branches, and suggest where stickies still to sort
   belong (Help me sort). Each is a question in plain words and a forgiving
   reader of the answer, since small models don't always keep to the format. Pure. */

import { markdownTree, NodeFileError } from './node-file.mjs'
import { WHATS } from './what-model.mjs'

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

/* ---------- Sort Unsorted ---------- */

const plain = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/* Every sticky in Unsorted against every place it could go (a node or a branch, with a
   couple of the stickies already in it as examples). `places` are { name, peek: [words] },
   `stickies` the words of each. */
export function sortUnsortedMessages({ places, stickies }) {
  return [SYSTEM, {
    role: 'user',
    content: `These are someone's notes. A sticky is one thought. A topic gathers stickies about one thing, and a branch is a group inside a topic.

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
    const named = /^(?:a\s+)?(?:new|make|create)\b\s*(?:node|topic|place|branch)?\s*[:\-–—]?\s*(.+)$/i.exec(value)
    let place = -1
    let name = ''
    if (number) place = Number(number[1]) - 1
    else if (named) name = named[1].replace(/^["“'‘]+|["”'’.]+$/g, '').replace(/^(?:node|topic|place)\s*[:\-–—]?\s*/i, '').trim().slice(0, 60)
    else place = byName.get(plain(value)) ?? -1
    if (name && byName.has(plain(name))) { place = byName.get(plain(name)); name = '' }
    if (place >= 0 && place < placeNames.length) homes.push({ sticky, place })
    else if (name && plain(name)) fresh.set(plain(name), { name: fresh.get(plain(name))?.name || name, stickies: [...(fresh.get(plain(name))?.stickies || []), sticky] })
    else continue
    seen.add(sticky)
  }
  return { homes, made: [...fresh.values()].filter((group) => group.stickies.length > 1) }
}

/* ---------- What is it? (Phase 67) ---------- */

/* The stickies code couldn't read on its own (what-model.mjs), each to be named in one word. */
export function whatMessages(stickies) {
  return [SYSTEM, {
    role: 'user',
    content: `These are stickies someone wrote quickly. Say what each one is, in one word:
idea (something to try or build), question (something to find out), problem (something wrong), todo (something to do), date (something happening on a day), buy (something to buy), note (anything else).

${stickies.map((words, index) => `${index + 1}. ${clip(words, 200).replace(/\s+/g, ' ')}`).join('\n')}

Write one line per sticky: its number, a colon and the word. For example:
1: idea
2: buy`,
  }]
}

// Words a model uses for each kind besides its own.
const WHAT_WORDS = {
  idea: 'idea', thought: 'idea', question: 'question', problem: 'problem', bug: 'problem', issue: 'problem', complaint: 'problem',
  todo: 'todo', 'to do': 'todo', 'to-do': 'todo', task: 'todo', chore: 'todo', date: 'date', event: 'date', appointment: 'date',
  calendar: 'date', buy: 'buy', shopping: 'buy', grocery: 'buy', groceries: 'buy', purchase: 'buy', note: 'note', other: 'note',
}

/* [{ sticky, what }] (0-based), each sticky once, only kinds there are. */
export function readWhatAnswer(text, stickyCount) {
  const found = new Map()
  for (const line of unwrap(text).split('\n')) {
    const match = /^\s*(?:sticky\s*)?#?(\d+)\s*(?:[:.)=→]|-+>?)+\s*\**\s*([a-z][a-z -]*)/i.exec(line.replace(/[*_`]/g, ''))
    if (!match) continue
    const sticky = Number(match[1]) - 1
    const said = match[2].toLowerCase().trim()
    const what = WHAT_WORDS[said] || WHAT_WORDS[said.split(/\s+/)[0]]
    if (sticky < 0 || sticky >= stickyCount || found.has(sticky) || !WHATS.includes(what)) continue
    found.set(sticky, what)
  }
  return [...found].map(([sticky, what]) => ({ sticky, what }))
}

/* ---------- A long sticky, shortened ---------- */

/* One long or tangled sticky as a short title and one or two plain sentences, in the
   writer's own voice. The sticky itself never changes; this is only how it reads in a list. */
export function gistMessages(words) {
  return [SYSTEM, {
    role: 'user',
    content: `This is one sticky someone wrote quickly. It may be long or tangled.

${clip(words, 4000)}

Answer in exactly two lines:
Title: a short title, at most 8 words
Gist: what it says in one or two plain sentences, at most 40 words, written as the person would ("Call Jordan about…", not "The user wants…")`,
  }]
}

/* { title, gist } from the answer, or null when it had neither. Forgiving: a missing
   "Title:" takes the first line, quotes and a trailing full stop on the title go. */
export function readGistAnswer(text) {
  const lines = unwrap(text).split('\n').map((line) => line.replace(/[*_`#]/g, '').trim()).filter(Boolean)
  const pick = (label) => {
    const index = lines.findIndex((line) => new RegExp(`^${label}\\s*[:\\-–—]`, 'i').test(line))
    return index < 0 ? '' : lines[index].replace(new RegExp(`^${label}\\s*[:\\-–—]\\s*`, 'i'), '')
  }
  const tidy = (value, max) => value.replace(/^["“'‘]+|["”'’]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
  const title = tidy(pick('title') || (lines.length > 1 && !/^gist/i.test(lines[0]) ? lines[0] : ''), 80).replace(/\.$/, '')
  const gist = tidy(pick('gist') || pick('summary'), 400)
  return title || gist ? { title, gist } : null
}

/* ---------- A photo of paper stickies (Phase 72) ---------- */

/* The AI on this Mac looks at the photo (it goes with this question) and writes out each paper sticky. */
export function photoMessages() {
  return [SYSTEM, {
    role: 'user',
    content: `This photo shows paper sticky notes, or a page of handwritten notes. Write out each sticky note on its own line, in the writer's own words. Fix only obvious misreadings. A list written on one sticky stays on one line, its items separated by commas. Leave out anything that isn't writing.
If there is no writing, answer: none`,
  }]
}

/* The stickies in the answer: one per line, bullets and numbers gone, each once, at most 40. */
export function readPhotoAnswer(text) {
  const seen = new Set()
  return unwrap(text).split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.):])\s*/, '').replace(/^["“]+|["”]+$/g, '').trim().slice(0, 600))
    .filter((line) => {
      const key = line.toLowerCase()
      // An introduction ("Here are the notes:") ends with a colon; a sticky doesn't.
      if (!line || /^none\.?$/i.test(line) || line.endsWith(':') || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 40)
}
