import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { COULDNT_UNLOCK, COPY_CLEAR_MS, waitWords } from '../shared/password-model.mjs'

const require = createRequire(import.meta.url)
const { createPasswords, LOCKED, writeAtomic } = require('../desktop/passwords.cjs')
const { SCRIPT, writeConcealed } = require('../desktop/conceal.cjs')
const repo = fileURLToPath(new URL('..', import.meta.url))

const MASTER = 'a long master passphrase 2026'
const SECRET = 'Zq9-SECRET-site-password-Zq9'

const CHANNELS = [
  'passwords:status', 'passwords:create', 'passwords:unlock', 'passwords:lock', 'passwords:touch', 'passwords:list', 'passwords:save', 'passwords:remove',
  'passwords:restore', 'passwords:reveal', 'passwords:copy', 'passwords:generate', 'passwords:set-auto-lock', 'passwords:change-master', 'passwords:export',
  'passwords:import-pick', 'passwords:import',
]

/* Everything main would give it, made of stand-ins: a clock, timers that fire when told, a clipboard, a save dialog. */
async function setup({ dir, fs = fsp, dialog = {}, conceal = null } = {}) {
  dir ||= await mkdtemp(path.join(tmpdir(), 'osat-passwords-'))
  const handlers = new Map()
  const froms = new Map()
  const sent = []
  const clock = { t: 1_800_000_000_000 }
  const clipboard = { text: '', cleared: 0, readText() { return this.text }, clear() { this.text = ''; this.cleared += 1 } }
  const written = []
  const timers = { list: [], set(fn, ms) { const timer = { fn, ms, live: true }; this.list.push(timer); return timer }, clear(timer) { if (timer) timer.live = false } }
  const live = (ms) => timers.list.filter((timer) => timer.live && (ms === undefined || timer.ms === ms))
  const real = await import(pathToFileURL(path.join(repo, 'shared', 'vault-format.mjs')).href)
  const seen = { sessions: [], gate: null }
  const wrapped = {
    ...real,
    open: async (...args) => { if (seen.gate) await seen.gate; const session = await real.open(...args); seen.sessions.push(session); return session },
    create: async (...args) => { const made = await real.create(...args); seen.sessions.push(made.session); return made },
  }
  const sharedModule = async (name) => (name === 'vault-format.mjs' ? wrapped : import(pathToFileURL(path.join(repo, 'shared', name)).href))
  const passwords = await createPasswords({
    dataDir: dir,
    sharedModule,
    handle: (channel, operation, options) => { handlers.set(channel, operation); froms.set(channel, options?.from) },
    fail: (message) => { throw new Error(message) },
    dialog,
    clipboard,
    writeConcealed: conceal || (async (text) => { written.push(text); clipboard.text = text }),
    send: (channel, ...args) => sent.push([channel, ...args]),
    now: () => clock.t,
    timers,
    fs,
  })
  const call = (channel, ...args) => handlers.get(channel)(...args)
  return { dir, call, handlers, froms, sent, clock, clipboard, written, timers, live, passwords, seen, file: path.join(dir, 'vault.json') }
}

const open = async (extra) => {
  const s = await setup(extra)
  await s.call('passwords:create', MASTER, MASTER)
  return s
}
const add = (s, patch = {}) => s.call('passwords:save', { title: 'Bank', username: 'nate', url: 'https://bank.example', password: SECRET, ...patch })

test('every channel is for the app’s own window and nothing else answers', async () => {
  const s = await setup()
  assert.deepEqual([...s.handlers.keys()].sort(), [...CHANNELS].sort())
  for (const channel of CHANNELS) assert.equal(s.froms.get(channel), 'app', channel)
})

test('a new set of passwords: asked twice, long enough, saved as one private file in the data folder only', async () => {
  const s = await setup()
  assert.deepEqual(await s.call('passwords:status'), { exists: false, unlocked: false, waitMs: 0, autoLockMinutes: 5 })
  await assert.rejects(s.call('passwords:create', MASTER, 'something else'), /don’t match/)
  await assert.rejects(s.call('passwords:create', 'short', 'short'), /at least 10/)
  await assert.rejects(s.call('passwords:unlock', MASTER), /no passwords here yet/)
  assert.deepEqual(await readdir(s.dir), [], 'nothing written yet')
  assert.deepEqual(await s.call('passwords:create', MASTER, MASTER), [])
  assert.deepEqual(await readdir(s.dir), ['vault.json'], 'one file, no temporary leftovers, nothing in store/')
  assert.equal((await stat(s.file)).mode & 0o777, 0o600)
  assert.equal((await readFile(s.file, 'utf8')).includes(MASTER), false, 'the master password is nowhere')
  assert.deepEqual(await s.call('passwords:status'), { exists: true, unlocked: true, waitMs: 0, autoLockMinutes: 5 })
  await assert.rejects(s.call('passwords:create', MASTER, MASTER), /already set up/)
})

test('the window only gets the public fields; a password leaves for Reveal or Copy and nowhere else', async () => {
  const s = await open()
  const saved = await add(s)
  assert.deepEqual(Object.keys(saved), ['id', 'list'])
  const results = [saved, await s.call('passwords:list'), await s.call('passwords:status')]
  for (const result of results) assert.equal(JSON.stringify(result).includes(SECRET), false)
  assert.deepEqual(Object.keys(saved.list[0]).sort(), ['id', 'title', 'updatedAt', 'url', 'username'])
  assert.equal(await s.call('passwords:reveal', saved.id), SECRET)
  await assert.rejects(s.call('passwords:reveal', 'nope'), /isn’t here any more/)
  // Not in the file as it sits on disk either.
  const onDisk = await readFile(s.file, 'utf8')
  for (const text of [SECRET, 'Bank', 'bank.example']) assert.equal(onDisk.includes(text), false)
})

test('Copy writes concealed in main, clears after 30 seconds only if the clipboard still holds it, and a lock clears it at once', async () => {
  const s = await open()
  const { id } = await add(s)
  assert.deepEqual(await s.call('passwords:copy', id), { clearsInSeconds: 30 })
  assert.deepEqual(s.written, [SECRET])
  const [timer] = s.live(COPY_CLEAR_MS)
  assert.ok(timer, 'a 30 second timer')
  // Something else was copied meanwhile: leave it alone.
  s.clipboard.text = 'my own copy'
  timer.fn()
  assert.equal(s.clipboard.text, 'my own copy')
  assert.equal(s.clipboard.cleared, 0)
  // Copy again and let it run out.
  await s.call('passwords:copy', id)
  assert.equal(s.live(COPY_CLEAR_MS).length, 1, 'the old timer was replaced')
  s.live(COPY_CLEAR_MS)[0].fn()
  assert.equal(s.clipboard.text, '')
  assert.equal(s.clipboard.cleared, 1)
  // A lock while it is still there empties it.
  await s.call('passwords:copy', id)
  await s.call('passwords:lock')
  assert.equal(s.clipboard.text, '')
  assert.equal(s.clipboard.cleared, 2)
  assert.equal(s.live(COPY_CLEAR_MS).length, 0)
})

test('a lock overwrites the key, drops the entries, tells the window, and everything waits for the master password', async () => {
  const s = await open()
  const { id } = await add(s)
  const { key } = s.seen.sessions.at(-1)
  assert.ok(key.some((byte) => byte !== 0))
  s.passwords.lock()
  assert.ok(key.every((byte) => byte === 0), 'the key Buffer is zeroed')
  assert.deepEqual(s.sent, [['passwords:locked']])
  for (const [channel, args] of [['passwords:list', []], ['passwords:reveal', [id]], ['passwords:copy', [id]], ['passwords:save', [{ title: 'x', password: 'y' }]], ['passwords:remove', [id]], ['passwords:export', []], ['passwords:set-auto-lock', [5]], ['passwords:change-master', [MASTER, MASTER, MASTER]]]) {
    await assert.rejects(s.call(channel, ...args), (error) => error.message === LOCKED, channel)
  }
  assert.equal((await s.call('passwords:status')).unlocked, false)
  assert.equal(s.written.length, 0)
  s.passwords.lock()
  assert.equal(s.sent.length, 1, 'locking twice says it once')
  // And it opens again only with the password.
  assert.equal((await s.call('passwords:unlock', MASTER)).length, 1)
  assert.equal(await s.call('passwords:reveal', id), SECRET)
})

test('it locks by itself after the idle time, the time is a setting, and using the room keeps it open', async () => {
  const s = await open()
  const idle = () => s.live().filter((timer) => timer.ms % 60000 === 0)
  assert.deepEqual(idle().map((timer) => timer.ms), [5 * 60000])
  const first = idle()[0]
  await s.call('passwords:touch')
  assert.equal(first.live, false, 'touching starts the wait again')
  assert.deepEqual(idle().map((timer) => timer.ms), [5 * 60000])
  await assert.rejects(s.call('passwords:set-auto-lock', 7), /list/)
  assert.equal(await s.call('passwords:set-auto-lock', 1), 1)
  assert.deepEqual(idle().map((timer) => timer.ms), [60000])
  assert.deepEqual(await s.call('passwords:status'), { exists: true, unlocked: true, waitMs: 0, autoLockMinutes: 1 })
  idle()[0].fn()
  assert.equal((await s.call('passwords:status')).unlocked, false)
  assert.deepEqual(s.sent, [['passwords:locked']])
  await s.call('passwords:unlock', MASTER)
  assert.deepEqual(idle().map((timer) => timer.ms), [60000], 'the setting is sealed in the file and is back after unlocking')
})

test('wrong guesses and a damaged file say the same thing; after five it slows down, and a quit doesn’t reset it', async () => {
  const s = await open()
  await s.call('passwords:lock')
  await assert.rejects(s.call('passwords:unlock', 'not the master password'), (error) => error.message === COULDNT_UNLOCK)
  for (let n = 0; n < 3; n += 1) await assert.rejects(s.call('passwords:unlock', 42), (error) => error.message === COULDNT_UNLOCK)
  const slow = await assert.rejects(s.call('passwords:unlock', 42), (error) => error.message === `${COULDNT_UNLOCK} ${waitWords(30000)}`)
  assert.equal(slow, undefined)
  assert.equal((await s.call('passwords:status')).waitMs, 30000)
  // Even the right password waits, and a wrong one doesn't get to ask the key derivation anything.
  await assert.rejects(s.call('passwords:unlock', MASTER), (error) => error.message === waitWords(30000))
  s.clock.t += 10000
  await assert.rejects(s.call('passwords:unlock', MASTER), (error) => error.message === waitWords(20000))
  // The count is in the file, so quitting and starting again doesn't clear it.
  assert.equal(JSON.parse(await readFile(s.file, 'utf8')).attempts.failed, 5)
  const again = await setup({ dir: s.dir })
  again.clock.t = s.clock.t
  assert.equal((await again.call('passwords:status')).waitMs, 20000)
  await assert.rejects(again.call('passwords:unlock', MASTER), (error) => error.message === waitWords(20000))
  again.clock.t += 20000
  assert.equal((await again.call('passwords:unlock', MASTER)).length, 0)
  assert.equal((await again.call('passwords:status')).waitMs, 0)
  assert.equal('attempts' in JSON.parse(await readFile(s.file, 'utf8')), false, 'a right password clears the count')
  // A flipped byte in the file reads exactly like a wrong password (and a file that isn’t ours says so).
  await again.call('passwords:lock')
  const file = JSON.parse(await readFile(s.file, 'utf8'))
  file.ciphertext = (file.ciphertext[0] === 'A' ? 'B' : 'A') + file.ciphertext.slice(1)
  await writeFile(s.file, JSON.stringify(file))
  await assert.rejects(again.call('passwords:unlock', MASTER), (error) => error.message === COULDNT_UNLOCK)
  await writeFile(s.file, 'hello')
  await assert.rejects(again.call('passwords:unlock', MASTER), /isn’t a passwords file/)
  assert.equal(await readFile(s.file, 'utf8'), 'hello', 'a file it can’t read is left exactly as it was')
  await assert.rejects(again.call('passwords:create', MASTER, MASTER), /already here/)
})

test('a lock that lands while the key is still being worked out throws that unlock away', async () => {
  const s = await open()
  await s.call('passwords:lock')
  let release
  s.seen.gate = new Promise((resolve) => { release = resolve })
  const slow = s.call('passwords:unlock', MASTER)
  await new Promise((resolve) => setTimeout(resolve, 20))
  s.passwords.lock()
  release()
  await assert.rejects(slow, (error) => error.message === LOCKED)
  assert.equal((await s.call('passwords:status')).unlocked, false)
  assert.ok(s.seen.sessions.at(-1).key.every((byte) => byte === 0), 'its key was zeroed on the way out')
})

test('saving, editing (a blank password keeps the old one), deleting with Undo, and Undo ending at the lock', async () => {
  const s = await open()
  const { id } = await add(s)
  await add(s, { title: 'Apple', password: 'second-secret' })
  assert.deepEqual((await s.call('passwords:list')).map((item) => item.title), ['Apple', 'Bank'])
  const edited = await s.call('passwords:save', { id, title: 'Bank (old)', username: 'me', url: '', password: '' })
  assert.equal(edited.id, id)
  assert.equal(await s.call('passwords:reveal', id), SECRET)
  await s.call('passwords:save', { id, title: 'Bank (old)', password: 'changed' })
  assert.equal(await s.call('passwords:reveal', id), 'changed')
  await assert.rejects(s.call('passwords:save', { id: 'ghost', title: 'x', password: 'y' }), /isn’t here any more/)
  await assert.rejects(s.call('passwords:save', { title: '', password: 'y' }), /needs a name and a password/)
  await assert.rejects(s.call('passwords:save', { title: 'x' }), /needs a name and a password/)
  const removed = await s.call('passwords:remove', id)
  assert.equal(removed.title, 'Bank (old)')
  assert.deepEqual(removed.list.map((item) => item.title), ['Apple'])
  assert.equal((await readFile(s.file, 'utf8')).length > 0, true)
  const back = await s.call('passwords:restore', id)
  assert.deepEqual(back.map((item) => item.title), ['Apple', 'Bank (old)'])
  assert.equal(await s.call('passwords:reveal', id), 'changed')
  // Saved to disk each time: a fresh start sees it.
  await s.call('passwords:lock')
  const reopened = await setup({ dir: s.dir })
  assert.equal((await reopened.call('passwords:unlock', MASTER)).length, 2)
  // A deleted one is only kept until the lock.
  await reopened.call('passwords:remove', id)
  await reopened.call('passwords:lock')
  await reopened.call('passwords:unlock', MASTER)
  await assert.rejects(reopened.call('passwords:restore', id), /can’t be brought back/)
  assert.deepEqual((await reopened.call('passwords:list')).map((item) => item.title), ['Apple'])
})

test('every save seals again with a new nonce, and a write that fails leaves the old file whole', async () => {
  const s = await open()
  const nonces = [JSON.parse(await readFile(s.file, 'utf8')).nonce]
  await add(s)
  nonces.push(JSON.parse(await readFile(s.file, 'utf8')).nonce)
  await add(s, { title: 'Two' })
  nonces.push(JSON.parse(await readFile(s.file, 'utf8')).nonce)
  assert.equal(new Set(nonces).size, 3)
  // The rename is the step that makes it real: when it fails, the file is the one before and no temporary stays behind.
  const before = await readFile(s.file, 'utf8')
  const broken = await setup({ dir: s.dir, fs: { ...fsp, rename: async () => { throw new Error('disk full: /secret/path') } } })
  await broken.call('passwords:unlock', MASTER)
  await assert.rejects(add(broken, { title: 'Three' }), (error) => error.message === 'Passwords couldn’t do that. Nothing was changed.')
  assert.equal(await readFile(s.file, 'utf8'), before)
  assert.deepEqual(await readdir(s.dir), ['vault.json'])
  assert.equal((await broken.call('passwords:list')).length, 2, 'what is shown is what is saved')
  // The helper alone: written whole to a private temporary file, then moved.
  const target = path.join(s.dir, 'x.json')
  await writeAtomic(target, 'first')
  await writeAtomic(target, 'second')
  assert.equal(await readFile(target, 'utf8'), 'second')
  assert.equal((await stat(target)).mode & 0o777, 0o600)
  assert.deepEqual((await readdir(s.dir)).sort(), ['vault.json', 'x.json'])
})

test('a new master password: the old one must be right, there is a new salt, the old password stops working, the old key is overwritten', async () => {
  const s = await open()
  const { id } = await add(s)
  const oldFile = JSON.parse(await readFile(s.file, 'utf8'))
  const oldKey = s.seen.sessions.at(-1).key
  await assert.rejects(s.call('passwords:change-master', 'not it', 'a brand new master 2027', 'a brand new master 2027'), (error) => error.message === COULDNT_UNLOCK)
  await assert.rejects(s.call('passwords:change-master', MASTER, 'a brand new master 2027', 'typo'), /don’t match/)
  await assert.rejects(s.call('passwords:change-master', MASTER, 'tiny', 'tiny'), /at least 10/)
  assert.equal(await s.call('passwords:change-master', MASTER, 'a brand new master 2027', 'a brand new master 2027'), true)
  const newFile = JSON.parse(await readFile(s.file, 'utf8'))
  assert.notEqual(newFile.kdf.salt, oldFile.kdf.salt)
  assert.ok(oldKey.every((byte) => byte === 0))
  assert.equal(await s.call('passwords:reveal', id), SECRET, 'still open, on the new key')
  await add(s, { title: 'After' })
  await s.call('passwords:lock')
  await assert.rejects(s.call('passwords:unlock', MASTER), (error) => error.message.startsWith(COULDNT_UNLOCK))
  assert.equal((await s.call('passwords:unlock', 'a brand new master 2027')).length, 2)
})

test('a backup is the same sealed file; adding one merges, and with nothing set up it becomes the passwords', async () => {
  const saving = path.join(tmpdir(), `osat-backup-${process.pid}.json`)
  const dialog = {
    showSaveDialog: async () => ({ canceled: false, filePath: saving }),
    showOpenDialog: async () => ({ canceled: false, filePaths: [saving] }),
  }
  const s = await open({ dialog })
  await add(s)
  await add(s, { title: 'Second' })
  assert.equal(await s.call('passwords:export'), path.basename(saving))
  const backup = await readFile(saving, 'utf8')
  for (const text of [SECRET, 'Bank', 'Second', 'bank.example', MASTER]) assert.equal(backup.includes(text), false, 'no plain text in a backup')
  assert.equal((await stat(saving)).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(backup).ciphertext, JSON.parse(await readFile(s.file, 'utf8')).ciphertext, 'the very same ciphertext')
  // Another Mac, another master password: nothing there yet, so the backup becomes its passwords.
  const other = await setup({ dialog })
  await assert.rejects(other.call('passwords:import', MASTER), /Choose a backup file first/)
  assert.deepEqual(await other.call('passwords:import-pick'), { name: path.basename(saving) })
  await assert.rejects(other.call('passwords:import', 'wrong'), (error) => error.message === COULDNT_UNLOCK)
  const restored = await other.call('passwords:import', MASTER)
  assert.deepEqual([restored.added, restored.list.map((item) => item.title)], [2, ['Bank', 'Second']])
  assert.equal((await other.call('passwords:status')).unlocked, true)
  await other.call('passwords:lock')
  assert.equal((await other.call('passwords:unlock', MASTER)).length, 2)
  // Here, with one more entry each side: adding the backup keeps both.
  await other.call('passwords:save', { title: 'Only here', password: 'p' })
  await other.call('passwords:import-pick')
  const merged = await other.call('passwords:import', MASTER)
  assert.deepEqual([merged.added, merged.updated, merged.list.length], [0, 0, 3])
  // A file that isn’t a backup is refused when chosen.
  await writeFile(saving, 'just words')
  await assert.rejects(other.call('passwords:import-pick'), /isn’t a passwords file/)
  await rm(saving, { force: true })
})

test('nothing secret is printed, or said in an error, whatever goes wrong', async () => {
  const logged = []
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((name) => { const original = console[name]; console[name] = (...args) => logged.push(args.map(String).join(' ')); return [name, original] })
  const said = []
  try {
    const s = await open()
    const { id } = await add(s)
    const tries = [
      () => s.call('passwords:save', { id, title: 'x', password: SECRET.repeat(100) }),
      () => s.call('passwords:save', { title: SECRET, password: 42 }),
      () => s.call('passwords:reveal', SECRET),
      () => s.call('passwords:copy', SECRET),
      () => s.call('passwords:change-master', SECRET, MASTER, MASTER),
      () => s.call('passwords:change-master', MASTER, SECRET, `${SECRET}x`),
      () => s.call('passwords:generate', { length: SECRET }),
      () => s.call('passwords:set-auto-lock', SECRET),
      () => s.call('passwords:remove', SECRET),
      () => s.call('passwords:import', SECRET),
    ]
    await s.call('passwords:lock')
    tries.push(() => s.call('passwords:unlock', SECRET), () => s.call('passwords:unlock', MASTER + SECRET), () => s.call('passwords:reveal', id))
    for (const attempt of tries) await attempt().then(() => said.push('ok'), (error) => said.push(error.message))
  } finally {
    for (const [name, original] of spies) console[name] = original
  }
  assert.ok(said.length >= 12)
  for (const text of [...said, ...logged]) {
    assert.equal(text.includes(SECRET), false, text)
    assert.equal(text.includes(MASTER), false, text)
  }
  assert.deepEqual(logged, [], 'not a word printed')
})

test('copying is refused, not done plainly, when it can’t be done concealed', async () => {
  const s = await open()
  const { id } = await add(s)
  const refusing = await setup({ dir: s.dir, conceal: async () => { throw new Error('osascript said: SECRET') } })
  await refusing.call('passwords:unlock', MASTER)
  await assert.rejects(refusing.call('passwords:copy', id), (error) => error.message === 'The password couldn’t be copied safely, so it wasn’t copied.')
  assert.equal(refusing.clipboard.text, '')
  assert.equal(refusing.live(COPY_CLEAR_MS).length, 0)
})

test('the generator is a channel too: lengths, kinds and words', async () => {
  const s = await setup()
  assert.equal((await s.call('passwords:generate', { length: 33, symbols: false })).length, 33)
  assert.match(await s.call('passwords:generate', { words: 5 }), /^[a-z]+(-[a-z]+){4}$/)
  assert.equal((await s.call('passwords:generate')).length, 20)
  assert.equal((await s.call('passwords:generate', 'junk')).length, 20)
})

test('Copy’s concealed write puts the words on the clipboard with the concealed type (Mac only, on a clipboard of its own)', { skip: process.platform !== 'darwin' }, async () => {
  const name = `osat-test-${process.pid}-${Date.now()}`
  const text = 'päss wörd "quoted" $HOME \u{1F511}'
  await writeConcealed(text, { pasteboard: name })
  const read = `ObjC.import('AppKit'); const b = $.NSPasteboard.pasteboardWithName('${name}'); const out = JSON.stringify({ types: ObjC.deepUnwrap(b.types), text: ObjC.unwrap(b.stringForType('public.utf8-plain-text')) }); b.releaseGlobally; out`
  const got = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', read]).toString())
  assert.equal(got.text, text)
  assert.ok(got.types.includes('org.nspasteboard.ConcealedType'))
  const { isConcealed } = await import('../shared/clipboard-model.mjs')
  assert.equal(isConcealed(got.types), true, 'the clipboard history skips it')
  assert.equal(SCRIPT.includes(text), false)
  await assert.rejects(writeConcealed(text, { platform: 'linux' }), /needs the Mac/)
})
