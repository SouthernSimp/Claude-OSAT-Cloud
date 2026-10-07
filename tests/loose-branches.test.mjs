import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'
import { readWhereAnswer, whereMessages } from '../shared/ai-tasks.mjs'
import { boardMap } from '../src/assistant/board-context.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { isBranch } from '../src/notes-model.js'
import { moveFolder, nodesOf } from '../src/nodes-model.js'
import { branchWords, wherePlaces } from '../src/sky/where.js'

const at = new Date(Date.UTC(2026, 8, 29, 9)).toISOString()
const folder = (id, extra = {}) => ({ id, name: id, createdAt: at, ...extra })
const note = (id, folderId) => ({ id, title: id, markdown: id, createdAt: at, updatedAt: at, folderId })
const space = (folders, notes = []) => normalizeWorkspace({ ...createDefaultWorkspace(), folders, notes })

test('a branch set down on the canvas on its own stays a branch, and comes through save and reload', () => {
  const state = space([folder('Clients'), folder('Tommy', { parentId: 'Clients' }), folder('Ideas')])
  const loose = moveFolder(state, 'Tommy', null, Infinity, { loose: true })
  const tommy = loose.folders.find((item) => item.id === 'Tommy')
  assert.equal(tommy.parentId, null)
  assert.equal(tommy.kind, 'branch')
  assert.deepEqual([isBranch(tommy), isBranch(loose.folders[0])], [true, false])
  const reloaded = normalizeWorkspace(JSON.parse(JSON.stringify(loose)))
  assert.equal(reloaded.folders.find((item) => item.id === 'Tommy').kind, 'branch', 'the mark survives')
  assert.deepEqual(nodesOf(reloaded.folders).map((item) => item.folder.id).sort(), ['Clients', 'Ideas', 'Tommy'], 'it is drawn on the board with the topics')
})

test('a branch taken out without `loose` becomes a topic, and one set down loose can be made a topic', () => {
  const state = space([folder('Clients'), folder('Tommy', { parentId: 'Clients' })])
  const node = moveFolder(state, 'Tommy', null).folders.find((item) => item.id === 'Tommy')
  assert.equal(isBranch(node), false)
  const loose = moveFolder(state, 'Tommy', null, Infinity, { loose: true })
  const made = moveFolder(loose, 'Tommy', null).folders.find((item) => item.id === 'Tommy')
  assert.equal(isBranch(made), false, '"Its own topic"')
  assert.equal('kind' in made, false)
})

test('a loose branch put inside a topic is an ordinary branch again; a stale mark inside a topic is dropped', () => {
  const state = space([folder('Clients'), folder('Tommy', { kind: 'branch' })])
  const inside = moveFolder(state, 'Tommy', 'Clients').folders.find((item) => item.id === 'Tommy')
  assert.equal(inside.parentId, 'Clients')
  assert.equal('kind' in inside, false)
  const stale = space([folder('Clients'), folder('Tommy', { parentId: 'Clients', kind: 'branch' })])
  assert.equal('kind' in stale.folders[1], false, 'inside a topic the mark means nothing')
  const lost = space([folder('Tommy', { parentId: 'gone', kind: 'branch' })])
  assert.equal(lost.folders[0].kind, 'branch', 'a branch whose topic is missing stays a loose branch, not a topic')
})

test('a branch cannot be put inside itself or what is inside it', () => {
  const state = space([folder('A', { kind: 'branch' }), folder('B', { parentId: 'A' })])
  assert.equal(moveFolder(state, 'A', 'B'), state)
})

test('schema 8 changes nothing in the data; a newer OSAT is refused', () => {
  const old = { ...createEmptyDoc(), schema: 7, rev: 3, folders: [folder('Clients'), folder('Tommy', { parentId: 'Clients' })] }
  assert.deepEqual(migrate(old), { ...old, schema: SCHEMA })
  assert.ok(SCHEMA >= 8)
  assert.throws(() => migrate({ schema: SCHEMA + 1 }), /newer OSAT/)
})

test('where a branch could go: every topic and branch except itself, what is in it and where it is now', () => {
  const state = space([
    folder('Clients'), folder('Tommy', { parentId: 'Clients' }), folder('Projects'), folder('Plans', { parentId: 'Projects' }),
    folder('Mine', { kind: 'branch' }), folder('Deep', { parentId: 'Mine' }),
  ], [note('call Tommy', 'Mine'), note('x', 'Deep')])
  assert.deepEqual(wherePlaces(state, 'Mine').map((place) => place.name), ['Clients', 'Clients / Tommy', 'Projects', 'Projects / Plans'])
  assert.deepEqual(wherePlaces(state, 'Tommy').map((place) => place.name).sort(), ['Mine', 'Mine / Deep', 'Projects', 'Projects / Plans'], 'not its own topic, not itself')
  assert.deepEqual(branchWords(state, 'Mine'), ['call Tommy', 'Deep'])
})

test('the model’s answer: a number and a reason, a name, none, or nothing usable', () => {
  const names = ['Clients', 'Clients / Tommy', 'Projects']
  assert.deepEqual(readWhereAnswer('2: both are about Tommy', names), { place: 1, why: 'both are about Tommy' })
  // The name is what the prompt asks for: the longest name wins, and a name with a colon in it still counts.
  assert.deepEqual(readWhereAnswer('Clients / Tommy: both are about Tommy', names), { place: 1, why: 'both are about Tommy' })
  assert.deepEqual(readWhereAnswer('**Clients**: it mentions clients', names), { place: 0, why: 'it mentions clients' })
  assert.deepEqual(readWhereAnswer('Trip: Ohio - hotels and packing', ['Clients', 'Trip: Ohio']), { place: 1, why: 'hotels and packing' })
  assert.deepEqual(readWhereAnswer('2 Clients / Tommy: the number came first', names), { place: 1, why: 'the number came first' })
  assert.deepEqual(readWhereAnswer('Here is my answer\n**Clients** - it mentions clients', names), { place: 0, why: 'it mentions clients' })
  assert.deepEqual(readWhereAnswer('3', names), { place: 2, why: '' })
  assert.equal(readWhereAnswer('none', names), null)
  assert.equal(readWhereAnswer('9: somewhere else', names), null, 'a place that does not exist is nothing')
  assert.equal(readWhereAnswer('', names), null)
  assert.match(whereMessages({ branch: 'Tommy stuff', peek: ['call Tommy'], places: [{ name: 'Clients', peek: ['a'] }] })[1].content, /1\. Clients \(has: a\)/)
})

test('the AI is told about branches on their own, apart from the topics', () => {
  const state = space([folder('Clients'), folder('Mine', { kind: 'branch' })], [note('hello', 'Mine')])
  const map = boardMap(state)
  assert.match(map, /Topics \(1\):\n- Clients/)
  assert.match(map, /Branches on the canvas on their own \(1\), in no topic yet:\n- Mine/)
})
