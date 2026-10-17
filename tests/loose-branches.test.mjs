import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'
import { boardMap } from '../src/assistant/board-context.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { isBranch } from '../src/notes-model.js'
import { moveFolder, nodesOf } from '../src/nodes-model.js'

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

test('Ask names old loose branches as boards, like the sidebar does', () => {
  const state = space([folder('Clients'), folder('Mine', { kind: 'branch' })], [note('hello', 'Mine')])
  const map = boardMap(state)
  assert.match(map, /Boards \(2\):/)
  assert.match(map, /- Mine \(1 sticky\)/)
})
