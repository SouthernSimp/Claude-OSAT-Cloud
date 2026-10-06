import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { createLauncher } = require('../desktop/launcher/index.cjs')
const repo = fileURLToPath(new URL('..', import.meta.url))

/* Electron's pieces, as stand-ins: enough to run the launcher's wiring end to end. */
async function setup({ trusted = false, offline = false, taken = () => false, refuse = [], script = null, apps = undefined } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'osat-launcher-'))
  const calls = { open: [], external: [], showItem: [], sent: [], command: [], exec: [], written: [], notified: [], ring: [] }
  const handlers = new Map()
  const board = { text: '' }
  const clipboard = {
    readText: () => board.text, readBuffer: () => Buffer.alloc(0), readImage: () => ({ isEmpty: () => true }), has: () => false, availableFormats: () => ['text/plain'],
    writeText: (text) => { board.text = text; calls.written.push(text) }, writeImage() {},
  }
  const sent = []
  class FakeWindow {
    constructor() {
      this.visible = false
      this.webContents = { send: (...args) => sent.push(args), focus() {}, isLoading: () => false, on() {}, once() {}, id: 'search' }
    }
    setVisibleOnAllWorkspaces() {} setAlwaysOnTop() {} on() {} setBounds() {} getBounds() { return { x: 0, y: 0, width: 700, height: 76 } }
    show() { this.visible = true } hide() { this.visible = false } focus() {} isVisible() { return this.visible } isFocused() { return this.visible } isDestroyed() { return false }
  }
  const desk = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(['desk', ...args]), id: 'desk' } }
  const registered = new Map()
  const shortcuts = { register: (key, run) => { if (refuse.includes(key) || registered.has(key)) return false; registered.set(key, run); return true }, unregister: (key) => registered.delete(key) }
  const files = {
    find: async (words) => [{ rootId: 'documents', relative: 'Taxes/Taxes 2025.pdf', name: 'Taxes 2025.pdf', kind: 'file', where: `found ${words}` }],
    recent: async () => [{ rootId: 'desktop', relative: 'Trip notes.md', name: 'Trip notes.md', kind: 'file', where: 'Desktop' }],
    resolve: async (rootId, relative) => {
      if (relative.includes('..')) throw new Error('Invalid relative file path.')
      return path.join(dir, 'files', rootId, relative)
    },
    whereOf: (item) => `Where ${item.rootId}`,
    open: async (rootId, relative) => { calls.open.push([rootId, relative]); return 'opened' },
    reveal: async (rootId, relative) => { calls.showItem.push([rootId, relative]); return true },
    trash: async (items) => ({ count: items.length, failed: [], undo: 'undo-1' }),
    undo: async (token) => token === 'undo-1',
    thumbnail: async (file) => `thumb:${path.basename(file)}`,
  }
  await mkdir(path.join(dir, 'files', 'desktop'), { recursive: true })
  await writeFile(path.join(dir, 'files', 'desktop', 'notes.md'), '# A note\nwords inside')
  const launcher = await createLauncher({
    app: { showEmojiPanel: () => calls.exec.push('emoji') },
    BrowserWindow: FakeWindow,
    screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 0, width: 1440, height: 900 } }], getCursorScreenPoint: () => ({ x: 5, y: 5 }) },
    clipboard,
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({ isEmpty: () => true }) },
    shell: {
      openPath: async (target) => { calls.open.push(target); return '' },
      openExternal: async (url) => { calls.external.push(url) },
      showItemInFolder: (target) => calls.showItem.push(target),
    },
    systemPreferences: { isTrustedAccessibilityClient: (ask) => { calls.exec.push(`trusted?${ask}`); return trusted } },
    globalShortcut: shortcuts,
    platform: 'darwin',
    dataDir: path.join(dir, 'data'),
    preload: 'preload.cjs',
    load: () => {},
    files,
    handle: (channel, operation, { from }) => handlers.set(channel, { operation, from }),
    fail: (message) => { throw new Error(message) },
    sharedModule: (name) => import(pathToFileURL(path.join(repo, 'shared', name)).href),
    mainWindow: () => desk,
    command: (detail) => calls.command.push(detail),
    sendToAllWindows: (...args) => sent.push(['all', ...args]),
    offline: () => offline,
    isTaken: (key) => taken(key),
    ...(apps ? { apps } : {}),
    notify: (options) => calls.notified.push(options),
    ringActions: { sticky: () => calls.ring.push('sticky'), chat: () => calls.ring.push('chat'), desk: () => calls.ring.push('desk'), sky: () => calls.ring.push('sky'), files: () => calls.ring.push('files') },
    exec: async (command, args) => { calls.exec.push([command, ...args]); if (script) return script(command, args); return command === 'lsappinfo' ? 'nothing' : '' },
  })
  const ask = (channel, ...args) => handlers.get(channel).operation(...args)
  return { dir, launcher, handlers, ask, calls, sent, registered, board, desk, files, done: async () => { launcher.stop(); await rm(dir, { recursive: true, force: true }) } }
}

test('starting registers a Hyper key for each source and reads what is saved', async () => {
  const t = await setup()
  try {
    await t.launcher.start()
    assert.deepEqual([...t.registered.keys()].sort(), ['Control+Alt+Shift+Command+A', 'Control+Alt+Shift+Command+N', 'Control+Alt+Shift+Command+R', 'Control+Alt+Shift+Command+S', 'Control+Alt+Shift+Command+V', 'Control+Alt+Shift+Command+W'])
    assert.equal(t.launcher.taken('Control+Alt+Shift+Command+V'), true, 'the desk’s shortcut picker can’t take it')
    assert.equal(t.launcher.hotkeyLabel('Control+Alt+Shift+Command+V'), 'Hyper V')
    assert.equal((await t.ask('search:settings')).sources.clipboard.keyword, 'v')
  } finally { await t.done() }
})

test('only the panel and the desk may ask; the settings are the desk’s alone', async () => {
  const t = await setup()
  try {
    const clipboardRule = t.handlers.get('search:clipboard').from
    const settingsRule = t.handlers.get('search:save-settings').from
    assert.equal(clipboardRule(t.desk.webContents), true)
    assert.equal(clipboardRule(t.launcher.search.window.webContents), true)
    assert.equal(clipboardRule({ id: 'quick chat' }), false)
    assert.equal(settingsRule(t.desk.webContents), true)
    assert.equal(settingsRule(t.launcher.search.window.webContents), false)
    for (const channel of ['search:clipboard-clear', 'search:clipboard-pause', 'search:ask-access', 'search:status']) assert.equal(t.handlers.get(channel).from(t.launcher.search.window.webContents), false, channel)
  } finally { await t.done() }
})

test('files: words search, nothing typed shows what was used lately, and a preview is the words or a picture', async () => {
  const t = await setup()
  try {
    await t.launcher.start()
    assert.equal((await t.ask('search:files', 'taxes'))[0].where, 'found taxes')
    assert.equal((await t.ask('search:files', '  '))[0].name, 'Trip notes.md')
    assert.deepEqual(await t.ask('search:preview', 'desktop', 'notes.md'), { text: '# A note\nwords inside', thumb: null })
    await writeFile(path.join(t.dir, 'files', 'desktop', 'photo.png'), 'x')
    assert.deepEqual(await t.ask('search:preview', 'desktop', 'photo.png'), { text: null, thumb: 'thumb:photo.png' })
    await assert.rejects(t.ask('search:preview', 'desktop', '../secret'), /Invalid relative/)
    await t.ask('search:save-settings', { sources: { files: { on: false } } })
    assert.deepEqual(await t.ask('search:files', 'taxes'), [], 'a source that is off answers nothing')
  } finally { await t.done() }
})

test('a keyword, a hotkey or a limit is saved privately, tells every window, and a key someone else has is refused', async () => {
  const t = await setup({ refuse: ['Control+Alt+Shift+Command+K'] })
  try {
    await t.launcher.start()
    const saved = await t.ask('search:save-settings', { view: 'full', sources: { clipboard: { keyword: 'clip', hotkey: 'Control+Alt+Shift+Command+C' } }, clipboard: { days: 7 }, apps: { Spotify: null, Music: { keyword: 'ss' } } })
    assert.deepEqual([saved.view, saved.sources.clipboard.keyword, saved.sources.clipboard.hotkey, saved.clipboard.days, Object.keys(saved.apps)[0]], ['full', 'clip', 'Control+Alt+Shift+Command+C', 7, 'Music'])
    assert.equal(t.registered.has('Control+Alt+Shift+Command+V'), false, 'the old key was let go')
    assert.equal(t.registered.has('Control+Alt+Shift+Command+C'), true)
    const file = path.join(t.dir, 'data', 'launcher.json')
    assert.equal((await stat(file)).mode & 0o077, 0, 'only this Mac user can read it')
    assert.equal(JSON.parse(await readFile(file, 'utf8')).view, 'full')
    assert.ok(t.sent.some(([channel, name, value]) => channel === 'all' && name === 'launcher:changed' && value.view === 'full'), 'every window heard')
    // The Mac won't give a key: it keeps its old one and says so, and the rest of the patch stands.
    await assert.rejects(t.ask('search:save-settings', { sources: { files: { hotkey: 'Control+Alt+Shift+Command+K' } }, view: 'bar' }), /taken by another app.*Files keeps its old one/)
    const now = await t.ask('search:settings')
    assert.equal(now.sources.files.hotkey, 'Control+Alt+Shift+Command+S')
    assert.equal(now.view, 'bar')
    assert.equal(t.registered.has('Control+Alt+Shift+Command+S'), true)
  } finally { await t.done() }
})

test('a key that is one of main’s shortcuts is refused too', async () => {
  const t = await setup({ taken: (key) => key === 'Control+Alt+Shift+Command+P' })
  try {
    await t.launcher.start()
    await assert.rejects(t.ask('search:save-settings', { sources: { notes: { hotkey: 'Control+Alt+Shift+Command+P' } } }), /taken by another app or another OSAT shortcut/)
  } finally { await t.done() }
})

test('Return on a copy: it goes back on the clipboard; without Accessibility nothing is sent and it says why', async () => {
  const t = await setup({ trusted: false })
  try {
    await t.launcher.start()
    t.board.text = 'Quote for Jordan'
    await t.launcher.history.poll()
    const [item] = (await t.ask('search:clipboard')).items
    t.board.text = 'something else'
    assert.deepEqual(await t.ask('search:paste-clip', item.id), { pasted: false, reason: 'access' })
    assert.equal(t.board.text, 'Quote for Jordan')
    assert.ok(!t.calls.exec.some((call) => Array.isArray(call) && call[0] === 'osascript'), 'no keystroke was sent')
    await assert.rejects(t.ask('search:paste-clip', 'not-an-id'), /That copy is gone/)
    // Asking macOS for Accessibility happens only through its own button, and never sends anything.
    assert.equal(t.calls.exec.includes('trusted?true'), false)
    await t.ask('search:ask-access')
    assert.equal(t.calls.exec.includes('trusted?true'), true)
  } finally { await t.done() }
})

test('with Accessibility the panel goes away and ⌘V is sent to the app you were in', async () => {
  const t = await setup({ trusted: true })
  try {
    await t.launcher.start()
    t.launcher.search.show()
    t.board.text = 'A copy to paste'
    await t.launcher.history.poll()
    const [item] = (await t.ask('search:clipboard')).items
    assert.deepEqual(await t.ask('search:paste-clip', item.id), { pasted: true })
    assert.equal(t.launcher.search.window.isVisible(), false)
    assert.equal(t.calls.exec.filter((call) => Array.isArray(call) && call[0] === 'osascript').length, 1)
  } finally { await t.done() }
})

test('copies: pin, delete and Undo, the whole text for a sticky, and OSAT’s own copies are never kept', async () => {
  const t = await setup()
  try {
    await t.launcher.start()
    t.board.text = 'x'.repeat(7000)
    await t.launcher.history.poll()
    const [item] = (await t.ask('search:clipboard')).items
    assert.equal(item.text.length, 6000)
    assert.equal((await t.ask('search:clipboard-text', item.id)).length, 7000, 'a sticky gets the whole copy')
    assert.equal(await t.ask('search:pin-clip', item.id, true), true)
    assert.equal((await t.ask('search:clipboard')).items[0].pinned, true)
    const token = await t.ask('search:forget-clip', item.id)
    assert.deepEqual((await t.ask('search:clipboard')).items, [])
    assert.equal(await t.ask('search:undo-clip', token), true)
    assert.equal((await t.ask('search:clipboard')).items.length, 1)
    // A copy OSAT makes for you (a path, an answer) or for itself (a key) goes on the clipboard without a second look.
    const quiet = t.launcher.history.quiet({ writeText: (text) => { t.board.text = text }, readText: () => t.board.text })
    quiet.writeText('a connector key')
    await t.launcher.history.poll()
    assert.equal((await t.ask('search:clipboard')).items.length, 1)
    assert.equal(await t.ask('search:copy-text', '98'), true)
    assert.equal(t.board.text, '98')
    await t.ask('search:clipboard-pause', true)
    assert.equal((await t.ask('search:clipboard')).paused, true)
    const cleared = await t.ask('search:clipboard-clear')
    assert.equal((await t.ask('search:clipboard')).items.length, 0)
    assert.equal(await t.ask('search:undo-clip', cleared), true)
  } finally { await t.done() }
})

test('files: open, show, copy the path, delete with Undo and pin all go through the approved places', async () => {
  const t = await setup()
  try {
    await t.launcher.start()
    assert.equal(await t.ask('search:open-file', 'documents', 'Taxes/Taxes 2025.pdf'), 'opened')
    assert.deepEqual(t.calls.open.at(-1), ['documents', 'Taxes/Taxes 2025.pdf'])
    await t.ask('search:reveal-file', 'documents', 'Taxes/Taxes 2025.pdf')
    await t.ask('search:copy-path', 'desktop', 'notes.md')
    assert.equal(t.board.text, path.join(t.dir, 'files', 'desktop', 'notes.md'))
    const trashed = await t.ask('search:trash-file', 'desktop', 'notes.md')
    assert.equal(trashed.count, 1)
    assert.equal(await t.ask('search:undo-file', trashed.undo), true)
    const pins = await t.ask('search:pin-file', { rootId: 'desktop', relative: 'notes.md', kind: 'file' }, true)
    assert.deepEqual(pins, [{ kind: 'file', rootId: 'desktop', relative: 'notes.md', name: 'notes.md', where: 'Where desktop' }])
    assert.deepEqual(await t.ask('search:pin-file', { rootId: 'desktop', relative: 'notes.md', kind: 'file' }, false), [])
    await assert.rejects(t.ask('search:pin-file', { rootId: 'desktop', relative: '../x', kind: 'file' }, true), /Invalid relative/)
  } finally { await t.done() }
})

test('apps and links open only what is on the list or a web address, and links wait offline', async () => {
  const online = await setup()
  try {
    await online.launcher.start()
    await assert.rejects(online.ask('search:open-app', '/Applications/NotAnApp.app'), /isn’t in the list/)
    await assert.rejects(online.ask('search:open-app-named', 'Definitely Not Installed 9'), /isn’t installed on this Mac/)
    await assert.rejects(online.ask('search:open-link', 'javascript:alert(1)'), /isn’t a web address/)
    await assert.rejects(online.ask('search:open-link', 'file:///etc/passwd'), /isn’t a web address/)
    await online.ask('search:open-link', 'https://www.google.com/search?q=cats')
    assert.deepEqual(online.calls.external, ['https://www.google.com/search?q=cats'])
  } finally { await online.done() }
  const offline = await setup({ offline: true })
  try {
    await offline.launcher.start()
    await offline.ask('search:open-link', 'https://www.google.com/')
    assert.deepEqual(offline.calls.external, [], 'nothing is opened while OSAT is offline')
  } finally { await offline.done() }
})

test('Open in OSAT puts the panel away and sends the desk there; a new copy is told to the desk only', async () => {
  const t = await setup()
  try {
    await t.launcher.start()
    t.launcher.search.show()
    assert.equal(await t.ask('search:open-in-osat', 'Notes', { noteId: 'n1' }), true)
    assert.equal(t.launcher.search.window.isVisible(), false)
    assert.deepEqual(t.calls.command, [{ view: 'Notes', detail: { noteId: 'n1' } }])
    assert.equal(await t.ask('search:open-in-osat', 42), false)
    t.board.text = 'jordan@acme.com'
    await t.launcher.history.poll()
    const told = t.sent.find(([who, channel]) => who === 'desk' && channel === 'clipboard:copied')
    assert.equal(told[2].kind, 'email')
    assert.equal(told[2].text, 'jordan@acme.com')
  } finally { await t.done() }
})

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* A Mac whose front window is a Safari window, and which records where it was told to put it. */
const macScript = (moves) => (command, args) => {
  if (command !== 'osascript') return 'nothing'
  if (args[3].includes('const [x, y, width, height]')) { moves.push(args.slice(4).map(Number)); return 'ok' }
  return JSON.stringify({ app: 'Safari', x: 100, y: 120, width: 900, height: 600 })
}

test('window keys are off until turned on; then each layout has its key, and a press moves the window', async () => {
  const moves = []
  const t = await setup({ trusted: true, script: macScript(moves) })
  try {
    await t.launcher.start()
    assert.equal(t.registered.has('Control+Alt+Left'), false, 'off by default: global keys are not taken without being asked')
    const saved = await t.ask('search:save-settings', { windows: { on: true } })
    assert.equal(saved.windows.on, true)
    assert.equal(t.registered.has('Control+Alt+Left'), true)
    assert.equal(t.registered.size, 6 + 16, 'a key for each layout, beside the Hyper keys and the ring’s')
    t.registered.get('Control+Alt+Left')()
    await wait(120)
    assert.deepEqual(moves, [[0, 0, 720, 900]])
    // A key can be changed or taken away; a key the Mac won't give keeps the old one and says which.
    await t.ask('search:save-settings', { windows: { hotkeys: { 'left-half': 'Control+Alt+Shift+Command+H', maximize: null } } })
    assert.equal(t.registered.has('Control+Alt+Left'), false)
    assert.equal(t.registered.has('Control+Alt+Shift+Command+H'), true)
    assert.equal(t.registered.has('Control+Alt+Return'), false)
    assert.equal((await t.ask('search:settings')).windows.hotkeys['top-half'], 'Control+Alt+Up', 'the others keep their usual keys')
    t.registered.set('Control+Alt+Shift+Command+Q', () => {})
    await assert.rejects(t.ask('search:save-settings', { windows: { hotkeys: { center: 'Control+Alt+Shift+Command+Q' } } }), /Center keeps its old one/)
    assert.equal((await t.ask('search:settings')).windows.hotkeys.center, 'Control+Alt+C')
    await t.ask('search:save-settings', { windows: { on: false } })
    assert.equal(t.registered.has('Control+Alt+Shift+Command+H'), false, 'turned off, every layout key goes')
  } finally { await t.done() }
})

test('a layout from the panel puts the panel away first, then moves the window; without Accessibility nothing is touched', async () => {
  const moves = []
  const allowed = await setup({ trusted: true, script: macScript(moves) })
  try {
    await allowed.launcher.start()
    allowed.launcher.search.show()
    assert.deepEqual(await allowed.ask('search:snap', 'maximize'), { ok: true, app: 'Safari', layout: 'maximize' })
    assert.equal(allowed.launcher.search.window.isVisible(), false)
    assert.deepEqual(moves, [[0, 0, 1440, 900]])
    await assert.rejects(allowed.ask('search:snap', 'sideways'), /isn’t a layout/)
  } finally { await allowed.done() }
  const locked = await setup({ trusted: false, script: macScript([]) })
  try {
    await locked.launcher.start()
    locked.launcher.search.show()
    assert.deepEqual(await locked.ask('search:snap', 'left-half'), { ok: false, reason: 'access' })
    assert.equal(locked.launcher.search.window.isVisible(), true, 'the panel stays, to say what is waiting')
    assert.ok(!locked.calls.exec.some((call) => Array.isArray(call) && call[0] === 'osascript'), 'no script ran')
  } finally { await locked.done() }
})

test('a layout key pressed without Accessibility says so once, calmly, and never moves anything', async () => {
  const t = await setup({ trusted: false, script: macScript([]) })
  try {
    await t.launcher.start()
    await t.ask('search:save-settings', { windows: { on: true } })
    t.registered.get('Control+Alt+Left')()
    t.registered.get('Control+Alt+Right')()
    await wait(160)
    assert.equal(t.calls.notified.length, 1, 'once, not on every press')
    assert.match(t.calls.notified[0].body, /allowed in Accessibility/)
    assert.ok(!t.calls.exec.some((call) => Array.isArray(call) && call[0] === 'osascript'))
  } finally { await t.done() }
})

test('the ring: its key is on by default, its window is made the first time, and a tool does its one thing', async () => {
  const moves = []
  const t = await setup({ trusted: true, script: macScript(moves) })
  try {
    await t.launcher.start()
    assert.equal(t.registered.has('Control+Alt+Shift+Command+R'), true, 'Hyper R')
    await assert.rejects(t.ask('ring:pick', 'sticky'), /reading 'hide'|undefined/, 'no ring window yet, nothing to pick from')
    t.registered.get('Control+Alt+Shift+Command+R')()
    await wait(120)
    await t.ask('ring:pick', 'sticky')
    await t.ask('ring:pick', 'chat')
    await t.ask('ring:pick', 'sky')
    await t.ask('ring:pick', 'search')
    assert.deepEqual(t.calls.ring, ['sticky', 'chat', 'sky'])
    assert.equal(t.launcher.search.window.isVisible(), true, 'the quick search tool opens the panel')
    await t.ask('ring:pick', 'left')
    assert.deepEqual(moves, [[0, 0, 720, 900]], 'a layout tool moves the window you were in')
    await assert.rejects(t.ask('ring:pick', 'launch-missiles'), /isn’t a tool the ring holds/)
    // The desk's ring opens the panel on a tab; only the desk may ask, and only for tabs that exist.
    assert.equal(t.handlers.get('search:show').from(t.desk.webContents), true)
    assert.equal(t.handlers.get('search:show').from(t.launcher.search.window.webContents), false)
    await t.ask('search:show', 'clipboard')
    assert.ok(t.sent.some(([channel, payload]) => channel === 'search:shown' && payload?.scope === 'clipboard'))
    await t.ask('search:show', 'nonsense')
    assert.equal(t.sent.filter(([channel]) => channel === 'search:shown').at(-1)[1].scope, 'all')
    // Turned off, the key goes; a key someone else has is refused and the old one stays.
    await t.ask('search:save-settings', { ring: { on: false } })
    assert.equal(t.registered.has('Control+Alt+Shift+Command+R'), false)
    await t.ask('search:save-settings', { ring: { on: true } })
    t.registered.set('Control+Alt+Shift+Command+Y', () => {})
    await assert.rejects(t.ask('search:save-settings', { ring: { hotkey: 'Control+Alt+Shift+Command+Y' } }), /The ring keeps its old one/)
    assert.equal((await t.ask('search:settings')).ring.hotkey, 'Control+Alt+Shift+Command+R')
    const saved = await t.ask('search:save-settings', { ring: { items: ['files', 'desk', 'files', 'bogus'] } })
    assert.deepEqual(saved.ring.items, ['files', 'desk'], 'unknown tools and repeats go')
  } finally { await t.done() }
})

const HYPER = (letter) => `Control+Alt+Shift+Command+${letter}`

test('an app or a quick link can have a key: it opens the app or the address, or the search with its word waiting', async () => {
  const notes = { name: 'Notes', path: '/Applications/Notes.app' }
  const apps = { list: async () => [notes], has: async (appPath) => appPath === notes.path, named: async (name) => (name === 'Notes' ? notes : null) }
  const t = await setup({ apps })
  try {
    await t.launcher.start()
    await t.ask('search:save-settings', {
      apps: { Notes: { hotkey: HYPER('Q') } },
      links: [
        { id: 'l1', name: 'Jira', url: 'https://jira.example.com/board', keyword: 'jira', hotkey: HYPER('J') },
        { id: 'l2', name: 'GitHub', url: 'https://github.com/search?q={query}', keyword: 'gh', hotkey: HYPER('H') },
      ],
    })
    t.registered.get(HYPER('Q'))()
    await wait(140)
    assert.deepEqual(t.calls.open.at(-1), '/Applications/Notes.app', 'the app opened')
    t.registered.get(HYPER('J'))()
    await wait(140)
    assert.deepEqual(t.calls.external, ['https://jira.example.com/board'])
    t.registered.get(HYPER('H'))()
    await wait(140)
    assert.deepEqual(t.sent.filter(([channel]) => channel === 'search:shown').at(-1)[1], { scope: 'all', mode: 'bar', text: 'gh ' }, 'a link that wants words opens the search with its word typed')
    assert.equal(t.calls.external.length, 1, 'and opens nothing yet')
    // Taking a link off takes its key off.
    await t.ask('search:save-settings', { links: [] })
    assert.equal(t.registered.has(HYPER('J')), false)
    assert.equal(t.registered.has(HYPER('Q')), true, 'the app’s key stays')
  } finally { await t.done() }
})

test('a Hyper key made by another app that leaves ⇧ out: the Mac is asked for ⌃⌥⌘, and the key still shows as Hyper', async () => {
  const t = await setup()
  try {
    await t.launcher.start()
    assert.equal(t.registered.has(HYPER('V')), true)
    const saved = await t.ask('search:save-settings', { hyper: { sends: 'three' } })
    assert.equal(saved.sources.clipboard.hotkey, HYPER('V'), 'stored as Hyper V')
    assert.equal(t.registered.has(HYPER('V')), false)
    assert.equal(t.registered.has('Control+Alt+Command+V'), true, 'registered as the Mac hears it')
    assert.equal(t.launcher.hotkeyLabel(HYPER('V')), 'Hyper V')
    await t.ask('search:save-settings', { hyper: { sends: 'four' } })
    assert.equal(t.registered.has(HYPER('V')), true)
  } finally { await t.done() }
})

test('emoji picker hides quick search and opens the native panel', async () => {
  const t = await setup()
  try {
    t.launcher.search.show()
    assert.deepEqual(await t.ask('search:emoji'), { ok: true })
    assert.equal(t.launcher.search.window.isVisible(), false)
    assert.ok(t.calls.exec.includes('emoji'))
  } finally { await t.done() }
})

test('screenshots: a key of their own and a ring tool ask CleanShot, with the panels put away first', async () => {
  const t = await setup({ script: (command) => (command === 'mdfind' ? '/Applications/CleanShot X.app\n' : '') })
  try {
    await t.launcher.start()
    await t.ask('search:save-settings', { captures: { hotkeys: { area: HYPER('4') } } })
    assert.equal((await t.ask('search:settings')).captures.hotkeys.area, HYPER('4'))
    t.registered.get(HYPER('4'))()
    await wait(400)
    assert.deepEqual(t.calls.external, ['cleanshot://capture-area'])
    t.launcher.search.show()
    t.launcher.ring.show()
    await t.ask('ring:pick', 'capture-record')
    assert.equal(t.launcher.search.window.isVisible(), false, 'the quick search is not in the picture')
    assert.deepEqual(t.calls.external, ['cleanshot://capture-area', 'cleanshot://record-screen'])
    assert.equal((await t.ask('search:capture-status')).cleanshot, true)
    // Taking its key off takes it off the Mac.
    await t.ask('search:save-settings', { captures: { hotkeys: { area: null } } })
    assert.equal(t.registered.has(HYPER('4')), false)
  } finally { await t.done() }
})
