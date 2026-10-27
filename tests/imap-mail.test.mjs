import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { cleanSignIn, explainImap, imapRaw, providerFor, replyLink } from '../shared/imap-model.mjs'
import { messageRow } from '../shared/mail-model.mjs'

const require = createRequire(import.meta.url)
const { createImapMail } = require('../desktop/imap-mail.cjs')
const { createMacMail } = require('../desktop/mac-mail.cjs')
const sharedModule = (name) => import(`../shared/${name}`)

const SOURCE = 'From: Sam Lee <sam@fortispay.com>\r\nSubject: Deck\r\nContent-Type: text/html\r\n\r\n<p>Send the <b>deck</b> by Friday.</p><script>alert(1)</script>'
const message = (uid, subject, seen = false) => ({
  uid, flags: new Set(seen ? ['\\Seen'] : []), internalDate: new Date(Date.UTC(2026, 9, 20 + uid)),
  envelope: { subject, from: [{ name: 'Sam Lee', address: 'sam@fortispay.com' }] },
})

test('an address picks its provider, and the sign-in is checked before it leaves', () => {
  assert.equal(providerFor('nate@icloud.com'), 'icloud')
  assert.equal(providerFor('Nate@Gmail.com'), 'gmail')
  assert.equal(providerFor('n@yahoo.co.uk'), 'yahoo')
  assert.equal(providerFor('nate@mccreery.ai'), 'other')
  assert.deepEqual(cleanSignIn({ provider: 'icloud', email: ' nate@icloud.com ', password: 'abcd efgh ijkl mnop' }),
    { provider: 'icloud', email: 'nate@icloud.com', password: 'abcdefghijklmnop', host: 'imap.mail.me.com' })
  assert.equal(cleanSignIn({ provider: 'other', email: 'n@x.com', password: 'p', host: 'Mail.X.com' }).host, 'mail.x.com')
  for (const bad of [{ provider: 'aol', email: 'n@x.com', password: 'p' }, { provider: 'gmail', email: 'nope', password: 'p' },
    { provider: 'gmail', email: 'n@gmail.com', password: '' }, { provider: 'other', email: 'n@x.com', password: 'p', host: 'x;rm -rf' }]) {
    assert.ok(cleanSignIn(bad).error, JSON.stringify(bad))
  }
})

test('a fetched message reads as the Mail room’s own row; Reply goes where the provider writes', () => {
  const row = messageRow(imapRaw(message(7, 'Deck')))
  assert.equal(row.id, 7)
  assert.deepEqual(row.from, { name: 'Sam Lee', address: 'sam@fortispay.com' })
  assert.equal(row.unread, true)
  assert.equal(messageRow(imapRaw(message(8, 'x', true))).unread, false)
  assert.match(replyLink('gmail', 'sam@x.com', 'Deck'), /^https:\/\/mail\.google\.com\/mail\/\?view=cm.*su=Re%3A%20Deck/)
  assert.equal(replyLink('icloud', 'sam@x.com', 'Deck'), 'https://www.icloud.com/mail/')
  assert.equal(replyLink('other', 'sam@x.com', 'Re: Deck'), 'mailto:sam%40x.com?subject=Re%3A%20Deck')
  assert.match(explainImap({ authenticationFailed: true }, 'icloud'), /app-specific password/)
})

function pretendServer({ password = 'right', inbox = [message(1, 'Old', true), message(2, 'Deck'), message(3, 'Lunch')] } = {}) {
  const seen = { connects: 0, fetches: [], searches: [], sourced: [] }
  const connectTo = (options) => {
    seen.options = options
    const client = {
      usable: false,
      mailbox: { exists: inbox.length },
      on() {},
      async connect() {
        seen.connects += 1
        if (options.auth.pass !== password) throw Object.assign(new Error('Authentication failed'), { authenticationFailed: true })
        client.usable = true
      },
      async logout() { client.usable = false },
      async getMailboxLock(name) { assert.equal(name, 'INBOX'); return { release() {} } },
      async *fetch(range, query, how) {
        seen.fetches.push([range, how?.uid === true])
        assert.ok(!query.source, 'the list never downloads whole messages')
        const uids = how?.uid ? range.split(',').map(Number) : inbox.map((item) => item.uid)
        yield * inbox.filter((item) => uids.includes(item.uid))
      },
      async search(query, how) { seen.searches.push(query); assert.equal(how.uid, true); return [2] },
      async fetchOne(uid, query, how) {
        assert.equal(how.uid, true)
        seen.sourced.push(query)
        const found = inbox.find((item) => String(item.uid) === uid)
        return found && { ...found, source: Buffer.from(SOURCE) }
      },
    }
    return client
  }
  return { connectTo, seen }
}

async function setUp(server, { offline = false } = {}) {
  const handlers = new Map()
  const opened = []
  const held = new Map()
  const keychain = { get: async (k) => held.get(k) ?? null, set: async (k, v) => { held.set(k, v) }, remove: async (k) => { held.delete(k) } }
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'osat-imap-'))
  const state = { offline }
  const imap = await createImapMail({
    dataDir, keychain, sharedModule, handle: (channel, fn) => handlers.set(channel, fn), fail: (line) => { throw new Error(line) },
    open: async (url) => { opened.push(url) }, offline: () => state.offline, connectTo: server.connectTo,
  })
  const call = (channel, ...args) => handlers.get(channel)(...args)
  return { imap, call, opened, held, dataDir, state, handlers }
}

test('connecting checks the app password with the server, then keeps it in the Keychain only', async () => {
  const server = pretendServer()
  const { call, held, dataDir } = await setUp(server)
  await assert.rejects(call('imap:connect', { provider: 'icloud', email: 'nate@icloud.com', password: 'wrong' }), /app-specific password/)
  assert.equal(held.size, 0)
  const status = await call('imap:connect', { provider: 'icloud', email: 'nate@icloud.com', password: 'right' })
  assert.deepEqual(status, { connected: true, provider: 'icloud', email: 'nate@icloud.com', label: 'iCloud Mail' })
  assert.equal(server.seen.options.host, 'imap.mail.me.com')
  assert.equal(server.seen.options.secure, true)
  assert.equal(held.get('imap-password'), 'right')
  const saved = await readFile(path.join(dataDir, 'imap.json'), 'utf8')
  assert.ok(!saved.includes('right'), 'the password never reaches the data folder')
  assert.deepEqual(await call('imap:disconnect'), { connected: false, provider: '', email: '', label: 'Your mail' })
  assert.equal(held.size, 0)
})

test('the inbox is one fetch of the newest; reading peeks; search looks inside only when asked; offline waits', async () => {
  const server = pretendServer()
  const { imap, call, opened, state } = await setUp(server)
  await call('imap:connect', { provider: 'gmail', email: 'nate@gmail.com', password: 'right' })
  const rows = await imap.list()
  assert.deepEqual(rows.map((row) => row.subject), ['Lunch', 'Deck', 'Old'])
  assert.deepEqual(server.seen.fetches, [['1:*', false]])
  const before = server.seen.connects
  await imap.list()
  assert.equal(server.seen.connects, before, 'one connection is kept while in use')

  const full = await imap.read(2)
  assert.match(full.body, /Send the deck by Friday\./)
  assert.ok(!/alert|</.test(full.body), full.body)
  assert.ok(!('markAsSeen' in server.seen.sourced[0]), 'reading never asks the server to mark it read')
  await assert.rejects(imap.read('2'), /isn’t a message/)

  await imap.search('deck')
  await imap.search('deck', true)
  assert.deepEqual(server.seen.searches, [{ or: [{ subject: 'deck' }, { from: 'deck' }] }, { or: [{ subject: 'deck' }, { from: 'deck' }, { body: 'deck' }] }])

  await imap.reply(2)
  assert.match(opened.at(-1), /^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=sam%40fortispay\.com&su=Re%3A%20Deck$/)
  await imap.open(2)
  assert.equal(opened.at(-1), 'https://mail.google.com/mail/u/0/')

  state.offline = true
  await assert.rejects(imap.list(), /back online/)
  imap.stop()
})

test('once connected, the Mail room reads over IMAP instead of the Mail app', async () => {
  const server = pretendServer()
  const { imap, call } = await setUp(server)
  await call('imap:connect', { provider: 'icloud', email: 'nate@icloud.com', password: 'right' })
  const handlers = new Map()
  await createMacMail({
    sharedModule, handle: (channel, fn) => handlers.set(channel, fn), fail: (line) => { throw new Error(line) }, imap,
    run: async () => assert.fail('the Mail app is never asked'), platform: 'linux',
  })
  const status = await handlers.get('mail:status')()
  assert.equal(status.available, true)
  assert.equal(status.imap.provider, 'icloud')
  assert.equal((await handlers.get('mail:list')()).length, 3)
  assert.equal((await handlers.get('mail:read')(3)).subject, 'Lunch')
  imap.stop()
})
