import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as model from '../shared/clipboard-model.mjs'

const { createClipboardHistory } = createRequire(import.meta.url)('../desktop/launcher/clipboard-history.cjs')

/* A clipboard and a picture maker that stand in for Electron's. */
function fakes() {
  const board = { text: '', png: Buffer.alloc(0), types: new Set() }
  const picture = (data) => ({
    isEmpty: () => data.length === 0,
    toPNG: () => data,
    getSize: () => ({ width: 8, height: 6 }),
    resize: () => ({ toDataURL: () => 'data:image/png;base64,THUMB' }),
  })
  return {
    board,
    clipboard: {
      readText: () => board.text,
      readBuffer: (format) => (format === 'public.png' ? board.png : Buffer.alloc(0)),
      readImage: () => picture(Buffer.alloc(0)),
      has: (type) => board.types.has(type),
      availableFormats: () => ['text/plain'],
      writeText: (text) => { board.text = text; board.png = Buffer.alloc(0) },
      writeImage: (image) => { board.png = image.toPNG(); board.text = '' },
    },
    nativeImage: { createFromBuffer: picture, createFromPath: (file) => picture(Buffer.from(`from ${path.basename(file)}`)) },
    copy(text, ...types) { board.text = text; board.png = Buffer.alloc(0); board.types = new Set(types) },
    copyPicture(bytes) { board.text = ''; board.png = Buffer.from(bytes); board.types = new Set() },
  }
}

async function setup(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'osat-clip-'))
  const fake = fakes()
  const history = createClipboardHistory({ dir, clipboard: fake.clipboard, nativeImage: fake.nativeImage, model, every: 60000, ...options })
  await history.start()
  return { ...fake, history, dir, done: async () => { history.stop(); await rm(dir, { recursive: true, force: true }) } }
}
const texts = (history) => history.list().items.map((item) => item.text)

test('what is copied while OSAT runs is kept, newest first, and the same copy moves up', async () => {
  const t = await setup()
  try {
    t.copy('one'); await t.history.poll()
    t.copy('https://osat.example'); await t.history.poll()
    t.copy('one'); await t.history.poll()
    assert.deepEqual(texts(t.history), ['one', 'https://osat.example'])
    assert.deepEqual(t.history.list().items.map((item) => item.kind), ['text', 'link'])
    await t.history.poll()
    assert.equal(t.history.list().items.length, 2, 'looking again at the same copy adds nothing')
  } finally { await t.done() }
})

test('what was on the clipboard before OSAT started is not kept', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'osat-clip-'))
  const fake = fakes()
  fake.copy('copied before OSAT opened')
  const history = createClipboardHistory({ dir, clipboard: fake.clipboard, nativeImage: fake.nativeImage, model, every: 60000 })
  await history.start()
  await history.poll()
  assert.deepEqual(history.list().items, [])
  history.stop()
  await rm(dir, { recursive: true, force: true })
})

test('a password manager’s copy is never kept, and the copy after it is', async () => {
  const t = await setup()
  try {
    t.copy('hunter2', 'org.nspasteboard.ConcealedType'); await t.history.poll()
    t.copy('123456', 'org.nspasteboard.TransientType'); await t.history.poll()
    assert.deepEqual(texts(t.history), [])
    t.copy('a normal copy'); await t.history.poll()
    assert.deepEqual(texts(t.history), ['a normal copy'])
  } finally { await t.done() }
})

test('paused keeps nothing, and what was copied meanwhile stays out when it resumes', async () => {
  const t = await setup()
  try {
    t.history.setPaused(true)
    t.copy('while paused'); await t.history.poll()
    assert.deepEqual(texts(t.history), [])
    t.history.setPaused(false)
    await t.history.poll()
    assert.deepEqual(texts(t.history), [], 'the copy made while paused is not picked up afterwards')
    t.copy('after'); await t.history.poll()
    assert.deepEqual(texts(t.history), ['after'])
  } finally { await t.done() }
})

test('a picture is kept as a file, put back on the clipboard, and forgotten with its file', async () => {
  const t = await setup()
  try {
    t.copyPicture('picture-bytes'); await t.history.poll()
    const [item] = t.history.list().items
    assert.equal(item.kind, 'image')
    assert.equal(item.thumb, 'data:image/png;base64,THUMB')
    assert.deepEqual(item.image, { w: 8, h: 6, bytes: 13 })
    assert.match(await t.history.image(item.id), /^data:image\/png;base64,/)
    assert.deepEqual(await readdir(path.join(t.dir, 'images')), [`${item.id}.png`])
    t.copy('something else'); await t.history.poll()
    assert.equal(t.history.use(item.id), true)
    assert.equal(t.board.png.toString(), 'from ' + `${item.id}.png`)
    await t.history.poll()
    assert.equal(t.history.list().items.length, 2, 'putting it back does not add it again')
    assert.equal(t.history.list().items[0].id, item.id, 'it moved to the top')
    const token = t.history.forget(item.id)
    assert.equal(typeof token, 'string')
    assert.deepEqual(await readdir(path.join(t.dir, 'images')), [`${item.id}.png`], 'the picture waits a few minutes, for Undo')
    // Forgetting something else replaces what Undo holds, and the older picture goes for good.
    t.copy('another'); await t.history.poll()
    t.history.forget(t.history.list().items[0].id)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(await readdir(path.join(t.dir, 'images')), [])
    assert.equal(t.history.undo(token), false)
  } finally { await t.done() }
})

test('a picture that is too big is skipped', async () => {
  const t = await setup()
  try {
    t.copyPicture(Buffer.alloc(model.MAX_IMAGE_BYTES + 1)); await t.history.poll()
    assert.deepEqual(t.history.list().items, [])
  } finally { await t.done() }
})

test('a copy put back on the clipboard is not kept a second time; OSAT’s own quiet writes are never kept', async () => {
  const t = await setup()
  try {
    t.copy('first'); await t.history.poll()
    t.copy('second'); await t.history.poll()
    assert.equal(t.history.use(t.history.list().items[1].id), true)
    assert.equal(t.board.text, 'first')
    await t.history.poll()
    assert.deepEqual(texts(t.history), ['first', 'second'])
    t.history.quiet(t.clipboard).writeText('a connector key')
    await t.history.poll()
    assert.deepEqual(texts(t.history), ['first', 'second'])
    assert.equal(t.board.text, 'a connector key')
  } finally { await t.done() }
})

test('the list sent to a window cuts a long copy; the whole copy still goes back', async () => {
  const t = await setup()
  try {
    t.copy('x'.repeat(model.PREVIEW_CHARS + 500)); await t.history.poll()
    const [item] = t.history.list().items
    assert.equal(item.text.length, model.PREVIEW_CHARS)
    assert.equal(item.chars, model.PREVIEW_CHARS + 500)
    t.history.use(item.id)
    assert.equal(t.board.text.length, model.PREVIEW_CHARS + 500)
    assert.equal(t.history.use('not an id'), false)
  } finally { await t.done() }
})

test('the history is saved privately, comes back after a restart, and Clear removes it all', async () => {
  const t = await setup()
  try {
    t.copy('kept across a restart'); await t.history.poll()
    t.copyPicture('bytes'); await t.history.poll()
    t.history.setPaused(true)
    t.history.stop()
    const file = path.join(t.dir, 'history.json')
    assert.equal((await stat(file)).mode & 0o077, 0, 'only this Mac user can read it')
    const again = createClipboardHistory({ dir: t.dir, clipboard: t.clipboard, nativeImage: t.nativeImage, model, every: 60000 })
    await again.start()
    assert.equal(again.list().paused, true, 'paused stays paused')
    assert.deepEqual(again.list().items.map((item) => item.kind), ['image', 'text'])
    assert.equal(typeof again.clear(), 'string')
    assert.deepEqual(again.list().items, [])
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).items, [])
    again.stop()
    assert.deepEqual(await readdir(path.join(t.dir, 'images')), [], 'the pictures leave the disk when OSAT quits, Undo or not')
  } finally { await t.done() }
})

test('a picture file no copy points to is swept up at start', async () => {
  const t = await setup()
  try {
    t.copyPicture('bytes'); await t.history.poll()
    t.history.stop()
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(path.join(t.dir, 'images'), { recursive: true })
    await writeFile(path.join(t.dir, 'images', 'stray.png'), 'x')
    const again = createClipboardHistory({ dir: t.dir, clipboard: t.clipboard, nativeImage: t.nativeImage, model, every: 60000 })
    await again.start()
    assert.equal((await readdir(path.join(t.dir, 'images'))).length, 1)
    again.stop()
  } finally { await t.done() }
})

test('each copy remembers which app it came from, and OSAT hears about a new copy once', async () => {
  let front = 'Safari'
  const heard = []
  const t = await setup({ frontApp: async () => front, onCopy: (item) => heard.push(item.id) })
  try {
    t.copy('from a web page'); await t.history.poll()
    front = 'Notes'
    t.copy('from Notes'); await t.history.poll()
    t.copy('from a web page'); await t.history.poll()
    const items = t.history.list().items
    assert.deepEqual(items.map((item) => [item.text, item.app]), [['from a web page', 'Notes'], ['from Notes', 'Notes']], 'the newest copy names the app it was made in')
    assert.equal(heard.length, 2, 'a repeat is not a new copy')
  } finally { await t.done() }
})

test('a pinned copy stays whatever the limits say; the others go by count and by age', async () => {
  let clock = new Date('2026-09-01T10:00:00Z')
  const t = await setup({ now: () => clock, limits: () => ({ items: 2, days: 7 }) })
  try {
    t.copy('a snippet'); await t.history.poll()
    t.history.pin(t.history.list().items[0].id, true)
    for (const text of ['two', 'three', 'four']) { t.copy(text); await t.history.poll() }
    assert.deepEqual(texts(t.history), ['four', 'three', 'a snippet'], 'two unpinned copies and the pin')
    clock = new Date('2026-09-20T10:00:00Z')
    t.history.limitsChanged()
    assert.deepEqual(texts(t.history), ['a snippet'], 'older than a week is gone, the pin is not')
    assert.equal(t.history.list().items[0].pinned, true)
    assert.equal(t.history.pin(t.history.list().items[0].id, false), true)
    assert.equal(t.history.list().items[0].pinned, undefined)
    assert.equal(t.history.pin('nope', true), false)
  } finally { await t.done() }
})

test('forgetting a copy, or clearing all, can be undone for a few minutes', async () => {
  const t = await setup()
  try {
    for (const text of ['one', 'two', 'three']) { t.copy(text); await t.history.poll() }
    t.copyPicture('bytes'); await t.history.poll()
    const [picture, , two] = t.history.list().items
    const token = t.history.forget(two.id)
    assert.deepEqual(texts(t.history).filter(Boolean), ['three', 'one'])
    assert.equal(t.history.undo('wrong'), false)
    assert.equal(t.history.undo(token), true)
    assert.deepEqual(t.history.list().items.map((item) => item.id).slice(0, 3), [picture.id, t.history.list().items[1].id, two.id], 'back in the same place')
    assert.equal(t.history.undo(token), false, 'an undo works once')
    const cleared = t.history.clear()
    assert.deepEqual(t.history.list().items, [])
    t.copy('made after clearing'); await t.history.poll()
    assert.equal(t.history.undo(cleared), true)
    assert.equal(t.history.list().items.length, 5, 'everything came back, after what was copied since')
    assert.equal(t.history.list().items[0].text, 'made after clearing')
    assert.match(await t.history.image(picture.id), /^data:image\/png/, 'the picture came back with its file')
    assert.equal(t.history.clear() !== null, true)
    assert.equal(t.history.undo(t.history.clear()), false, 'clearing nothing has nothing to bring back')
  } finally { await t.done() }
})

test('turning the source off stops the watching; what is copied meanwhile is not kept', async () => {
  const t = await setup()
  try {
    t.history.watch(false)
    t.copy('while off'); await t.history.poll()
    assert.deepEqual(texts(t.history), [])
    t.history.watch(true)
    await t.history.poll()
    assert.deepEqual(texts(t.history), [], 'a copy made while it was off is not picked up afterwards')
    t.copy('back on'); await t.history.poll()
    assert.deepEqual(texts(t.history), ['back on'])
    assert.equal(t.history.textOf(t.history.list().items[0].id), 'back on')
    assert.equal(t.history.textOf('nope'), null)
  } finally { await t.done() }
})

test('private writes stay out of history even when the clipboard update is delayed', async () => {
  const t = await setup()
  try {
    t.copy('before'); await t.history.poll()
    let waiting
    t.history.quiet({ writeText: (text) => { waiting = text } }).writeText('Bearer private-key')
    await t.history.poll()
    t.copy('another ordinary copy'); await t.history.poll()
    t.copy(waiting); await t.history.poll()
    assert.deepEqual(texts(t.history), ['another ordinary copy', 'before'])
  } finally { await t.done() }
})
