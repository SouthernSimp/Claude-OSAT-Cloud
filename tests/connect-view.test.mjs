import assert from 'node:assert/strict'
import test from 'node:test'

import { edgeSpot, offscreen, sideOf, unionBoxes } from '../src/sky/connect-view.js'

const size = { w: 1000, h: 600 }

test('one box around the two ends of a connection', () => {
  assert.deepEqual(unionBoxes([{ x: 0, y: 0, w: 100, h: 50 }, { x: 900, y: 400, w: 100, h: 50 }]), { x: 0, y: 0, w: 1000, h: 450 })
  assert.deepEqual(unionBoxes([null, { x: 5, y: 6, w: 7, h: 8 }]), { x: 5, y: 6, w: 7, h: 8 })
  assert.equal(unionBoxes([null]), null)
})

test('a box is off screen only when none of it shows', () => {
  const camera = { x: 0, y: 0, z: 1 }
  assert.equal(offscreen({ x: 100, y: 100, w: 50, h: 50 }, camera, size), false)
  assert.equal(offscreen({ x: 990, y: 100, w: 50, h: 50 }, camera, size), false, 'half in')
  assert.equal(offscreen({ x: 1200, y: 100, w: 50, h: 50 }, camera, size), true)
  assert.equal(offscreen({ x: 100, y: -200, w: 50, h: 50 }, camera, size), true)
  assert.equal(offscreen({ x: 1200, y: 100, w: 50, h: 50 }, { x: -400, y: 0, z: 1 }, size), false, 'the camera moved')
})

test('a label for a line that runs off the screen sits at its edge, on the way there', () => {
  const right = edgeSpot({ x: 500, y: 300 }, { x: 3000, y: 300 }, size)
  assert.deepEqual(right, { x: 986, y: 300 })
  assert.equal(sideOf(right, size), 'right')
  const up = edgeSpot({ x: 500, y: 300 }, { x: 500, y: -2000 }, size)
  assert.deepEqual(up, { x: 500, y: 14 })
  assert.equal(sideOf(up, size), 'top')
  const slanted = edgeSpot({ x: 500, y: 300 }, { x: 1500, y: 1300 }, size)
  assert.ok(slanted.x > 500 && slanted.y > 300 && slanted.x <= 986 && slanted.y <= 586)
  assert.equal(sideOf(slanted, size), 'bottom')
})

test('a label never lands outside the view', () => {
  for (const to of [{ x: -9000, y: 2 }, { x: 9000, y: 9000 }, { x: 500, y: 300 }, { x: 5000, y: -4000 }]) {
    const spot = edgeSpot({ x: 700, y: 100 }, to, size)
    assert.ok(spot.x >= 14 && spot.x <= 986 && spot.y >= 14 && spot.y <= 586, JSON.stringify(spot))
  }
})
