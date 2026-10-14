import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CIPHER, DEFAULT_KDF, FORMAT, MIN_N, VERSION, VaultError, create, deriveKey, newKdf, open, opensWith, parse, sameSecret, seal, wipe, withAttempts,
} from '../shared/vault-format.mjs'

const PASSWORD = 'correct horse battery staple'
const data = () => ({ entries: [{ id: 'id-11111111', title: 'Bank', username: 'nate', url: 'bank.example', password: 'S3CR3T-VALUE-ONE', createdAt: 'a', updatedAt: 'b' }], settings: { autoLockMinutes: 5 } })

// The key derivation costs real time on purpose (128 MiB, about half a second), so one file is made and reused.
const made = await create(PASSWORD, data())
const file = () => JSON.parse(made.text)
const flip = (text) => (text[0] === 'A' ? 'B' : 'A') + text.slice(1)
const flipMiddle = (text) => { const at = Math.floor(text.length / 2); return text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1) }
const CANNOT = (error) => error instanceof VaultError && error.code === 'cannot-open'

test('what is sealed opens with the master password, and the file holds none of it in the clear', async () => {
  assert.equal(file().format, FORMAT)
  assert.equal(file().version, VERSION)
  assert.equal(file().cipher, CIPHER)
  assert.equal(file().cipher, 'aes-256-gcm')
  for (const secret of ['S3CR3T-VALUE-ONE', 'Bank', 'bank.example', 'nate', PASSWORD]) assert.equal(made.text.includes(secret), false, secret)
  const opened = await open(made.text, PASSWORD)
  assert.deepEqual(opened.data, data())
  assert.equal(opened.key.length, 32)
  assert.deepEqual(opened.kdf, made.session.kdf)
})

test('a wrong password and a damaged file say the same thing', async () => {
  await assert.rejects(open(made.text, 'not the password'), (error) => CANNOT(error))
  await assert.rejects(open(made.text, ''), (error) => CANNOT(error))
  const messages = new Set()
  for (const change of [
    (f) => { f.ciphertext = flipMiddle(f.ciphertext) },
    (f) => { f.ciphertext = flip(f.ciphertext) },
    (f) => { f.tag = flip(f.tag) },
    (f) => { f.nonce = flip(f.nonce) },
    (f) => { f.kdf.salt = flip(f.kdf.salt) },
    (f) => { f.kdf.N = f.kdf.N * 2 },
    (f) => { f.kdf.p = 2 },
    (f) => { f.kdf.r = 9 },
    (f) => { f.ciphertext = '' },
    (f) => { f.nonce = 'AAAA' },
    (f) => { f.tag = null },
    (f) => { f.cipher = 'aes-128-gcm' },
    (f) => { f.kdf.name = 'pbkdf2' },
  ]) {
    const f = file()
    change(f)
    await assert.rejects(open(`${JSON.stringify(f)}\n`, PASSWORD), (error) => { messages.add(error.message); return CANNOT(error) }, JSON.stringify(change.toString()))
  }
  messages.add((await open(made.text, 'wrong').catch((error) => error)).message)
  assert.equal(messages.size, 1, 'one calm message for all of them')
})

test('every byte of the ciphertext, tag and nonce is checked', async () => {
  const f = file()
  const bytes = Buffer.from(f.ciphertext, 'base64')
  const opened = await open(made.text, PASSWORD) // the key, so each try is quick
  for (const at of [0, 1, 100, 4095, bytes.length - 1]) {
    const bad = Buffer.from(bytes)
    bad[at] ^= 1
    assert.equal(opensWith(`${JSON.stringify({ ...f, ciphertext: bad.toString('base64') })}\n`, opened.key), false, `ciphertext byte ${at}`)
  }
  for (const field of ['tag', 'nonce']) {
    const raw = Buffer.from(f[field], 'base64')
    for (let at = 0; at < raw.length; at += 1) {
      const bad = Buffer.from(raw)
      bad[at] ^= 0x80
      assert.equal(opensWith(`${JSON.stringify({ ...f, [field]: bad.toString('base64') })}\n`, opened.key), false, `${field} byte ${at}`)
    }
  }
  assert.equal(opensWith(made.text, opened.key), true)
  // The header is bound as the GCM additional data: even a change that leaves the key the same fails the tag.
  const changedVersion = { ...f, version: 2 }
  assert.throws(() => parse(JSON.stringify(changedVersion)), (error) => error.code === 'too-new')
})

test('the header is part of what the tag covers', async () => {
  const opened = await open(made.text, PASSWORD)
  const f = file()
  // Same key, but the header says something else: the tag no longer matches.
  assert.equal(opensWith(JSON.stringify({ ...f, kdf: { ...f.kdf, salt: Buffer.alloc(16, 1).toString('base64') } }), opened.key), false)
  assert.equal(opensWith(JSON.stringify({ ...f, kdf: { ...f.kdf, N: f.kdf.N * 2 } }), opened.key), false)
  assert.equal(opensWith(JSON.stringify({ ...f, kdf: { ...f.kdf, p: 2 } }), opened.key), false)
})

test('a fresh nonce every time it is sealed, and the same data never seals to the same bytes', async () => {
  const { key, kdf } = made.session
  const texts = Array.from({ length: 50 }, () => seal(key, kdf, data()))
  const nonces = new Set(texts.map((text) => JSON.parse(text).nonce))
  assert.equal(nonces.size, 50)
  assert.equal(new Set(texts.map((text) => JSON.parse(text).ciphertext)).size, 50)
  for (const text of texts.slice(0, 3)) assert.equal(JSON.parse(text).kdf.salt, kdf.salt, 'the salt stays; the nonce changes')
  assert.equal(Buffer.from(JSON.parse(texts[0]).nonce, 'base64').length, 12)
  assert.notEqual(JSON.parse(texts[0]).nonce, file().nonce)
  assert.deepEqual((await open(texts[7], PASSWORD)).data, data())
})

test('the cost is read from the file’s header, so it can be raised later; a weaker or silly one is refused', async () => {
  assert.equal(DEFAULT_KDF.N, 2 ** 17)
  assert.ok(DEFAULT_KDF.N >= 2 ** 17 && DEFAULT_KDF.r === 8 && DEFAULT_KDF.p === 1 && DEFAULT_KDF.keyLength === 32)
  assert.equal(file().kdf.N, DEFAULT_KDF.N)
  assert.equal(Buffer.from(file().kdf.salt, 'base64').length, 16)
  // A file made at twice the cost opens, because it says so itself.
  const heavier = await create(PASSWORD, data(), { kdf: newKdf({ ...DEFAULT_KDF, N: 2 ** 18 }) })
  assert.equal(JSON.parse(heavier.text).kdf.N, 2 ** 18)
  assert.deepEqual((await open(heavier.text, PASSWORD)).data, data())
  assert.notDeepEqual(heavier.session.key, made.session.key)
  // Weaker than today's floor, or beyond the ceiling, is refused before any work (the header is not trusted).
  const started = Date.now()
  for (const N of [2 ** 10, MIN_N / 2, 2 ** 20, 2 ** 31, 100000, 0, -1, '131072']) {
    const f = file()
    f.kdf.N = N
    await assert.rejects(open(JSON.stringify(f), PASSWORD), (error) => CANNOT(error), String(N))
  }
  assert.ok(Date.now() - started < 1500, 'refused at once, nothing derived')
  await assert.rejects(create(PASSWORD, data(), { kdf: newKdf({ ...DEFAULT_KDF, N: 2 ** 10 }) }), (error) => error instanceof VaultError)
})

test('a new salt each time: the same password makes a different key', async () => {
  const other = await create(PASSWORD, data())
  assert.notEqual(other.session.kdf.salt, made.session.kdf.salt)
  assert.notEqual(other.session.key.toString('hex'), made.session.key.toString('hex'))
  assert.equal(sameSecret(PASSWORD, PASSWORD), true)
  assert.equal(sameSecret(PASSWORD, `${PASSWORD} `), false)
  assert.equal(sameSecret('', undefined), true)
  // The same password typed in another Unicode form (é as one character, or as e and an accent) is the same password.
  const a = await deriveKey('café au lait 123', made.session.kdf)
  const b = await deriveKey('café au lait 123', made.session.kdf)
  assert.deepEqual(a, b)
})

test('not our file, or a newer one, says so; the guess count sits beside the sealed part', async () => {
  for (const text of ['', 'nope', '[]', '{"format":"other"}', 'null']) await assert.rejects(open(text, PASSWORD), (error) => error.code === 'not-vault', text)
  await assert.rejects(open(JSON.stringify({ ...file(), version: 99 }), PASSWORD), (error) => error.code === 'too-new')
  const counted = withAttempts(made.text, { failed: 6, lastAt: 1234 })
  assert.deepEqual(parse(counted).attempts, { failed: 6, lastAt: 1234 })
  assert.equal(JSON.parse(counted).ciphertext, file().ciphertext, 'the sealed part is untouched')
  assert.equal(parse(withAttempts(counted, null)).attempts, null)
  assert.equal(withAttempts(counted, null), made.text)
  assert.deepEqual((await open(counted, PASSWORD)).data, data(), 'counting a wrong guess doesn’t break the file')
  assert.equal(parse(withAttempts(made.text, { failed: -3, lastAt: 'x' })).attempts, null)
})

test('a lock overwrites the key and drops the entries', async () => {
  const session = await open(made.text, PASSWORD)
  const { key } = session
  const [entry] = session.data.entries
  assert.ok(key.some((byte) => byte !== 0))
  wipe(session)
  assert.ok(key.every((byte) => byte === 0), 'the very same Buffer is zeroed')
  assert.equal(session.data, null)
  assert.equal(entry.password, '')
  assert.throws(() => seal(key, session.kdf, data()), (error) => error.code === 'locked', 'a zeroed key is not mistaken for a real one')
  wipe(null)
  assert.throws(() => seal(Buffer.alloc(5), made.session.kdf, data()), VaultError)
})

test('the file is padded, so its size doesn’t say how many passwords there are', async () => {
  const one = Buffer.from(file().ciphertext, 'base64').length
  const some = { entries: Array.from({ length: 5 }, (_, n) => ({ ...data().entries[0], id: `id-${n}0000000`, title: `Site ${n}` })), settings: { autoLockMinutes: 5 } }
  const text = seal(made.session.key, made.session.kdf, some)
  assert.equal(one % 4096, 0)
  assert.equal(Buffer.from(JSON.parse(text).ciphertext, 'base64').length, one)
})
