import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as storeCore from '../shared/store-core.mjs'
import { runTool } from '../shared/connector-tools.mjs'
import {
  BRIEF_END, BRIEF_START, briefMessages, briefOps, cleanBrief, cleanSettings, dayBefore, due, localParts, macText, placeBrief, withoutBrief,
} from '../shared/brief-model.mjs'

const require = createRequire(import.meta.url)
const { createBrief } = require('../desktop/brief.cjs')
const { createAgent } = require('../desktop/agent.cjs')
const { createMacCalendar } = require('../desktop/mac-calendar.cjs')
const { createStore } = require('../desktop/store/index.cjs')

const ON = { on: true, time: '07:00' }

test('due: once a day, after the time, on the clock where Nate is', () => {
  const chicago = 'America/Chicago'
  // 12:30 UTC is 07:30 in Chicago, 21:30 in Tokyo and 01:30 the next morning in Auckland.
  const at = '2026-10-08T12:30:00Z'
  assert.equal(due(at, ON, '', chicago), true)
  assert.equal(due(at, ON, '2026-10-07', chicago), true)
  assert.equal(due(at, ON, '2026-10-08', chicago), false, 'written today')
  assert.equal(due(at, { ...ON, on: false }, '', chicago), false, 'off until turned on')
  assert.equal(due(at, { ...ON, time: '08:00' }, '', chicago), false, 'not yet time')
  assert.equal(due('2026-10-08T04:59:00Z', ON, '2026-10-07', chicago), false, 'still 23:59 the night before')
  assert.equal(due(at, ON, '2026-10-08', 'Asia/Tokyo'), false)
  assert.equal(due(at, ON, '2026-10-08', 'Pacific/Auckland'), false, 'Auckland is on the 9th, but before 7:00')
  assert.equal(due('2026-10-08T19:00:00Z', ON, '2026-10-08', 'Pacific/Auckland'), true, '08:00 on the 9th in Auckland')
  // Flying west after this morning's brief: it is the 8th again, and no second one comes.
  assert.equal(due('2026-10-08T20:00:00Z', ON, '2026-10-09', 'America/Los_Angeles'), false)
  // Midnight is 00:00, never 24:00; the day turns over on the local clock.
  assert.deepEqual(localParts('2026-10-09T05:00:00Z', chicago), { day: '2026-10-09', time: '00:00' })
  assert.equal(dayBefore('2026-03-01'), '2026-02-28')
  assert.deepEqual(cleanSettings({ on: 'yes', time: '25:00' }), { on: false, time: '07:00' })
})

test('the brief goes on top; writing it again replaces only its block and keeps the rest exactly', () => {
  assert.equal(placeBrief('', 'Hello.'), `${BRIEF_START}\nHello.\n${BRIEF_END}`)
  const page = 'Slept well.\n\n- [ ] call Mum'
  const first = placeBrief(page, 'A quiet day.')
  assert.equal(first, `${BRIEF_START}\nA quiet day.\n${BRIEF_END}\n\n${page}`)
  // Nate wrote above it and below it since: only the block changes.
  const edited = `Up early.\n${first}\nMore later.`
  assert.equal(placeBrief(edited, 'Two things today.'), `Up early.\n${BRIEF_START}\nTwo things today.\n${BRIEF_END}\n\n${page}\nMore later.`)
  // Words that look like replacement patterns stay words.
  assert.match(placeBrief(first, 'Costs $1 and $& today.'), /Costs \$1 and \$& today\./)
  assert.equal(withoutBrief(first), page)
  assert.equal(placeBrief(first, 'Again.').split(BRIEF_START).length, 2, 'never two blocks')
})

test('cleanBrief keeps the words and drops a title, headings, the marker and older names', () => {
  const text = cleanBrief(`**Morning brief**\n## Today\nYou have the dentist at 9. Two stickies wait, one about the Garden node.\n${BRIEF_END}\n\n\n\nGo gently.`)
  assert.equal(text, 'Today\nYou have the dentist at 9. Two stickies wait, one about the Garden topic.\n\nGo gently.')
  const long = cleanBrief(Array.from({ length: 400 }, () => 'word').join(' '))
  assert.ok(long.split(' ').length <= 190 && long.endsWith('…'))
  assert.equal(cleanBrief(''), '')
})

test('the question carries what OSAT knows, asks for the four parts, and leaves out what is empty', () => {
  const doc = {
    notes: [
      { id: 'n1', title: 'Buy seeds', markdown: 'Buy seeds', updatedAt: '2026-10-06T10:00:00Z' },
      { id: 'n2', title: 'Fix the gate', markdown: 'Fix the gate', folderId: 'f1', updatedAt: '2026-10-07T15:00:00Z' },
      { id: 'n3', title: 'Old', markdown: 'Old', trashedAt: '2026-10-01', updatedAt: '2026-10-07T15:00:00Z' },
      { id: 'day-2026-10-07', kind: 'day', markdown: 'x', updatedAt: '2026-10-07T15:00:00Z' },
    ],
  }
  const journal = `# Journal, 2026-10-07\n\n${placeBrief('Planted the beds.', 'Yesterday’s brief.')}`
  const [system, user] = briefMessages({ day: '2026-10-08', doc, timeZone: 'America/Chicago', known: { events: '1 event from 2026-10-08 to 2026-10-08:\n- 09:00: Dentist', mac: '', journal, topics: '1 node in OSAT:\n- Garden: 1 sticky' } })
  assert.match(system.content, /Thursday, October 8, 2026/)
  assert.match(user.content, /what’s on today .*what waits in Unsorted.*what I was working on yesterday.*one gentle suggestion/s)
  assert.match(user.content, /At most 150 words/)
  assert.match(user.content, /\[Today on OSAT’s calendar\]\n1 event[^]*Dentist/)
  assert.match(user.content, /\[Waiting in Unsorted\]\n1 sticky, the newest: “Buy seeds”/)
  assert.match(user.content, /\[Stickies Nate changed yesterday\]\n“Fix the gate”/)
  assert.match(user.content, /Planted the beds\./)
  assert.doesNotMatch(user.content, /Yesterday’s brief|Old/)
  assert.match(user.content, /1 topic in OSAT/)
  assert.doesNotMatch(user.content, /Mac’s Calendar/, 'nothing from the Mac, so no section')
})

test('the Mac’s own events and reminders, in lines', () => {
  const text = macText({
    events: [{ title: 'Dentist', start: '2026-10-08T14:00:00Z', end: '2026-10-08T15:00:00Z' }, { title: 'Holiday', allDay: true, start: '2026-10-08T05:00:00Z', end: '2026-10-09T05:00:00Z' }],
    reminders: [{ title: 'Pay rent', due: '2026-10-05' }, { title: 'Water plants', due: '2026-10-08', time: '18:00' }],
  }, '2026-10-08', 'America/Chicago')
  assert.equal(text, '- 09:00–10:00: Dentist\n- all day: Holiday\n- Reminder: Pay rent (due 2026-10-05)\n- Reminder: Water plants (today at 18:00)')
})

test('briefOps makes today’s page the journal’s way, or changes only its words', () => {
  const now = '2026-10-08T12:00:00.000Z'
  const [add] = briefOps({ notes: [] }, 'Hi.', { day: '2026-10-08', now })
  assert.equal(add.t, 'add')
  assert.equal(add.at, 0)
  assert.equal(add.v.id, 'day-2026-10-08')
  assert.equal(add.v.kind, 'day')
  assert.equal(add.v.date, '2026-10-08')
  assert.equal(add.v.title, 'Thursday, October 8')
  assert.equal(add.v.markdown, placeBrief('', 'Hi.'))
  const [patch] = briefOps({ notes: [{ ...add.v, markdown: 'Mine. #garden', trashedAt: now }] }, 'Hi.', { day: '2026-10-08', now })
  assert.equal(patch.t, 'patch')
  assert.equal(patch.v.markdown, placeBrief('Mine. #garden', 'Hi.'))
  assert.deepEqual(patch.v.tags, ['garden'])
  assert.equal(patch.v.trashedAt, null)
})

test('the Mac’s calendar is read for the brief only where OSAT may already look, and never asks', async () => {
  const runs = []
  const fake = (status, platform = 'darwin') => createMacCalendar({
    handle: () => {},
    fail: (message) => { throw new Error(message) },
    platform,
    run: async (command) => {
      runs.push(command)
      if (command === 'status') return JSON.stringify(status)
      if (command === 'events') return JSON.stringify([{ title: 'Dentist', start: '2026-10-08T14:00:00Z', end: '2026-10-08T15:00:00Z' }])
      return JSON.stringify([{ title: 'Late', due: '2026-10-01' }, { title: 'Today', due: '2026-10-08' }, { title: 'Later', due: '2026-10-20' }, { title: 'Someday', due: '' }])
    },
  })
  const range = { from: '2026-10-08T05:00:00Z', to: '2026-10-09T05:00:00Z', day: '2026-10-08' }
  const both = await fake({ events: 'allowed', reminders: 'allowed' }).today(range)
  assert.deepEqual(both.events.map((event) => event.title), ['Dentist'])
  assert.deepEqual(both.reminders.map((item) => item.title), ['Late', 'Today'])
  runs.length = 0
  const eventsOnly = await fake({ events: 'allowed', reminders: 'notAsked' }).today(range)
  assert.deepEqual(eventsOnly.reminders, [])
  assert.deepEqual(runs, ['status', 'events'], 'reminders were never read, and nothing asked')
  runs.length = 0
  assert.deepEqual(await fake({}, 'linux').today(range), { events: [], reminders: [] })
  assert.deepEqual(runs, [])
})

/* desktop/brief.cjs as main wires it: a real store in a temp folder, a fake agent (or Ask's real one, with a
   scripted model) and IPC handlers called directly. The clock is this Mac's, set to a morning. */
const tempStore = async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-brief-'))
  return { dataDir, store: await createStore({ dir: path.join(dataDir, 'store'), core: storeCore, writeDelay: 0, maxDelay: 0 }) }
}

async function briefOn({ agent, models = [{ id: 'osat:balanced' }], at = new Date(2026, 9, 8, 7, 30), offline = false, mac, made } = {}) {
  const { dataDir, store } = made || await tempStore()
  const t = { store, dataDir, handlers: {}, acts: [], clock: at, answer: 'You have the dentist at 9. Go gently.' }
  t.agent = agent || {
    act: async (options) => { t.acts.push(options); return { answer: t.answer, steps: [], undo: null } },
  }
  t.brief = await createBrief({
    store,
    sharedModule: (name) => import(`../shared/${name}`),
    agent: t.agent,
    dataDir,
    models: async () => ({ models }),
    handle: (channel, work) => { t.handlers[channel] = work },
    fail: (message) => { throw new Error(message) },
    offline: () => offline,
    macToday: mac,
    now: () => t.clock,
  })
  t.ipc = (channel, ...args) => t.handlers[channel](...args)
  t.page = () => store.load().doc.notes.find((note) => note.id === 'day-2026-10-08')
  t.saved = async () => JSON.parse(await fs.readFile(path.join(dataDir, 'brief.json'), 'utf8'))
  return t
}

test('off until turned on; then once a day after its time, at the top of today’s page, and the desk is told once', async () => {
  const t = await briefOn()
  assert.equal(await t.brief.check(), null)
  assert.equal(t.acts.length, 0, 'off: nothing runs')
  t.clock = new Date(2026, 9, 8, 6, 30)
  await t.ipc('brief:set', { on: true })
  assert.equal(await t.brief.check(), null, 'before 7:00')
  t.clock = new Date(2026, 9, 8, 7, 30)
  assert.deepEqual(await t.brief.check(), { written: true, day: '2026-10-08' })
  assert.equal(t.page().markdown, `${BRIEF_START}\n${t.answer}\n${BRIEF_END}`)
  assert.equal(t.page().kind, 'day')
  assert.equal(t.acts[0].readOnly, true)
  assert.deepEqual(await t.saved(), { on: true, time: '07:00', last: '2026-10-08', unseen: true })
  assert.equal(await t.brief.check(), null, 'once a day')
  assert.equal(t.acts.length, 1)
  const status = await t.ipc('brief:status')
  assert.equal(status.unseen, true)
  assert.equal(status.ai, true)
  await t.ipc('brief:seen')
  assert.equal((await t.ipc('brief:status')).unseen, false)
  // The next morning, again.
  t.clock = new Date(2026, 9, 9, 7, 1)
  assert.equal((await t.brief.check())?.written, true)
})

test('Write it now replaces only the brief, keeps what Nate wrote, and Undo puts the page back', async () => {
  const t = await briefOn()
  await t.ipc('brief:write')
  const client = t.store.connect(() => {})
  const mine = `${t.page().markdown}\n\nFeeling good about today.`
  t.store.commit(client, [{ t: 'patch', c: 'notes', id: 'day-2026-10-08', v: { markdown: mine } }])
  t.answer = 'A new plan.'
  const status = await t.ipc('brief:write')
  assert.equal(status.unseen, false, 'Nate asked for it: no line on the desk')
  assert.equal(t.page().markdown, `${BRIEF_START}\nA new plan.\n${BRIEF_END}\n\nFeeling good about today.`)
  await t.ipc('brief:undo')
  assert.equal(t.page().markdown, mine)
  await assert.rejects(t.ipc('brief:undo'), /can’t be undone/)
})

test('with no AI set up nothing happens, and an answer that fails writes nothing', async () => {
  const t = await briefOn({ models: [] })
  await t.ipc('brief:set', { on: true })
  assert.match((await t.brief.check()).error, /needs OSAT’s AI/)
  assert.equal(t.acts.length, 0)
  assert.equal((await t.ipc('brief:status')).ai, false)
  await assert.rejects(t.ipc('brief:write'), /needs OSAT’s AI/)
  assert.equal(t.page(), undefined)

  const failing = await briefOn({ agent: { act: async () => ({ answer: '', steps: [], undo: null, error: 'The AI could not answer.' }) } })
  await assert.rejects(failing.ipc('brief:write'), /couldn’t be written/)
  assert.equal(failing.page(), undefined)
  assert.equal((await failing.ipc('brief:status')).last, '')
})

test('the brief runs Ask’s agent with looking tools only: no files, no other apps offline, and the Mac’s calendar up front', async () => {
  const chats = []
  const appCalls = []
  const ask = async (payload, onDelta) => {
    chats.push(payload)
    if (payload.messages[0].content.includes('You can use tools')) return chats.length === 1 ? JSON.stringify({ why: 'Looking at Garden', use: 'read_node', with: { node: 'Garden' } }) : '{"done": true}'
    onDelta('A calm day: the dentist at 9.')
    return 'A calm day: the dentist at 9.'
  }
  const apps = [
    { app: 'mail', appName: 'Mail', name: 'list_mail', description: 'Lists mail.', inputSchema: { type: 'object', properties: {} }, readOnly: true },
    { app: 'mail', appName: 'Mail', name: 'send_mail', description: 'Sends mail.', inputSchema: { type: 'object', properties: {} }, readOnly: false },
  ]
  for (const offline of [false, true]) {
    chats.length = 0
    const made = await tempStore()
    const { store } = made
    const seeded = runTool('add_node', { title: 'Garden' }, { doc: store.load().doc, now: new Date(2026, 9, 7).toISOString(), makeId: (prefix) => `${prefix}-1` })
    store.commit(store.connect(() => {}), seeded.ops)
    const agent = await createAgent({
      store, sharedModule: (name) => import(`../shared/${name}`), chat: ask, ipcMain: { handle: () => {}, on: () => {} }, trust: () => {},
      bots: { askApps: { tools: async () => apps, call: async (...call) => { appCalls.push(call); return { text: 'ok' } } } },
      findFiles: async () => [], models: async () => ({ models: [{ id: 'osat:balanced' }] }), offline: () => offline,
    })
    const macDays = []
    const t = await briefOn({ agent, offline, made, mac: async (range) => { macDays.push(range.day); return { events: [{ title: 'Dentist', start: new Date(2026, 9, 8, 9).toISOString(), end: new Date(2026, 9, 8, 10).toISOString() }], reminders: [] } } })
    await t.ipc('brief:write')
    const toolsPrompt = chats[0].messages[0].content
    assert.match(toolsPrompt, /- read_node:/)
    assert.match(toolsPrompt, /- search:/)
    assert.doesNotMatch(toolsPrompt, /- (find_files|add_sticky|move_sticky|add_to_journal|mail\.send_mail):/)
    if (offline) assert.doesNotMatch(toolsPrompt, /mail\.list_mail/)
    else assert.match(toolsPrompt, /- mail\.list_mail:/)
    assert.match(chats[0].messages[1].content, /\[Today on the Mac’s Calendar and Reminders\]\n- 09:00–10:00: Dentist/)
    assert.deepEqual(macDays, ['2026-10-08'])
    assert.equal(t.page().markdown, `${BRIEF_START}\nA calm day: the dentist at 9.\n${BRIEF_END}`)
  }
  assert.deepEqual(appCalls, [])
})
