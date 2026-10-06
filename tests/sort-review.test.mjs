import assert from 'node:assert/strict'
import test from 'node:test'
import { fileUnsorted, findPlaces, homeOptions, undoFiling, placementSuggestion, placementPlaces, placementMessages, readPlacement, sortQueue } from '../src/sky/sort-review.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { moveSticky } from '../src/nodes-model.js'

const fixture = () => normalizeWorkspace({ ...createDefaultWorkspace(), folders: [{ id: 'topic', name: 'Work', at: { x: 90, y: 100 } }, { id: 'branch', name: 'Planning', parentId: 'topic' }], notes: [
  ...Array.from({ length: 220 }, (_, i) => ({ id: `n${i}`, title: `Thought ${i}`, markdown: `Original ${i}`, rank: i * 1024, unsorted: true, ...(i === 0 ? { links: ['folder:topic'] } : {}) })),
  { id: 'filed', title: 'Filed', folderId: 'topic', markdown: 'Keep' },
  { id: 'trash', title: 'Trash', trashedAt: '2026-10-04' }, { id: 'archive', title: 'Archive', archived: true }, { id: 'day', title: 'Day', kind: 'day', date: '2026-10-04' }, { id: 'free', title: 'Placed on Sky', at: { x: 500, y: -600 } },
] })

test('a large selected batch files once without changing content, identities, links or topic geometry', () => {
  const before = fixture()
  const ids = Array.from({ length: 200 }, (_, i) => `n${i}`)
  const result = fileUnsorted(before, [...ids, ...ids], 'branch')
  assert.equal(result.moved.length, 200)
  assert.equal(result.state.notes.length, before.notes.length)
  assert.equal(result.state.folders, before.folders)
  assert.deepEqual(result.state.notes.map(({ id, title, markdown, links }) => ({ id, title, markdown, links })), before.notes.map(({ id, title, markdown, links }) => ({ id, title, markdown, links })))
  assert.equal(result.state.notes.find((n) => n.id === 'n200').folderId, null)
})

test('stale selections and missing destinations never move other records', () => {
  const before = fixture()
  assert.equal(fileUnsorted(before, ['n0'], 'missing').state, before)
  assert.equal(fileUnsorted(before, ['filed', 'trash', 'archive', 'day', 'free', 'deleted'], 'branch', 'Empty topic').state, before)
  assert.deepEqual(fileUnsorted(before, ['n0', 'filed', 'trash'], 'branch').moved, ['n0'])
})

test('undo restores exact placement and ranks while retaining later writing and added notes', () => {
  const before = fixture()
  const result = fileUnsorted(before, ['n0', 'n1'], 'branch')
  const edited = { ...result.state, notes: [...result.state.notes.map((note) => note.id === 'n0' ? { ...note, markdown: 'Later writing' } : note), { id: 'later', title: 'Later' }] }
  const undone = undoFiling(edited, result.changes).state
  const original = before.notes.find((note) => note.id === 'n0')
  assert.deepEqual(undone.notes.find((note) => note.id === 'n0'), { ...original, markdown: 'Later writing' })
  assert.ok(undone.notes.some((note) => note.id === 'later'))
})

test('undo preserves a newer move and does not resurrect a deleted note', () => {
  const result = fileUnsorted(fixture(), ['n0', 'n1'], 'branch')
  const moved = moveSticky(result.state, 'n0', 'topic')
  const edited = { ...moved, notes: moved.notes.filter((note) => note.id !== 'n1') }
  const undone = undoFiling(edited, result.changes).state
  assert.equal(undone.notes.find((note) => note.id === 'n0').folderId, 'topic')
  assert.ok(!undone.notes.some((note) => note.id === 'n1'))
})

test('creating a topic requires a valid nonempty selection and undo preserves later topic work', () => {
  const before = fixture()
  const result = fileUnsorted(before, ['n0'], null, 'Garden')
  assert.equal(result.state.folders.length, before.folders.length + 1)
  assert.equal(result.state.notes.find((n) => n.id === 'n0').folderId, result.folderId)
  const later = moveSticky(result.state, 'n2', result.folderId)
  const undone = undoFiling(later, result.changes).state
  assert.ok(undone.folders.some((folder) => folder.id === result.folderId))
  assert.equal(undone.notes.find((n) => n.id === 'n2').folderId, result.folderId)
  assert.equal(undone.notes.find((n) => n.id === 'n0').folderId, null)
})

test('shared boilerplate is not enough to suggest unrelated destinations', () => {
  const state = fixture()
  const notes = [{ id: 'a', title: 'Unfiled thought', markdown: 'Review the next step', tags: [] }]
  const topics = { ...state, folders: [{ id: 'topic', name: 'Gardening' }], notes: [{ id: 'existing', title: 'Unfiled thought', markdown: 'Review the next step', folderId: 'topic' }] }
  const tagged = [{ ...notes[0], tags: ['gardening'] }]
  assert.equal(placementSuggestion(topics, tagged[0]).folderId, 'topic')
  assert.equal(placementSuggestion(topics, notes[0]), null)
})

test('single sticky placement finds the related branch across a large workspace and validates local proposals', () => {
  const state = normalizeWorkspace({ ...fixture(), folders: [...Array.from({ length: 90 }, (_, i) => ({ id: `f${i}`, name: `Unrelated ${i}` })), { id: 'client', name: 'Client work' }, { id: 'launch', name: 'Website launch', parentId: 'client' }], notes: [
    { id: 'photo', title: 'Book the photographer for the website launch', markdown: 'Confirm launch photos', unsorted: true },
    { id: 'home', title: 'Homepage draft', markdown: 'Website launch plans', folderId: 'launch' },
    { id: 'check', title: 'Launch checklist', markdown: 'Photographer and photos', folderId: 'launch' },
  ] })
  const note = state.notes[0]
  assert.equal(placementSuggestion(state, note).folderId, 'launch')
  const places = placementPlaces(state, note)
  assert.equal(places[0].id, 'launch')
  assert.equal(places.length, 92)
  assert.equal(readPlacement('Client work / Website launch: related launch plans', places).folderId, 'launch')
  assert.equal(readPlacement('Imaginary place: move it now', places), null)
  assert.equal(readPlacement('Client workevil: do something else', places), null)
  assert.equal(readPlacement('NEW:   ', places), null)
  assert.equal(readPlacement('NONE', places), null)
  assert.equal(readPlacement('NEW: Photography', places).name, 'Photography')
  assert.ok(placementMessages(note, places)[1].content.length <= 32000)
  assert.equal(fileUnsorted(state, ['photo'], 'launch').state.notes[0].id, 'photo')
})

test('Sky and recoverable Trash share safe placement Undo without overwriting later edits or locations', () => {
  const state = fixture()
  const placed = fileUnsorted(state, ['n0'], null, '', { at: { x: 123, y: 456 } })
  assert.deepEqual(placed.state.notes[0].at, { x: 123, y: 456 })
  assert.deepEqual(undoFiling(placed.state, placed.changes).state.notes[0], state.notes[0])
  assert.equal(fileUnsorted(state, ['n0'], null, '', { at: { x: NaN, y: 1 } }).state, state)
  const trashed = fileUnsorted(state, ['n0'], null, '', { trash: true })
  assert.ok(trashed.state.notes[0].trashedAt)
  const edited = { ...trashed.state, notes: trashed.state.notes.map((note) => note.id === 'n0' ? { ...note, markdown: 'Later writing' } : note) }
  assert.deepEqual(undoFiling(edited, trashed.changes).state.notes[0], { ...state.notes[0], markdown: 'Later writing' })
  const archived = { ...placed.state, notes: placed.state.notes.map((note) => note.id === 'n0' ? { ...note, archived: true } : note) }
  assert.equal(undoFiling(archived, placed.changes).restored, 0)
})

test('the homes for one sticky: best first, each with why and what is in it, then places used a moment ago', () => {
  const state = normalizeWorkspace({ ...createDefaultWorkspace(), folders: [{ id: 'osat', name: 'OSAT' }, { id: 'polish', name: 'Sky polish', parentId: 'osat' }, { id: 'garden', name: 'Garden' }, { id: 'work', name: 'Work' }], notes: [
    { id: 'p1', title: 'Sky toolbar spacing', markdown: 'Sky toolbar', folderId: 'polish' },
    { id: 'g1', title: 'Tomatoes', markdown: 'water', folderId: 'garden' },
    { id: 'u', title: 'Sky polish for the toolbar icons', markdown: 'Sky polish for the toolbar icons', unsorted: true },
    { id: 'c1', title: 'Buy cat litter', markdown: 'Buy cat litter', unsorted: true },
    { id: 'c2', title: 'Cat vet', markdown: 'Cat vet', unsorted: true },
    { id: 'c3', title: 'Cat toys', markdown: 'Cat toys', unsorted: true },
  ] })
  const note = state.notes.find((item) => item.id === 'u')
  const { homes } = homeOptions(state, note, { recent: ['work'] })
  assert.equal(homes[0].folderId, 'polish')
  assert.equal(homes[0].path, 'OSAT / Sky polish')
  assert.match(homes[0].why, /Shares “sky” and “polish”/)
  assert.deepEqual([homes[0].count, homes[0].peek], [1, ['Sky toolbar spacing']])
  assert.ok(homes.some((home) => home.folderId === 'work' && home.from === 'recent' && home.why === 'Used a moment ago'))
  const ai = homeOptions(state, note, { picks: [{ kind: 'move', folderId: 'garden', why: 'about plants' }] }).homes
  assert.deepEqual([ai[0].folderId, ai[0].from, ai[0].why], ['garden', 'ai', 'about plants'], 'the AI’s pick goes first')
  const cats = state.notes.filter((item) => item.id.startsWith('c'))
  const { newNode } = homeOptions(state, cats[0], { pile: cats })
  assert.equal(newNode.name, 'Cat')
  assert.match(newNode.why, /3 stickies here mention “cat”/)
  assert.equal(homeOptions(state, cats[0], { pile: cats, picks: [{ kind: 'make', name: 'Pets', why: 'x' }] }).newNode.name, 'Pets')
  assert.deepEqual(homeOptions(state, null), { homes: [], newNode: null })
  assert.deepEqual(findPlaces(state, 'pol').map((place) => place.path), ['OSAT / Sky polish'])
  assert.equal(findPlaces(state, 'g')[0].path, 'Garden', 'a name that starts with it comes first')
})

test('the queue keeps this sitting’s order, adds new arrivals, and a chosen few stays a few', () => {
  const waiting = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
  assert.deepEqual(sortQueue([], waiting), ['a', 'b', 'c', 'd'])
  assert.deepEqual(sortQueue(['b', 'c', 'a', 'b'], waiting), ['b', 'c', 'a', 'd'], 'Later sent a to the end; d arrived since')
  assert.deepEqual(sortQueue(['c', 'gone', 'a'], waiting, { chosen: true }), ['c', 'a'])
})

test('a new node uses one of the same name, and Undo takes away a node made for it only while empty', () => {
  const before = fixture()
  const made = fileUnsorted(before, ['n0'], null, 'Garden')
  assert.ok(made.made)
  const again = fileUnsorted(made.state, ['n1'], null, 'garden')
  assert.deepEqual([again.made, again.folderId], [null, made.made])
  const empty = undoFiling(made.state, made.changes, [made.made]).state
  assert.ok(!empty.folders.some((folder) => folder.id === made.made))
  const kept = undoFiling(again.state, made.changes, [made.made]).state
  assert.ok(kept.folders.some((folder) => folder.id === made.made), 'n1 is still in it')
  assert.equal(readPlacement('**Work / Planning**: about plans\nmore words', [{ id: 'branch', path: 'Work / Planning' }]).folderId, 'branch')
})
