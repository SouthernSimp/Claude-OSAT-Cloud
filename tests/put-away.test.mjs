import assert from 'node:assert/strict'
import test from 'node:test'

import { putAway, putAwayName } from '../src/field/put-away.js'

const at = '2026-10-12T12:00:00Z'
const note = (id, extra = {}) => ({ id, title: id, markdown: id, createdAt: at, updatedAt: at, folderId: null, unsorted: true, ...extra })

function desk() {
  return {
    state: {
      folders: [{ id: 'osat', name: 'OSAT', parentId: null, createdAt: at }],
      notes: [note('a'), note('b'), note('c', { folderId: 'osat', unsorted: false }), note('d'), note('e', { trashedAt: at }), note('day-2026-10-12', { kind: 'day' })],
    },
    places: {
      'note:a': { x: 0.4, y: 0.4 },
      'note:c': { x: 0.5, y: 0.5 },
      'note:day-2026-10-12': { x: 0.1, y: 0.1 },
      'stack:s1': { x: 0.2, y: 0.2, ids: ['b', 'c2', 'd'], name: 'Questions' },
      'stack:s2': { x: 0.3, y: 0.3, ids: ['e'] },
      'folder:osat': { x: 0.9, y: 0.1 },
    },
  }
}

test('everything on the desk goes into one topic; stacks become branches; sorted stickies stay home', () => {
  const { state, places } = desk()
  const name = putAwayName(state, new Date(2026, 9, 12))
  assert.equal(name, 'Put away · Oct 12')
  const result = putAway(state, places, { name })
  const topic = result.folder
  assert.equal(topic.name, 'Put away · Oct 12')
  const home = (id) => result.state.notes.find((item) => item.id === id)
  assert.equal(home('a').folderId, topic.id, 'an Unsorted sticky moves in')
  assert.equal(home('a').unsorted, false)
  assert.equal(home('c').folderId, 'osat', 'a sorted sticky stays in its topic')
  assert.ok(result.state.folders.find((item) => item.id === topic.id).links.includes('note:c'), '…and is connected instead')
  const branch = result.state.folders.find((item) => item.parentId === topic.id)
  assert.equal(branch.name, 'Questions', 'a stack keeps its name as a branch')
  assert.equal(home('b').folderId, branch.id)
  assert.equal(home('d').folderId, branch.id)
  assert.equal(result.state.folders.filter((item) => item.parentId === topic.id).length, 1, 'a stack of only binned stickies makes no branch')
  assert.equal(result.count, 4)
  assert.deepEqual(result.places, { 'folder:osat': { x: 0.9, y: 0.1 } }, 'the desk is clear; topic icons stay')
})

test('a clear desk changes nothing, and a taken name is numbered', () => {
  const { state } = desk()
  assert.equal(putAway(state, { 'folder:osat': { x: 0, y: 0 } }, { name: 'x' }), null)
  const taken = { ...state, folders: [...state.folders, { id: 'p', name: 'Put away · Oct 12', parentId: null }] }
  assert.equal(putAwayName(taken, new Date(2026, 9, 12)), 'Put away · Oct 12 2')
})
