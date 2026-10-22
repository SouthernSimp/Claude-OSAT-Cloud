import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { bodyText, decodeEntities, gmailLink, gmailRaw, htmlText } from '../shared/gmail-model.mjs'
import { messageRow, validMessageId } from '../shared/mail-model.mjs'

const require = createRequire(import.meta.url)
const { createGmail, GOOGLE, SCOPE } = require('../desktop/gmail.cjs')
const { createMacMail } = require('../desktop/mac-mail.cjs')
const sharedModule = (name) => import(`../shared/${name}`)
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url')
const decode = (data) => Buffer.from(data, 'base64url').toString('utf8')

const MESSAGE = {
  id: '18c2f0a1b2c3d4e5',
  internalDate: String(Date.UTC(2026, 9, 22, 14, 30)),
  labelIds: ['INBOX', 'UNREAD'],
  snippet: 'Can you send the deck by Friday? It&#39;s for Sam &amp; Lee',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [{ name: 'From', value: 'Sam Lee <sam@fortispay.com>' }, { name: 'Subject', value: 'Deck' }, { name: 'Date', value: 'Thu, 22 Oct 2026 09:30:00 -0500' }],
    parts: [
      { mimeType: 'text/html', body: { data: b64('<p>Hi Nate,</p><style>p{}</style><p>Send the <b>deck</b> by Friday&nbsp;please.</p><script>alert(1)</script>') } },
    ],
  },
}

test('a Gmail message reads as the Mail room’s own: sender, subject, date, unread, a clean snippet', () => {
  const row = messageRow(gmailRaw(MESSAGE))
  assert.equal(row.id, MESSAGE.id)
  assert.equal(row.subject, 'Deck')
  assert.deepEqual(row.from, { name: 'Sam Lee', address: 'sam@fortispay.com' })
  assert.equal(row.date, '2026-10-22T14:30:00.000Z')
  assert.equal(row.unread, true)
  assert.equal(row.snippet, 'Can you send the deck by Friday? It\'s for Sam & Lee')
  for (const bad of [{ id: '../x' }, { id: 'ZZZ' }, {}, null]) assert.equal(gmailRaw(bad), null)
  assert.equal(validMessageId(MESSAGE.id), true)
  for (const bad of ['42', '18c2f0a1b2c3d4e5; rm', 'ABCDEF12', '']) assert.equal(validMessageId(bad), false, bad)
})

test('an email sent only as HTML becomes plain words: no tags, styles or scripts', () => {
  const text = bodyText(MESSAGE.payload, decode)
  assert.match(text, /Hi Nate,\n\s*Send the deck by Friday please\./)
  assert.ok(!/[<>]|alert|p\{\}/.test(text), text)
  const both = { parts: [{ mimeType: 'text/plain', body: { data: b64('Plain words') } }, { mimeType: 'text/html', body: { data: b64('<b>html</b>') } }] }
  assert.equal(bodyText(both, decode), 'Plain words', 'the plain part wins')
  assert.equal(bodyText({ parts: [{ mimeType: 'text/plain', filename: 'notes.txt', body: { data: b64('an attachment') } }] }, decode), '', 'attachments are not the body')
  assert.equal(decodeEntities('&lt;b&gt; &#x1F600; &#0; &bogus;'), '<b> 😀  &bogus;')
  assert.equal(htmlText('a<br>b'), 'a\nb')
  assert.equal(gmailLink(MESSAGE.id, 'nate@gmail.com'), 'https://mail.google.com/mail/u/?authuser=nate%40gmail.com#all/18c2f0a1b2c3d4e5')
  assert.equal(gmailLink('javascript:x', 'a'), 'https://mail.google.com/mail/u/?authuser=a#all/')
})

/* A pretend Google: the token endpoint (with PKCE checked), the Gmail API, revoke. */
function pretendGoogle({ status = () => 200 } = {}) {
  const seen = { authorize: null, tokens: [], api: [], revoked: [] }
  const json = (value, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'content-type': 'application/json' } })
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.href === GOOGLE.token_endpoint) {
      const form = new URLSearchParams(String(init.body))
      seen.tokens.push(form)
      assert.ok(!form.has('resource'), 'Google is never sent a resource')
      if (form.get('grant_type') === 'refresh_token') return form.get('refresh_token') === 'refresh-g' ? json({ access_token: 'access-2', expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400)
      const challenge = createHash('sha256').update(form.get('code_verifier')).digest('base64url')
      if (form.get('code') !== 'the-code' || challenge !== seen.authorize.get('code_challenge') || form.get('client_secret') !== 'shh') return json({ error: 'invalid_grant' }, 400)
      return json({ access_token: 'access-1', refresh_token: 'refresh-g', expires_in: 3600 })
    }
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/revoke') { seen.revoked.push(String(init.body)); return json({}) }
    if (url.origin === 'https://gmail.googleapis.com') {
      seen.api.push({ path: url.pathname, search: url.searchParams, auth: init.headers?.authorization })
      const code = status(url)
      if (code !== 200) return json({ error: { code } }, code)
      if (url.pathname.endsWith('/profile')) return json({ emailAddress: 'nate@gmail.com' })
      if (url.pathname.endsWith('/messages')) return json({ messages: [{ id: MESSAGE.id }, { id: 'not-an-id!' }] })
      if (url.pathname.endsWith(`/messages/${MESSAGE.id}`)) return json(MESSAGE)
      return json({}, 404)
    }
    throw new Error(`unexpected ${url.href}`)
  }
  // The browser: Google's page, signed in, sends it back to OSAT on 127.0.0.1.
  const open = async (href) => {
    const page = new URL(href)
    if (page.origin === 'https://mail.google.com') return
    seen.authorize = page.searchParams
    const back = new URL(page.searchParams.get('redirect_uri'))
    back.searchParams.set('code', 'the-code')
    back.searchParams.set('state', page.searchParams.get('state'))
    await globalThis.fetch(back)
  }
  return { fetch, open, seen }
}

const memoryKeychain = () => { const held = new Map(); return { held, get: async (a) => held.get(a) ?? null, set: async (a, s) => { held.set(a, s) }, remove: async (a) => { held.delete(a) } } }
class Plain extends Error {}
const fail = (message) => { throw new Plain(message) }

async function setUp(google = pretendGoogle(), { client = { id: 'osat.apps.googleusercontent.com', secret: 'shh' } } = {}) {
  const handlers = new Map()
  const keychain = memoryKeychain()
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'osat-gmail-'))
  const gmail = await createGmail({ dataDir, keychain, fetch: google.fetch, open: google.open, sharedModule, handle: (channel, run) => handlers.set(channel, run), fail, client })
  return { gmail, google, keychain, dataDir, call: (channel, ...args) => handlers.get(channel)(...args) }
}

test('Connect Gmail: Google’s own page, read-only, PKCE; the refresh token goes to the Keychain, never a file', async () => {
  const { google, keychain, dataDir, call, gmail } = await setUp()
  assert.deepEqual(await call('gmail:status'), { ready: true, connected: false, email: '', busy: false })
  const status = await call('gmail:connect')
  assert.deepEqual(status, { ready: true, connected: true, email: 'nate@gmail.com', busy: false })
  assert.equal(google.seen.authorize.get('scope'), SCOPE)
  assert.equal(SCOPE, 'https://www.googleapis.com/auth/gmail.readonly')
  assert.equal(google.seen.authorize.get('access_type'), 'offline')
  assert.equal(google.seen.authorize.get('code_challenge_method'), 'S256')
  assert.match(google.seen.authorize.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  assert.equal(keychain.held.get('gmail-refresh'), 'refresh-g')
  const saved = await readFile(path.join(dataDir, 'gmail.json'), 'utf8')
  assert.deepEqual(JSON.parse(saved), { email: 'nate@gmail.com' })
  assert.ok(!saved.includes('refresh') && !saved.includes('access'))
  assert.equal(gmail.on(), true)
})

test('the inbox, a search and a message, read with the token; only Gmail ids are asked for', async () => {
  const { google, gmail, call } = await setUp()
  await call('gmail:connect')
  const rows = await gmail.list()
  assert.deepEqual(rows.map((row) => row.subject), ['Deck'])
  const listed = google.seen.api.find((item) => item.path.endsWith('/messages'))
  assert.equal(listed.search.get('labelIds'), 'INBOX')
  assert.equal(listed.auth, 'Bearer access-1')
  assert.ok(!google.seen.api.some((item) => item.path.includes('not-an-id')))
  await gmail.search('deck from:sam')
  assert.equal(google.seen.api.filter((item) => item.path.endsWith('/messages')).at(-1).search.get('q'), 'deck from:sam')
  const message = await gmail.read(MESSAGE.id)
  assert.match(message.body, /Send the deck by Friday/)
  await assert.rejects(gmail.read('../../profile'), /isn’t a message/)
  assert.ok(google.seen.api.every((item) => !/(send|modify|trash|delete|drafts)/.test(item.path)), 'read only')
})

test('a sign-in Google ended asks to connect again; offline says Gmail waits', async () => {
  let code = 200
  const google = pretendGoogle({ status: () => code })
  const { gmail, call } = await setUp(google)
  await call('gmail:connect')
  code = 401
  await assert.rejects(gmail.list(), /Connect Gmail again/)
  code = 200
  google.fetch = google.fetch // the next ask refreshes: the refresh token still works
  assert.equal((await gmail.list()).length, 1)

  const offline = pretendGoogle()
  const { gmail: away, call: callAway } = await setUp({ ...offline, fetch: async (input, init) => {
    if (String(input).startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages')) throw Object.assign(new Error('offline'), { code: 'OFFLINE' })
    return offline.fetch(input, init)
  } })
  await callAway('gmail:connect')
  await assert.rejects(away.list(), /Gmail waits until you’re back online/)
})

test('Disconnect tells Google to forget OSAT and takes the token out of the Keychain', async () => {
  const { google, keychain, gmail, call } = await setUp()
  await call('gmail:connect')
  const status = await call('gmail:disconnect')
  assert.equal(status.connected, false)
  assert.deepEqual(google.seen.revoked, ['token=refresh-g'])
  assert.equal(keychain.held.has('gmail-refresh'), false)
  await assert.rejects(gmail.list(), /Connect Gmail again/)
})

test('a build without OSAT’s Google client says so instead of opening a broken sign-in', async () => {
  const { call } = await setUp(pretendGoogle(), { client: null })
  assert.equal((await call('gmail:status')).ready, false)
  await assert.rejects(call('gmail:connect'), /isn’t set up in this build/)
})

test('once Gmail is connected, the Mail room and To-dos from email read Gmail, never the Mail app', async () => {
  const { gmail, call } = await setUp()
  await call('gmail:connect')
  const handlers = new Map()
  const asked = []
  const mail = await createMacMail({ sharedModule, handle: (channel, run) => handlers.set(channel, run), fail, gmail, platform: 'darwin', installed: () => true, running: async () => true, run: async (command) => { asked.push(command); return '[]' } })
  assert.deepEqual((await mail.list()).map((row) => row.subject), ['Deck'])
  assert.match((await mail.read(MESSAGE.id)).body, /deck/)
  assert.deepEqual((await handlers.get('mail:search')('deck')).map((row) => row.id), [MESSAGE.id])
  assert.equal((await handlers.get('mail:status')()).gmail.email, 'nate@gmail.com')
  assert.deepEqual(asked, [], 'the Mail app was never asked')
  await call('gmail:disconnect')
  await mail.list()
  assert.deepEqual(asked, ['list'], 'disconnected, the Mail app reads again')
})
