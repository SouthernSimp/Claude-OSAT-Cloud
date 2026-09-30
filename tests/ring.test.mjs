import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { DEFAULT_RING, MAX_RING, RING_ITEMS, ringBounds, ringItems, ringPositions } from '../shared/ring-model.mjs'

const require = createRequire(import.meta.url)
const { SIZE, createRing, ringBounds: windowBounds } = require('../desktop/launcher/ring-window.cjs')

test('the ring holds the usual eight unless Settings says otherwise; unknown and repeated tools go', () => {
  assert.deepEqual(ringItems(null).map((item) => item.id), DEFAULT_RING)
  assert.equal(DEFAULT_RING.length, MAX_RING)
  assert.deepEqual(ringItems(['files', 'search', 'files', 'bogus', 'desk']).map((item) => item.id), ['files', 'search', 'desk'])
  assert.deepEqual(ringItems([]), [])
  assert.equal(ringItems(RING_ITEMS.map((item) => item.id)).length, MAX_RING, 'never more than eight')
  assert.ok(RING_ITEMS.every((item) => item.label && item.id), 'every tool has a plain name')
})

test('on the desk the layouts are left out: they move windows of other apps', () => {
  const ids = (list) => list.map((item) => item.id)
  assert.deepEqual(ids(ringItems(null, { desk: true })), ['search', 'clipboard', 'sticky', 'chat', 'desk'])
  assert.deepEqual(ids(ringItems(['left', 'sky'], { desk: true })), ['sky'])
  assert.ok(ids(ringItems(null)).includes('left'))
})

test('the tools sit on a circle, the first at the top and the rest clockwise', () => {
  assert.deepEqual(ringPositions(4, 100), [{ x: 0, y: -100 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: -100, y: 0 }])
  assert.deepEqual(ringPositions(1, 50), [{ x: 0, y: -50 }])
  assert.deepEqual(ringPositions(0, 50), [])
  for (const { x, y } of ringPositions(8, 108)) assert.ok(Math.abs(Math.hypot(x, y) - 108) <= 1)
})

test('the ring opens with its middle under the pointer, and stays on the screen', () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 }
  assert.deepEqual(ringBounds({ x: 700, y: 400 }, area, 340), { x: 530, y: 230, width: 340, height: 340 })
  assert.deepEqual(ringBounds({ x: 5, y: 30 }, area, 340), { x: 0, y: 25, width: 340, height: 340 }, 'a corner pushes it in')
  assert.deepEqual(ringBounds({ x: 1439, y: 899 }, area, 340), { x: 1100, y: 560, width: 340, height: 340 })
  assert.deepEqual(windowBounds({ x: 700, y: 400 }, area), ringBounds({ x: 700, y: 400 }, area, SIZE), 'main and the page agree')
})

function fakeWindowClass(log) {
  return class FakeWindow {
    constructor(options) {
      this.options = options
      this.visible = false
      this.focused = false
      this.handlers = {}
      this.webContents = { send: (...args) => log.push(args), focus() {}, on: (event, handler) => { this.handlers[event] = handler } }
    }
    setVisibleOnAllWorkspaces() {} setAlwaysOnTop() {}
    on(event, handler) { this.handlers[event] = handler }
    setBounds(bounds) { this.bounds = bounds }
    show() { this.visible = true; this.focused = true }
    hide() { this.visible = false; this.focused = false }
    focus() { this.focused = true }
    isVisible() { return this.visible }
    isFocused() { return this.focused }
    isDestroyed() { return false }
  }
}
const screen = { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 0, width: 1440, height: 900 } }], getCursorScreenPoint: () => ({ x: 720, y: 450 }) }

test('the ring window is a see-through panel at the pointer; it waits for its page; it goes when you click away', async () => {
  const log = []
  const hidden = []
  const ring = createRing({ BrowserWindow: fakeWindowClass(log), screen, platform: 'darwin', preload: 'p', load: () => {}, hideOnBlur: true, onHide: () => hidden.push(1) })
  assert.equal(ring.window.options.transparent, true)
  assert.equal(ring.window.options.type, 'panel')
  ring.show()
  assert.deepEqual(ring.window.bounds, { x: 550, y: 280, width: 340, height: 340 })
  assert.deepEqual(log, [], 'the page is not listening yet')
  ring.ready()
  assert.deepEqual(log.at(-1), ['ring:shown'])
  ring.toggle()
  assert.equal(ring.window.isVisible(), false, 'the key again puts it away')
  assert.equal(hidden.length, 1)
  ring.show()
  assert.deepEqual(log.at(-1), ['ring:shown'])
  await new Promise((resolve) => setTimeout(resolve, 350))
  ring.window.handlers.blur()
  assert.equal(ring.window.isVisible(), false, 'clicking away puts it away')
  assert.equal(ring.owns(ring.window.webContents), true)
  assert.equal(ring.owns({}), false)
})
