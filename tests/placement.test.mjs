import assert from 'node:assert/strict'
import test from 'node:test'

import { covers, placeRoom } from '../src/shell/placement.js'

const wide = { width: 3440, height: 1410 }
const laptop = { width: 1440, height: 900 }
const lineOn = (view) => ({ left: view.width / 2 - 286, right: view.width / 2 + 286, top: view.height * 0.35, bottom: view.height * 0.35 + 190 })

test('on a wide screen rooms open beside the line, one each side', () => {
  const line = lineOn(wide)
  const first = placeRoom(wide, [1100, 720], line)
  assert.equal(first.w, 1100)
  assert.equal(covers(first, line), false)
  const second = placeRoom(wide, [1080, 700], line, [first])
  assert.equal(covers(second, line), false)
  assert.notEqual(first.x > line.right, second.x > line.right, 'the second room takes the other side')
  const third = placeRoom(wide, [980, 720], line, [first, second])
  assert.equal(covers(third, line), false)
  assert.ok(third.x !== first.x || third.y !== first.y, 'a third room steps down instead of hiding one')
})

test('a room that would lose most of its size beside the line opens under the risen line', () => {
  const line = lineOn(laptop)
  const spot = placeRoom(laptop, [1100, 720], line)
  assert.equal(spot.y, 170)
  assert.ok(spot.x >= 16 && spot.x + spot.w <= laptop.width - 16)
  assert.ok(spot.y + spot.h <= laptop.height - 96, 'clear of the dock')
  assert.equal(covers(spot, line), true, 'the line has to rise for it')
})

test('small rooms still fit beside the line on a mid-size screen', () => {
  const view = { width: 1920, height: 1080 }
  const line = lineOn(view)
  const note = placeRoom(view, [600, 640], line)
  assert.equal(covers(note, line), false)
  assert.ok(note.w >= 560)
})

test('rooms stay on the screen and clear of the dock', () => {
  for (const view of [wide, laptop, { width: 1280, height: 720 }]) {
    let pops = []
    for (let index = 0; index < 8; index += 1) {
      const spot = placeRoom(view, [1120, 760], lineOn(view), pops)
      assert.ok(spot.x >= 0 && spot.x + spot.w <= view.width, `x on ${view.width}`)
      assert.ok(spot.y >= 0 && spot.y + spot.h <= view.height - 96, `y on ${view.width}`)
      pops = [...pops, spot]
    }
  }
})

test('covers needs the boxes to meet', () => {
  const line = { left: 100, right: 300, top: 100, bottom: 200 }
  assert.equal(covers({ x: 300, y: 100, w: 50, h: 50 }, line), false)
  assert.equal(covers({ x: 299, y: 199, w: 50, h: 50 }, line), true)
  assert.equal(covers({ x: 0, y: 0, w: 50, h: 50 }, null), false)
})
