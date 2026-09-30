import assert from 'node:assert/strict'
import test from 'node:test'

import { COLUMN, MAX_H, MAX_W, resize, roomFor, sizeKey, sizeOf } from '../src/field/widget-size.js'

test('a size is kept with the other places, and read back only when it is whole', () => {
  assert.equal(sizeKey('next'), 'size:widget:next')
  assert.deepEqual(sizeOf({ 'size:widget:next': { x: 0, y: 0, w: 400, h: 300 } }, 'next'), { w: 400, h: 300 })
  assert.equal(sizeOf({ 'size:widget:next': { x: 0, y: 0 } }, 'next'), null)
  assert.equal(sizeOf({}, 'next'), null)
  assert.equal(sizeOf(undefined, 'next'), null)
})

test('a widget in the column only grows taller; one set down on the desk grows both ways', () => {
  assert.deepEqual(resize({ w: COLUMN, h: 200 }, { x: 90, y: 60 }), { w: COLUMN, h: 260 })
  assert.deepEqual(resize({ w: COLUMN, h: 200 }, { x: 90, y: 60 }, { placed: true }), { w: 401, h: 260 })
})

test('it never gets smaller than its own content, or bigger than the desk holds', () => {
  assert.equal(resize({ w: COLUMN, h: 200 }, { x: 0, y: -150 }, { floor: 180 }).h, 180)
  assert.equal(resize({ w: COLUMN, h: 200 }, { x: 0, y: -500 }).h, 90)
  assert.equal(resize({ w: COLUMN, h: 200 }, { x: 0, y: 5000 }).h, MAX_H)
  assert.equal(resize({ w: 400, h: 200 }, { x: 5000, y: 0 }, { placed: true }).w, MAX_W)
  assert.equal(resize({ w: 400, h: 200 }, { x: -5000, y: 0 }, { placed: true }).w, 240)
})

test('a taller widget has room to show more', () => {
  assert.equal(roomFor(undefined, 'next'), 0)
  assert.equal(roomFor(200, 'next'), 0)
  assert.equal(roomFor(290, 'next'), 3)
  assert.equal(roomFor(230, 'habits'), 3)
  assert.equal(roomFor(100, 'habits'), 0)
  assert.equal(roomFor(500, 'unknown'), 12)
})
