import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const { addLauncher, createOverlay, displayAt, hotkeyLabel, validHotkey } = createRequire(import.meta.url)('../desktop/overlay.cjs')

test('the layer opens on the display under the cursor', () => {
  const left = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } }
  const right = { id: 2, bounds: { x: 1440, y: -200, width: 2560, height: 1440 } }
  assert.equal(displayAt([left, right], { x: 2000, y: 100 }).id, 2)
  assert.equal(displayAt([left, right], { x: 10, y: 10 }).id, 1)
  assert.equal(displayAt([left, right], { x: -50, y: 5000 }).id, 1)
})

test('a hotkey needs a modifier and one key', () => {
  for (const good of ['Alt+Space', 'Control+Shift+O', 'Command+Alt+K', 'Alt+F5', 'Control+1']) assert.equal(validHotkey(good), true, good)
  for (const bad of ['Space', 'Alt', 'Alt+Alt+K', 'Hyper+K', 'Alt+Enter+K', '', null, 'CommandOrControl+K']) assert.equal(validHotkey(bad), false, String(bad))
  assert.equal(hotkeyLabel('Alt+Space'), '⌥Space')
  assert.equal(hotkeyLabel('Command+Shift+K'), '⌘⇧K')
})

test('launchers keep real apps, once', () => {
  let list = addLauncher([], '/Applications/Safari.app')
  list = addLauncher(list, '/Applications/Safari.app')
  list = addLauncher(list, '/etc/passwd')
  list = addLauncher(list, 'relative/Thing.app')
  assert.deepEqual(list, [{ path: '/Applications/Safari.app', name: 'Safari' }])
})

test('the layer is created hidden, shows on the cursor display and hides again', () => {
  const calls = []
  class FakeWindow {
    constructor(options) { this.options = options; this.shown = false; this.webContents = { focus() {}, send: (channel) => calls.push(channel) } }
    setVisibleOnAllWorkspaces(value, options) { this.everywhere = [value, options] }
    setAlwaysOnTop(value, level) { this.top = [value, level] }
    on() {}
    setBounds(bounds) { this.bounds = bounds }
    show() { this.shown = true }
    hide() { this.shown = false }
    focus() {}
    isVisible() { return this.shown }
  }
  const screen = { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 800, height: 600 }, workArea: { x: 0, y: 25, width: 800, height: 520 } }], getCursorScreenPoint: () => ({ x: 5, y: 5 }) }
  const layer = createOverlay({ BrowserWindow: FakeWindow, screen, platform: 'darwin', preload: 'p.cjs', load: () => calls.push('load') })
  assert.equal(layer.window.options.show, false)
  assert.equal(layer.window.options.type, 'panel')
  assert.deepEqual(layer.window.everywhere, [true, { visibleOnFullScreen: true }])
  layer.toggle()
  assert.equal(layer.visible(), true)
  assert.deepEqual(layer.window.bounds, { x: 0, y: 25, width: 800, height: 520 })
  assert.deepEqual(calls, ['load', 'overlay:shown'])
  layer.toggle()
  assert.equal(layer.visible(), false)
})

test('a spot on the layer is kept inside it, and null puts the item back', () => {
  const { placeItem } = createRequire(import.meta.url)('../desktop/overlay.cjs')
  let places = placeItem({}, 'widget:day', { x: 0.4, y: 1.8 })
  assert.deepEqual(places, { 'widget:day': { x: 0.4, y: 0.97 } })
  places = placeItem(places, 'note:abc', { x: -2, y: 0.1 })
  assert.deepEqual(places['note:abc'], { x: 0, y: 0.1 })
  assert.equal(placeItem(places, 'bad id!', { x: 0, y: 0 }), places)
  assert.equal(placeItem(places, 'note:abc', { x: 'a', y: 0 }), places)
  assert.deepEqual(Object.keys(placeItem(places, 'widget:day', null)), ['note:abc'])
})
