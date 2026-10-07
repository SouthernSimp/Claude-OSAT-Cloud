/* Sort Unsorted (Phase 26): a home for every sticky that is in no node yet, suggested,
   never done. The model reads them (shared/ai-tasks.mjs); with no model, or for what it
   couldn't place, matching words and #tags do. Both end as the same groups:
     { key, kind: 'move', folderId, noteIds }   these stickies look like they belong in it
     { key, kind: 'make', name, noteIds }       these could be a new node
   A single leftover never becomes a node of its own. Unsorted's sorter shows them under
   "Suggest homes for all". Pure. */

import { readSortUnsortedAnswer, sortUnsortedMessages } from '../../shared/ai-tasks.mjs'
import { folderChildren, folderPath, relatedNotes } from '../notes-model.js'
import { nodesOf, pileOf } from '../nodes-model.js'

/* One request reads this many stickies (the built-in model reads about 8,000 tokens); a sort goes
   through up to MOST of them, one request after another with progress shown, so a pile of a hundred
   or more is sorted in one go. The rest wait for the next time. */
export const BATCH = 20
export const MOST = 300
const MOST_PLACES = 40

const plainKey = (name) => String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const wordsOfSticky = (note) => `${note.title}\n${note.markdown}`.slice(0, 600)

/* "Sort these", "can you sort my unsorted stickies?": a request to sort Unsorted, not a question for
   the AI. It has to start with the ask, so "sort of a hard question" and "how do I sort my closet"
   are still questions. */
export const asksToSort = (text) => /^(?:(?:please|can you|could you|would you|help me|go ahead and|now)\s+)*sort\s+(?:out\s+)?(?:these|them|it|this|my|the|all|everything|unsorted)\b.{0,40}$/.test(
  String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim(),
)

/* The stickies waiting in Unsorted (not those set free on the Sky), oldest rank first, as many
   as one sort reads. */
const waitingIn = (state) => pileOf(state.notes, null).filter((note) => !note.at)
export const unsortedStickies = (state) => waitingIn(state).slice(0, MOST)

/* Every place a sticky can go: each node, then the branches in it, depth first. */
function allPlaces(state, skip = () => false) {
  const out = []
  const walk = (parentId) => folderChildren(state.folders, parentId).forEach((folder) => { if (!skip(folder)) out.push(folder); walk(folder.id) })
  nodesOf(state.folders).forEach(({ folder }) => { if (!skip(folder)) out.push(folder); walk(folder.id) })
  return out
}

/* The places the model may pick, with a couple of the stickies in each as examples: [{ id, name
   ("Trip / Packing"), peek }]. */
export function sortPlaces(state, skip) {
  return allPlaces(state, skip).slice(0, MOST_PLACES).map((folder) => ({
    id: folder.id,
    name: folderPath(state.folders, folder.id).join(' / '),
    peek: pileOf(state.notes, folder.id).slice(0, 2).map((note) => note.title),
  }))
}

/* ---------- with no model: matching words ---------- */

/* The place a sticky's #tag names, else the place whose name and stickies share the most
   words with it. Only what fits well is placed. [{ noteId, folderId }] */
export function wordHomes(state, stickies = unsortedStickies(state)) {
  const places = allPlaces(state)
  if (!places.length) return []
  const faces = places.map((folder) => ({
    id: folder.id,
    title: folder.name,
    markdown: pileOf(state.notes, folder.id).map((note) => `${note.title}\n${note.markdown}`).join('\n').slice(0, 20000),
    updatedAt: '',
  }))
  return stickies.flatMap((note) => {
    const tagged = places.find((folder) => (note.tags || []).some((tag) => plainKey(tag) === plainKey(folder.name)))
    if (tagged) return [{ noteId: note.id, folderId: tagged.id }]
    const [best] = relatedNotes(faces, wordsOfSticky(note), 1)
    return best ? [{ noteId: note.id, folderId: best.id }] : []
  })
}

const COMMON = new Set(('the and for you are was but not all any can has had her his how its let may new now old our out see she too use way who why yes yet '
  + 'need needs call calls buy check find make get got take look todo thing things stuff about from that this with have want '
  + 'some more will would could should also just then them they what when where which idea ideas note notes write send maybe remember '
  + 'today tomorrow tonight later soon next last first').split(' '))
const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1)

/* Stickies that go together though no place fits: the same #tag on two or more, or the same
   uncommon word in three or more. The word is the node's name. [{ name, noteIds }] */
export function wordNodes(stickies) {
  const claimed = new Set()
  const out = []
  const take = (name, ids, least) => {
    const free = ids.filter((id) => !claimed.has(id))
    if (free.length < least) return
    free.forEach((id) => claimed.add(id))
    out.push({ name, noteIds: free })
  }
  const tags = new Map()
  stickies.forEach((note) => (note.tags || []).forEach((tag) => tags.set(tag, [...(tags.get(tag) || []), note.id])))
  ;[...tags].sort((a, b) => b[1].length - a[1].length).forEach(([tag, ids]) => take(capital(tag), ids, 2))

  const words = new Map()
  stickies.forEach((note) => {
    const seen = new Set()
    ;(wordsOfSticky(note).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).forEach((word) => {
      const stem = word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
      if (COMMON.has(stem) || seen.has(stem)) return
      seen.add(stem)
      const entry = words.get(stem) || { ids: [], forms: new Map() }
      entry.ids.push(note.id)
      entry.forms.set(word, (entry.forms.get(word) || 0) + 1)
      words.set(stem, entry)
    })
  })
  const most = Math.max(3, Math.floor(stickies.length * 0.6))
  ;[...words].filter(([, entry]) => entry.ids.length <= most)
    .sort((a, b) => b[1].ids.length - a[1].ids.length || b[0].length - a[0].length)
    .forEach(([stem, entry]) => take(capital([...entry.forms].sort((a, b) => b[1] - a[1])[0][0]), entry.ids, 3))
  return out.filter((group) => group.noteIds.length > 1)
}

/* ---------- groups ---------- */

/* Homes ([{ noteId, folderId }]) and new nodes ([{ name, noteIds }]) as the lines shown, one
   per place (in the order the places were first named), then one per new node. */
export function sortGroups({ homes = [], made = [] }) {
  const byFolder = new Map()
  homes.forEach(({ noteId, folderId }) => byFolder.set(folderId, [...(byFolder.get(folderId) || []), noteId]))
  return [
    ...[...byFolder].map(([folderId, noteIds]) => ({ key: `move:${folderId}`, kind: 'move', folderId, noteIds })),
    ...made.filter((group) => group.noteIds.length > 1).map((group) => ({ key: `make:${plainKey(group.name)}`, kind: 'make', name: group.name, noteIds: group.noteIds })),
  ]
}

/* What matching words alone suggest for these stickies. */
export function wordSuggestions(state, stickies = unsortedStickies(state)) {
  const homes = wordHomes(state, stickies)
  const placed = new Set(homes.map((home) => home.noteId))
  return sortGroups({ homes, made: wordNodes(stickies.filter((note) => !placed.has(note.id))) })
}

/* What the model's answers (one per batch of `stickies`, read with the same `places`) suggest,
   with words for whatever it left where it was. */
export function modelSuggestions(state, stickies, places, answers, { words = true } = {}) {
  const homes = []
  const made = new Map()
  answers.forEach(({ from, text }) => {
    const batch = stickies.slice(from, from + BATCH)
    const read = readSortUnsortedAnswer(text, places.map((place) => place.name), batch.length)
    read.homes.forEach(({ sticky, place }) => homes.push({ noteId: batch[sticky].id, folderId: places[place].id }))
    read.made.forEach(({ name, stickies: picked }) => {
      const key = plainKey(name)
      made.set(key, { name: made.get(key)?.name || name, noteIds: [...(made.get(key)?.noteIds || []), ...picked.map((index) => batch[index].id)] })
    })
  })
  // Filing on its own (auto-file.js), only the model's own picks count: what it wasn't sure of waits for Nate.
  if (!words) return sortGroups({ homes, made: [...made.values()] })
  const placed = new Set([...homes.map((home) => home.noteId), ...[...made.values()].flatMap((group) => group.noteIds)])
  const rest = stickies.filter((note) => !placed.has(note.id))
  const byWords = wordHomes(state, rest)
  const left = rest.filter((note) => !byWords.some((home) => home.noteId === note.id))
  return sortGroups({ homes: [...homes, ...byWords], made: [...made.values(), ...wordNodes(left).map((group) => ({ name: group.name, noteIds: group.noteIds }))] })
}

/* The questions to ask: one per batch. */
export function sortRequests(state, stickies = unsortedStickies(state)) {
  const places = sortPlaces(state)
  const batches = []
  for (let from = 0; from < stickies.length; from += BATCH) {
    batches.push({ from, messages: sortUnsortedMessages({ places, stickies: stickies.slice(from, from + BATCH).map(wordsOfSticky) }) })
  }
  return { places, batches }
}

/* Only what can still be done: stickies that are still in Unsorted, and groups still with two
   or more (a new node) or one (a place). */
export function stillToSort(groups, state) {
  const waiting = new Set(waitingIn(state).map((note) => note.id))
  return groups
    .map((group) => ({ ...group, noteIds: group.noteIds.filter((id) => waiting.has(id)) }))
    .filter((group) => group.noteIds.length > (group.kind === 'make' ? 1 : 0))
}

/* Doing it is sort-review.js's fileUnsorted (one group or many, one Undo with undoFiling). */
