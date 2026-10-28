import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  AUTO_LOCK_CHOICES, DIGITS, FREE_TRIES, LOWER, MAX_LENGTH, MIN_LENGTH, SYMBOLS, UPPER, WORDS,
  cleanEntry, cleanVault, findEntries, generate, generatePassphrase, generatePassword, listing, mergeEntries, strengthOf, waitFor, waitWords, forSite, fromCsv, hostOf, loginKey } from '../shared/password-model.mjs'

const randomInt = (n) => crypto.randomInt(n)

test('the master password hint goes by length, and a short one is not allowed', () => {
  assert.equal(strengthOf('').ok, false)
  assert.equal(strengthOf('short1!').ok, false)
  assert.match(strengthOf('short1!').label, /at least 10/)
  assert.deepEqual([strengthOf('abcdefghij').level, strengthOf('abcdefghij').ok], [1, true])
  assert.equal(strengthOf('correct horse battery').level, 3, 'a few words is strong')
  assert.equal(strengthOf('aaaaaaaaaaaaaaaaaaaaaaaa').level, 1, 'long but all one letter')
  assert.equal(strengthOf('Tr0ub4dor&3xyz').level, 2)
  assert.equal(strengthOf('Tr0ub4dor&3xyz-and-more!').level, 3)
  // Counted in characters, not bytes.
  assert.equal(strengthOf('ééééééééé').ok, false)
})

test('an entry is cleaned: a name and a password are needed, control characters go, a blank password keeps the old one', () => {
  const made = cleanEntry({ title: ' Bank\n', username: 'me@x.com', url: 'https://bank.example', password: 'p@ss' }, { newId: () => 'id-12345678', now: () => '2026-10-13T10:00:00Z' })
  assert.deepEqual(made, { id: 'id-12345678', title: 'Bank', username: 'me@x.com', url: 'https://bank.example', password: 'p@ss', createdAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:00:00Z' })
  assert.equal(cleanEntry({ title: '', password: 'x' }, { newId: () => 'id-12345678' }), null)
  assert.equal(cleanEntry({ title: 'No password' }, { newId: () => 'id-12345678' }), null)
  assert.equal(cleanEntry({ title: 'x', password: 'y'.repeat(1025) }, { newId: () => 'id-12345678' }), null)
  assert.equal(cleanEntry({ title: 'x', password: 'y' }, { newId: () => 'not valid!' }), null, 'a made-up id is refused')
  assert.equal(cleanEntry(null), null)
  const edited = cleanEntry({ title: 'Bank 2', password: '' }, { previous: made, now: () => '2026-10-14T10:00:00Z' })
  assert.equal(edited.password, 'p@ss')
  assert.equal(edited.createdAt, '2026-10-13T10:00:00Z')
  assert.equal(edited.updatedAt, '2026-10-14T10:00:00Z')
  assert.equal(edited.id, made.id)
  assert.equal(cleanEntry({ title: 'a\u0000b\u007fc', password: 'x' }, { newId: () => 'id-12345678' }).title, 'a b c')
})

test('a window only ever gets the five public fields of an entry', () => {
  const entry = cleanEntry({ title: 'T', username: 'u', url: 'x.com', password: 'SECRET-WORDS' }, { newId: () => 'id-12345678' })
  assert.deepEqual(Object.keys(listing(entry)).sort(), ['id', 'title', 'updatedAt', 'url', 'username'])
  assert.equal(JSON.stringify(listing(entry)).includes('SECRET-WORDS'), false)
})

test('what is read back from the sealed file is put in shape; a mangled entry is dropped, not trusted', () => {
  const sealed = { entries: [{ id: 'id-aaaaaaaa', title: 'A', password: 'pa', createdAt: 'c', updatedAt: 'u' }, { id: 'id-aaaaaaaa', title: 'dup', password: 'x' }, { title: 'no id', password: 'x' }, 7, { id: 'id-bbbbbbbb', title: '', password: 'x' }], settings: { autoLockMinutes: 3 } }
  const clean = cleanVault(sealed)
  assert.deepEqual(clean.entries.map((entry) => entry.id), ['id-aaaaaaaa'])
  assert.equal(clean.entries[0].updatedAt, 'u')
  assert.equal(clean.settings.autoLockMinutes, 5, '3 isn’t on the list, so the default')
  assert.deepEqual(cleanVault(undefined), { entries: [], settings: { autoLockMinutes: 5 } })
  assert.ok(AUTO_LOCK_CHOICES.includes(5))
})

test('a backup joins what is here: new ones added, a shared one keeps whichever changed last', () => {
  const mine = [{ id: 'id-1', updatedAt: '2026-10-02' , title: 'mine'}, { id: 'id-2', updatedAt: '2026-10-05', title: 'newer here' }]
  const theirs = [{ id: 'id-2', updatedAt: '2026-10-03', title: 'older there' }, { id: 'id-1', updatedAt: '2026-10-09', title: 'newer there' }, { id: 'id-3', updatedAt: '2026-10-01', title: 'only there' }]
  const merged = mergeEntries(mine, theirs)
  assert.deepEqual([merged.added, merged.updated], [1, 1])
  assert.deepEqual(Object.fromEntries(merged.entries.map((entry) => [entry.id, entry.title])), { 'id-1': 'newer there', 'id-2': 'newer here', 'id-3': 'only there' })
})

test('finding an entry looks at its name, username and address', () => {
  const list = [{ title: 'Bank', username: 'nate', url: 'bank.example' }, { title: 'Mail', username: 'nate@x.com', url: '' }]
  assert.equal(findEntries(list, 'bank').length, 1)
  assert.equal(findEntries(list, 'NATE').length, 2)
  assert.equal(findEntries(list, 'nate mail').length, 1)
  assert.equal(findEntries(list, '').length, 2)
})

test('after five wrong guesses it slows down: 30 seconds, then doubling, never more than an hour', () => {
  const t = 1_000_000
  for (let failed = 0; failed < FREE_TRIES; failed += 1) assert.equal(waitFor(failed, t, t), 0, `${failed} wrong`)
  assert.equal(waitFor(5, t, t), 30000)
  assert.equal(waitFor(5, t, t + 10000), 20000)
  assert.equal(waitFor(5, t, t + 30000), 0)
  assert.equal(waitFor(6, t, t), 60000)
  assert.equal(waitFor(7, t, t), 120000)
  assert.equal(waitFor(30, t, t), 3600000)
  assert.equal(waitFor(1e9, t, t), 3600000)
  assert.equal(waitFor(8, t, t - 5_000_000), 240000, 'a clock set back can’t make it longer than the wait itself')
  assert.equal(waitFor(8, NaN, t), 0)
  assert.equal(waitWords(30000), 'Too many tries. Try again in 30 seconds.')
  assert.equal(waitWords(1000), 'Too many tries. Try again in 1 second.')
  assert.equal(waitWords(90000), 'Too many tries. Try again in 2 minutes.')
})

test('a generated password has the right length and characters, and every kind asked for', () => {
  for (const length of [12, 13, 20, 40, 64]) {
    for (let n = 0; n < 40; n += 1) {
      const text = generatePassword({ length, symbols: true }, randomInt)
      assert.equal(text.length, length)
      assert.ok([...text].every((c) => (LOWER + UPPER + DIGITS + SYMBOLS).includes(c)), text)
      for (const set of [LOWER, UPPER, DIGITS, SYMBOLS]) assert.ok([...text].some((c) => set.includes(c)), `${text} has no ${set.slice(0, 3)}…`)
    }
  }
  for (let n = 0; n < 40; n += 1) {
    const plain = generatePassword({ length: 16, symbols: false }, randomInt)
    assert.ok([...plain].every((c) => (LOWER + UPPER + DIGITS).includes(c)), plain)
  }
  assert.equal(generatePassword({ length: 5 }, randomInt).length, MIN_LENGTH, 'too short is raised')
  assert.equal(generatePassword({ length: 900 }, randomInt).length, MAX_LENGTH, 'too long is lowered')
  assert.equal(generatePassword({ length: 'x' }, randomInt).length, 20)
  assert.notEqual(generatePassword({}, randomInt), generatePassword({}, randomInt))
})

test('the generator draws every pick from one even draw, never throwing a draw away', () => {
  const asked = []
  const counted = (n) => { asked.push(n); return n - 1 }
  const text = generatePassword({ length: 12, symbols: true }, counted)
  assert.equal(text.length, 12)
  // 4 picks for the kinds, 8 for the rest, 11 for the shuffle: nothing drawn again until a rule was met.
  assert.equal(asked.length, 4 + 8 + 11)
  assert.ok(asked.every((n) => n >= 1 && n <= LOWER.length + UPPER.length + DIGITS.length + SYMBOLS.length))
  // Every character is reachable, and about evenly: 62k draws over 62 letters and digits.
  const seen = new Map()
  for (let n = 0; n < 1000; n += 1) for (const c of generatePassword({ length: 64, symbols: false }, randomInt)) seen.set(c, (seen.get(c) || 0) + 1)
  assert.equal(seen.size, 62)
  for (const count of seen.values()) assert.ok(count > 700 && count < 1300, `uneven: ${count}`)
})

test('a passphrase is words from a plain list', () => {
  assert.ok(WORDS.length >= 400)
  assert.equal(new Set(WORDS).size, WORDS.length, 'no word twice')
  assert.ok(WORDS.every((word) => /^[a-z]{3,8}$/.test(word)))
  const phrase = generatePassphrase({ words: 6 }, randomInt)
  assert.equal(phrase.split('-').length, 6)
  assert.ok(phrase.split('-').every((word) => WORDS.includes(word)))
  assert.equal(generatePassphrase({ words: 1 }, randomInt).split('-').length, 4)
  assert.equal(generatePassphrase({ words: 99 }, randomInt).split('-').length, 12)
  assert.equal(generate({ words: 5 }, randomInt).split('-').length, 5)
  assert.equal(generate({ length: 30 }, randomInt).length, 30)
  assert.equal(generate(undefined, randomInt).length, 20)
})

test('a login fills on its own host or one under it, only over https', () => {
  assert.equal(hostOf('github.com'), 'github.com')
  assert.equal(hostOf('https://GitHub.com/login'), 'github.com')
  assert.equal(hostOf(''), '')
  assert.equal(forSite('github.com', 'https://github.com/login'), true)
  assert.equal(forSite('https://github.com', 'https://gist.github.com/'), true)
  assert.equal(forSite('github.com', 'https://evilgithub.com/'), false)
  assert.equal(forSite('github.com', 'https://github.com.evil.com/'), false)
  assert.equal(forSite('github.com', 'http://github.com/'), false)
  assert.equal(forSite('', 'https://github.com/'), false)
  assert.equal(forSite('github.com', 'not a page'), false)
  assert.equal(loginKey({ url: 'https://a.com/x', username: 'n', password: 'p' }), loginKey({ url: 'a.com', username: 'n', password: 'p' }))
})

test('exports from Chrome, Apple Passwords, Firefox and Bitwarden are read; a file without passwords is not', () => {
  assert.deepEqual(fromCsv('\uFEFFname,url,username,password,note\r\nGitHub,https://github.com/,nate,"a,b""c\nd",\r\n'), [
    { title: 'GitHub', url: 'https://github.com/', username: 'nate', password: 'a,b"c\nd' },
  ])
  assert.deepEqual(fromCsv('Title,URL,Username,Password,Notes,OTPAuth\nBank,https://bank.example,me,pw1,,\n'), [{ title: 'Bank', url: 'https://bank.example', username: 'me', password: 'pw1' }])
  assert.deepEqual(fromCsv('"url","username","password","httpRealm"\n"https://mail.example","me","pw2",""\n'), [{ title: 'mail.example', url: 'https://mail.example', username: 'me', password: 'pw2' }])
  assert.deepEqual(fromCsv('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Shop,,,0,https://shop.example,me,pw3,\n,,note,Secret note,words,,0,,,,\n'), [
    { title: 'Shop', url: 'https://shop.example', username: 'me', password: 'pw3' },
  ])
  assert.deepEqual(fromCsv('name,url,username,password\nApp,android://abc@com.app/,me,pw\n'), [])
  assert.equal(fromCsv('a,b,c\n1,2,3\n'), null)
  assert.equal(fromCsv(''), null)
})
