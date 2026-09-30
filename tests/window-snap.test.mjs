import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { LAYOUTS, cleanWindowKeys, findLayouts, frameFor, layoutById, screenFor } from '../shared/window-layouts.mjs'
import * as layouts from '../shared/window-layouts.mjs'

const require = createRequire(import.meta.url)
const { FRONT, MOVE, createSnap } = require('../desktop/launcher/snap.cjs')
const { validHotkey } = require('../desktop/desk.cjs')

const area = { x: 0, y: 25, width: 1440, height: 875 }

test('each layout puts the window in the right part of the screen, in whole points', () => {
  assert.deepEqual(frameFor('left-half', area), { x: 0, y: 25, width: 720, height: 875 })
  assert.deepEqual(frameFor('right-half', area), { x: 720, y: 25, width: 720, height: 875 })
  assert.deepEqual(frameFor('top-half', area), { x: 0, y: 25, width: 1440, height: 438 })
  assert.deepEqual(frameFor('bottom-right', area), { x: 720, y: 463, width: 720, height: 437 })
  assert.deepEqual(frameFor('maximize', area), area)
  // Thirds and halves meet with no gap and no overlap, whatever the screen.
  for (const odd of [{ x: 0, y: 0, width: 1001, height: 703 }, { x: -1920, y: 0, width: 1920, height: 1055 }]) {
    const [a, b, c] = ['left-third', 'center-third', 'right-third'].map((id) => frameFor(id, odd))
    assert.equal(a.x + a.width, b.x)
    assert.equal(b.x + b.width, c.x)
    assert.equal(c.x + c.width, odd.x + odd.width)
    const [l, r] = ['left-half', 'right-half'].map((id) => frameFor(id, odd))
    assert.equal(l.x + l.width, r.x)
    assert.equal(r.x + r.width, odd.x + odd.width)
    const [two, third] = ['left-two-thirds', 'right-third'].map((id) => frameFor(id, odd))
    assert.equal(two.x + two.width, third.x)
  }
  const middle = frameFor('center', area)
  assert.ok(middle.x > 100 && middle.x + middle.width < 1340 && Math.abs(middle.x - (1440 - middle.width - middle.x)) <= 1, 'centred')
  assert.equal(frameFor('restore', area), null, 'putting it back is not a place')
  assert.equal(frameFor('nonsense', area), null)
  for (const layout of LAYOUTS.filter((item) => item.box)) {
    const frame = frameFor(layout.id, area)
    assert.ok(frame.x >= area.x && frame.y >= area.y && frame.x + frame.width <= area.x + area.width && frame.y + frame.height <= area.y + area.height, layout.id)
  }
})

test('a window is on the screen that holds most of it', () => {
  const left = { workArea: { x: 0, y: 25, width: 1440, height: 875 } }
  const right = { workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }
  assert.equal(screenFor({ x: 100, y: 100, width: 800, height: 600 }, [left, right]), left)
  assert.equal(screenFor({ x: 1300, y: 100, width: 800, height: 600 }, [left, right]), right, 'more of it is on the right')
  assert.equal(screenFor({ x: 5000, y: 0, width: 100, height: 100 }, [left, right]), left, 'off every screen: the first')
  assert.equal(screenFor({ x: 0, y: 0, width: 10, height: 10 }, [area]), area, 'a bare area works too')
})

test('the words that find a layout', () => {
  assert.deepEqual(findLayouts('left half').map((layout) => layout.id), ['left-half'])
  assert.deepEqual(findLayouts('left').map((layout) => layout.id), ['left-half', 'top-left', 'bottom-left', 'left-third', 'left-two-thirds'])
  assert.deepEqual(findLayouts('max').map((layout) => layout.id), ['maximize'])
  assert.deepEqual(findLayouts('full screen').map((layout) => layout.id), ['maximize'])
  assert.deepEqual(findLayouts('top r').map((layout) => layout.id), ['top-right'])
  assert.equal(findLayouts('').length, LAYOUTS.length)
  assert.deepEqual(findLayouts('zzz'), [])
  assert.equal(layoutById('center').label, 'Center')
})

test('every layout has a usual key OSAT can register, and none is used twice', () => {
  const keys = LAYOUTS.map((layout) => layout.key)
  assert.ok(keys.every((key) => validHotkey(key)))
  assert.equal(new Set(keys).size, keys.length)
  const own = cleanWindowKeys({ 'left-half': 'Control+Alt+Shift+Command+H', maximize: null, center: 'nonsense' }, validHotkey)
  assert.equal(own['left-half'], 'Control+Alt+Shift+Command+H')
  assert.equal(own.maximize, null, 'a key taken away stays away')
  assert.equal(own.center, 'Control+Alt+C', 'a broken one goes back to the usual')
  assert.equal(own['right-half'], 'Control+Alt+Right')
  assert.equal(cleanWindowKeys(undefined, validHotkey)['top-half'], 'Control+Alt+Up')
})

test('the scripts are valid JavaScript for System Events', () => {
  for (const script of [FRONT, MOVE]) assert.doesNotThrow(() => new Function('Application', `${script}\nreturn run`))
})

/* A Mac whose front window is where the test says, and which remembers where it was told to put it. */
function fakeMac({ trusted = true, window = { app: 'Safari', x: 100, y: 120, width: 900, height: 600 } } = {}) {
  const state = { window: { ...window }, scripts: [], moves: [] }
  const exec = async (command, args) => {
    state.scripts.push(args[3])
    if (args[3] === FRONT) return JSON.stringify(state.window)
    if (args[3] === MOVE) {
      const [x, y, width, height] = args.slice(4).map(Number)
      state.moves.push({ x, y, width, height })
      Object.assign(state.window, { x, y, width, height })
      return 'ok'
    }
    throw new Error('unexpected script')
  }
  const snap = createSnap({ exec, platform: 'darwin', trusted: () => trusted, screens: () => [{ workArea: area }], own: ['OSAT', 'Electron'], layouts })
  return { state, snap, exec }
}

test('snapping moves the front window; put it back returns it to where it was before the first move', async () => {
  const mac = fakeMac()
  assert.equal(mac.snap.allowed(), true)
  assert.deepEqual(await mac.snap.snap('left-half'), { ok: true, app: 'Safari', layout: 'left-half' })
  assert.deepEqual(mac.state.moves.at(-1), { x: 0, y: 25, width: 720, height: 875 })
  assert.deepEqual(await mac.snap.snap('top-right'), { ok: true, app: 'Safari', layout: 'top-right' })
  assert.deepEqual(mac.state.moves.at(-1), { x: 720, y: 25, width: 720, height: 438 })
  assert.deepEqual(await mac.snap.snap('restore'), { ok: true, app: 'Safari', layout: 'restore' })
  assert.deepEqual(mac.state.moves.at(-1), { x: 100, y: 120, width: 900, height: 600 }, 'back to before the first move, not the one in between')
  assert.deepEqual(await mac.snap.snap('restore'), { ok: false, reason: 'nothing', app: 'Safari' }, 'nothing left to put back')
  // Moved by hand after a snap: that place is what it goes back to next time.
  await mac.snap.snap('maximize')
  Object.assign(mac.state.window, { x: 300, y: 300, width: 500, height: 400 })
  await mac.snap.snap('left-third')
  await mac.snap.snap('restore')
  assert.deepEqual(mac.state.moves.at(-1), { x: 300, y: 300, width: 500, height: 400 })
})

test('without Accessibility nothing is touched, and the reason is said; OSAT’s own windows, and no window, are left alone', async () => {
  const locked = fakeMac({ trusted: false })
  assert.equal(locked.snap.allowed(), false)
  assert.deepEqual(await locked.snap.snap('left-half'), { ok: false, reason: 'access' })
  assert.deepEqual(locked.state.scripts, [], 'no script ran')
  const own = fakeMac({ window: { app: 'OSAT', x: 0, y: 0, width: 1440, height: 900 } })
  assert.deepEqual(await own.snap.snap('left-half'), { ok: false, reason: 'own', app: 'OSAT' })
  assert.deepEqual(own.state.moves, [])
  const empty = createSnap({ exec: async () => JSON.stringify({ error: 'NOWINDOW', app: 'Finder' }), platform: 'darwin', trusted: () => true, screens: () => [{ workArea: area }], layouts })
  assert.deepEqual(await empty.snap('left-half'), { ok: false, reason: 'nowindow', app: 'Finder' })
  const broken = createSnap({ exec: async () => { throw new Error('not allowed to control System Events') }, platform: 'darwin', trusted: () => true, screens: () => [{ workArea: area }], layouts })
  assert.deepEqual(await broken.snap('left-half'), { ok: false, reason: 'failed' })
  const elsewhere = createSnap({ exec: async () => '', platform: 'linux', trusted: () => true, layouts })
  assert.equal(elsewhere.allowed(), false)
  assert.deepEqual(await elsewhere.snap('left-half'), { ok: false, reason: 'mac' })
  assert.deepEqual(await fakeMac().snap.snap('not-a-layout'), { ok: false, reason: 'nothing' })
})

test('a window on a second screen snaps inside that screen', async () => {
  const second = { x: 1440, y: 0, width: 1920, height: 1080 }
  const mac = fakeMac({ window: { app: 'Notes', x: 1600, y: 100, width: 800, height: 600 } })
  const snap = createSnap({ exec: mac.exec, platform: 'darwin', trusted: () => true, screens: () => [{ workArea: area }, { workArea: second }], layouts })
  await snap.snap('right-half')
  assert.deepEqual(mac.state.moves.at(-1), { x: 2400, y: 0, width: 960, height: 1080 })
})
