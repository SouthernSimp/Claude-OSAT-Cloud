import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as model from '../shared/capture-model.mjs'
import { cleanSettings, holderOf, keysOf, withKey, applyPatch } from '../shared/launcher-model.mjs'
import { RING_ITEMS, ringItems } from '../shared/ring-model.mjs'
import { actionsFor, buildRows, readTyped } from '../shared/quick-search-model.mjs'

const require = createRequire(import.meta.url)
const { createCapture } = require('../desktop/launcher/capture.cjs')

test('CleanShot URLs are its documented commands; an after-action only where CleanShot takes one, never upload', () => {
  assert.equal(model.cleanshotUrl('area'), 'cleanshot://capture-area')
  assert.equal(model.cleanshotUrl('area', { action: 'copy' }), 'cleanshot://capture-area?action=copy')
  assert.equal(model.cleanshotUrl('area', { action: 'upload' }), 'cleanshot://capture-area', 'upload would leave the Mac')
  assert.equal(model.cleanshotUrl('record', { action: 'copy' }), 'cleanshot://record-screen', 'recording takes no action')
  assert.equal(model.cleanshotUrl('history'), 'cleanshot://open-history')
  assert.equal(model.cleanshotUrl('nope'), null)
  for (const item of model.CAPTURES) assert.ok(model.CLEANSHOT_URL.test(model.cleanshotUrl(item.id)), item.id)
  for (const bad of ['cleanshot://capture-area?action=upload', 'https://cleanshot.com', 'cleanshot://pin?filepath=/etc/passwd', 'cleanshot://x\nopen']) assert.ok(!model.CLEANSHOT_URL.test(bad), bad)
})

test('with CleanShot everything is there; without it, the three plain screenshots; elsewhere nothing', () => {
  assert.equal(model.available({ cleanshot: true, mac: true }).length, model.CAPTURES.length)
  assert.deepEqual(model.available({ mac: true }), ['area', 'window', 'fullscreen', 'text'])
  assert.deepEqual(model.available({}), [])
  assert.deepEqual(model.macArgs('area'), ['-i', '-c'])
  assert.deepEqual(model.macArgs('window', { file: '/x/a.png' }), ['-i', '-w', '/x/a.png'])
  assert.deepEqual(model.macArgs('fullscreen', { file: '/x/a.png' }), ['/x/a.png'])
  assert.equal(model.macArgs('record'), null, 'recording is never the Mac’s own here')
})

test('a screenshot gets a new name, never another file’s', () => {
  assert.equal(model.captureName(new Date(2026, 9, 5, 22, 3, 9)), 'Screenshot 2026-10-05 at 22.03.09.png')
  const taken = new Set(['a.png', 'a 2.png'])
  assert.equal(model.freeName('a.png', (name) => taken.has(name)), 'a 3.png')
  assert.equal(model.freeName('b.png', (name) => taken.has(name)), 'b.png')
})

test('the quick search finds captures by plain words, only the ones this Mac can do', () => {
  const all = model.available({ cleanshot: true })
  assert.deepEqual(model.findCaptures('record', all).map((row) => row.data.capture), ['all-in-one', 'record', 'history'], 'past recordings too')
  assert.deepEqual(model.findCaptures('screenshot win', all).map((row) => row.data.capture), ['window'])
  assert.deepEqual(model.findCaptures('record', ['area', 'window', 'fullscreen']), [])
  assert.deepEqual(model.findCaptures('', all), [])
  assert.equal(model.findCaptures('screenshots', all).length, 7, 'plural words find the same')
  assert.ok(model.wantsRecent('screenshots') && model.wantsRecent('recent captures') && !model.wantsRecent('screenshot window'))
  // They come under Everything with the rest, and Return starts them.
  const settings = cleanSettings(undefined)
  const read = readTyped('record', settings)
  const rows = buildRows(read, { captures: model.findCaptures('record', all, { cleanshot: true }) }, settings)
  assert.equal(rows[0].kind, 'capture')
  assert.deepEqual(actionsFor(rows[0]).map((action) => action.id), ['capture'])
  assert.deepEqual(actionsFor({ kind: 'shot', title: 'a.mp4', data: {} }).map((action) => action.id), ['shot-open', 'shot-reveal'], 'a recording drags, it isn’t copied')
})

test('recent captures: pictures and videos, newest first, ids that stay inside CleanShot’s folder', () => {
  const list = model.newestMedia([
    { id: 'm1/a.png', name: 'a.png', at: 1 }, { id: 'm2/b.cleanshot', name: 'b.cleanshot', at: 9 }, { id: 'm3/c.mp4', name: 'c.mp4', at: 5 },
    { id: '../x.png', name: 'x.png', at: 8 }, { id: 'm4/.hidden.png', name: '.hidden.png', at: 7 },
  ])
  assert.deepEqual(list.map((item) => item.id), ['m3/c.mp4', 'm1/a.png'])
  assert.ok(model.validMediaId('media_x/CleanShot 1.png'))
  for (const bad of ['../a.png', 'a.png', 'm/../../a.png', 'm/a/b.png', '/etc/a.png', 7]) assert.ok(!model.validMediaId(bad), String(bad))
  assert.equal(model.recentRows(list, { now: new Date(6) })[0].section, 'Recent captures')
})

test('capture keys live with the launcher’s: saved, cleaned, named, and refused when another has them', () => {
  const settings = cleanSettings({ captures: { hotkeys: { area: 'Control+Alt+Shift+Command+4', bogus: 'X' }, recent: 'yes', saveTo: 'nowhere' } })
  assert.deepEqual(settings.captures, { hotkeys: { ...Object.fromEntries(model.CAPTURES.map((item) => [item.id, null])), area: 'Control+Alt+Shift+Command+4' }, recent: false, saveTo: 'desktop' })
  assert.equal(keysOf(settings)['capture:area'], 'Control+Alt+Shift+Command+4')
  assert.equal(holderOf(settings, { key: 'Control+Alt+Shift+Command+4' }), 'Screenshot an area')
  const moved = withKey(settings, 'capture:record', 'Control+Alt+Shift+Command+5')
  assert.equal(moved.captures.hotkeys.record, 'Control+Alt+Shift+Command+5')
  assert.equal(moved.captures.hotkeys.area, 'Control+Alt+Shift+Command+4')
  const patched = cleanSettings(applyPatch(settings, { captures: { recent: true, hotkeys: { window: 'Alt+5' } } }))
  assert.equal(patched.captures.recent, true)
  assert.equal(patched.captures.hotkeys.area, 'Control+Alt+Shift+Command+4', 'a patch merges one level down')
  // The ring can hold them; a saved ring keeps a capture tool.
  assert.ok(RING_ITEMS.some((item) => item.capture === 'record'))
  assert.deepEqual(ringItems(cleanSettings({ ring: { items: ['capture-area', 'search'] } }).ring.items).map((item) => item.id), ['capture-area', 'search'])
})

/* capture.cjs with stand-ins for Electron and the Mac. */
async function setup({ cleanshot = true, settings = {}, screen = 'granted', platform = 'darwin', writes = true, readText = async () => ({ text: 'Hello there' }) } = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'osat-capture-'))
  const calls = { opened: [], exec: [], hid: 0, notified: [], dragged: [], copied: [] }
  const handlers = new Map()
  const state = { recent: false, saveTo: 'desktop', hotkeys: {}, ...settings }
  const capture = createCapture({
    model,
    platform,
    home,
    appPath: path.join(home, 'no CleanShot here.app'),
    shell: { openExternal: async (url) => calls.opened.push(url), openPath: async (file) => { calls.opened.push(file); return '' }, showItemInFolder: (file) => calls.opened.push(['reveal', file]) },
    clipboard: { writeImage: (image) => calls.copied.push(image), writeText: (text) => calls.copied.push(text) },
    readText,
    nativeImage: { createFromPath: (file) => ({ file, isEmpty: () => !file.endsWith('.png') }), createFromDataURL: () => ({ resize: () => 'icon' }) },
    systemPreferences: { getMediaAccessStatus: () => screen },
    exec: async (command, args) => {
      calls.exec.push([command, ...args])
      if (command === 'mdfind') return cleanshot ? '/Applications/CleanShot X.app\n' : ''
      if (writes && command === 'screencapture' && args.at(-1).endsWith('.png')) await writeFile(args.at(-1), 'png')
      return ''
    },
    settings: () => state,
    hidePanels: async () => { calls.hid += 1 },
    notify: (options) => calls.notified.push(options.body),
    thumbnail: async (file) => `thumb:${path.basename(file)}`,
    panel: () => ({ isDestroyed: () => false, webContents: { startDrag: (item) => calls.dragged.push(item) } }),
    on: (channel, operation) => handlers.set(channel, operation),
  })
  return { capture, calls, handlers, home, state, done: () => rm(home, { recursive: true, force: true }) }
}

test('with CleanShot: the panels go first, then CleanShot is asked; nothing else runs', async () => {
  const { capture, calls, handlers, done } = await setup()
  assert.deepEqual(await handlers.get('search:capture')('area'), { ok: true })
  assert.deepEqual(await capture.take('record'), { ok: true })
  assert.deepEqual(calls.opened, ['cleanshot://capture-area', 'cleanshot://record-screen'])
  assert.equal(calls.hid, 2)
  assert.ok(!calls.exec.some(([command]) => command === 'screencapture'))
  assert.equal(calls.exec.filter(([command]) => command === 'mdfind').length, 1, 'looked for once')
  assert.equal((await handlers.get('search:capture-status')()).cleanshot, true)
  await done()
})

test('without CleanShot: the Mac’s own screenshot into OSAT Captures, never over a file; recording says it needs CleanShot', async () => {
  const { capture, calls, home, state, done } = await setup({ cleanshot: false })
  const first = await capture.take('area')
  const second = await capture.take('fullscreen')
  assert.ok(first.ok && second.ok)
  const folder = path.join(home, 'Desktop', 'OSAT Captures')
  assert.ok(existsSync(path.join(folder, first.file)) && existsSync(path.join(folder, second.file)))
  assert.deepEqual(calls.exec.find(([command]) => command === 'screencapture').slice(0, 2), ['screencapture', '-i'])
  if (first.file.replace('.png', '') === second.file.replace(/ 2\.png$/, '')) assert.match(second.file, / 2\.png$/)
  state.saveTo = 'clipboard'
  assert.deepEqual(await capture.take('window'), { ok: true })
  assert.deepEqual(calls.exec.at(-1), ['screencapture', '-i', '-w', '-c'])
  assert.deepEqual(await capture.take('record'), { ok: false, reason: 'cleanshot' })
  assert.deepEqual(calls.notified, [], 'the panel says why; no notification')
  await capture.take('record', { tell: true })
  assert.match(calls.notified[0], /needs CleanShot X/)
  assert.equal(calls.hid, 3, 'nothing was hidden for what can’t run')
  assert.deepEqual(calls.opened, [])
  await done()
})

test('a cancelled screenshot is no file; a denied Screen Recording is said once', async () => {
  const quiet = await setup({ cleanshot: false, writes: false })
  assert.deepEqual(await quiet.capture.take('area'), { ok: false, reason: 'cancelled' }, 'Esc while picking leaves no file')
  await quiet.done()
  const { capture, calls, done } = await setup({ cleanshot: false, screen: 'denied' })
  await capture.take('area')
  await capture.take('area')
  assert.equal(calls.notified.length, 1)
  assert.match(calls.notified[0], /Screen Recording/)
  await done()
})

test('recent captures are off until turned on; then the newest come from CleanShot’s folder, and only files inside it open', async () => {
  const { handlers, calls, home, state, done } = await setup()
  const media = path.join(home, 'Library', 'Application Support', 'CleanShot', 'media')
  for (const [folder, name, at] of [['media_a', 'CleanShot 1.png', 1000], ['media_b', 'CleanShot 2.mp4', 3000], ['media_c', 'CleanShot 3.cleanshot', 4000]]) {
    await mkdir(path.join(media, folder), { recursive: true })
    await writeFile(path.join(media, folder, name), 'x')
    await utimes(path.join(media, folder, name), at, at)
  }
  assert.deepEqual(await handlers.get('search:capture-recent')(), [])
  await assert.rejects(handlers.get('search:capture-open')('media_a/CleanShot 1.png'), /isn’t there/)
  state.recent = true
  assert.deepEqual((await handlers.get('search:capture-recent')()).map((item) => item.id), ['media_b/CleanShot 2.mp4', 'media_a/CleanShot 1.png'])
  await handlers.get('search:capture-open')('media_a/CleanShot 1.png')
  assert.equal(calls.opened.at(-1), path.join(await import('node:fs/promises').then((fs) => fs.realpath(media)), 'media_a', 'CleanShot 1.png'))
  await assert.rejects(handlers.get('search:capture-open')('../../../../etc/passwd'), /isn’t there/)
  await assert.rejects(handlers.get('search:capture-copy')('media_b/CleanShot 2.mp4'), /drag a recording/)
  await handlers.get('search:capture-copy')('media_a/CleanShot 1.png')
  assert.equal(calls.copied.length, 1)
  await handlers.get('search:capture-drag')('media_b/CleanShot 2.mp4')
  assert.match(calls.dragged[0].file, /CleanShot 2\.mp4$/)
  await done()
})

test('off the Mac nothing is offered and nothing runs', async () => {
  const { capture, calls, done } = await setup({ platform: 'linux' })
  assert.deepEqual((await capture.status()).list, [])
  assert.deepEqual(await capture.take('area'), { ok: false, reason: 'mac' })
  assert.deepEqual(calls.exec, [])
  await done()
})

test('without CleanShot: Copy text from the screen reads an area with the Mac and copies the words; the picture goes', async () => {
  let read = null
  const { capture, calls, home, done } = await setup({ cleanshot: false, readText: async (file) => { read = file; return { text: 'Hello there\nfriend' } } })
  assert.deepEqual(await capture.take('text'), { ok: true, words: 3 })
  assert.deepEqual(calls.copied, ['Hello there\nfriend'])
  assert.match(calls.notified[0], /Copied 3 words/)
  assert.deepEqual(calls.exec.find(([command]) => command === 'screencapture').slice(0, 2), ['screencapture', '-i'])
  assert.ok(read && !existsSync(read), 'the picture was read, then removed')
  assert.ok(!existsSync(path.join(home, 'Desktop', 'OSAT Captures')), 'nothing saved to the captures folder')
  await done()
})

test('Copy text: Esc says nothing; a picture with no words says so calmly', async () => {
  const quiet = await setup({ cleanshot: false, writes: false })
  assert.deepEqual(await quiet.capture.take('text'), { ok: false, reason: 'cancelled' })
  assert.deepEqual(quiet.calls.notified, [])
  await quiet.done()
  const blank = await setup({ cleanshot: false, readText: async () => { throw new Error('EMPTY') } })
  assert.deepEqual(await blank.capture.take('text'), { ok: false, reason: 'empty' })
  assert.match(blank.calls.notified[0], /No words/)
  assert.deepEqual(blank.calls.copied, [])
  await blank.done()
})
