import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { appsIn, createApps } = require('../desktop/launcher/apps.cjs')
const { recentPaths, usedDates } = require('../desktop/launcher/recent-files.cjs')
const { frontApp, pasteInto } = require('../desktop/launcher/front.cjs')
const { createHotkeys } = require('../desktop/launcher/hotkeys.cjs')
const { BAR, CHAT, FULL, createQuickSearch, fitAt, searchBounds } = require('../desktop/launcher/search-window.cjs')

const dirent = (name, dir = false) => ({ name, isDirectory: () => dir })
const readdirOf = (tree) => async (dir) => {
  if (!tree[dir]) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
  return tree[dir]
}

test('apps: the .app bundles in the usual places, one level into plain folders, never hidden, each name once', async () => {
  const readdir = readdirOf({
    '/Applications': [dirent('Notes.app', true), dirent('.hidden.app', true), dirent('Adobe', true), dirent('readme.txt')],
    '/Applications/Adobe': [dirent('Photoshop.app', true), dirent('Deep', true)],
    '/Applications/Adobe/Deep': [dirent('TooDeep.app', true)],
    '/System/Applications': [dirent('Music.app', true), dirent('Notes.app', true)],
  })
  const apps = createApps({ dirs: () => ['/Applications', '/System/Applications', '/nowhere'], readdir })
  assert.deepEqual((await apps.list()).map((item) => [item.name, item.path]), [
    ['Music', '/System/Applications/Music.app'], ['Notes', '/Applications/Notes.app'], ['Photoshop', '/Applications/Adobe/Photoshop.app'],
  ])
  assert.equal(await apps.has('/Applications/Notes.app'), true)
  assert.equal(await apps.has('/Applications/../etc/passwd'), false, 'only a path on the list can be opened')
  assert.equal((await apps.named('spotify')), null)
  assert.equal((await apps.named('MUSIC')).name, 'Music')
  assert.equal((await apps.named('photo')).name, 'Photoshop', 'the one that starts with it')
  assert.deepEqual(await appsIn('/nope', { readdir }), [])
})

test('apps are looked at again only after a minute', async () => {
  let clock = 0
  let looks = 0
  const apps = createApps({ dirs: () => ['/A'], readdir: async () => { looks += 1; return [dirent('One.app', true)] }, now: () => clock, keep: 60000 })
  await apps.list(); await apps.list()
  assert.equal(looks, 1)
  clock = 61000
  await apps.list()
  assert.equal(looks, 2)
})

test('recent files: what was opened lately, newest first, from Spotlight on the Mac', async () => {
  assert.deepEqual(usedDates('2026-09-29 23:25:32 +0000\0(null)\0nonsense', 3), [Date.parse('2026-09-29T23:25:32+00:00'), 0, 0])
  const calls = []
  const exec = async (command, args) => {
    calls.push([command, ...args])
    if (command === 'mdfind') return '/Users/n/Documents/old.pdf\n/Users/n/Desktop/new.md\n/Users/n/Downloads/mid.png\n'
    return ['2026-09-01 10:00:00 +0000', '2026-09-29 10:00:00 +0000', '2026-09-15 10:00:00 +0000'].join('\0')
  }
  const found = await recentPaths({ roots: ['/Users/n/Documents', '/Users/n/Desktop'], now: new Date('2026-09-30T00:00:00Z'), platform: 'darwin', exec })
  assert.deepEqual(found, ['/Users/n/Desktop/new.md', '/Users/n/Downloads/mid.png', '/Users/n/Documents/old.pdf'])
  assert.equal(calls[0][0], 'mdfind')
  assert.deepEqual(calls[0].slice(1, 5), ['-onlyin', '/Users/n/Documents', '-onlyin', '/Users/n/Desktop'])
  assert.match(calls[0].at(-1), /^kMDItemLastUsedDate >= \$time\.iso\(2026-09-16T00:00:00Z\)$/, 'two weeks back')
  assert.equal(calls[1][0], 'mdls')
  // Nothing found, or Spotlight failing, is just an empty list; elsewhere the folders are walked.
  assert.deepEqual(await recentPaths({ roots: ['/x'], platform: 'darwin', exec: async () => '' }), [])
  assert.deepEqual(await recentPaths({ roots: ['/x'], platform: 'darwin', exec: async () => { throw new Error('no mdfind') } }), [])
  assert.deepEqual(await recentPaths({ roots: ['/x'], platform: 'linux', walk: async (since) => (since instanceof Date ? ['/x/walked'] : []) }), ['/x/walked'])
})

test('the app in front is found without any permission, and pasting needs Accessibility', async () => {
  const exec = async (command, args) => {
    assert.equal(command, 'lsappinfo')
    return args[0] === 'front' ? 'ASN:0x0-0x4ee4ee0:\n' : '"Safari" ASN:0x0-0x4ee4ee0: (in front) \n    bundleID=[ NULL ] \n'
  }
  assert.equal(await frontApp({ exec, platform: 'darwin' }), 'Safari')
  assert.equal(await frontApp({ exec, platform: 'linux' }), '')
  assert.equal(await frontApp({ exec: async () => { throw new Error('boom') }, platform: 'darwin' }), '')
  assert.equal(await frontApp({ exec: async () => 'not an asn', platform: 'darwin' }), '')

  const sent = []
  const osascript = async (command, args) => { sent.push([command, ...args]); return '' }
  assert.deepEqual(await pasteInto({ exec: osascript, platform: 'darwin', trusted: () => false }), { pasted: false, reason: 'access' })
  assert.deepEqual(sent, [], 'without permission nothing is sent')
  assert.deepEqual(await pasteInto({ exec: osascript, platform: 'linux', trusted: () => true }), { pasted: false, reason: 'mac' })
  assert.deepEqual(await pasteInto({ exec: osascript, platform: 'darwin', trusted: () => true }), { pasted: true })
  assert.equal(sent[0][0], 'osascript')
  assert.match(sent[0][2], /keystroke "v" using command down/)
  assert.deepEqual(await pasteInto({ exec: async () => { throw new Error('not allowed') }, platform: 'darwin', trusted: () => true }), { pasted: false, reason: 'failed' })
})

function fakeShortcuts(refuse = []) {
  const registered = new Map()
  return {
    registered,
    register: (key, run) => { if (refuse.includes(key) || registered.has(key)) return false; registered.set(key, run); return true },
    unregister: (key) => registered.delete(key),
  }
}

test('hotkeys: each id holds one key; a key someone else has is refused and said so; a change lets the old one go', () => {
  const shortcuts = fakeShortcuts(['Control+Alt+Shift+Command+V'])
  const taken = new Set(['Alt+Space'])
  const keys = createHotkeys({ globalShortcut: shortcuts, isTaken: (key) => taken.has(key) })
  assert.equal(keys.set('a', 'Control+Alt+Shift+Command+S', () => {}), true)
  assert.equal(keys.set('b', 'Control+Alt+Shift+Command+V', () => {}), false, 'the Mac would not give it')
  assert.equal(keys.set('c', 'Alt+Space', () => {}), false, 'one of main’s shortcuts')
  assert.equal(keys.set('d', 'Control+Alt+Shift+Command+S', () => {}), false, 'another id already holds it')
  assert.deepEqual(keys.failed().sort(), ['b', 'c', 'd'])
  assert.equal(keys.set('a', 'Control+Alt+Shift+Command+A', () => {}), true)
  assert.equal(shortcuts.registered.has('Control+Alt+Shift+Command+S'), false)
  assert.equal(keys.has('Control+Alt+Shift+Command+A'), true)
  assert.equal(keys.has('Control+Alt+Shift+Command+A', 'a'), false, 'a key is not taken from its own holder')
  assert.equal(keys.set('a', null, () => {}), true)
  assert.equal(keys.has('Control+Alt+Shift+Command+A'), false)
  const ran = []
  const sync = createHotkeys({ globalShortcut: shortcuts })
  assert.deepEqual(sync.sync({ x: { key: 'Control+Alt+Shift+Command+X', run: () => ran.push('x') }, y: { key: 'Control+Alt+Shift+Command+Y', run: () => ran.push('y') } }), [])
  assert.deepEqual(sync.sync({ y: { key: 'Control+Alt+Shift+Command+Y', run: () => {} } }), [])
  assert.equal(shortcuts.registered.has('Control+Alt+Shift+Command+X'), false, 'what is no longer wanted goes')
  sync.stop()
  assert.equal(shortcuts.registered.has('Control+Alt+Shift+Command+Y'), false)
})

test('hotkeys: the key runs a moment later, so a panel shown while the keys are down keeps focus', async () => {
  const shortcuts = fakeShortcuts()
  const keys = createHotkeys({ globalShortcut: shortcuts })
  let ran = 0
  keys.set('a', 'Control+Alt+Shift+Command+S', () => { ran += 1 })
  shortcuts.registered.get('Control+Alt+Shift+Command+S')()
  assert.equal(ran, 0)
  await new Promise((resolve) => setTimeout(resolve, 90))
  assert.equal(ran, 1)
})

test('the bar sits in the upper part of the screen under the cursor, and the full view grows down from it', () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } },
    { bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } },
  ]
  const bar = searchBounds('bar', displays, { x: 100, y: 100 })
  assert.deepEqual([bar.width, bar.height, bar.x], [BAR.width, BAR.height, Math.round((1440 - BAR.width) / 2)])
  assert.ok(bar.y > 100 && bar.y < 300)
  const full = searchBounds('full', displays, { x: 2000, y: 500 })
  assert.deepEqual([full.width, full.height, full.x], [FULL.width, FULL.height, 1440 + (1920 - FULL.width) / 2])
  assert.equal(full.y, Math.round(1080 * 0.18))
  const tiny = searchBounds('full', [{ bounds: { x: 0, y: 0, width: 700, height: 500 }, workArea: { x: 0, y: 0, width: 700, height: 500 } }], { x: 1, y: 1 })
  assert.ok(tiny.width <= 668 && tiny.height <= 452, 'a small screen still holds it')
})

test('dragged somewhere, the bar opens there while that spot is on a screen; the full view stays on it', () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } },
    { bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } },
  ]
  // Its top middle is kept: it opens there, even with the cursor on the other screen.
  assert.deepEqual(searchBounds('bar', displays, { x: 2000, y: 500 }, { x: 400, y: 600 }), { x: 400 - BAR.width / 2, y: 600, width: BAR.width, height: BAR.height })
  // Near the bottom, the full view is pulled up so it fits; near the edge, it stays on the screen.
  const low = searchBounds('full', displays, { x: 0, y: 0 }, { x: 100, y: 850 })
  assert.deepEqual([low.x, low.y + low.height <= 900], [0, true])
  // A spot on a screen that went away: back under the cursor.
  assert.deepEqual(searchBounds('bar', displays, { x: 2000, y: 500 }, { x: 9000, y: 10 }), searchBounds('bar', displays, { x: 2000, y: 500 }))
  assert.deepEqual(searchBounds('bar', displays, { x: 10, y: 10 }, { x: NaN, y: 1 }), searchBounds('bar', displays, { x: 10, y: 10 }))
  assert.equal(fitAt('chat', displays[1].workArea, { x: 2400, y: 100 }).height, CHAT.height)
})

function fakeWindowClass(log) {
  return class FakeWindow {
    constructor(options) {
      this.options = options
      this.bounds = { x: 0, y: 0, width: options.width, height: options.height }
      this.visible = false
      this.focused = false
      this.handlers = {}
      this.webContents = { send: (...args) => log.push(['send', ...args]), focus() {}, isLoading: () => false, once() {}, on() {}, getURL: () => '' }
    }
    setVisibleOnAllWorkspaces() {}
    setAlwaysOnTop() {}
    on(event, handler) { this.handlers[event] = handler }
    setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds } }
    getBounds() { return this.bounds }
    show() { this.visible = true; this.focused = true }
    hide() { this.visible = false; this.focused = false }
    focus() { this.focused = true }
    isVisible() { return this.visible }
    isFocused() { return this.focused }
    isDestroyed() { return false }
  }
}
const screen = { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 0, width: 1440, height: 900 } }], getCursorScreenPoint: () => ({ x: 10, y: 10 }) }

test('the panel opens as a bar, or full on a source; the shortcut again puts it away; it goes when you click away', async () => {
  const log = []
  const hidden = []
  const search = createQuickSearch({ BrowserWindow: fakeWindowClass(log), screen, platform: 'darwin', preload: 'p', load: () => {}, hideOnBlur: true, onHide: () => hidden.push(1) })
  assert.equal(search.window.options.type, 'panel', 'a panel, so the app you were in keeps focus')
  search.show()
  assert.equal(search.window.getBounds().height, BAR.height)
  assert.deepEqual(log.at(-1), ['send', 'search:shown', { scope: 'all', mode: 'bar', text: '', view: 'search', chat: null }])
  search.setMode('full')
  assert.equal(search.window.getBounds().height, FULL.height)
  assert.equal(search.window.getBounds().x, Math.round((1440 - FULL.width) / 2), 'it grows from the middle')
  search.toggle()
  assert.equal(search.window.isVisible(), false, 'pressed again, it goes')
  assert.equal(hidden.length, 1)
  search.toggle({ scope: 'clipboard' })
  assert.deepEqual(log.at(-1), ['send', 'search:shown', { scope: 'clipboard', mode: 'full', text: '', view: 'search', chat: null }])
  assert.equal(search.window.getBounds().height, FULL.height, 'a Hyper key opens the full view straight away')
  search.hide()
  search.show({ expanded: true })
  assert.equal(search.window.getBounds().height, FULL.height)
  await new Promise((resolve) => setTimeout(resolve, 450))
  search.window.handlers.blur()
  assert.equal(search.window.isVisible(), false, 'clicking away puts it away')
  search.show()
  search.window.handlers.blur()
  assert.equal(search.window.isVisible(), true, 'a blur in the first moments is not a click away')
  assert.equal(search.owns(search.window.webContents), true)
  assert.equal(search.owns({}), false)
})

test('Ask opens the same bar as a chat; its key over the search switches to Ask, and again puts it away', () => {
  const log = []
  const search = createQuickSearch({ BrowserWindow: fakeWindowClass(log), screen, platform: 'darwin', preload: 'p', load: () => {} })
  search.show()
  search.toggle({ view: 'chat' })
  assert.equal(search.window.isVisible(), true, 'the Ask key over the search does not put it away')
  assert.equal(search.window.getBounds().height, CHAT.height)
  assert.deepEqual(log.at(-1), ['send', 'search:shown', { scope: 'all', mode: 'chat', text: '', view: 'chat', chat: null }])
  search.toggle({ view: 'chat' })
  assert.equal(search.window.isVisible(), false, 'pressed again on Ask, it goes')
  search.show({ view: 'chat', chat: { chatId: 'c1' } })
  assert.deepEqual(log.at(-1)[2].chat, { chatId: 'c1' }, 'a chat popped out of the desk')
  search.hide()
  search.show({ view: 'sticky' })
  assert.deepEqual([log.at(-1)[2].view, search.window.getBounds().height], ['sticky', BAR.height], 'a sticky is written in the small bar')
})

test('a move Nate makes is remembered; OSAT placing the bar is not', async () => {
  const log = []
  const spots = []
  const search = createQuickSearch({ BrowserWindow: fakeWindowClass(log), screen, platform: 'darwin', preload: 'p', load: () => {}, onMoved: (spot) => spots.push(spot) })
  search.show()
  search.window.handlers['will-move']()
  search.window.handlers.moved()
  assert.deepEqual(spots, [], 'the bar placing itself a moment ago is not a drag')
  await new Promise((resolve) => setTimeout(resolve, 300))
  search.window.handlers['will-move']()
  search.window.setBounds({ x: 100, y: 640 })
  search.window.handlers.moved()
  assert.deepEqual(spots, [{ x: 100 + BAR.width / 2, y: 640 }])
  search.hide()
  search.show()
  assert.deepEqual([search.window.getBounds().x, search.window.getBounds().y], [100, 640], 'it opens where it was left')
  search.window.handlers.moved()
  assert.equal(spots.length, 1, 'a move without a drag is not kept')
})

test('the panel does not hide itself on a blur when it is not asked to (the tests, Linux)', async () => {
  const log = []
  const search = createQuickSearch({ BrowserWindow: fakeWindowClass(log), screen, platform: 'linux', preload: 'p', load: () => {} })
  assert.equal(search.window.options.type, undefined)
  search.show()
  await new Promise((resolve) => setTimeout(resolve, 450))
  search.window.handlers.blur()
  assert.equal(search.window.isVisible(), true)
})
