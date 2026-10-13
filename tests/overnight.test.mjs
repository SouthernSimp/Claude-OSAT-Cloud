import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as storeCore from '../shared/store-core.mjs'

import {
  candidatePairs, dismissKey, ideaWords, due, liveIdeas, linkIdea, nightOf, pairId, pairMessages, readPairAnswer, readTopicAnswer, recentStickies, topicIdea, topicMessages, wordsOf,
} from '../shared/overnight-model.mjs'

const NOW = '2026-10-13T08:00:00Z'
const OLD = '2026-08-01T12:00:00Z'
const NEW = '2026-10-12T12:00:00Z'
const chicago = 'America/Chicago'

const note = (id, markdown, folderId, at = NEW, extra = {}) => ({ id, title: markdown.split('\n')[0], markdown, folderId, createdAt: at, updatedAt: at, ...extra })
const folder = (id, name, parentId = null, extra = {}) => ({ id, name, parentId, createdAt: OLD, ...extra })

function sample() {
  return {
    folders: [folder('work', 'Work'), folder('home', 'Home'), folder('fortis', 'Fortis Pay'), folder('trip', 'Japan trip')],
    notes: [
      note('n1', 'Send the Fortis merchant dashboard mockup to Dana', 'work'),
      note('n2', 'Dana liked the merchant dashboard colours', 'home', OLD),
      note('n3', 'Buy oat milk and eggs', 'home', OLD),
      note('n4', 'Kyoto ryokan booking for the Japan trip', 'work'),
      note('n5', 'Merchant dashboard: add refunds tab', 'work', OLD),
      ...Array.from({ length: 30 }, (_, i) => note(`f${i}`, `Filler sticky number ${i} about groceries ${i % 3 ? 'cleaning' : 'laundry'}`, 'home', OLD)),
    ],
  }
}

test('due: once a night, after 1:00, on the charger, or when the Mac sits idle', () => {
  // 07:00 UTC is 02:00 in Chicago.
  const night = '2026-10-13T07:00:00Z'
  assert.equal(nightOf(night, chicago), '2026-10-13')
  assert.equal(nightOf('2026-10-13T05:30:00Z', chicago), '2026-10-12', '00:30 still belongs to the night before')
  assert.equal(due({ now: night, settings: {}, last: '', timeZone: chicago }), true, 'on unless turned off')
  assert.equal(due({ now: night, settings: {}, last: '2026-10-13', timeZone: chicago }), false, 'done this night')
  assert.equal(due({ now: night, settings: { on: false }, last: '', timeZone: chicago }), false)
  assert.equal(due({ now: night, settings: {}, last: '', onBattery: true, timeZone: chicago }), false, 'never on battery')
  const afternoon = '2026-10-13T20:00:00Z'
  assert.equal(due({ now: afternoon, settings: {}, last: '2026-10-12', timeZone: chicago }), false, 'in the day only when idle')
  assert.equal(due({ now: afternoon, settings: {}, last: '2026-10-12', idleSeconds: 1500, timeZone: chicago }), true)
})

test('wordsOf keeps the words that say what a sticky is about', () => {
  assert.deepEqual([...wordsOf('Send the dashboards to https://x.com/abc about 2026 plans')].sort(), ['dashboard', 'plan', 'send'])
  assert.deepEqual([...wordsOf('Fortis')], [...wordsOf('fortis')], 'a plural is folded the same way on both sides')
})

test('candidatePairs: new things that share rare words, never ones already together', () => {
  const doc = sample()
  const pairs = candidatePairs(doc, { now: NOW })
  const ids = pairs.map((pair) => pair.id)
  assert.ok(ids.includes(pairId('note:n1', 'note:n2')), 'Dana and the merchant dashboard, in two places')
  assert.ok(ids.includes(pairId('note:n1', 'folder:fortis')), 'a sticky names a whole topic')
  assert.ok(ids.includes(pairId('note:n4', 'folder:trip')))
  assert.ok(!ids.includes(pairId('note:n1', 'note:n5')), 'side by side in Work already')
  assert.ok(!ids.some((id) => id.includes('note:n3')), 'nothing shared')
  assert.ok(!ids.some((id) => id.includes('note:f') && id.includes('|note:f')), 'two old stickies are never asked about')

  const connected = { ...doc, notes: doc.notes.map((item) => (item.id === 'n1' ? { ...item, links: ['note:n2'] } : item)) }
  assert.ok(!candidatePairs(connected, { now: NOW }).some((pair) => pair.id === pairId('note:n1', 'note:n2')), 'already connected')
  assert.ok(!candidatePairs(doc, { now: NOW, dismissed: [pairId('note:n1', 'note:n2')] }).some((pair) => pair.id === pairId('note:n1', 'note:n2')), 'waved away before')

  const nested = { folders: [folder('a', 'Garden plans'), folder('b', 'Garden plans spring', 'a')], notes: [note('x', 'Garden plans for spring beds', 'b')] }
  assert.deepEqual(candidatePairs(nested, { now: NOW }), [], 'a sticky and the topic it lives in are together')
})

test('pair answers: only yeses, numbered in range, with a short why', () => {
  const doc = sample()
  const pairs = candidatePairs(doc, { now: NOW })
  const [, ask] = pairMessages(doc, pairs)
  assert.match(ask.content, /\d\. “Send the Fortis merchant dashboard mockup to Dana” \(a sticky in Work\) and “Fortis Pay” \(a topic\)/)
  const answer = readPairAnswer('Sure!\n1: yes: both are about the merchant dashboard\n2: no\n3. YES — the Japan trip.\n9: yes: out of range\n1: yes: again', 3)
  assert.deepEqual([...answer], [[1, 'both are about the merchant dashboard'], [3, 'the Japan trip']])
  assert.equal(readPairAnswer('2: yes', 3).get(2), 'These look like the same subject.')
})

test('topic answers: three stickies or more in different homes, a name no topic has', () => {
  const doc = {
    folders: [folder('work', 'Work'), folder('home', 'Home')],
    notes: [
      note('a', 'Call the Hendrix plumber', 'work'), note('b', 'Hendrix plumber quote is $400', 'home'),
      note('c', 'Pick a Hendrix plumber date', null, NEW, { unsorted: true }), note('d', 'Work standup', 'work'), note('e', 'Old thing', 'work', OLD),
    ],
  }
  const stickies = recentStickies(doc, new Date(NOW))
  assert.equal(stickies.length, 4, 'this week only')
  assert.match(topicMessages(doc, stickies)[1].content, /Work, Home/)
  const n = (id) => stickies.findIndex((item) => item.id === id) + 1
  const text = `**Hendrix plumber**: ${n('a')}, ${n('b')}, ${n('c')}\nWork: 1, 2, 3\nTwo only: ${n('a')}, ${n('b')}\nnone`
  assert.deepEqual(readTopicAnswer(text, doc, stickies), [{ name: 'Hendrix plumber', notes: ['a', 'b', 'c'] }])
  assert.deepEqual(readTopicAnswer(text, doc, stickies, { dismissed: ['topic:hendrix plumber'] }), [], 'waved away before')
  const oneHome = { ...doc, notes: doc.notes.map((item) => ({ ...item, folderId: 'work', unsorted: false })) }
  assert.deepEqual(readTopicAnswer(text, oneHome, recentStickies(oneHome, new Date(NOW))), [], 'already together in one topic')
})

test('liveIdeas drops ideas that no longer fit', () => {
  const doc = sample()
  const link = linkIdea({ id: pairId('note:n1', 'note:n2'), a: 'note:n1', b: 'note:n2' }, 'why')
  const topic = topicIdea({ name: 'Dashboards', notes: ['n1', 'n2', 'n5'] })
  assert.equal(liveIdeas(doc, [link, topic]).length, 2)
  const binned = { ...doc, notes: doc.notes.map((item) => (item.id === 'n2' ? { ...item, trashedAt: NOW } : item)) }
  assert.deepEqual(liveIdeas(binned, [link]), [], 'an end in the Bin')
  const linked = { ...doc, folders: doc.folders, notes: doc.notes.map((item) => (item.id === 'n2' ? { ...item, links: ['note:n1'] } : item)) }
  assert.deepEqual(liveIdeas(linked, [link]), [], 'connected since')
  const named = { ...doc, folders: [...doc.folders, folder('d', 'dashboards')] }
  assert.deepEqual(liveIdeas(named, [topic]), [], 'a topic of that name exists now')
  assert.equal(dismissKey(link), pairId('note:n1', 'note:n2'))
  assert.equal(dismissKey(topic), 'topic:dashboards')
})

/* desktop/overnight.cjs as main wires it: a real store in a temp folder, a scripted model, IPC called directly. */
const require = createRequire(import.meta.url)
const { createOvernight } = require('../desktop/overnight.cjs')
const { createStore } = require('../desktop/store/index.cjs')

async function overnightOn({ models = [{ id: 'osat:balanced' }], answers = [], clock = new Date(NOW), battery = false, idle = 0 } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-overnight-'))
  const store = await createStore({ dir: path.join(dataDir, 'store'), core: storeCore, writeDelay: 0, maxDelay: 0 })
  const doc = sample()
  store.commit(store.connect(() => {}), [...doc.folders.map((v) => ({ t: 'add', c: 'folders', v })), ...doc.notes.map((v) => ({ t: 'add', c: 'notes', v }))])
  const t = { store, dataDir, handlers: {}, asked: [], sent: [], clock, battery, idle }
  t.night = await createOvernight({
    store,
    sharedModule: (name) => import(`../shared/${name}`),
    dataDir,
    models: async () => ({ models }),
    chat: async (payload) => { t.asked.push(payload); return answers.shift() || 'none' },
    handle: (channel, work) => { t.handlers[channel] = work },
    fail: (message) => { throw new Error(message) },
    send: (channel, value) => t.sent.push([channel, value]),
    onBattery: () => t.battery,
    idleSeconds: () => t.idle,
    now: () => t.clock,
    timeZone: 'America/Chicago',
  })
  t.ipc = (channel, ...args) => t.handlers[channel](...args)
  return t
}

test('the runner: only a model on this Mac, ideas saved, kept and waved away', async () => {
  const cloudOnly = await overnightOn({ models: [{ id: 'cloud:openai:gpt' }] })
  assert.equal((await cloudOnly.ipc('overnight:status')).ai, false, 'a cloud model never reads everything')
  await assert.rejects(cloudOnly.ipc('overnight:think'), /an AI on this Mac/)
  assert.deepEqual(cloudOnly.asked, [])

  const t = await overnightOn({ models: [{ id: 'cloud:openai:gpt' }, { id: 'osat:balanced' }], answers: ['1: yes: both are the Japan trip\n2: yes: Dana and the merchant dashboard\n3: no'] })
  const status = await t.ipc('overnight:think')
  assert.equal(t.asked[0].model, 'osat:balanced')
  assert.equal(t.asked[0].background, true, 'never wakes or swaps a model for it')
  assert.equal(status.ideas.length, 2)
  assert.equal(status.unseen, true)
  assert.equal(status.last, '2026-10-13')
  assert.equal(t.sent.at(-1)[0], 'overnight:changed')
  assert.equal(t.store.load().doc.notes.find((item) => item.id === 'n1').links, undefined, 'nothing changed by itself')

  const [first, second] = status.ideas
  await t.ipc('overnight:done', second.id, true)
  const after = await t.ipc('overnight:done', first.id, false)
  assert.deepEqual(after.ideas, [])
  const saved = JSON.parse(await fs.readFile(path.join(t.dataDir, 'overnight.json'), 'utf8'))
  assert.deepEqual(saved.dismissed, [dismissKey(second)], 'only the waved-away one is remembered')
})

test('the runner thinks once a night, on the charger', async () => {
  // 07:30 UTC is 02:30 in Chicago.
  const t = await overnightOn({ clock: new Date('2026-10-13T07:30:00Z'), battery: true })
  assert.equal(await t.night.check(), null, 'not on battery')
  t.battery = false
  assert.ok((await t.night.check()).ideas)
  const asked = t.asked.length
  assert.equal(await t.night.check(), null, 'once a night')
  assert.equal(t.asked.length, asked)
  await t.ipc('overnight:set', { on: false })
  t.clock = new Date('2026-10-14T07:30:00Z')
  assert.equal(await t.night.check(), null, 'off')
})

test('the morning brief hears about last night’s ideas in a line', async () => {
  const doc = sample()
  const link = linkIdea({ id: pairId('note:n1', 'note:n2'), a: 'note:n1', b: 'note:n2' }, 'why')
  const topic = topicIdea({ name: 'Dashboards', notes: ['n1', 'n2', 'n5'] })
  assert.equal(ideaWords(doc, []), '')
  assert.equal(ideaWords(doc, [link, topic]), '2 ideas: connect “Send the Fortis merchant dashboard mockup to Dana” and “Dana liked the merchant dashboard colours”; make Dashboards a topic')
  const { briefMessages } = await import('../shared/brief-model.mjs')
  const [, user] = briefMessages({ day: '2026-10-13', doc, known: { ideas: ideaWords(doc, [topic]) } })
  assert.match(user.content, /\[Ideas OSAT left on the canvas last night\]\n1 idea: make Dashboards a topic/)
  const [, none] = briefMessages({ day: '2026-10-13', doc, known: { ideas: '' } })
  assert.doesNotMatch(none.content, /\[Ideas OSAT left/, 'no section when there are none')
})
