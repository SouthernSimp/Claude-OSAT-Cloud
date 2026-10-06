import assert from 'node:assert/strict'
import test from 'node:test'

import { DOCK_BAND, cleanSide, deskArea, fullBox, nearestSide } from '../src/shell/dock-model.js'
import { covers, fitRoom, placeRoom, shrinkTo } from '../src/shell/placement.js'

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

test('a room from a widget opens on the widget\'s side when it fits, else in the middle', () => {
  const view = { width: 2560, height: 1300 }
  const line = lineOn(view)
  const left = placeRoom(view, [1040, 720], line, [], { prefer: 'left' })
  assert.ok(left.x + left.w <= line.left, 'on the left of the line')
  const right = placeRoom(view, [1040, 720], line, [], { prefer: 'right' })
  assert.ok(right.x >= line.right, 'on the right of the line')
  // The left side holds more rooms than the right, and still wins when it is preferred.
  assert.ok(placeRoom(view, [600, 640], line, [left], { prefer: 'left' }).x < line.left)
  // Too narrow on a laptop: the middle, never the other side.
  const laptopLine = lineOn(laptop)
  const middle = placeRoom(laptop, [1040, 720], laptopLine, [], { prefer: 'left' })
  assert.equal(middle.y, 170)
  assert.equal(covers(middle, laptopLine), true)
})

test('a room grows out of the rectangle it came from', () => {
  assert.equal(shrinkTo({ left: 30, top: 40, width: 300, height: 150 }, { left: 530, top: 240, width: 1200, height: 600 }), 'translate(-500px, -200px) scale(0.25, 0.25)')
})

test('with the dock on a side, rooms leave that strip clear, and the bottom is theirs again', () => {
  for (const view of [wide, laptop, { width: 1280, height: 720 }]) {
    for (const side of ['left', 'right']) {
      let pops = []
      for (let index = 0; index < 8; index += 1) {
        const spot = placeRoom(view, [1120, 760], lineOn(view), pops, { dock: side })
        assert.ok(spot.y >= 0 && spot.y + spot.h <= view.height - 16, `y with the dock on the ${side} of ${view.width}`)
        if (side === 'left') assert.ok(spot.x >= DOCK_BAND && spot.x + spot.w <= view.width, `clear of the left dock on ${view.width}`)
        else assert.ok(spot.x >= 0 && spot.x + spot.w <= view.width - DOCK_BAND, `clear of the right dock on ${view.width}`)
        pops = [...pops, spot]
      }
    }
  }
  const low = placeRoom(laptop, [1100, 720], lineOn(laptop), [], { dock: 'left' })
  assert.ok(low.y + low.h > laptop.height - DOCK_BAND, 'nothing keeps a room off the foot of the desk with the dock at the side')
  const same = placeRoom(laptop, [1100, 720], lineOn(laptop))
  assert.deepEqual(placeRoom(laptop, [1100, 720], lineOn(laptop), [], { dock: 'bottom' }), same, 'bottom is the usual')
})

test('the dock goes to the nearest edge: bottom, left or right; and a saved side is only ever one of those', () => {
  const view = { width: 1440, height: 900 }
  assert.equal(nearestSide({ x: 720, y: 850 }, view), 'bottom')
  assert.equal(nearestSide({ x: 300, y: 880 }, view), 'bottom')
  assert.equal(nearestSide({ x: 30, y: 400 }, view), 'left')
  assert.equal(nearestSide({ x: 1420, y: 300 }, view), 'right')
  assert.equal(nearestSide({ x: 720, y: 100 }, view), 'bottom', 'far from every side edge (the top is not one for the dock): back to the bottom')
  assert.equal(nearestSide({ x: 1000, y: 100 }, view), 'right', 'nearer a side than the bottom')
  assert.deepEqual(['left', 'right', 'bottom', 'top', '', null, 'sideways'].map(cleanSide), ['left', 'right', 'bottom', 'bottom', 'bottom', 'bottom', 'bottom'])
})

test('a room that fills the screen, and the stickies\' area, leave the dock\'s strip clear', () => {
  const view = { width: 1440, height: 900 }
  assert.deepEqual(fullBox(view), { left: 12, top: 12, width: 1416, height: 792 }, 'the same as before the dock could move')
  assert.deepEqual(fullBox(view, 'left'), { left: 96, top: 12, width: 1332, height: 876 })
  assert.deepEqual(fullBox(view, 'right'), { left: 12, top: 12, width: 1332, height: 876 })
  const box = { left: 0, top: 0, right: 1440, bottom: 900 }
  assert.deepEqual(deskArea(box), { left: 12, top: 12, right: 1428, bottom: 804 })
  assert.deepEqual(deskArea(box, 'left'), { left: 96, top: 12, right: 1428, bottom: 888 })
  assert.deepEqual(deskArea(box, 'right'), { left: 12, top: 12, right: 1344, bottom: 888 })
})

test('open rooms remain reachable when the viewport shrinks, without changing their content', () => {
  const pop = { key: 'Notes', x: 383, y: 170, w: 1100, h: 720, detail: { noteId: 'source' } }
  for (const dock of ['bottom', 'left', 'right']) {
    const view = { width: 660, height: 850 }
    const box = fullBox(view, dock)
    const fitted = fitRoom(pop, view, dock)
    assert.ok(fitted.x >= box.left && fitted.x + fitted.w <= box.left + box.width)
    assert.ok(fitted.y >= box.top && fitted.y + fitted.h <= box.top + box.height)
    assert.strictEqual(fitted.detail, pop.detail)
  }
  const full = { ...pop, full: true }
  assert.strictEqual(fitRoom(full, { width: 660, height: 850 }, 'bottom'), full)
})
