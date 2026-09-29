/* Sort a pile: a table of its own for one pile of paper stickies. Toss them down around the
   quick input, drop one sticky on another to start a branch, ask for help, and when it's
   sorted send the whole pile to the Sky as a node (its branches inside it, or each branch a
   node of its own). Until then a pile lives in `settings.piles`, apart from the Sky, so a
   half-sorted pile is saved like everything else but never mixed into your nodes. Pure. */

import { PAPERS } from './note-core.js'
import { addFolder, addSticky } from './nodes-model.js'

export const CARD = { w: 164, h: 112, gap: 16 }
export const GROUP = { pad: 14, head: 44, cols: 3 }
// The quick input in the middle of the table: new stickies land around it, never on it.
export const MIDDLE = { w: 420, h: 150 }
const MAX_CARDS = 400
const MAX_TEXT = 2000

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const num = (value) => (Number.isFinite(value) ? Math.round(Math.max(-40000, Math.min(40000, value))) : 0)
let counter = 0
export const pileId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/* ---------- the data ---------- */

function normalizeGroup(value) {
  if (!isObject(value) || !text(value.id, 80)) return null
  return { id: value.id, name: text(value.name, 80), x: num(value.x), y: num(value.y), ...(PAPERS.includes(value.color) ? { color: value.color } : {}) }
}

function normalizeCard(value, groups) {
  const words = text(value?.text, MAX_TEXT)
  if (!isObject(value) || !text(value.id, 80) || !words) return null
  return {
    id: value.id,
    text: words,
    x: num(value.x),
    y: num(value.y),
    group: groups.has(value.group) ? value.group : null,
    ...(PAPERS.includes(value.color) ? { color: value.color } : {}),
  }
}

export function normalizePile(value) {
  if (!isObject(value) || !text(value.id, 80)) return null
  const groups = (Array.isArray(value.groups) ? value.groups : []).map(normalizeGroup).filter(Boolean)
  const ids = new Set(groups.map((group) => group.id))
  const cards = (Array.isArray(value.cards) ? value.cards : []).map((card) => normalizeCard(card, ids)).filter(Boolean).slice(0, MAX_CARDS)
  return { id: value.id, name: text(value.name, 80), createdAt: text(value.createdAt, 40) || new Date().toISOString(), cards, groups }
}

export const pilesOf = (state) => (Array.isArray(state?.settings?.piles) ? state.settings.piles.map(normalizePile).filter(Boolean) : [])

export function setPiles(state, piles) {
  return { ...state, settings: { ...(state.settings || {}), piles } }
}

/* Changes one pile (`change(pile) → pile`, or null to take it away). */
export function updatePile(state, id, change) {
  const piles = pilesOf(state)
  const next = piles.flatMap((pile) => {
    if (pile.id !== id) return [pile]
    const changed = change(pile)
    return changed ? [changed] : []
  })
  return setPiles(state, next)
}

export function newPile(state, name = '') {
  const pile = { id: pileId('pile'), name: text(name, 80), createdAt: new Date().toISOString(), cards: [], groups: [] }
  return { state: setPiles(state, [...pilesOf(state), pile]), pile }
}

/* "Pile Sep 29" when it has no name yet. */
export function pileName(pile, now = new Date(pile?.createdAt || Date.now())) {
  return pile?.name || `Pile ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(now)}`
}

/* ---------- the words that make stickies ---------- */

const BULLET = /^\s*(?:[-*•·–—+]|\[\s?[xX]?\s?\]|\(?\d{1,3}[.)])\s+/

/* What was typed, pasted or read from a photo, as stickies: one per paragraph when there are
   blank lines between them, else one per line. Bullets and numbers at the start go. */
export function splitStickies(value) {
  const raw = String(value || '').replace(/\r\n?/g, '\n').trim()
  if (!raw) return []
  const paragraphs = raw.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  const parts = paragraphs.length > 1 ? paragraphs : raw.split('\n')
  return parts
    .map((part) => part.split('\n').map((line) => line.replace(BULLET, '').trim()).filter(Boolean).join('\n'))
    .filter(Boolean)
    .map((part) => part.slice(0, MAX_TEXT))
    .slice(0, MAX_CARDS)
}

/* ---------- where things sit ---------- */

const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

/* A branch's box on the table: its name on top, its stickies in rows of up to three. */
export function groupBox(group, count) {
  const cols = Math.max(1, Math.min(GROUP.cols, count || 1))
  const rows = Math.max(1, Math.ceil((count || 1) / cols))
  return {
    x: group.x,
    y: group.y,
    w: GROUP.pad * 2 + cols * CARD.w + (cols - 1) * CARD.gap,
    h: GROUP.head + GROUP.pad + rows * CARD.h + (rows - 1) * CARD.gap,
    cols,
  }
}

export const membersOf = (pile, groupId) => pile.cards.filter((card) => card.group === groupId)

/* Where each sticky in a branch sits, in its order. */
export function memberSpot(group, index, count) {
  const { cols } = groupBox(group, count)
  return {
    x: group.x + GROUP.pad + (index % cols) * (CARD.w + CARD.gap),
    y: group.y + GROUP.head + Math.floor(index / cols) * (CARD.h + CARD.gap),
  }
}

/* Everything on the table as boxes (loose stickies, branches and the quick input). */
function takenBoxes(pile, skip = new Set()) {
  const boxes = [{ x: -MIDDLE.w / 2, y: -MIDDLE.h / 2, w: MIDDLE.w, h: MIDDLE.h }]
  pile.cards.forEach((card) => { if (!card.group && !skip.has(card.id)) boxes.push({ x: card.x, y: card.y, w: CARD.w, h: CARD.h }) })
  pile.groups.forEach((group) => { if (!skip.has(group.id)) boxes.push(groupBox(group, membersOf(pile, group.id).length)) })
  return boxes
}

/* Free places for `count` new stickies (or a box of `size`), in rings around the quick
   input: the first ring starts at the top and goes clockwise, wider than tall like the room. */
export function freeSpots(pile, count = 1, size = { w: CARD.w, h: CARD.h }) {
  const taken = takenBoxes(pile)
  const found = []
  for (let ring = 0; found.length < count && ring < 60; ring += 1) {
    const rx = MIDDLE.w / 2 + size.w / 2 + 40 + ring * (size.w + CARD.gap) * 0.9
    const ry = MIDDLE.h / 2 + size.h / 2 + 30 + ring * (size.h + CARD.gap)
    const around = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
    const steps = Math.max(5, Math.floor(around / (size.w + CARD.gap)))
    for (let step = 0; step < steps && found.length < count; step += 1) {
      const angle = -Math.PI / 2 + (step / steps) * Math.PI * 2
      const box = { x: Math.round(Math.cos(angle) * rx - size.w / 2), y: Math.round(Math.sin(angle) * ry - size.h / 2), ...size }
      if (taken.some((other) => overlaps(box, other, CARD.gap / 2))) continue
      taken.push(box)
      found.push({ x: box.x, y: box.y })
    }
  }
  return found
}

/* Nothing sits on anything else: a branch that grew over loose stickies (or over another
   branch) moves them to the nearest free place around the quick input. The first branch
   made keeps its place; stickies never move a branch. */
export function settle(pile) {
  let next = pile
  const boxesOf = (of) => of.groups.map((group) => ({ id: group.id, ...groupBox(group, membersOf(of, group.id).length) }))
  // Later branches step aside from earlier ones.
  let groups = boxesOf(next)
  for (let i = 1; i < groups.length; i += 1) {
    if (!groups.slice(0, i).some((other) => overlaps(groups[i], other, CARD.gap / 2))) continue
    const others = { ...next, cards: next.cards.filter((card) => card.group !== groups[i].id), groups: next.groups.filter((group) => group.id !== groups[i].id) }
    const spot = freeSpots(others, 1, { w: groups[i].w, h: groups[i].h })[0]
    if (spot) next = moveGroup(next, groups[i].id, spot.x, spot.y)
    groups = boxesOf(next)
  }
  const covered = next.cards.filter((card) => !card.group && groups.some((box) => overlaps({ x: card.x, y: card.y, w: CARD.w, h: CARD.h }, box, CARD.gap / 2)))
  if (!covered.length) return next
  const gone = new Set(covered.map((card) => card.id))
  const spots = freeSpots({ ...next, cards: next.cards.filter((card) => !gone.has(card.id)) }, covered.length)
  const moves = new Map(covered.map((card, index) => [card.id, spots[index]]))
  return { ...next, cards: next.cards.map((card) => (moves.get(card.id) ? { ...card, ...moves.get(card.id) } : card)) }
}

/* ---------- changes ---------- */

/* New stickies, each in a free place around the quick input. Returns the pile and their ids. */
export function addCards(pile, texts, { color } = {}) {
  const list = texts.map((value) => text(value, MAX_TEXT)).filter(Boolean).slice(0, MAX_CARDS - pile.cards.length)
  const spots = freeSpots(pile, list.length)
  const cards = list.map((words, index) => ({ id: pileId('card'), text: words, x: spots[index]?.x ?? 0, y: spots[index]?.y ?? MIDDLE.h, group: null, ...(PAPERS.includes(color) ? { color } : {}) }))
  return { pile: { ...pile, cards: [...pile.cards, ...cards] }, ids: cards.map((card) => card.id) }
}

export function editCard(pile, id, words) {
  const value = text(words, MAX_TEXT)
  if (!value) return removeCards(pile, [id])
  return { ...pile, cards: pile.cards.map((card) => (card.id === id ? { ...card, text: value } : card)) }
}

export function paintCard(pile, id, color) {
  return { ...pile, cards: pile.cards.map((card) => (card.id === id ? { ...card, color } : card)) }
}

/* Taking stickies away; a branch left with none goes too. */
export function removeCards(pile, ids) {
  const gone = new Set(ids)
  const cards = pile.cards.filter((card) => !gone.has(card.id))
  const used = new Set(cards.map((card) => card.group).filter(Boolean))
  return { ...pile, cards, groups: pile.groups.filter((group) => used.has(group.id)) }
}

/* One sticky with several lines becomes a sticky per line, in its place (and its branch). */
export function splitCard(pile, id) {
  const card = pile.cards.find((item) => item.id === id)
  const parts = card ? splitStickies(card.text.split('\n').join('\n\n')) : []
  if (parts.length < 2) return pile
  const rest = parts.slice(1)
  const spots = card.group ? [] : freeSpots(pile, rest.length)
  const made = rest.map((words, index) => ({ ...card, id: pileId('card'), text: words, x: spots[index]?.x ?? card.x, y: spots[index]?.y ?? card.y }))
  const at = pile.cards.indexOf(card)
  return { ...pile, cards: [...pile.cards.slice(0, at), { ...card, text: parts[0] }, ...made, ...pile.cards.slice(at + 1)] }
}

/* A sticky put down somewhere: on another loose sticky (they start a new branch there), on
   a branch (it joins, before `index` or at the end), or on the open table at { x, y }.
   Returns the pile, and the new branch's id when one was started. */
export function dropCard(pile, id, target) {
  const card = pile.cards.find((item) => item.id === id)
  if (!card || !target) return { pile }
  const without = pile.cards.filter((item) => item.id !== id)
  const tidy = (cards, groups = pile.groups) => {
    const used = new Set(cards.map((item) => item.group).filter(Boolean))
    return groups.filter((group) => used.has(group.id))
  }
  if (target.kind === 'card') {
    const other = pile.cards.find((item) => item.id === target.id)
    if (!other || other.id === id) return { pile }
    if (other.group) return dropCard(pile, id, { kind: 'group', id: other.group, before: other.id })
    const group = { id: pileId('branch'), name: '', x: other.x, y: other.y, ...(other.color ? { color: other.color } : {}) }
    const cards = without.map((item) => (item.id === other.id ? { ...item, group: group.id } : item))
    const at = cards.findIndex((item) => item.id === other.id)
    cards.splice(at + 1, 0, { ...card, group: group.id })
    return { pile: { ...pile, cards, groups: tidy(cards, [...pile.groups, group]) }, started: group.id }
  }
  if (target.kind === 'group') {
    if (!pile.groups.some((group) => group.id === target.id)) return { pile }
    const cards = [...without]
    const moved = { ...card, group: target.id }
    const before = target.before ? cards.findIndex((item) => item.id === target.before) : -1
    if (before >= 0) cards.splice(before, 0, moved)
    else {
      const last = cards.map((item) => item.group).lastIndexOf(target.id)
      cards.splice(last >= 0 ? last + 1 : cards.length, 0, moved)
    }
    return { pile: { ...pile, cards, groups: tidy(cards) } }
  }
  const cards = [...without, { ...card, group: null, x: num(target.x), y: num(target.y) }]
  return { pile: { ...pile, cards, groups: tidy(cards) } }
}

export function moveGroup(pile, id, x, y) {
  return { ...pile, groups: pile.groups.map((group) => (group.id === id ? { ...group, x: num(x), y: num(y) } : group)) }
}

export function renameGroup(pile, id, name) {
  return { ...pile, groups: pile.groups.map((group) => (group.id === id ? { ...group, name: text(name, 80) } : group)) }
}

/* A branch let go: its stickies go back onto the table, loose. */
export function ungroup(pile, id) {
  const members = membersOf(pile, id)
  const base = { ...pile, groups: pile.groups.filter((group) => group.id !== id), cards: pile.cards.filter((card) => card.group !== id) }
  const spots = freeSpots(base, members.length)
  return { ...base, cards: [...base.cards, ...members.map((card, index) => ({ ...card, group: null, x: spots[index]?.x ?? card.x, y: spots[index]?.y ?? card.y }))] }
}

/* A branch with no name yet is called after the word its stickies share, else "Branch 2". */
export function branchName(pile, group) {
  if (group.name) return group.name
  const counts = new Map()
  membersOf(pile, group.id).forEach((card) => new Set(keywords(card.text)).forEach((word) => counts.set(word, (counts.get(word) || 0) + 1)))
  const [best] = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (best) return best[0][0].toUpperCase() + best[0].slice(1)
  return `Branch ${pile.groups.findIndex((item) => item.id === group.id) + 1}`
}

/* ---------- help ---------- */

const STOP = new Set('a an and are as at be been but by call can could did do does done for from get got had has have her here him his how i if in into is it its just like make me more my need needs new next not now of off on one or our out over see she should so some than that the their them then there these they thing things this to too up us was we were what when where which who will with would you your about after again also back before call check want going week today tomorrow all any few has her him his its may new not now off old one our out own put say see she too two use way who why yes yet you get let did day got are was can for the and but had set try ask end lot big bit also into'.split(' '))

/* The words that say what a sticky is about: #tags, and words of three letters or more. */
export function keywords(value) {
  const words = String(value || '').toLowerCase().match(/#?[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []
  return words
    .map((word) => word.replace(/'s$/, ''))
    .filter((word) => word.startsWith('#') ? word.length > 2 : word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word))
    .map((word) => (word.startsWith('#') ? word.slice(1) : word.replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1')))
}

/* Help without the AI: loose stickies that share a word (or a #tag) with a branch go to it;
   the rest that share a word with each other become a new branch named after it. Returns
   suggestions [{ name, groupId?, cardIds }], biggest first. */
export function wordSuggestions(pile) {
  const loose = pile.cards.filter((card) => !card.group)
  const words = new Map(loose.map((card) => [card.id, new Set(keywords(card.text))]))
  const out = []
  const placed = new Set()
  pile.groups.forEach((group) => {
    const name = branchName(pile, group)
    const theirs = new Set([...keywords(name), ...membersOf(pile, group.id).flatMap((card) => keywords(card.text))])
    const nameWords = new Set(keywords(name))
    const cardIds = loose.filter((card) => {
      const mine = words.get(card.id)
      const shared = [...mine].filter((word) => theirs.has(word))
      return shared.some((word) => nameWords.has(word)) || shared.length >= 2
    }).map((card) => card.id)
    if (cardIds.length) { out.push({ name, groupId: group.id, cardIds }); cardIds.forEach((id) => placed.add(id)) }
  })
  for (;;) {
    const counts = new Map()
    loose.forEach((card) => { if (!placed.has(card.id)) words.get(card.id).forEach((word) => counts.set(word, (counts.get(word) || 0) + 1)) })
    const [best] = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    if (!best) break
    const cardIds = loose.filter((card) => !placed.has(card.id) && words.get(card.id).has(best[0])).map((card) => card.id)
    cardIds.forEach((id) => placed.add(id))
    out.push({ name: best[0][0].toUpperCase() + best[0].slice(1), cardIds })
  }
  return out.sort((a, b) => b.cardIds.length - a.cardIds.length)
}

const clip = (value, max) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max)

/* Help with the AI: the loose stickies, numbered, and the branches there already. */
export function groupMessages(pile) {
  const loose = pile.cards.filter((card) => !card.group).slice(0, 80)
  const names = pile.groups.map((group) => branchName(pile, group))
  return [
    { role: 'system', content: 'You help someone sort a pile of their own paper sticky notes in OSAT. Keep their words, never invent facts, and answer only in the form asked, with no introduction.' },
    {
      role: 'user',
      content: `Group these sticky notes into a few branches (2 to 8), each with a short name of one to three words.${names.length ? `\nThese branches exist already; use one when it fits: ${names.join(', ')}.` : ''}

Stickies:
${loose.map((card, index) => `${index + 1}. ${clip(card.text, 240)}`).join('\n')}

For each sticky write one line: its number, a colon, and the branch name. For example:
1: Wedding
2: Car`,
    },
  ]
}

/* The AI's answer as suggestions like wordSuggestions', forgiving about the format; a name
   that matches a branch there (whatever the case) joins it. */
export function readGroupAnswer(answer, pile) {
  const loose = pile.cards.filter((card) => !card.group).slice(0, 80)
  const byName = new Map(pile.groups.map((group) => [branchName(pile, group).toLowerCase(), group]))
  const found = new Map()
  const seen = new Set()
  String(answer || '').replace(/```[a-z]*\n?/gi, '').split('\n').forEach((line) => {
    const match = /^\s*(?:sticky\s*)?#?(\d+)\s*[:.)=\-–→>]+\s*(.+?)\s*$/i.exec(line)
    if (!match) return
    const card = loose[Number(match[1]) - 1]
    const name = clip(match[2].replace(/^["'*_]+|["'*_.]+$/g, ''), 60)
    if (!card || !name || seen.has(card.id) || /^(none|n\/a|other|misc)$/i.test(name)) return
    seen.add(card.id)
    const key = name.toLowerCase()
    if (!found.has(key)) found.set(key, { name: byName.get(key) ? branchName(pile, byName.get(key)) : name, ...(byName.get(key) ? { groupId: byName.get(key).id } : {}), cardIds: [] })
    found.get(key).cardIds.push(card.id)
  })
  return [...found.values()].filter((item) => item.groupId || item.cardIds.length).sort((a, b) => b.cardIds.length - a.cardIds.length)
}

/* A suggestion taken: its stickies join the branch, or start a new one in a free place. */
export function takeSuggestion(pile, suggestion) {
  const ids = suggestion.cardIds.filter((id) => pile.cards.some((card) => card.id === id && !card.group))
  if (!ids.length) return pile
  let groupId = suggestion.groupId && pile.groups.some((group) => group.id === suggestion.groupId) ? suggestion.groupId : null
  let next = pile
  if (!groupId) {
    const spot = freeSpots({ ...pile, cards: pile.cards.filter((card) => !ids.includes(card.id)) }, 1, groupBox({ x: 0, y: 0 }, ids.length))[0] || { x: 0, y: MIDDLE.h }
    groupId = pileId('branch')
    next = { ...pile, groups: [...pile.groups, { id: groupId, name: text(suggestion.name, 80), x: spot.x, y: spot.y }] }
  }
  const moving = next.cards.filter((card) => ids.includes(card.id)).map((card) => ({ ...card, group: groupId }))
  const others = next.cards.filter((card) => !ids.includes(card.id))
  const last = others.map((card) => card.group).lastIndexOf(groupId)
  return { ...next, cards: [...others.slice(0, last + 1), ...moving, ...others.slice(last + 1)] }
}

/* ---------- to the Sky ---------- */

/* The pile goes to the Sky and leaves the table. `mode` 'one': one node named `name`, its
   branches inside it and loose stickies in the node itself. 'each': every branch its own
   node, loose stickies in Unsorted. Returns the new state and what was made (for Undo). */
export function sendToSky(state, id, { name, mode = 'one' } = {}) {
  const pile = pilesOf(state).find((item) => item.id === id)
  if (!pile || !pile.cards.length) return { state, folders: [], notes: [], nodes: [] }
  let next = state
  const folders = []
  const notes = []
  const nodes = []
  const folder = (label, parentId = null, color) => {
    const made = addFolder(next, label, parentId)
    if (!made.folder) return null
    next = { ...made.state, folders: made.state.folders.map((item) => (item.id === made.folder.id ? { ...item, ...(color ? { color } : {}), ...(parentId ? {} : { fresh: true }) } : item)) }
    folders.push(made.folder.id)
    if (!parentId) nodes.push(made.folder.id)
    return made.folder.id
  }
  const sticky = (card, folderId) => {
    const made = addSticky(next, card.text, folderId, { source: 'Pile', color: card.color })
    next = made.state
    if (made.note) notes.push(made.note.id)
  }
  const top = mode === 'one' ? folder(text(name, 80) || pileName(pile)) : null
  pile.groups.forEach((group) => {
    const members = membersOf(pile, group.id)
    if (!members.length) return
    const home = folder(branchName(pile, group), top, group.color)
    members.forEach((card) => sticky(card, home))
  })
  pile.cards.filter((card) => !card.group).forEach((card) => sticky(card, top))
  next = setPiles(next, pilesOf(next).filter((item) => item.id !== id))
  return { state: next, folders, notes, nodes }
}
