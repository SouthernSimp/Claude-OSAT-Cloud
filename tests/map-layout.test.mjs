import assert from 'node:assert/strict'
import test from 'node:test'

import { branchOf, childrenOf, hangAt, layoutTree, MAP, tidyTree } from '../src/sky/map-layout.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const at = new Date(Date.UTC(2026, 8, 30, 9)).toISOString()
const note = (id, extra = {}) => ({ id, title: id, markdown: id, createdAt: at, updatedAt: at, ...extra })
const folder = (id, extra = {}) => ({ id, name: id, createdAt: at, ...extra })
const space = (notes = [], folders = []) => normalizeWorkspace({ ...createDefaultWorkspace(), notes, folders })

const clients = space(
  [note('call', { folderId: 'clients', rank: 1 }), note('bag', { folderId: 'tommy', rank: 1 }), note('invoice', { folderId: 'tommy', rank: 2 }), note('loose')],
  [folder('clients', { at: { x: 0, y: 0 } }), folder('tommy', { parentId: 'clients', rank: 1 }), folder('ana', { parentId: 'clients', rank: 2 })],
)
const root = (state, id) => state.folders.find((item) => item.id === id)

test('an open node spreads its branches and stickies out on both sides, joined to it', () => {
  assert.deepEqual(childrenOf(clients, 'clients').map((item) => item.key), ['tommy', 'ana', 'note:call'], 'branches first, then its own stickies')
  const boxes = layoutTree(clients, root(clients, 'clients'), { x: 0, y: 0 })
  assert.deepEqual([...boxes.keys()], ['clients', 'tommy', 'note:bag', 'note:invoice', 'ana', 'note:call'])
  const [tommy, ana, call] = ['tommy', 'ana', 'note:call'].map((key) => boxes.get(key))
  assert.equal(tommy.side, 1, 'the first things go right')
  assert.equal(tommy.x, MAP.folder.w + MAP.gapX)
  assert.ok([ana.side, call.side].includes(-1), 'the rest go left, so nothing piles up in one column')
  assert.ok(call.x < 0 || ana.x < 0)
  assert.equal(boxes.get('note:bag').parent, 'tommy')
  assert.equal(boxes.get('note:bag').side, 1, 'a branch keeps its things on its side')
  assert.ok(boxes.get('note:bag').x > tommy.x + tommy.w, 'further out than the branch')
  assert.ok(boxes.get('note:invoice').y > boxes.get('note:bag').y, 'in rank order, top to bottom')
  assert.equal(boxes.has('note:loose'), false, 'Unsorted is not in a node')
})

test('a folded branch keeps its things tucked away; a card moved by hand stays where it hangs', () => {
  const folded = layoutTree(clients, root(clients, 'clients'), { x: 0, y: 0 }, { folds: new Set(['tommy']) })
  assert.equal(folded.has('note:bag'), false)
  assert.equal(folded.has('tommy'), true)

  const moved = space(clients.notes, clients.folders.map((item) => (item.id === 'tommy' ? { ...item, at: { x: -400, y: 220 } } : item)))
  const boxes = layoutTree(moved, root(moved, 'clients'), { x: 100, y: 50 })
  assert.deepEqual([boxes.get('tommy').x, boxes.get('tommy').y], [-300, 270], 'from the node\'s corner')
  assert.equal(boxes.get('tommy').side, -1)
  assert.ok(boxes.get('note:bag').x < boxes.get('tommy').x, 'its things follow it to its side')
  assert.deepEqual(hangAt({ x: 100, y: 50 }, { x: -300.4, y: 270.2 }), { x: -400, y: 220 })

  const tidied = tidyTree(moved, 'clients')
  assert.equal('at' in tidied.folders.find((item) => item.id === 'tommy'), false)
  assert.deepEqual(tidied.folders.find((item) => item.id === 'clients').at, { x: 0, y: 0 }, 'the node itself stays put')
  assert.equal(tidied.notes.find((item) => item.id === 'loose'), moved.notes.find((item) => item.id === 'loose'), 'nothing outside changes')
})

test('a card with its branch: everything laid out off it', () => {
  const boxes = layoutTree(clients, root(clients, 'clients'), { x: 0, y: 0 })
  assert.deepEqual([...branchOf(boxes, 'tommy')].sort(), ['note:bag', 'note:invoice', 'tommy'])
  assert.equal(branchOf(boxes, 'clients').size, boxes.size)
  // Measured sizes are used once known.
  const wide = layoutTree(clients, root(clients, 'clients'), { x: 0, y: 0 }, { sizes: new Map([['clients', { w: 300, h: 150 }]]) })
  assert.equal(wide.get('tommy').x, 300 + MAP.gapX)
})
