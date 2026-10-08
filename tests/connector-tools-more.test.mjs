import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as storeCore from '../shared/store-core.mjs'
import { isReadOnly, runTool, TOOLS, ToolError } from '../shared/connector-tools.mjs'

const require = createRequire(import.meta.url)
const { createStore } = require('../desktop/store/index.cjs')

let n = 0
const makeId = (prefix) => `${prefix}-${++n}`
const NOW = '2026-09-29T10:00:00.000Z'
const LATER = '2026-09-30T08:00:00.000Z'

/* A real store in a temp folder, as in connector.test.mjs. Each change keeps its inverse the
   way main does (applyOps before committing), so `undo` is what Settings → Bots' Undo does. */
async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-connector-more-'))
  const store = await createStore({ dir, core: storeCore, writeDelay: 0, maxDelay: 0 })
  const client = store.connect(() => {})
  let inverse = null
  const run = (name, args, now = NOW) => {
    const doc = store.load().doc
    const result = runTool(name, args, { doc, now, makeId })
    inverse = result.ops ? storeCore.applyOps(doc, result.ops).inverse : null
    if (result.ops) store.commit(client, result.ops)
    return result.text
  }
  const undo = () => store.commit(client, inverse)
  const doc = () => store.load().doc
  const note = (words) => doc().notes.find((item) => item.markdown === words)
  const idOf = (text) => /\(((?:note|folder|event)-\d+)\)/.exec(text)[1]
  const snapshot = () => JSON.parse(JSON.stringify({ notes: doc().notes, folders: doc().folders, calendar: doc().calendar }))
  /* Runs a changing tool, checks it changed something, then that its Undo puts back exactly what was there. */
  const undoes = (name, args) => {
    const before = snapshot()
    const text = run(name, args)
    assert.ok(inverse?.length, `${name} made a change`)
    assert.notDeepEqual(snapshot(), before)
    undo()
    assert.deepEqual(snapshot(), before, `Undo puts back what ${name} changed`)
    return text
  }
  return { run, undo, doc, note, idOf, undoes }
}

async function garden() {
  const tools = await tempStore()
  tools.run('add_node', { title: 'Garden', branches: [{ title: 'Beds', leaves: ['Water the tomatoes'] }, { title: 'Herbs' }] })
  tools.run('add_node', { title: 'House', branches: [{ title: 'Kitchen' }] })
  return tools
}

test('annotations: exactly the six that only look are read-only; deleting is destructive', () => {
  const reads = ['list_nodes', 'read_node', 'search', 'read_journal', 'list_events', 'find_files']
  assert.deepEqual(TOOLS.filter((tool) => tool.annotations.readOnlyHint === true).map((tool) => tool.name), reads)
  assert.deepEqual(TOOLS.filter((tool) => isReadOnly(tool.name)).map((tool) => tool.name), reads)
  assert.ok(TOOLS.every((tool) => typeof tool.annotations.readOnlyHint === 'boolean' && typeof tool.annotations.destructiveHint === 'boolean'))
  assert.equal(TOOLS.find((tool) => tool.name === 'delete_sticky').annotations.destructiveHint, true)
  assert.equal(TOOLS.find((tool) => tool.name === 'add_sticky').annotations.destructiveHint, false)
  assert.equal(isReadOnly('add_sticky'), false)
  assert.equal(isReadOnly('no_such_tool'), false)
  assert.equal(isReadOnly('constructor'), false)
  // New tools say "topic" and that its argument is still called node.
  for (const name of ['move_sticky', 'add_branch', 'rename']) assert.match(TOOLS.find((tool) => tool.name === name).description, /topic \(the node argument\)/)
})

test('search shows ids, and adding says the new id', async () => {
  const { run, idOf } = await garden()
  const added = run('add_sticky', { text: 'Buy tomato cages' })
  assert.match(added, /^Added a sticky to Unsorted \(note-\d+\)\.$/)
  const found = run('search', { query: 'tomato' })
  assert.match(found, new RegExp(`- \\(${idOf(added)}\\) \\[Unsorted, 2026-09-29\\] Buy tomato cages`))
  assert.match(found, /- \(note-\d+\) \[Garden › Beds, 2026-09-29\] Water the tomatoes/)
})

test('a sticky by id or by words: only one may hold them, never a guess', async () => {
  const { run, idOf } = await garden()
  const seeds = idOf(run('add_sticky', { text: 'Buy seeds' }))
  run('add_sticky', { text: 'Buy seeds for spring\nCarrots and peas' })
  run('add_sticky', { text: 'Seeds: save the tomato ones' })
  assert.throws(() => run('delete_sticky', { sticky: 'zucchini' }), (error) => error instanceof ToolError && error.message === 'No sticky holds “zucchini”.')
  assert.throws(() => run('delete_sticky', { sticky: 'seeds' }), (error) => error instanceof ToolError
    && /^3 stickies hold “seeds”:\n- \(note-\d+\) Seeds: save the tomato ones\n- \(note-\d+\) Buy seeds for spring\n- \(note-\d+\) Buy seeds\nSay which by its id\.$/.test(error.message))
  assert.throws(() => run('delete_sticky', { sticky: '  ' }), /Say which sticky/)
  // Every word, any case and order, as search reads them; an exact title settles a tie.
  assert.match(run('edit_sticky', { sticky: 'PEAS carrots', text: 'Buy seeds for spring\nCarrots, peas, beans' }), /^Changed the sticky “Buy seeds for spring” \(note-\d+\)\.$/)
  assert.match(run('move_sticky', { sticky: 'buy seeds', node: 'Garden' }), /^Moved “Buy seeds” to Garden\.$/)
  assert.match(run('move_sticky', { sticky: seeds, node: 'Garden', branch: 'Herbs' }), /^Moved “Buy seeds” to Garden › Herbs\.$/)
  // Seven hold "e": only the first five are listed.
  for (const words of ['one', 'two', 'three']) run('add_sticky', { text: `Extra ${words}` })
  assert.match(run('search', { query: 'e', limit: 50 }), /^7 found/)
  assert.throws(() => run('delete_sticky', { sticky: 'e' }), (error) => /^7 stickies hold “e”:\n(- .*\n){5}…and 2 more\.\nSay which by its id\.$/.test(error.message))
  // A journal page is not a sticky.
  run('add_to_journal', { text: 'Planted garlic' })
  assert.throws(() => run('edit_sticky', { sticky: 'garlic', text: 'x' }), /No sticky holds “garlic”/)
})

test('edit_sticky: new words, title and tags follow; Undo brings the old words back', async () => {
  const { run, note, idOf, undoes, doc } = await garden()
  const id = idOf(run('add_sticky', { text: 'Call Jordan', node: 'House' }))
  assert.match(undoes('edit_sticky', { sticky: id, text: '# Call Jordan Friday\nAbout the #kitchen' }), /Changed the sticky “Call Jordan Friday”/)
  run('edit_sticky', { sticky: id, text: '# Call Jordan Friday\nAbout the #kitchen' }, LATER)
  const changed = doc().notes.find((item) => item.id === id)
  assert.deepEqual([changed.title, changed.tags, changed.updatedAt, changed.createdAt], ['Call Jordan Friday', ['kitchen'], LATER, NOW])
  assert.equal(run('edit_sticky', { sticky: id, text: '# Call Jordan Friday\nAbout the #kitchen' }), '“Call Jordan Friday” already says that.')
  assert.throws(() => run('edit_sticky', { sticky: id, text: ' ' }), /needs some words/)
  assert.equal(note('Call Jordan'), undefined)
})

test('move_sticky files into a topic or branch at the end, or back to Unsorted; Undo moves it back', async () => {
  const { run, idOf, undoes, doc } = await garden()
  const id = idOf(run('add_sticky', { text: 'Mulch the beds' }))
  const sticky = () => doc().notes.find((item) => item.id === id)
  assert.equal(sticky().unsorted, true)
  assert.equal(undoes('move_sticky', { sticky: id, node: 'garden', branch: 'beds' }), 'Moved “Mulch the beds” to Garden › Beds.')
  run('move_sticky', { sticky: id, node: 'Garden', branch: 'Beds' })
  const beds = doc().folders.find((folder) => folder.name === 'Beds')
  const tomatoes = doc().notes.find((item) => item.markdown === 'Water the tomatoes')
  assert.deepEqual([sticky().folderId, sticky().unsorted], [beds.id, false])
  assert.ok(sticky().rank > tomatoes.rank, 'at the end of the branch')
  assert.equal(run('move_sticky', { sticky: id, node: 'Garden', branch: 'Beds' }), '“Mulch the beds” is already in Garden › Beds.')
  assert.equal(undoes('move_sticky', { sticky: id }), 'Moved “Mulch the beds” to Unsorted.')
  run('move_sticky', { sticky: id })
  assert.deepEqual([sticky().folderId, sticky().unsorted], [null, true])
  assert.equal(run('move_sticky', { sticky: id }), '“Mulch the beds” is already in Unsorted.')
  assert.throws(() => run('move_sticky', { sticky: id, node: 'Gardn' }), /no topic called “Gardn”/)
  assert.throws(() => run('move_sticky', { sticky: id, node: 'Garden', branch: 'Roses' }), /no branch called “Roses”\. Its branches are: Beds, Herbs\./)
  assert.throws(() => run('move_sticky', { sticky: id, branch: 'Beds' }), /Say which node/)
})

test('move_sticky: a sticky set down on the canvas lets go of its spot, and Undo gives it back', () => {
  const made = runTool('add_sticky', { text: 'A free sticky' }, { doc: storeCore.createEmptyDoc(), now: NOW, makeId })
  const id = made.ops[0].v.id
  // Set down on the canvas as placeSticky does: an `at` in board points, in no topic.
  const { doc } = storeCore.applyOps(storeCore.createEmptyDoc(), [...made.ops, { t: 'patch', c: 'notes', id, v: { at: { x: 40, y: 80 } } }])
  // Back to Unsorted is a move too (into the pile), not "already there".
  const home = runTool('move_sticky', { sticky: id }, { doc, now: NOW, makeId })
  assert.equal(home.text, 'Moved “A free sticky” to Unsorted.')
  const { doc: after, inverse } = storeCore.applyOps(doc, home.ops)
  assert.equal('at' in after.notes[0], false)
  assert.deepEqual(storeCore.applyOps(after, inverse).doc.notes[0].at, { x: 40, y: 80 })
  assert.equal(runTool('move_sticky', { sticky: id }, { doc: after, now: NOW, makeId }).text, '“A free sticky” is already in Unsorted.')
})

test('delete_sticky moves it to the Trash in Notes; Undo restores it', async () => {
  const { run, idOf, undoes, doc } = await garden()
  const id = idOf(run('add_sticky', { text: 'Old idea', node: 'Garden' }))
  assert.equal(undoes('delete_sticky', { sticky: 'old idea' }), 'Moved “Old idea” to the Trash in Notes, where it can be restored.')
  run('delete_sticky', { sticky: id })
  const gone = doc().notes.find((item) => item.id === id)
  assert.deepEqual([gone.trashedAt, gone.pinned], [NOW, false])
  assert.throws(() => run('delete_sticky', { sticky: id }), /No sticky holds/, 'a deleted sticky can’t be acted on')
  assert.equal(run('search', { query: 'old idea' }), 'Nothing in OSAT holds “old idea”.')
})

test('add_branch: in a topic or inside a branch, at the end; a name already there is used', async () => {
  const { run, idOf, undoes, doc } = await garden()
  const made = undoes('add_branch', { node: 'Garden', title: 'Compost' })
  assert.match(made, /^Added the branch “Compost” to Garden \(folder-\d+\)\.$/)
  const id = idOf(run('add_branch', { node: 'Garden', title: 'Compost' }))
  const compost = doc().folders.find((folder) => folder.id === id)
  const herbs = doc().folders.find((folder) => folder.name === 'Herbs')
  assert.deepEqual([compost.parentId, compost.collapsed, compost.createdAt], [herbs.parentId, false, NOW])
  assert.ok(compost.rank > herbs.rank, 'after the other branches')
  assert.equal(run('add_branch', { node: 'Garden', title: 'compost' }), `Garden already has a branch called “Compost” (${id}), so nothing new was made.`)
  assert.match(undoes('add_branch', { node: 'Garden', title: 'Tomatoes', inside: 'beds' }), /^Added the branch “Tomatoes” to Garden › Beds \(folder-\d+\)\.$/)
  assert.match(run('add_sticky', { text: 'Stake them', node: 'Garden', branch: idOf(run('add_branch', { node: 'Garden', title: 'Tomatoes', inside: 'Beds' })) }), /Garden › Beds › Tomatoes/)
  assert.throws(() => run('add_branch', { node: 'Garden', title: ' ' }), /needs a title/)
  assert.throws(() => run('add_branch', { node: 'Garden', title: 'x', inside: 'Roses' }), /no branch called “Roses”/)
  assert.throws(() => run('add_branch', { node: 'Shed', title: 'x' }), /no topic called “Shed”/)
})

test('rename: a topic or one of its branches, only the name; links follow by id', async () => {
  const { run, undoes, doc } = await garden()
  const topic = doc().folders.find((folder) => folder.name === 'Garden')
  assert.equal(undoes('rename', { node: 'garden', name: 'Back garden' }), 'Renamed the topic “Garden” to “Back garden”.')
  run('rename', { node: 'Garden', name: 'Back garden' })
  assert.equal(doc().folders.find((folder) => folder.id === topic.id).name, 'Back garden')
  assert.match(run('search', { query: 'tomatoes' }), /\[Back garden › Beds, /)
  assert.equal(undoes('rename', { node: 'Back garden', branch: 'Beds', name: 'Raised beds' }), 'Renamed the branch “Beds” to “Raised beds”.')
  assert.equal(run('rename', { node: topic.id, name: 'Back garden' }), 'The topic is already called “Back garden”.')
  assert.throws(() => run('rename', { node: 'Back garden', name: 'house' }), /already a topic called “House” there\. Pick another name\./)
  assert.throws(() => run('rename', { node: 'Back garden', branch: 'Beds', name: 'Herbs' }), /already a branch called “Herbs”/)
  assert.throws(() => run('rename', { node: 'Back garden', name: '' }), /Give the new name/)
  // Same name under different parents is fine.
  assert.equal(run('rename', { node: 'House', branch: 'Kitchen', name: 'Beds' }), 'Renamed the branch “Kitchen” to “Beds”.')
})

const local = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString()

test('add_event: a time lasts an hour, a day the whole day; kept in order of start; Undo takes it away', async () => {
  const { run, idOf, undoes, doc } = await garden()
  const dentist = run('add_event', { title: 'Dentist', start: '2026-10-09T14:30' })
  assert.match(dentist, /^Added “Dentist” to OSAT’s calendar: 2026-10-09 14:30–15:30 \(event-\d+\)\.$/)
  assert.deepEqual(doc().calendar.events.find((event) => event.id === idOf(dentist)), { id: idOf(dentist), title: 'Dentist', start: local(2026, 10, 9, 14, 30), end: local(2026, 10, 9, 15, 30), notes: '' })
  assert.match(run('add_event', { title: 'Market', start: '2026-10-08', notes: 'Bring bags' }), /2026-10-08, all day/)
  assert.match(run('add_event', { title: 'Trip', start: '2026-10-10T09:00', end: '2026-10-11T17:00' }), /2026-10-10 09:00–2026-10-11 17:00/)
  assert.match(run('add_event', { title: 'Fair', start: '2026-10-12', end: '2026-10-13' }), /2026-10-12 00:00–2026-10-13 23:59/)
  assert.deepEqual(doc().calendar.events.map((event) => event.title), ['Market', 'Dentist', 'Trip', 'Fair'], 'in order of start')
  assert.equal(doc().calendar.events[0].end, local(2026, 10, 8, 23, 59))
  assert.match(undoes('add_event', { title: 'Call', start: '2026-10-09 08:00:00' }), /2026-10-09 08:00–09:00/)
  assert.throws(() => run('add_event', { title: 'x', start: 'next Friday' }), (error) => error instanceof ToolError && /Give the start as YYYY-MM-DDTHH:MM/.test(error.message))
  assert.throws(() => run('add_event', { title: 'x', start: '2026-02-30' }), /Give the start/)
  assert.throws(() => run('add_event', { title: 'x', start: '2026-10-09T25:00' }), /Give the start/)
  assert.throws(() => run('add_event', { title: 'x', start: '2026-10-09T14:00Z' }), /Give the start/)
  assert.throws(() => run('add_event', { title: 'x', start: '2026-10-09T14:00', end: 'later' }), /Give the end/)
  assert.throws(() => run('add_event', { title: 'x', start: '2026-10-09T14:00', end: '2026-10-09T13:00' }), /end comes before the start/)
  assert.throws(() => run('add_event', { title: ' ', start: '2026-10-09' }), /needs a title/)
})

test('list_events: today through 7 days on, or the days asked for, one line each with its id', async () => {
  const { run } = await tempStore()
  const today = new Date(NOW)
  const day = (offset, h, mi = 0) => { const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, h, mi); return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` }
  run('add_event', { title: 'Yesterday', start: day(-1, 9) })
  run('add_event', { title: 'Lunch', start: day(0, 12), notes: 'With\nSam' })
  run('add_event', { title: 'Week out', start: day(7, 18) })
  run('add_event', { title: 'Too far', start: day(8, 9) })
  const listed = run('list_events', {})
  assert.match(listed, /^2 events from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}:\n- \(event-\d+\) \d{4}-\d{2}-\d{2} 12:00–13:00: Lunch \(With Sam\)\n- \(event-\d+\) \d{4}-\d{2}-\d{2} 18:00–19:00: Week out$/)
  assert.match(run('list_events', { from: day(-1, 0).slice(0, 10), to: day(-1, 0).slice(0, 10) }), /^1 event from .*\n- \(event-\d+\) .* 09:00–10:00: Yesterday$/)
  assert.equal(run('list_events', { from: '2030-01-01' }), 'Nothing on OSAT’s calendar from 2030-01-01 to 2030-01-08.')
  assert.throws(() => run('list_events', { from: '2026-10-09', to: '2026-10-01' }), /last day comes before the first/)
  assert.throws(() => run('list_events', { from: 'today' }), /YYYY-MM-DD/)
})

test('find_files: only looks, through the Mac app’s own search', async () => {
  const doc = storeCore.createEmptyDoc()
  assert.throws(() => runTool('find_files', { query: 'taxes' }, { doc, now: NOW, makeId }), (error) => error instanceof ToolError && error.message === 'Finding files works in the Mac app.')
  const asked = []
  const findFiles = async (query) => {
    asked.push(query)
    if (query === 'nothing') return []
    return Array.from({ length: 12 }, (_, i) => ({ name: `Taxes ${2014 + i}.pdf`, where: 'Documents › Taxes', kind: 'PDF', modifiedAt: i === 0 ? undefined : local(2026, 4, 15, 12) }))
  }
  const result = runTool('find_files', { query: ' taxes pdf ', limit: 2 }, { doc, now: NOW, makeId, findFiles })
  assert.ok(result instanceof Promise)
  const { text, ops } = await result
  assert.equal(ops, undefined)
  assert.equal(text, '12 files for “taxes pdf”:\n- Taxes 2014.pdf (PDF) in Documents › Taxes\n- Taxes 2015.pdf (PDF) in Documents › Taxes, changed 2026-04-15\n\n…and 10 more.')
  assert.deepEqual(asked, ['taxes pdf'])
  assert.match((await runTool('find_files', { query: 'taxes' }, { doc, findFiles })).text, /^12 files[^]*\n\n…and 2 more\.$/, '10 unless asked')
  assert.equal((await runTool('find_files', { query: 'nothing' }, { doc, findFiles })).text, 'No files match “nothing”.')
  await assert.rejects(runTool('find_files', {}, { doc, findFiles }), /Say what to look for/)
})

test('every changing tool gives back ops whose inverse undoes it exactly (pure, no store)', () => {
  let doc = storeCore.createEmptyDoc()
  const apply = (name, args) => {
    const result = runTool(name, args, { doc, now: NOW, makeId })
    const { doc: after, inverse } = storeCore.applyOps(doc, result.ops)
    assert.deepEqual(storeCore.applyOps(after, inverse).doc, doc, `${name}'s inverse`)
    doc = after
    return result.text
  }
  apply('add_node', { title: 'Garden', branches: [{ title: 'Beds', leaves: ['Water'] }] })
  const id = /\((note-\d+)\)/.exec(apply('add_sticky', { text: 'Buy seeds' }))[1]
  apply('edit_sticky', { sticky: id, text: 'Buy seeds #spring' })
  apply('move_sticky', { sticky: id, node: 'Garden', branch: 'Beds' })
  apply('add_branch', { node: 'Garden', title: 'Herbs' })
  apply('rename', { node: 'Garden', branch: 'Herbs', name: 'Kitchen herbs' })
  apply('add_event', { title: 'Plant', start: '2026-10-09' })
  apply('add_to_journal', { text: 'Rain' })
  apply('delete_sticky', { sticky: id })
  assert.equal(doc.notes.find((note) => note.id === id).trashedAt, NOW)
})
