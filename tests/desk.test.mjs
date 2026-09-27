import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const { addLauncher, deskAction, displayAt, hotkeyLabel, pickWidgets, placeItem, validHotkey } = createRequire(import.meta.url)('../desktop/desk.cjs')

test('the desk opens on the display under the cursor', () => {
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

test('⌥Space shows the desk, brings it forward, or puts it away', () => {
  assert.equal(deskAction({ visible: false, focused: false }), 'show')
  assert.equal(deskAction({ visible: true, focused: false }), 'show')
  assert.equal(deskAction({ visible: true, focused: true }), 'hide')
})

test('a spot on the desk is kept inside it, and null puts the item back', () => {
  let places = placeItem({}, 'widget:day', { x: 0.4, y: 1.8 })
  assert.deepEqual(places, { 'widget:day': { x: 0.4, y: 0.97 } })
  places = placeItem(places, 'note:abc', { x: -2, y: 0.1 })
  assert.deepEqual(places['note:abc'], { x: 0, y: 0.1 })
  assert.equal(placeItem(places, 'bad id!', { x: 0, y: 0 }), places)
  assert.equal(placeItem(places, 'note:abc', { x: 'a', y: 0 }), places)
  assert.deepEqual(Object.keys(placeItem(places, 'widget:day', null)), ['note:abc'])
})

test('the widgets out on the desk: up to five short ids, once each, in order', () => {
  assert.deepEqual(pickWidgets(['calendar', 'next', 'calendar', 'from-before']), ['calendar', 'next', 'from-before'])
  assert.deepEqual(pickWidgets(['a', 'b', 'c', 'd', 'e', 'f']), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(pickWidgets(['Next', '../x', '', 'x'.repeat(25), 3, null, 'habits']), ['habits'])
  assert.deepEqual(pickWidgets([]), [], 'an empty desk is a choice, not the defaults')
  assert.equal(pickWidgets(undefined), null)
  assert.equal(pickWidgets('calendar'), null)
})
