import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  arrivalOps, botInstructions, fromOf, isPacked, markdownTree, nodeRecords, NodeFileError, nodeTree, readNodeFile, sameFile,
} from '../shared/node-file.mjs'
import { applyOps, createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { importNode, markOpened, markUnpacked, pileOf } from '../src/nodes-model.js'

let counter = 0
const makeId = (prefix) => `${prefix}-${++counter}`
const hash = (text) => createHash('sha256').update(text).digest('hex')
const NOW = '2026-09-29T10:00:00.000Z'

const GARDEN_MD = `---
source: Muse
---
# Garden plan
What grows where.

## Beds
- Tomatoes
- [x] Dig the bed
  by the fence, before May
### Herbs
* Basil
1. Mint

## Tools
Borrow the tiller.
\`\`\`
## not a branch
- not a sticky
\`\`\`
`

test('Markdown: # is the node, ## and ### are branches, list items are stickies, front matter names the source', () => {
  const tree = readNodeFile(GARDEN_MD, 'Garden.md')
  assert.equal(tree.title, 'Garden plan')
  assert.equal(tree.source, 'Muse')
  assert.equal(tree.summary, 'What grows where.')
  assert.deepEqual(tree.branches.map((branch) => branch.title), ['Beds', 'Tools'])
  const [beds, tools] = tree.branches
  assert.deepEqual(beds.leaves, [{ text: 'Tomatoes', done: false }, { text: 'Dig the bed\nby the fence, before May', done: true }], 'an indented line stays with its sticky')
  assert.deepEqual(beds.branches.map((branch) => branch.title), ['Herbs'])
  assert.deepEqual(beds.branches[0].leaves.map((leaf) => leaf.text), ['Basil', 'Mint'])
  assert.match(tools.summary, /^Borrow the tiller\.\n```\n## not a branch\n- not a sticky\n```$/, 'inside a code fence nothing is a heading or a sticky')
  assert.deepEqual(tools.leaves, [])
  assert.equal(isPacked(tree), false)
})

test('plain text: with no # heading the first line is the name, the rest its summary (packed)', () => {
  const tree = readNodeFile('Spring launch ideas\n\nA short paragraph worth keeping.\nAnd a second line.', 'note.txt')
  assert.deepEqual([tree.title, tree.summary, tree.source], ['Spring launch ideas', 'A short paragraph worth keeping.\nAnd a second line.', ''])
  assert.equal(isPacked(tree), true)
})

test('JSON: the Sky’s Import format, plus a source; strings and objects as leaves', () => {
  const tree = readNodeFile(JSON.stringify({
    title: '  Garden  ', source: 'Grok Bot', summary: 'What grows where.',
    branches: [{ title: 'Beds', leaves: ['Tomatoes', { text: 'Dig', done: true }, { text: '  ' }], sub_branches: [{ name: 'Herbs', leaves: [{ text: 'Basil' }] }] }, { title: '' }],
  }), 'garden.json')
  assert.deepEqual([tree.title, tree.source], ['Garden', 'Grok Bot'])
  assert.deepEqual(tree.branches[0].leaves, [{ text: 'Tomatoes', done: false }, { text: 'Dig', done: true }], 'an empty leaf is dropped')
  assert.deepEqual(tree.branches.map((branch) => branch.title), ['Beds'], 'a branch with no name is dropped')
  assert.equal(tree.branches[0].branches[0].title, 'Herbs')
  assert.equal(nodeTree(tree).branches[0].branches[0].leaves[0].text, 'Basil', 'a tree reads back as itself')
})

test('bad files say what is wrong, and never make a node', () => {
  assert.throws(() => readNodeFile('', 'x.md'), (error) => error instanceof NodeFileError && /empty/.test(error.message))
  assert.throws(() => readNodeFile('{ "title": "Half', 'x.json'), /valid JSON/)
  assert.throws(() => readNodeFile('{"summary": "no title"}', 'x.json'), /isn’t a topic file/)
  assert.throws(() => readNodeFile('{"title": "X", "branches": "no"}', 'x.json'), /isn’t a topic file/)
  assert.throws(() => readNodeFile('[1, 2]', 'x.json'), /isn’t a topic file/)
  assert.throws(() => markdownTree('\n\n   \n'), /isn’t a topic file/)
})

test('records: one new node at the end of the Sky, a taken name gets 2, summary first then leaves, in order', () => {
  const folders = [{ id: 'g', name: 'Garden plan', parentId: null, createdAt: NOW, rank: 5000 }]
  const made = nodeRecords(folders, readNodeFile(GARDEN_MD, 'Garden.md'), { now: NOW, makeId, source: 'Muse' })
  assert.equal(made.folder.name, 'Garden plan 2')
  assert.equal(made.folder.rank, 5000 + 1024)
  assert.equal(made.folders.length, 4, 'the node, Beds, Herbs and Tools')
  const beds = made.folders.find((folder) => folder.name === 'Beds')
  const state = { notes: made.notes }
  assert.deepEqual(pileOf(state.notes, made.folder.id).map((note) => note.markdown), ['What grows where.'])
  assert.deepEqual(pileOf(state.notes, beds.id).map((note) => note.markdown), ['Tomatoes', '- [x] Dig the bed\nby the fence, before May'])
  assert.ok(made.notes.every((note) => note.source === 'Muse' && !note.unsorted && note.createdAt === NOW))
})

test('arrival: a New node that remembers where it came from; packed when it is only a summary', () => {
  let doc = createEmptyDoc()
  const packed = readNodeFile('# Spring launch\nEverything worth keeping.', 'Spring.md')
  const first = arrivalOps(doc, packed, { hash: hash('a'), file: 'Spring.md', source: 'Drop folder', now: NOW, makeId })
  doc = applyOps(doc, first.ops).doc
  const node = doc.folders.find((folder) => folder.id === first.folder.id)
  assert.deepEqual([node.fresh, node.packed, node.from], [true, true, { source: 'Drop folder', file: 'Spring.md', hash: hash('a') }])
  assert.deepEqual(doc.notes.map((note) => [note.markdown, note.source]), [['Everything worth keeping.', 'Drop folder']])

  const full = arrivalOps(doc, readNodeFile(GARDEN_MD, 'Garden.md'), { hash: hash('b'), file: 'Garden.md', now: NOW, makeId })
  assert.equal(full.folder.packed, undefined, 'a node with branches is not packed')
  assert.equal(full.folder.from.source, 'Muse', 'the file’s own source wins')
})

test('duplicates: the same file saved twice makes one node; the same name with other words makes "2"', () => {
  let doc = createEmptyDoc()
  const tree = readNodeFile('# Garden\nA summary.', 'Garden.md')
  doc = applyOps(doc, arrivalOps(doc, tree, { hash: hash('same'), file: 'Garden.md', now: NOW, makeId }).ops).doc
  const again = arrivalOps(doc, tree, { hash: hash('same'), file: 'Garden copy.md', now: NOW, makeId })
  assert.equal(again.duplicate.name, 'Garden')
  assert.equal(again.ops, undefined)
  const other = arrivalOps(doc, tree, { hash: hash('other'), file: 'Garden.md', now: NOW, makeId })
  assert.equal(other.folder.name, 'Garden 2')
  assert.equal(sameFile(doc.folders, ''), null, 'no fingerprint never matches')
  // Deleted, the same file can bring it back.
  const without = { ...doc, folders: [] }
  assert.ok(arrivalOps(without, tree, { hash: hash('same'), file: 'Garden.md', now: NOW, makeId }).folder)
})

test('schema 7: arrival fields are kept on folders, bad ones dropped; nothing else changes', () => {
  const state = normalizeWorkspace({
    ...createDefaultWorkspace(),
    folders: [
      { id: 'a', name: 'A', packed: true, fresh: true, from: { source: 'Muse', file: 'a.md', hash: 'ab'.repeat(16), extra: 1 } },
      { id: 'b', name: 'B', packed: 'yes', fresh: 1, from: { hash: 'not hex' } },
    ],
  })
  const [a, b] = state.folders
  assert.deepEqual([a.packed, a.fresh], [true, true])
  assert.deepEqual(a.from, { source: 'Muse', file: 'a.md', hash: 'ab'.repeat(16) })
  assert.deepEqual(['packed', 'fresh', 'from'].map((key) => key in b), [false, false, false])
  assert.equal(fromOf({ source: '  ' }), null)
  const old = { ...createEmptyDoc(), schema: 6, rev: 2, folders: [{ id: 'x', name: 'X' }] }
  assert.deepEqual(migrate(old), { ...old, schema: SCHEMA })
  assert.ok(SCHEMA >= 8)
})

test('opening a New node clears New; a branch or Unpack clears packed; nothing else moves', () => {
  const state = normalizeWorkspace({ ...createDefaultWorkspace(), folders: [{ id: 'a', name: 'A', packed: true, fresh: true, from: { source: 'Muse' } }] })
  const opened = markOpened(state, 'a')
  assert.deepEqual([opened.folders[0].fresh, opened.folders[0].packed, opened.folders[0].from.source], [undefined, true, 'Muse'])
  assert.equal(markOpened(opened, 'a'), opened, 'the same state when nothing changes')
  assert.equal(markUnpacked(opened, 'a').folders[0].packed, undefined)
  assert.equal(markUnpacked(state, 'missing'), state)
})

test('a leaf’s day (a sorted scan’s event) is kept on its sticky, to offer to the Calendar', () => {
  const tree = nodeTree({ title: 'Paper', leaves: [{ text: 'Dentist', event: { title: 'Dentist', date: '2026-10-05', time: '14:30' } }, 'Milk'] })
  const made = nodeRecords([], tree, { now: NOW, makeId, source: 'Scan' })
  assert.deepEqual(made.notes.map((note) => note.ask?.event || null), [{ title: 'Dentist', date: '2026-10-05', time: '14:30' }, null])
  const { state } = importNode(createDefaultWorkspace(), { title: 'Paper', leaves: [{ text: 'Dentist', event: { title: 'Dentist', date: '2026-10-05', time: '' } }] }, 'Scan')
  const dentist = state.notes.find((note) => note.markdown === 'Dentist')
  assert.deepEqual([dentist.source, dentist.ask.event.date], ['Scan', '2026-10-05'], 'the source can be given as a word, as scans do')
})

test('the Sky’s Import takes the Markdown bots write, and still makes an ordinary node', () => {
  const base = createDefaultWorkspace()
  const { state, folder, branches } = importNode(base, readNodeFile(GARDEN_MD, 'Garden.md'))
  assert.deepEqual([folder.name, branches, folder.fresh, folder.packed], ['Garden plan', 3, undefined, undefined])
  assert.ok(state.notes.every((note) => note.source === 'Import'))
})

test('the instructions for a bot: every example in them reads as the node it says it is', () => {
  const text = botInstructions('/Users/nate/Documents/OSAT Nodes')
  assert.match(text, /Documents\/OSAT Nodes/)
  const markdown = [...text.matchAll(/---\nsource: Muse\n---\n[\s\S]*?(?=\n\n"# "|\n\nJSON|\n\nA packed)/g)].map((match) => match[0])
  assert.equal(markdown.length, 2)
  const [full, packed] = markdown.map((body) => readNodeFile(body, 'example.md'))
  assert.deepEqual([full.title, full.source, full.branches.map((branch) => branch.title), isPacked(full)], ['Garden plan', 'Muse', ['Beds', 'Herbs'], false])
  assert.deepEqual(full.branches[0].leaves, [{ text: 'Tomatoes along the fence', done: false }, { text: 'Dig the first bed', done: true }])
  assert.deepEqual([packed.title, isPacked(packed)], ['Ideas for the spring launch', true])
  const json = readNodeFile(/\n\{\n[\s\S]*?\n\}\n/.exec(text)[0], 'example.json')
  assert.deepEqual([json.title, json.source, json.branches.length, isPacked(json)], ['Garden plan', 'Muse', 2, false])
})
