import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { actionsFor, buildRows, readTyped } from '../shared/quick-search-model.mjs'
import { applyPatch, cleanSettings, holderOf, keysOf, matchKeyword, nameOf, wordsOf, withKey } from '../shared/launcher-model.mjs'
import {
  LAYOUTS, LAYOUT_GROUPS, MAX_CUSTOM, allLayouts, cleanCustom, cleanRect, cleanWindows, findLayouts, frameFor, layoutIn, layoutsOf, nextScreenFrame, rectOfLayout,
} from '../shared/window-layouts.mjs'
import * as layouts from '../shared/window-layouts.mjs'

const require = createRequire(import.meta.url)
const { FRONT, MOVE, createSnap } = require('../desktop/launcher/snap.cjs')
const { validHotkey } = require('../desktop/desk.cjs')

const clean = (saved) => cleanSettings(saved, { validHotkey })

// A laptop with a menu bar, a big screen with the Dock at the left, a screen to the left of the main one, an odd size.
const AREAS = [
  { x: 0, y: 25, width: 1440, height: 875 },
  { x: 80, y: 0, width: 2480, height: 1415 },
  { x: -1920, y: -200, width: 1920, height: 1055 },
  { x: 0, y: 0, width: 1001, height: 703 },
]
const inside = (frame, area) => frame.x >= area.x && frame.y >= area.y && frame.x + frame.width <= area.x + area.width && frame.y + frame.height <= area.y + area.height && frame.width > 0 && frame.height > 0

test('every command that is a place stays on the screen, in whole points, on every kind of screen', () => {
  const places = LAYOUTS.filter((layout) => layout.box)
  assert.ok(places.length >= 40)
  for (const area of AREAS) {
    for (const layout of places) {
      const frame = frameFor(layout.id, area)
      assert.ok(inside(frame, area), `${layout.id} on ${JSON.stringify(area)}`)
      assert.ok(Object.values(frame).every(Number.isInteger), `${layout.id} is whole points`)
    }
  }
})

test('halves, quarters, thirds, fourths, sixths and ninths fill the screen with no gap and no overlap', () => {
  const tiles = [
    ['left-half', 'right-half'], ['top-half', 'bottom-half'], ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    ['left-third', 'center-third', 'right-third'], ['first-fourth', 'second-fourth', 'third-fourth', 'last-fourth'],
    ['top-left-sixth', 'top-center-sixth', 'top-right-sixth', 'bottom-left-sixth', 'bottom-center-sixth', 'bottom-right-sixth'],
    ['top-left-ninth', 'top-center-ninth', 'top-right-ninth', 'middle-left-ninth', 'middle-center-ninth', 'middle-right-ninth', 'bottom-left-ninth', 'bottom-center-ninth', 'bottom-right-ninth'],
  ]
  for (const area of AREAS) {
    for (const ids of tiles) {
      const frames = ids.map((id) => frameFor(id, area))
      // The areas add up to the screen, and no two tiles overlap.
      assert.equal(frames.reduce((sum, frame) => sum + frame.width * frame.height, 0), area.width * area.height, `${ids[0]}… add up on ${area.width}`)
      for (const [i, a] of frames.entries()) {
        for (const b of frames.slice(i + 1)) assert.ok(a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height, `${ids[i]} overlaps`)
      }
    }
  }
})

test('the places are where they say, on a screen with a menu bar and on one that is offset', () => {
  const area = AREAS[0]
  assert.deepEqual(frameFor('first-fourth', area), { x: 0, y: 25, width: 360, height: 875 })
  assert.deepEqual(frameFor('last-fourth', area), { x: 1080, y: 25, width: 360, height: 875 })
  assert.deepEqual(frameFor('first-three-fourths', area), { x: 0, y: 25, width: 1080, height: 875 })
  assert.deepEqual(frameFor('last-three-fourths', area), { x: 360, y: 25, width: 1080, height: 875 })
  assert.deepEqual(frameFor('top-center-sixth', area), { x: 480, y: 25, width: 480, height: 438 })
  assert.deepEqual(frameFor('bottom-right-sixth', area), { x: 960, y: 463, width: 480, height: 437 })
  assert.deepEqual(frameFor('middle-center-ninth', area), { x: 480, y: 317, width: 480, height: 291 })
  assert.deepEqual(frameFor('center-half', area), { x: 360, y: 25, width: 720, height: 875 })
  assert.deepEqual(frameFor('center-two-thirds', area), { x: 240, y: 25, width: 960, height: 875 })
  assert.deepEqual(frameFor('center-three-fourths', area), { x: 180, y: 25, width: 1080, height: 875 })
  assert.deepEqual(frameFor('almost-maximize', area), { x: 72, y: 69, width: 1296, height: 787 })
  assert.deepEqual(frameFor('maximize', area), area)
  const reasonable = frameFor('reasonable-size', area)
  assert.ok(reasonable.width < area.width && reasonable.height < area.height)
  assert.equal(reasonable.x, area.width - reasonable.width - reasonable.x, 'centred across')
  // A screen to the left of the main one has negative x; the place follows it.
  assert.deepEqual(frameFor('right-half', AREAS[2]), { x: -960, y: -200, width: 960, height: 1055 })
  assert.deepEqual(frameFor('last-fourth', AREAS[1]), { x: 80 + 1860, y: 0, width: 620, height: 1415 })
})

test('Make larger and Make smaller grow and shrink around the middle, and stay on the screen', () => {
  const area = AREAS[0]
  const now = { x: 400, y: 200, width: 600, height: 400 }
  const bigger = frameFor('larger', area, now)
  assert.deepEqual(bigger, { x: 328, y: 156, width: 744, height: 488 })
  const back = frameFor('smaller', area, bigger)
  assert.ok(Object.keys(now).every((key) => Math.abs(back[key] - now[key]) <= 1), 'smaller undoes larger, to a point')
  assert.equal(frameFor('larger', area), null, 'it needs the window as it is')
  // At an edge it stays inside; at the whole screen it stays the whole screen; it never shrinks to nothing.
  assert.ok(inside(frameFor('larger', area, { x: 0, y: 25, width: 700, height: 500 }), area))
  assert.deepEqual(frameFor('larger', area, area), area)
  let tiny = { x: 100, y: 100, width: 300, height: 200 }
  for (let i = 0; i < 30; i += 1) tiny = frameFor('smaller', area, tiny)
  assert.deepEqual([tiny.width, tiny.height], [288, 175], 'a fifth of the screen at the least')
  assert.ok(inside(frameFor('larger', area, { x: 5000, y: 5000, width: 300, height: 200 }), area), 'a window off the screen is brought back')
})

test('Move left, right, up and down slide the window to that edge without resizing it', () => {
  const area = AREAS[0]
  const now = { x: 400, y: 200, width: 600, height: 400 }
  assert.deepEqual(frameFor('move-left', area, now), { x: 0, y: 200, width: 600, height: 400 })
  assert.deepEqual(frameFor('move-right', area, now), { x: 840, y: 200, width: 600, height: 400 })
  assert.deepEqual(frameFor('move-up', area, now), { x: 400, y: 25, width: 600, height: 400 })
  assert.deepEqual(frameFor('move-down', area, now), { x: 400, y: 500, width: 600, height: 400 })
  assert.deepEqual(frameFor('move-left', AREAS[2], { x: -1000, y: 0, width: 500, height: 300 }), { x: -1920, y: 0, width: 500, height: 300 })
  assert.deepEqual(frameFor('move-right', area, { x: 0, y: 25, width: 2000, height: 400 }), { x: 0, y: 25, width: 1440, height: 400 }, 'a window wider than the screen is made to fit')
})

test('Next and Previous screen wrap round, three screens, and do nothing with one', () => {
  const a = { workArea: { x: 0, y: 25, width: 1440, height: 875 } }
  const b = { workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }
  const c = { workArea: { x: 3360, y: 0, width: 1000, height: 800 } }
  const win = { x: 0, y: 25, width: 700, height: 500 }
  assert.equal(nextScreenFrame(win, [a]), null)
  assert.equal(nextScreenFrame(win, [a], -1), null)
  assert.equal(nextScreenFrame(win, [a, b, c]).x, 1440, 'next from the first is the second')
  assert.equal(nextScreenFrame(win, [a, b, c], -1).x, 3360, 'previous from the first wraps to the last')
  assert.ok(nextScreenFrame({ ...win, x: 3400 }, [a, b, c]).x < 1440, 'next from the last wraps to the first')
  assert.ok(nextScreenFrame(win, [a, b, c], -1).width <= c.workArea.width)
})

test('a built-in command is in a group Settings knows, and has a name, and the ids are unique', () => {
  assert.equal(new Set(LAYOUTS.map((layout) => layout.id)).size, LAYOUTS.length)
  for (const layout of LAYOUTS) {
    assert.ok(layout.label && LAYOUT_GROUPS.some((group) => group.id === layout.group), layout.id)
    assert.ok(layout.box || layout.op, `${layout.id} is a place or an operation`)
  }
  // The ids and usual keys saved files and the bar already know.
  for (const [id, key] of [['left-half', 'Control+Alt+Left'], ['maximize', 'Control+Alt+Return'], ['center', 'Control+Alt+C'], ['next-display', 'Control+Alt+Command+Right'], ['restore', 'Control+Alt+Z'], ['center-third', 'Control+Alt+F']]) {
    assert.equal(layouts.layoutById(id).key, key, id)
  }
})

/* ---- Nate's own commands ---- */

test('a rectangle is kept on the screen: out of range is brought in, nonsense is refused', () => {
  assert.deepEqual(cleanRect({ x: 66.6, y: 66.6, w: 33.3, h: 33.3 }), { x: 66.6, y: 66.6, w: 33.3, h: 33.3 })
  assert.deepEqual(cleanRect({ x: -20, y: 150, w: 40, h: 40 }), { x: 0, y: 60, w: 40, h: 40 }, 'pulled inside')
  assert.deepEqual(cleanRect({ x: 90, y: 0, w: 50, h: 500 }), { x: 50, y: 0, w: 50, h: 100 }, 'too wide for where it starts: moved left')
  assert.deepEqual(cleanRect({ x: 10, y: 10, w: 0, h: -5 }), { x: 10, y: 10, w: 1, h: 1 }, 'never nothing')
  assert.deepEqual(cleanRect({ x: '25', y: ' 10 ', w: '50', h: '30.04' }), { x: 25, y: 10, w: 50, h: 30 }, 'typed numbers count, to a tenth')
  for (const bad of [null, undefined, {}, { x: NaN, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: Infinity, h: 10 }, { x: 0, y: 0, w: 'wide', h: 10 }, { x: 0, y: 0, w: '', h: 10 }, { x: null, y: 0, w: 10, h: 10 }, [1, 2, 3, 4]]) {
    assert.equal(cleanRect(bad), null, JSON.stringify(bad))
  }
  assert.deepEqual(cleanRect({ x: 99, y: 99, w: 50, h: 20 }, true), { x: 25, y: 40, w: 50, h: 20 }, 'centred ignores where it starts')
  assert.deepEqual(cleanRect({ w: 50, h: 20 }, true), { x: 25, y: 40, w: 50, h: 20 }, 'and does not need x and y')
})

test('custom commands are cleaned: good ids and names, a rectangle that fits, no repeats, at most fifty', () => {
  const good = { id: 'custom-a1', name: '  Bottom Right Ninth ', rect: { x: 66.7, y: 66.7, w: 33.3, h: 33.3 } }
  const list = cleanCustom([
    good,
    { ...good },
    { id: 'custom-b2', name: 'Not a number', rect: { x: 'a', y: 0, w: 10, h: 10 } },
    { id: 'left-half', name: 'Pretends to be built in', rect: { x: 0, y: 0, w: 50, h: 100 } },
    { id: 'custom-', name: 'Short id', rect: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'custom-UPPER', name: 'Loud id', rect: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'custom-' + 'x'.repeat(40), name: 'Long id', rect: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'custom-c3', name: '   ', rect: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'custom-d4', rect: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'custom-e5', name: 'Off the screen', rect: { x: 400, y: -9, w: 900, h: 5 } },
    { id: 'custom-f6', name: 'Middle', centered: true, rect: { x: 0, y: 0, w: 40, h: 40 } },
    { id: 'custom-g7', name: 'N'.repeat(200), rect: { x: 0, y: 0, w: 10, h: 10 } },
    null, 'text', 7, [],
  ])
  assert.deepEqual(list.map((item) => item.id), ['custom-a1', 'custom-e5', 'custom-f6', 'custom-g7'])
  assert.equal(list[0].name, 'Bottom Right Ninth')
  assert.deepEqual(list[1].rect, { x: 0, y: 0, w: 100, h: 5 })
  assert.deepEqual(list[2], { id: 'custom-f6', name: 'Middle', rect: { x: 30, y: 30, w: 40, h: 40 }, centered: true })
  assert.equal(list[3].name.length, 40)
  const many = Array.from({ length: 500 }, (_, i) => ({ id: `custom-n${i}`, name: `Number ${i}`, rect: { x: 0, y: 0, w: 10, h: 10 } }))
  assert.equal(cleanCustom(many).length, MAX_CUSTOM)
  assert.deepEqual(cleanCustom('nonsense'), [])
  assert.deepEqual(cleanCustom({ length: 3 }), [])
  // Cleaning twice changes nothing.
  assert.deepEqual(cleanCustom(list), list)
})

test('a custom command is placed like a built-in one, and appears among the commands that are on', () => {
  const windows = { custom: cleanCustom([{ id: 'custom-br', name: 'Bottom Right Ninth', rect: { x: 66.7, y: 66.7, w: 33.3, h: 33.3 } }]), off: ['left-half'] }
  const area = AREAS[0]
  const frame = frameFor('custom-br', area, null, windows)
  assert.ok(inside(frame, area))
  assert.equal(frame.x + frame.width, area.x + area.width, 'its right edge is the screen’s')
  assert.deepEqual(frameFor('custom-br', area), null, 'unknown without the list')
  assert.equal(layoutIn(windows, 'custom-br').label, 'Bottom Right Ninth')
  assert.equal(layoutIn(windows, 'maximize').label, 'Maximize')
  assert.equal(layoutIn(windows, 'custom-zz'), null)
  assert.equal(allLayouts(windows)[0].id, 'custom-br', 'his own come first')
  assert.equal(layoutsOf(windows).some((layout) => layout.id === 'left-half'), false, 'a command switched off is gone')
  assert.equal(layoutsOf(windows).length, LAYOUTS.length, 'one off, one of his own')
  assert.deepEqual(findLayouts('bottom right nin', layoutsOf(windows)).map((layout) => layout.id), ['custom-br', 'bottom-right-ninth'])
  assert.deepEqual(rectOfLayout(layouts.layoutById('right-third')), { x: 66.7, y: 0, w: 33.3, h: 100 })
  assert.equal(rectOfLayout(layouts.layoutById('restore')), null)
})

/* ---- Saved settings ---- */

test('settings saved before Phase 61 still load: the same keys, no words, nothing off, none of his own', () => {
  const old = { version: 2, windows: { on: true, hotkeys: { 'left-half': 'Control+Alt+Shift+Command+H', maximize: null, center: 'Control+Alt+C' } } }
  const settings = clean(old)
  assert.equal(settings.windows.on, true)
  assert.equal(settings.windows.hotkeys['left-half'], 'Control+Alt+Shift+Command+H')
  assert.equal(settings.windows.hotkeys.maximize, null)
  assert.equal(settings.windows.hotkeys['right-half'], 'Control+Alt+Right', 'the usual key stays')
  assert.equal(settings.windows.hotkeys['first-fourth'], null, 'a new command starts with no key')
  assert.deepEqual([settings.windows.aliases, settings.windows.off, settings.windows.custom], [{}, [], []])
  assert.equal(clean(undefined).windows.on, false)
  assert.deepEqual(Object.keys(clean(undefined).windows.hotkeys), LAYOUTS.map((layout) => layout.id))
  assert.deepEqual(clean(clean(old)), clean(old), 'cleaning twice changes nothing')
  // A damaged windows section never throws.
  for (const damaged of [null, 'text', 7, [], { aliases: 'x', off: 5, custom: { length: 2 }, hotkeys: [] }, { aliases: { 'left-half': 7 }, off: [{}], custom: [null] }]) {
    assert.doesNotThrow(() => clean({ windows: damaged }))
    assert.deepEqual(clean({ windows: damaged }).windows.custom, [])
  }
  // The Hyper key spellings are untouched: keys are saved as typed, all four, and main registers both.
  assert.equal(keysOf(settings)['snap:left-half'], 'Control+Alt+Shift+Command+H')
})

const custom = [{ id: 'custom-br', name: 'Bottom Right Ninth', rect: { x: 66.7, y: 66.7, w: 33.3, h: 33.3 } }]

test('a window alias is a word like any other: it never repeats one the bar already has', () => {
  const settings = clean({
    windows: { custom, aliases: { 'left-half': 'lh', 'right-half': 'lh', 'top-half': 'f', maximize: 'ss', 'custom-br': 'br', center: 'TOO LONG A WORD!', restore: 7, 'not-a-command': 'zz' } },
  })
  assert.equal(settings.windows.aliases['left-half'], 'lh')
  assert.equal(settings.windows.aliases['right-half'], undefined, 'the second to claim “lh” goes without')
  assert.equal(settings.windows.aliases['top-half'], undefined, '“f” is Files’ word')
  assert.equal(settings.windows.aliases.maximize, undefined, '“ss” is Spotify’s word')
  assert.equal(settings.windows.aliases['custom-br'], 'br')
  assert.equal(settings.windows.aliases.center, undefined)
  assert.equal(settings.windows.aliases.restore, undefined)
  assert.equal(settings.windows.aliases['not-a-command'], undefined)
  // Everything that was already there keeps its word; a snippet can't take an alias's.
  assert.equal(settings.sources.files.keyword, 'f')
  assert.equal(clean({ windows: { aliases: { 'left-half': 'g' } } }).windows.aliases['left-half'], undefined, '“g” is the Google quick link')
  assert.deepEqual(wordsOf(settings)['snap:left-half'], 'lh')
  assert.equal(holderOf(settings, { word: 'lh' }), 'Left half')
  assert.equal(holderOf(settings, { word: 'br' }), 'Bottom Right Ninth', 'a custom command is named')
  assert.equal(holderOf(settings, { word: 'lh' }, 'snap:left-half'), null, 'its own word is not a clash')
  assert.equal(holderOf(settings, { word: 'f' }), 'Files')
  assert.equal(nameOf(settings, 'snap:custom-br'), 'Bottom Right Ninth')
  assert.equal(nameOf(settings, 'snap:custom-gone'), 'custom-gone')
})

test('a key is clash-checked by name, switched-off commands keep theirs for the check but do not register it', () => {
  const settings = clean({ windows: { on: true, custom, off: ['top-half', 'custom-br'], hotkeys: { 'custom-br': 'Control+Alt+Shift+Command+9', 'first-fourth': 'Control+Alt+1', 'top-half': 'Control+Alt+Up' } } })
  assert.equal(settings.windows.hotkeys['first-fourth'], 'Control+Alt+1')
  assert.equal(holderOf(settings, { key: 'Control+Alt+Shift+Command+9' }), 'Bottom Right Ninth')
  assert.equal(holderOf(settings, { key: 'Control+Alt+1' }), 'First fourth')
  assert.equal(holderOf(settings, { key: 'Control+Alt+1' }, 'snap:first-fourth'), null)
  assert.equal(holderOf(settings, { key: 'Control+Alt+Left' }), 'Left half', 'a usual key is still held')
  assert.equal(keysOf(settings)['snap:first-fourth'], 'Control+Alt+1')
  assert.equal(keysOf(settings)['snap:top-half'], undefined, 'off: not registered')
  assert.equal(keysOf(settings)['snap:custom-br'], undefined)
  assert.equal(keysOf(settings, { all: true })['snap:top-half'], 'Control+Alt+Up', 'but still checked against')
  assert.equal(keysOf(clean({ windows: { on: false, hotkeys: { 'first-fourth': 'Control+Alt+1' } } }))['snap:first-fourth'], undefined, 'the master switch still rules')
  // A refused key goes back to what it was, for his own commands too.
  assert.equal(withKey(settings, 'snap:custom-br', null).windows.hotkeys['custom-br'], null)
  assert.equal(clean(withKey(settings, 'snap:custom-br', 'Control+Alt+2')).windows.hotkeys['custom-br'], 'Control+Alt+2')
})

test('a patch from Settings adds and takes away words, commands and switches, one command at a time', () => {
  const base = clean({ windows: { custom, aliases: { 'left-half': 'lh' }, hotkeys: { 'left-half': 'Control+Alt+Shift+Command+H' } } })
  const next = clean(applyPatch(base, { windows: { aliases: { 'right-half': 'rh', 'left-half': null }, hotkeys: { 'first-fourth': 'Control+Alt+1' }, off: ['center'] } }))
  assert.deepEqual(next.windows.aliases, { 'right-half': 'rh' }, 'null takes a word away; the others stay')
  assert.equal(next.windows.hotkeys['left-half'], 'Control+Alt+Shift+Command+H', 'other keys stay')
  assert.equal(next.windows.hotkeys['first-fourth'], 'Control+Alt+1')
  assert.deepEqual(next.windows.off, ['center'])
  assert.equal(next.windows.custom.length, 1, 'his own stay when the patch doesn’t mention them')
  // Delete one: its word, key and switch go with it; putting the same patch back brings them back (Undo).
  const withExtras = clean(applyPatch(base, { windows: { aliases: { 'custom-br': 'br' }, hotkeys: { 'custom-br': 'Control+Alt+9' }, off: ['custom-br'] } }))
  const gone = clean(applyPatch(withExtras, { windows: { custom: [] } }))
  assert.deepEqual([gone.windows.custom, gone.windows.aliases['custom-br'], gone.windows.hotkeys['custom-br'], gone.windows.off], [[], undefined, undefined, []])
  const back = clean(applyPatch(gone, { windows: { custom: withExtras.windows.custom, aliases: { 'custom-br': 'br' }, hotkeys: { 'custom-br': 'Control+Alt+9' }, off: ['custom-br'] } }))
  assert.deepEqual(back.windows, withExtras.windows)
})

test('typing an alias in the bar offers that command; a command switched off does not answer', () => {
  const settings = clean({ windows: { on: true, custom, aliases: { 'left-half': 'lh', 'custom-br': 'br', center: 'mid' }, off: ['center'], hotkeys: { 'left-half': 'Control+Alt+Left' } } })
  const hit = matchKeyword(settings, 'lh', { rows: true })
  assert.equal(hit.keyword.id, 'snap:left-half')
  assert.deepEqual([hit.keyword.row.kind, hit.keyword.row.data.layout, hit.keyword.row.data.key, hit.keyword.row.title], ['layout', 'left-half', 'Control+Alt+Left', 'Left half'])
  assert.deepEqual(hit.keyword.row.data.box, [0, 0, 0.5, 1])
  const mine = matchKeyword(settings, 'BR', { rows: true })
  assert.equal(mine.keyword.row.title, 'Bottom Right Ninth')
  assert.equal(mine.keyword.row.data.layout, 'custom-br')
  assert.equal(mine.keyword.row.data.box.length, 4)
  assert.equal(matchKeyword(settings, 'mid', { rows: true }), null, 'off')
  assert.equal(matchKeyword(settings, 'lh', {}), null, 'the desk’s line leaves it alone')
  assert.equal(matchKeyword(settings, 'lh and more', { rows: true }), null, 'only on its own')
})

test('the bar finds his own commands and the new ones by name, shows an alias as its command, and skips what is off', () => {
  const settings = clean({ windows: { on: true, custom, aliases: { 'custom-br': 'br', 'last-fourth': 'lf' }, off: ['first-fourth'], hotkeys: { 'custom-br': 'Control+Alt+Shift+Command+9' } } })
  const titles = (text, scope) => buildRows(readTyped(text, settings, scope), {}, settings, { now: new Date(2026, 8, 29, 9, 30) }).map((row) => row.title)
  assert.deepEqual(titles('bottom right nin', 'windows').slice(0, 2), ['Bottom Right Ninth', 'Bottom right ninth'], 'his own, then the built-in one')
  assert.equal(titles('', 'windows').length, LAYOUTS.length, 'one off, one of his own')
  assert.equal(titles('', 'windows').includes('First fourth'), false)
  assert.equal(titles('last fourth')[0], 'Last fourth', 'from Everything too')
  const rows = buildRows(readTyped('br', settings), {}, settings, { now: new Date(2026, 8, 29, 9, 30) })
  assert.deepEqual([rows[0].kind, rows[0].title, rows[0].data.layout, rows[0].data.key, rows[0].section], ['layout', 'Bottom Right Ninth', 'custom-br', 'Control+Alt+Shift+Command+9', 'Your word “br”'])
  assert.deepEqual(actionsFor(rows[0]).map((action) => action.id).slice(0, 1), ['snap'], 'Return moves the window')
  assert.equal(buildRows(readTyped('lf', settings), {}, settings, { now: new Date(2026, 8, 29, 9, 30) })[0].data.layout, 'last-fourth')
})

/* ---- The mover ---- */

function fakeMac(window, { screens = [{ workArea: AREAS[0] }], windows = null } = {}) {
  const state = { window: { app: 'Safari', ...window }, moves: [] }
  const exec = async (command, args) => {
    if (args[3] === FRONT) return JSON.stringify(state.window)
    if (args[3] === MOVE) {
      const [x, y, width, height] = args.slice(4).map(Number)
      state.moves.push({ x, y, width, height })
      Object.assign(state.window, { x, y, width, height })
      return 'ok'
    }
    throw new Error('unexpected script')
  }
  return { state, snap: createSnap({ exec, platform: 'darwin', trusted: () => true, screens: () => screens, own: ['OSAT'], layouts, windows: () => windows }) }
}

test('the mover runs the new commands without touching System Events in the tests', async () => {
  const mac = fakeMac({ x: 400, y: 200, width: 600, height: 400 })
  assert.deepEqual(await mac.snap.snap('larger'), { ok: true, app: 'Safari', layout: 'larger' })
  assert.deepEqual(mac.state.moves.at(-1), { x: 328, y: 156, width: 744, height: 488 })
  await mac.snap.snap('move-left')
  assert.deepEqual(mac.state.moves.at(-1), { x: 0, y: 156, width: 744, height: 488 })
  await mac.snap.snap('last-three-fourths')
  assert.deepEqual(mac.state.moves.at(-1), { x: 360, y: 25, width: 1080, height: 875 })
  assert.deepEqual(await mac.snap.snap('restore'), { ok: true, app: 'Safari', layout: 'restore' })
  assert.deepEqual(mac.state.moves.at(-1), { x: 400, y: 200, width: 600, height: 400 }, 'back to before OSAT’s first move')
})

test('the mover goes to the next or previous screen and says so with one', async () => {
  const second = { workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }
  const two = fakeMac({ x: 100, y: 100, width: 800, height: 600 }, { screens: [{ workArea: AREAS[0] }, second] })
  assert.equal((await two.snap.snap('next-display')).ok, true)
  assert.ok(two.state.moves.at(-1).x >= 1440)
  assert.equal((await two.snap.snap('previous-display')).ok, true)
  assert.ok(two.state.moves.at(-1).x < 1440)
  const one = fakeMac({ x: 100, y: 100, width: 800, height: 600 })
  assert.deepEqual(await one.snap.snap('previous-display'), { ok: false, reason: 'one-screen', app: 'Safari' })
  assert.deepEqual(one.state.moves, [])
})

test('the mover places one of his own commands, and refuses one that is gone', async () => {
  const windows = clean({ windows: { custom } }).windows
  const mac = fakeMac({ x: 100, y: 100, width: 800, height: 600 }, { windows })
  assert.deepEqual(await mac.snap.snap('custom-br'), { ok: true, app: 'Safari', layout: 'custom-br' })
  const frame = mac.state.moves.at(-1)
  assert.ok(inside(frame, AREAS[0]) && frame.x > 900 && frame.y > 600)
  assert.deepEqual(await mac.snap.snap('custom-gone'), { ok: false, reason: 'nothing' })
  assert.equal(mac.state.moves.length, 1)
  assert.deepEqual(await fakeMac({ x: 0, y: 0, width: 10, height: 10 }).snap.snap('custom-br'), { ok: false, reason: 'nothing' }, 'without the list it is unknown')
})
