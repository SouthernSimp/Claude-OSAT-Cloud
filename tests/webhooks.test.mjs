import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as storeCore from '../shared/store-core.mjs'
import * as model from '../shared/webhook-model.mjs'
import { runTool } from '../shared/connector-tools.mjs'

const require = createRequire(import.meta.url)
const { createStore } = require('../desktop/store/index.cjs')
const { createWebhooks } = require('../desktop/bots/webhooks.cjs')

const NOW = Date.parse('2026-10-08T10:00:00.000Z')
const at = (ms = 0) => new Date(NOW + ms).toISOString()
const note = (id, extra = {}) => ({ id, title: id, markdown: `${id} words`, createdAt: at(), updatedAt: at(), folderId: null, ...extra })
const doc = (notes = [], folders = []) => ({ notes, folders })

/* ---------- the pure rules ---------- */

test('moments: a sticky added, a sticky filed, a topic added, the journal written', () => {
  const garden = { id: 'garden', name: 'Garden', createdAt: at() }
  const before = doc([note('old'), { id: 'day-2026-10-08', kind: 'day', date: '2026-10-08', markdown: 'Morning' }], [garden])
  const after = doc([
    note('new'),
    { ...note('old'), folderId: 'garden' },
    { id: 'day-2026-10-08', kind: 'day', date: '2026-10-08', markdown: 'Morning\nWatered the beds' },
  ], [garden, { id: 'trips', name: 'Trips', createdAt: at() }])
  const ops = [
    { t: 'add', c: 'notes', v: after.notes[0] },
    { t: 'patch', c: 'notes', id: 'old', v: { folderId: 'garden' } },
    { t: 'patch', c: 'notes', id: 'day-2026-10-08', v: { markdown: 'Morning\nWatered the beds' } },
    { t: 'add', c: 'folders', v: after.folders[1] },
  ]
  assert.deepEqual(model.momentsOf(before, after, ops, { now: NOW }), [
    { event: 'sticky.added', id: 'new' },
    { event: 'sticky.filed', id: 'old' },
    { event: 'journal.written', date: '2026-10-08' },
    { event: 'topic.added', id: 'trips' },
  ])
})

test('moments: not a day page, an empty note, an Undo, a sticky a service sent, a branch, a move within nowhere', () => {
  const day = { id: 'day-2026-10-08', kind: 'day', date: '2026-10-08', markdown: '', createdAt: at() }
  const stale = note('back', { createdAt: at(-60 * 60 * 1000) }) // brought back by Undo, an hour old
  const after = doc([day, note('empty', { markdown: '  ' }), stale, note('relay', { source: 'Webhook' }), { ...note('moved'), folderId: null }], [
    { id: 'beds', name: 'Beds', parentId: 'garden', createdAt: at() },
    { id: 'loose', name: 'Loose', kind: 'branch', createdAt: at() },
  ])
  const before = doc([{ ...note('moved'), folderId: 'garden' }])
  const ops = [
    ...after.notes.slice(0, 4).map((v) => ({ t: 'add', c: 'notes', v })),
    { t: 'patch', c: 'notes', id: 'moved', v: { folderId: null } },
    ...after.folders.map((v) => ({ t: 'add', c: 'folders', v })),
    { t: 'set', p: 'theme', v: 'dark' },
  ]
  assert.deepEqual(model.momentsOf(before, after, ops, { now: NOW }), [])
})

test('the message: one plain line for Slack and Discord, and the details for Zapier', () => {
  const folders = [{ id: 'garden', name: 'Garden' }, { id: 'beds', name: 'Beds', parentId: 'garden' }]
  const sticky = note('seeds', { title: 'Buy seeds', markdown: 'Buy seeds\nfor the raised beds', folderId: 'beds', source: 'Quick bar' })
  const body = model.payloadFor({ event: 'sticky.filed', id: 'seeds' }, doc([sticky], folders), { at: at() })
  assert.deepEqual(body, {
    event: 'sticky.filed',
    at: at(),
    text: 'Filed into Garden › Beds: Buy seeds',
    content: 'Filed into Garden › Beds: Buy seeds',
    sticky: { id: 'seeds', title: 'Buy seeds', text: 'Buy seeds\nfor the raised beds', topic: 'Garden', branch: 'Beds', source: 'Quick bar' },
  })
  assert.equal(model.payloadFor({ event: 'sticky.added', id: 'seeds' }, doc([{ ...sticky, folderId: null }]), { at: at() }).text, 'New sticky: Buy seeds')
  assert.deepEqual(model.payloadFor({ event: 'topic.added', id: 'garden' }, doc([], folders), { at: at() }).topic, { id: 'garden', name: 'Garden' })
  const journal = model.payloadFor({ event: 'journal.written', date: '2026-10-08' }, doc([{ id: 'day-2026-10-08', kind: 'day', markdown: 'Morning\n- [x] Watered the beds\n' }]), { at: at() })
  assert.deepEqual(journal.journal, { date: '2026-10-08', line: 'Watered the beds' })
  assert.equal(journal.content, 'Journal, October 8: Watered the beds')
  assert.equal(model.payloadFor({ event: 'sticky.added', id: 'gone' }, doc(), {}), null)
  assert.equal(model.payloadFor({ event: 'journal.written', date: '2026-10-09' }, doc(), {}), null)
  assert.equal(model.payloadFor({ event: 'test' }, null, { at: at() }).event, 'test')
  assert.equal(model.oneLine('x'.repeat(400), 300).length, 300)
})

test('addresses: https anywhere, plain http only on this Mac', () => {
  assert.equal(model.webhookAddress(' https://hooks.zapier.com/hooks/catch/1/abc '), 'https://hooks.zapier.com/hooks/catch/1/abc')
  assert.equal(model.webhookAddress('http://127.0.0.1:5678/webhook'), 'http://127.0.0.1:5678/webhook')
  assert.equal(model.webhookAddress('http://n8n.localhost/hook'), 'http://n8n.localhost/hook')
  assert.throws(() => model.webhookAddress('http://hooks.slack.com/x'), /Use an https:\/\/ address/)
  for (const bad of ['ftp://example.com/x', 'hooks.zapier.com/abc', '', 'javascript:alert(1)', 'file:///etc/passwd']) assert.throws(() => model.webhookAddress(bad), /isn’t a web address/, bad)
  assert.equal(model.ntfyServer('https://ntfy.example.com/'), 'https://ntfy.example.com')
  assert.equal(model.hookName('https://hooks.zapier.com/x'), 'Zapier')
  assert.equal(model.hookName('https://discord.com/api/webhooks/1/a'), 'Discord')
  assert.equal(model.hookName('http://127.0.0.1:5678/'), 'This Mac')
})

test('ntfy replies: each message a sticky, its title first; older ones and other events left', () => {
  const body = [
    JSON.stringify({ id: 'a1', time: 100, event: 'message', message: 'Too old' }),
    JSON.stringify({ id: 'k1', time: 300, event: 'keepalive' }),
    JSON.stringify({ id: 'b2', time: 300, event: 'message', message: 'Buy milk' }),
    'not json',
    JSON.stringify({ id: 'c3', time: 301, event: 'message', title: 'From the form', message: 'Call Sam back' }),
    '',
  ].join('\n')
  assert.deepEqual(model.readNtfy(body, { after: 200 }), { texts: ['Buy milk', 'From the form\nCall Sam back'], last: 'c3' })
  assert.deepEqual(model.readNtfy('', {}), { texts: [], last: null })
  assert.equal(model.ntfyPollUrl({ server: 'https://ntfy.sh', topic: 'x'.repeat(32), since: 'c3' }), `https://ntfy.sh/${'x'.repeat(32)}/json?poll=1&since=c3`)
})

test('the settings file keeps only what makes sense', () => {
  const clean = model.cleanHookSettings({
    hooks: [
      { id: 'hook-1', url: 'https://hooks.slack.com/services/x', events: ['sticky.added', 'nonsense', 'sticky.added'], last: { at: at(), ok: true } },
      { id: 'hook-2', url: 'http://example.com/' },
      { id: '../bad', url: 'https://example.com/' },
    ],
    inbox: { on: true, topic: 'short', server: 'ftp://nope' },
  })
  assert.deepEqual(clean.hooks, [{ id: 'hook-1', name: 'Slack', url: 'https://hooks.slack.com/services/x', on: true, events: ['sticky.added'], last: { at: at(), ok: true, text: '' } }])
  assert.deepEqual(clean.inbox, { on: false, server: 'https://ntfy.sh', topic: '', since: '', after: 0, lastAt: null })
})

/* ---------- sending and reading, with a real store and a stand-in internet ---------- */

const TOPIC = 'T0pic_with-24-or-more-chars'

async function setup(t, { respond = () => ({ ok: true, status: 200 }), offline = () => false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-webhooks-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = await createStore({ dir: path.join(dir, 'store'), core: storeCore, writeDelay: 0, maxDelay: 0 })
  const client = store.connect(() => {})
  let n = 0
  const makeId = (prefix) => `${prefix}-${++n}`
  const timers = new Set()
  const sent = []
  let clock = NOW
  const hooks = createWebhooks({
    file: path.join(dir, 'webhooks.json'),
    model,
    store,
    offline,
    now: () => clock,
    newTopic: () => `${TOPIC}${++n}`,
    async fetch(url, init = {}) {
      sent.push({ url, body: init.body ? JSON.parse(init.body) : null })
      return respond(url, sent.length)
    },
    addSticky(text, source) {
      store.commit(client, runTool('add_sticky', { text, source }, { doc: store.load().doc, now: new Date(clock).toISOString(), makeId }).ops)
    },
    setTimer: (fn, ms) => { const timer = { fn, ms }; timers.add(timer); return timer },
    clearTimer: (timer) => timers.delete(timer),
  })
  await hooks.start()
  t.after(() => hooks.stop())
  const commit = (ops) => store.commit(client, ops)
  // Runs the timers that wait `ms`, then waits for what they started.
  const fire = async (ms) => {
    for (const timer of [...timers]) if (timer.ms === ms) { timers.delete(timer); timer.fn() }
    await hooks.settle()
    await new Promise((resolve) => setImmediate(resolve))
    await hooks.settle()
  }
  const saved = async () => JSON.parse(await fs.readFile(path.join(dir, 'webhooks.json'), 'utf8'))
  return { hooks, store, commit, sent, fire, timers, saved, dir, tick: (ms) => { clock += ms } }
}

const sticky = (id, text) => ({ t: 'add', c: 'notes', v: storeCore.migrate ? { id, title: text, markdown: text, createdAt: at(), updatedAt: at(), folderId: null, unsorted: true, source: 'Quick bar' } : null })

test('a sticky added goes to each address that wants it; the settings file is private', async (t) => {
  const { hooks, commit, sent, saved, dir } = await setup(t)
  await hooks.add({ url: 'https://hooks.zapier.com/catch/1', events: ['sticky.added'] })
  await hooks.add({ url: 'https://discord.com/api/webhooks/2', events: ['topic.added'] })
  commit([sticky('note-a', 'Buy milk')])
  await hooks.settle()
  assert.deepEqual(sent.map((item) => [item.url, item.body.content]), [['https://hooks.zapier.com/catch/1', 'New sticky: Buy milk']])
  const file = await saved()
  assert.equal(file.hooks[0].name, 'Zapier')
  assert.equal(file.hooks[0].last.ok, true)
  assert.match(hooks.status().hooks[0].last.at, /^2026-10-08/)
  if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(dir, 'webhooks.json'))).mode & 0o777, 0o600)
  await assert.rejects(hooks.add({ url: 'http://example.com/x', events: ['sticky.added'] }), /https/)
})

test('a 404 says so plainly; a 5xx is tried once more after 30 s, then given up calmly', async (t) => {
  let answers = [404]
  const { hooks, commit, sent, fire, timers } = await setup(t, { respond: () => { const status = answers.shift() ?? 200; return { ok: status < 300, status } } })
  await hooks.add({ url: 'https://hooks.zapier.com/catch/1', events: ['sticky.added'] })
  commit([sticky('note-a', 'One')])
  await hooks.settle()
  assert.equal(hooks.status().hooks[0].last.text, 'Zapier answered 404. Check the address.')
  assert.equal(timers.size, 0, 'a 4xx is not tried again')

  answers = [503, 200]
  commit([sticky('note-b', 'Two')])
  await hooks.settle()
  assert.match(hooks.status().hooks[0].last.text, /answered 503. OSAT tries again in 30 seconds/)
  await fire(30000)
  assert.equal(sent.length, 3)
  assert.equal(sent[2].body.content, 'New sticky: Two')
  assert.equal(hooks.status().hooks[0].last.ok, true)

  answers = [500, 502]
  commit([sticky('note-c', 'Three')])
  await hooks.settle()
  await fire(30000)
  assert.equal(sent.length, 5)
  assert.equal(hooks.status().hooks[0].last.text, 'Zapier answered 502, even after a second try, so that one wasn’t sent.')
  assert.equal(timers.size, 0)
})

test('offline, moments wait (up to 100) and go when back online; a test says it waits', async (t) => {
  let off = true
  const { hooks, commit, sent, fire } = await setup(t, { offline: () => off })
  await hooks.add({ url: 'https://hooks.slack.com/services/x', events: ['sticky.added'] })
  for (let i = 0; i < 102; i += 1) commit([sticky(`note-${i}`, `Sticky ${i}`)])
  await hooks.settle()
  assert.equal(sent.length, 0)
  assert.equal(hooks.status().hooks[0].waiting, 100)
  await assert.rejects(hooks.test(hooks.status().hooks[0].id), /waits until you’re back online/)
  off = false
  hooks.nudge()
  await fire(-1)
  assert.equal(sent.length, 100)
  assert.equal(sent[0].body.content, 'New sticky: Sticky 2', 'the oldest two made room')
  assert.equal(hooks.status().hooks[0].waiting, 0)
})

test('the journal goes out at most once a minute a day, with its newest line', async (t) => {
  const { hooks, commit, sent, fire } = await setup(t)
  await hooks.add({ url: 'https://hooks.zapier.com/catch/1', events: ['journal.written'] })
  const day = { id: 'day-2026-10-08', kind: 'day', date: '2026-10-08', title: 'Thursday', markdown: 'W', createdAt: at(), updatedAt: at() }
  commit([{ t: 'add', c: 'notes', v: day }])
  commit([{ t: 'patch', c: 'notes', id: day.id, v: { markdown: 'Watered' } }])
  commit([{ t: 'patch', c: 'notes', id: day.id, v: { markdown: 'Watered the beds' } }])
  await hooks.settle()
  assert.equal(sent.length, 0, 'nothing while the line is being written')
  await fire(60000)
  assert.deepEqual(sent.map((item) => item.body.journal), [{ date: '2026-10-08', line: 'Watered the beds' }])
  commit([{ t: 'patch', c: 'notes', id: day.id, v: { markdown: 'Watered the beds ' } }])
  await fire(60000)
  assert.equal(sent.length, 1, 'the same line isn’t sent twice')
})

test('Send a test answers how it went, even for an address switched off', async (t) => {
  const { hooks, sent } = await setup(t, { respond: () => ({ ok: false, status: 410 }) })
  await hooks.add({ url: 'https://discord.com/api/webhooks/2', events: ['sticky.added'] })
  const { id } = hooks.status().hooks[0]
  await hooks.change(id, { on: false })
  await assert.rejects(hooks.test(id), /Discord answered 410\. Check the address\./)
  assert.equal(sent[0].body.event, 'test')
  await hooks.remove(id)
  assert.deepEqual(hooks.status().hooks, [])
})

test('the inbox: turned on, it reads from now; each message becomes a sticky; where it got to is kept', async (t) => {
  const replies = []
  const { hooks, store, sent, fire, saved, tick } = await setup(t, { respond: () => ({ ok: true, status: 200, text: async () => replies.shift() || '' }) })
  const seconds = Math.floor(NOW / 1000)
  replies.push([
    JSON.stringify({ id: 'old1', time: seconds - 500, event: 'message', message: 'Sent before it was on' }),
    JSON.stringify({ id: 'msg1', time: seconds + 5, event: 'message', title: 'From the form', message: 'Call Sam back' }),
  ].join('\n'))
  await hooks.inboxOn()
  await fire(0)
  const { address } = hooks.status().inbox
  assert.match(address, /^https:\/\/ntfy\.sh\/T0pic_with-24-or-more-chars\d+$/)
  assert.equal(sent[0].url, `${address}/json?poll=1&since=${seconds}`)
  const added = store.load().doc.notes.filter((item) => item.source === 'Webhook')
  assert.deepEqual(added.map((item) => [item.markdown, item.unsorted, item.folderId]), [['From the form\nCall Sam back', true, null]])
  assert.equal((await saved()).inbox.since, 'msg1')

  // A minute later it reads again from the last message.
  tick(60000)
  replies.push(JSON.stringify({ id: 'msg2', time: seconds + 70, event: 'message', message: 'Buy milk' }))
  await fire(60000)
  assert.equal(sent[1].url, `${address}/json?poll=1&since=msg1`)
  assert.equal(store.load().doc.notes.filter((item) => item.source === 'Webhook').length, 2)
  assert.ok(hooks.status().inbox.lastAt)

  // Reset: a new address, and the old one is never read again.
  await hooks.inboxReset()
  await fire(0)
  const next = hooks.status().inbox.address
  assert.notEqual(next, address)
  assert.ok(sent.at(-1).url.startsWith(`${next}/json`))
  assert.equal((await saved()).inbox.topic, next.split('/').pop())

  await hooks.inboxOff()
  assert.equal(hooks.status().inbox.address, '')
})

test('a sticky a service sent is never sent back out', async (t) => {
  const { hooks, sent, fire } = await setup(t, { respond: (url) => (url.includes('ntfy.sh') ? { ok: true, status: 200, text: async () => JSON.stringify({ id: 'm1', time: Math.floor(NOW / 1000) + 1, event: 'message', message: 'From Zapier' }) } : { ok: true, status: 200 }) })
  await hooks.add({ url: 'https://hooks.zapier.com/catch/1', events: ['sticky.added'] })
  await hooks.inboxOn()
  await fire(0)
  assert.deepEqual(sent.map((item) => new URL(item.url).host), ['ntfy.sh'])
})

test('the inbox says calmly when the relay can’t be read, and waits offline', async (t) => {
  let off = false
  const { hooks, sent, fire } = await setup(t, { offline: () => off, respond: () => ({ ok: false, status: 502, text: async () => '' }) })
  await hooks.inboxOn()
  await fire(0)
  assert.match(hooks.status().inbox.error, /couldn’t check ntfy\.sh \(it answered 502\)\. It tries again in a minute/)
  off = true
  hooks.nudge()
  await fire(60000)
  assert.equal(sent.length, 1, 'nothing is read offline')
  await assert.rejects(hooks.inboxServer('http://ntfy.example.com'), /Use an https/)
  await hooks.inboxServer('https://ntfy.example.com/')
  assert.equal(hooks.status().inbox.host, 'ntfy.example.com')
})
