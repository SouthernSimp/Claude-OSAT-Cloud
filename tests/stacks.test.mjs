import assert from 'node:assert/strict'
import test from 'node:test'

import { addToStack, changes, setDown, stackOf, stackUp, unstack } from '../src/field/stacks.js'

test('desk stacks: drop one sticky on another, reorder, take one out, and the last one keeps the spot', () => {
  const desk = { 'note:a': { x: 0.5, y: 0.2 }, 'note:b': { x: 0.1, y: 0.6 }, 'note:c': { x: 0.3, y: 0.3 }, 'widget:day': { x: 0, y: 0 } }
  let places = stackUp(desk, 'a', 'b', 's1')
  assert.deepEqual(places['stack:s1'], { x: 0.5, y: 0.2, ids: ['a', 'b'] }, 'where the target lay, target first')
  assert.equal('note:a' in places || 'note:b' in places, false, 'the stack holds them now')
  assert.equal(stackOf(places, 'b'), 'stack:s1')

  places = stackUp(places, 'b', 'c', 's2')
  assert.deepEqual(places['stack:s1'].ids, ['a', 'b', 'c'], 'dropped on a sticky in a stack: joins that stack')
  assert.equal('stack:s2' in places, false)

  places = addToStack(places, 'stack:s1', 'c', 0)
  assert.deepEqual(places['stack:s1'].ids, ['c', 'a', 'b'], 'a new place in its order')

  places = setDown(places, 'a', { x: 0.7, y: 0.7 })
  assert.deepEqual(places['stack:s1'].ids, ['c', 'b'])
  assert.deepEqual(places['note:a'], { x: 0.7, y: 0.7 })

  places = setDown(places, 'c', { x: 0.2, y: 0.8 })
  assert.equal('stack:s1' in places, false, 'one sticky is not a stack')
  assert.deepEqual(places['note:b'], { x: 0.5, y: 0.2 }, 'the last one stays where the stack stood')
  assert.deepEqual(places['widget:day'], desk['widget:day'], 'nothing else moves')

  assert.equal(stackUp(desk, 'a', 'a', 's3'), desk, 'not onto itself')
  assert.equal(stackUp(desk, 'nowhere', 'a', 's3'), desk, 'only onto a sticky that is on the desk')
})

test('unstack fans the stickies back out; changes lists what to save, and reversed, what Undo puts back', () => {
  const before = { 'note:a': { x: 0.5, y: 0.2 }, 'note:b': { x: 0.1, y: 0.6 } }
  const stacked = stackUp(before, 'a', 'b', 's1')
  assert.deepEqual(changes(before, stacked).sort(), [['note:a', null], ['note:b', null], ['stack:s1', { x: 0.5, y: 0.2, ids: ['a', 'b'] }]])
  const undo = Object.fromEntries(changes(stacked, before))
  assert.deepEqual(undo, { 'stack:s1': null, 'note:a': before['note:a'], 'note:b': before['note:b'] })

  const spread = unstack(stacked, 'stack:s1')
  assert.equal('stack:s1' in spread, false)
  assert.deepEqual(Object.keys(spread).sort(), ['note:a', 'note:b'])
  assert.ok(spread['note:b'].y > spread['note:a'].y, 'fanned downwards')
  assert.equal(unstack(stacked, 'stack:none'), stacked)
})
