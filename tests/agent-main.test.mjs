import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as storeCore from '../shared/store-core.mjs'
import { runTool, ToolError } from '../shared/connector-tools.mjs'

const require = createRequire(import.meta.url)
const { createAgent } = require('../desktop/agent.cjs')
const { createStore } = require('../desktop/store/index.cjs')

let n = 0
const makeId = (prefix) => `${prefix}-${++n}`
const NOW = '2026-10-08T10:00:00.000Z'
const step = (name, args, why = 'Doing it') => JSON.stringify({ why, use: name, with: args })

/* desktop/agent.cjs as main wires it: a real store in a temp folder, a model that answers from a
   script (each tool turn from `turns`, then `final`), the apps Nate connected faked, and IPC
   handlers called directly with a stand-in window that collects what it is sent. */
async function agentOn({ turns = [], final = 'Done.', apps = [], offline = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-agent-'))
  const store = await createStore({ dir, core: storeCore, writeDelay: 0, maxDelay: 0 })
  const client = store.connect(() => {})
  const seed = (name, args) => {
    const result = runTool(name, args, { doc: store.load().doc, now: NOW, makeId })
    store.commit(client, result.ops)
  }
  seed('add_node', { title: 'Garden', branches: [{ title: 'Beds' }] })
  seed('add_sticky', { text: 'Buy seeds' })
  const t = { store, chats: [], sent: [], appCalls: [], handlers: {}, listeners: {} }
  const script = [...turns]
  const chat = async (payload, onDelta) => {
    t.chats.push(payload)
    if (payload.messages[0].content.includes('You can use tools')) return script.shift() || '{"done": true}'
    onDelta(final)
    return final
  }
  const bots = {
    askApps: {
      tools: async () => apps,
      call: async (app, name, args) => { t.appCalls.push([app, name, args]); return { text: `${name} done in ${app}.` } },
    },
  }
  const ipcMain = {
    handle: (channel, work) => { t.handlers[channel] = work },
    on: (channel, work) => { t.listeners[channel] = work },
  }
  t.agent = await createAgent({
    store,
    sharedModule: (name) => import(`../shared/${name}`),
    chat,
    bots,
    ipcMain,
    trust: () => {},
    findFiles: async () => [],
    models: async () => ({ models: [{ id: 'osat:balanced' }] }),
    offline: () => offline,
    now: () => NOW,
    makeId,
  })
  t.window = { sender: { id: 7, isDestroyed: () => false, send: (channel, message) => t.sent.push([channel, message]) } }
  t.ipc = (channel, ...args) => t.handlers[channel](t.window, ...args)
  t.run = (id, model = 'osat:balanced', question = 'Put the seeds sticky in Garden') => t.ipc('agent:run', id, { model, messages: [{ role: 'system', content: 'You are OSAT.' }, { role: 'user', content: question }] })
  t.doc = () => store.load().doc
  t.snapshot = () => JSON.parse(JSON.stringify({ notes: t.doc().notes, folders: t.doc().folders, calendar: t.doc().calendar }))
  t.until = async (test) => { for (let i = 0; i < 200 && !test(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5)) }
  return t
}

const CALENDAR = [
  { app: 'gcal', appName: 'Google Calendar', name: 'list_events', description: 'Lists events.', inputSchema: { type: 'object', properties: {} }, readOnly: true },
  { app: 'gcal', appName: 'Google Calendar', name: 'create_event', description: 'Adds an event.', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }, readOnly: false },
]

test('Ask moves a sticky, says so step by step, and one Undo puts everything back exactly', async () => {
  const t = await agentOn({
    turns: [
      step('add_branch', { node: 'Garden', title: 'To buy' }, 'Making a branch for things to buy'),
      step('move_sticky', { sticky: 'Buy seeds', node: 'Garden', branch: 'To buy' }, 'Filing Buy seeds'),
    ],
    final: 'I made “To buy” in Garden and moved “Buy seeds” there.',
  })
  const before = t.snapshot()
  const result = await t.run('agent-1')
  assert.equal(result.answer, 'I made “To buy” in Garden and moved “Buy seeds” there.')
  assert.deepEqual(result.steps.map((item) => [item.why, item.state, item.summary]), [
    ['Making a branch for things to buy', 'done', 'Added the branch “To buy” to Garden.'],
    ['Filing Buy seeds', 'done', 'Moved “Buy seeds” to Garden › To buy.'],
  ])
  const seeds = t.doc().notes.find((note) => note.markdown === 'Buy seeds')
  assert.equal(t.doc().folders.find((folder) => folder.id === seeds.folderId).name, 'To buy')
  // The window heard each step start and end, then the answer.
  assert.deepEqual(t.sent.map(([channel, message]) => [channel, message.type, message.state]), [
    ['agent:event:agent-1', 'step', 'running'], ['agent:event:agent-1', 'step', 'done'],
    ['agent:event:agent-1', 'step', 'running'], ['agent:event:agent-1', 'step', 'done'],
    ['agent:event:agent-1', 'delta', undefined],
  ])
  // The built-in model gets the grammar on its tool turns; the final answer is a plain chat.
  assert.ok(t.chats.slice(0, -1).every((payload) => payload.schema?.oneOf))
  assert.equal(t.chats.at(-1).schema, undefined)
  assert.match(t.chats.at(-1).messages.at(-1).content, /Moved “Buy seeds” to Garden › To buy\./)
  await t.ipc('agent:undo', result.undo)
  assert.deepEqual(t.snapshot(), before, 'Undo put back exactly what was there')
  await assert.rejects(t.ipc('agent:undo', result.undo), /can’t be undone any more/)
  // A run that only looked has nothing to undo.
  const looked = await agentOn({ turns: [step('search', { query: 'seeds' })] })
  assert.equal((await looked.run('agent-2')).undo, null)
})

test('another app’s change waits for Allow; Not now and Stop skip it; offline it waits; the apps are named', async () => {
  const t = await agentOn({ apps: CALENDAR, turns: [step('google_calendar.create_event', { title: 'Dentist' }, 'Adding the dentist')] })
  assert.deepEqual(await t.ipc('agent:apps'), ['Google Calendar'])
  const running = t.run('agent-3', 'cloud:deepseek:deepseek-chat')
  await t.until(() => t.sent.some(([, message]) => message.type === 'confirm'))
  const [, asking] = t.sent.find(([, message]) => message.type === 'confirm')
  assert.deepEqual(asking, { type: 'confirm', stepId: 'step-1', text: 'Ask wants to change something in Google Calendar: Adding the dentist. (title: Dentist)' })
  assert.equal(t.appCalls.length, 0, 'nothing happens in the app before Allow')
  assert.equal(await t.ipc('agent:confirm', 'agent-3', 'step-1', true), true)
  const result = await running
  assert.deepEqual(t.appCalls, [['gcal', 'create_event', { title: 'Dentist' }]])
  assert.deepEqual(result.steps.map((item) => [item.app, item.state]), [['Google Calendar', 'done']])
  assert.equal(result.undo, null, 'nothing changed in OSAT')
  assert.ok(t.chats.every((payload) => payload.schema === undefined), 'a cloud model never gets a grammar')
  assert.match(t.chats[0].messages[0].content, /- google_calendar\.create_event: In Google Calendar: Adds an event\./)
  assert.doesNotMatch(t.chats[0].messages[0].content, /- find_files:/, 'a cloud model is never offered the files on this Mac')

  const no = await agentOn({ apps: CALENDAR, turns: [step('google_calendar.create_event', { title: 'Gym' })] })
  const declined = no.run('agent-4')
  await no.until(() => no.sent.some(([, message]) => message.type === 'confirm'))
  await no.ipc('agent:confirm', 'agent-4', 'step-1', false)
  assert.deepEqual((await declined).steps.map((item) => item.state), ['skipped'])
  assert.equal(no.appCalls.length, 0)

  const stop = await agentOn({ apps: CALENDAR, turns: [step('google_calendar.create_event', { title: 'Run' })] })
  const stopped = stop.run('agent-5')
  await stop.until(() => stop.sent.some(([, message]) => message.type === 'confirm'))
  stop.listeners['agent:cancel'](stop.window, 'agent-5')
  const ended = await stopped
  assert.equal(stop.appCalls.length, 0)
  assert.equal(ended.answer, '', 'stopped: no answer is asked for')

  const away = await agentOn({ apps: CALENDAR, offline: true, turns: [step('google_calendar.list_events', {})] })
  const waited = await away.run('agent-6')
  assert.deepEqual(waited.steps.map((item) => [item.state, item.summary]), [['failed', 'Google Calendar waits until you’re back online.']])
  assert.equal(away.appCalls.length, 0)
})

test('the connector’s ask: only tools that look, no questions back, a short plain answer', async () => {
  const t = await agentOn({
    apps: CALENDAR,
    turns: [step('move_sticky', { sticky: 'Buy seeds', node: 'Garden' }), step('search', { query: 'seeds' })],
    final: `**Buy seeds** is in Unsorted. ${Array.from({ length: 200 }, () => 'more').join(' ')}`,
  })
  const before = t.snapshot()
  const { text } = await runTool('ask', { question: 'Where is my seeds sticky?' }, { ask: (question) => t.agent.answer(question) })
  assert.match(text, /^Buy seeds is in Unsorted\. more/)
  assert.equal(text.split(' ').length, 120)
  assert.deepEqual(t.snapshot(), before, 'nothing changed')
  const offered = t.chats[0].schema.oneOf.map((item) => item.properties.use?.const).filter(Boolean)
  assert.deepEqual(offered, ['list_nodes', 'read_node', 'search', 'read_journal', 'list_events', 'find_files', 'google_calendar.list_events'])
  assert.match(t.chats[0].messages[0].content, /^You are OSAT's AI, on Nate's Mac[\s\S]*Siri may read it aloud\./)
  assert.match(t.chats[1].messages.at(-1).content, /What move_sticky answered:\nThere is no tool called “move_sticky”/)
  assert.throws(() => runTool('ask', { question: 'Hi' }, {}), (error) => error instanceof ToolError && error.message === 'Asking works in the Mac app.')
  assert.throws(() => runTool('ask', { question: '  ' }, { ask: async () => ({ text: '' }) }), /Say what to ask\./)
  assert.equal((await runTool('ask', { question: 'Hi' }, { ask: async () => ({ text: '' }) })).text, 'OSAT’s AI had nothing to say to that.')
})
