import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as providers from '../shared/providers.mjs'

const require = createRequire(import.meta.url)
const { createKeychain } = require('../desktop/bots/keychain.cjs')
const { keychainFor } = require('../desktop/bots/index.cjs')
const { createCloud, readFrame } = require('../desktop/bots/cloud.cjs')
const { createSettings } = require('../desktop/bots/settings.cjs')

const KEY = 'sk-0123456789abcdef0123456789abcdef'

test('keychain off the Mac: held in memory only, and it says so', async () => {
  const chain = createKeychain({ platform: 'linux' })
  assert.equal(chain.lasting, false)
  await chain.set('cloud-model-deepseek', KEY)
  assert.equal(await chain.get('cloud-model-deepseek'), KEY)
  await chain.remove('cloud-model-deepseek')
  assert.equal(await chain.get('cloud-model-deepseek'), null)
})

test('OSAT_KEYCHAIN=memory holds keys in memory from source, and is ignored in the packaged app', () => {
  const lasting = (service, env) => keychainFor({ service, env, platform: 'darwin' }).lasting
  assert.equal(lasting('OSAT-Dev', { OSAT_KEYCHAIN: 'memory' }), false)
  assert.equal(lasting('OSAT-Dev', {}), true, 'from source the real Keychain is still the default')
  assert.equal(lasting('OSAT', { OSAT_KEYCHAIN: 'memory' }), true, 'the packaged app never takes the switch')
})

test('keychain on the Mac: the key goes in on security’s input, never on a command line', async () => {
  const stored = new Map()
  const calls = []
  const spawn = (file, args) => {
    const child = new EventEmitter()
    child.stdin = { end: (input) => {
      calls.push({ file, args, input })
      const match = /-a (\S+) .*-w (\S+)\n$/.exec(input)
      if (match) stored.set(match[1], match[2])
      setImmediate(() => child.emit('close', 0))
    } }
    child.kill = () => {}
    return child
  }
  const run = async (file, args) => {
    calls.push({ file, args })
    const account = args[args.indexOf('-a') + 1]
    if (args[0] === 'find-generic-password') return stored.has(account) ? { code: 0, stdout: `${stored.get(account)}\n` } : { code: 44, stdout: '' }
    if (args[0] === 'delete-generic-password') stored.delete(account)
    return { code: 0, stdout: '' }
  }
  const chain = createKeychain({ platform: 'darwin', service: 'OSAT-Test', run, spawn })
  assert.equal(chain.lasting, true)
  await chain.set('cloud-model-deepseek', KEY)
  const write = calls.find((call) => call.input)
  assert.deepEqual([write.file, write.args], ['/usr/bin/security', ['-i']], 'nothing but -i on the command line')
  assert.match(write.input, /^add-generic-password -U -s OSAT-Test -a cloud-model-deepseek /)
  assert.ok(calls.every((call) => !(call.args || []).join(' ').includes(KEY)), 'the key is in no command line')
  assert.equal(await chain.get('cloud-model-deepseek'), KEY)
  await chain.remove('cloud-model-deepseek')
  assert.equal(await chain.get('cloud-model-deepseek'), null)
  await assert.rejects(chain.set('cloud-model-deepseek', 'has space'), /doesn’t look like an API key/)
  await assert.rejects(chain.get('../../etc'), /isn’t a provider/)
  // The Keychain said no (locked): reading back shows it, and says how to fix it.
  const locked = createKeychain({ platform: 'darwin', run: async () => ({ code: 44, stdout: '' }), spawn })
  await assert.rejects(locked.set('cloud-model-deepseek', KEY), /Unlock your Mac’s Keychain/)
})

/* A pretend OpenAI-style provider: its model list, and streamed answers. */
function fakeProvider({ key = KEY, models = ['deepseek-chat', 'deepseek-reasoner'], reply = ['Hel', 'lo'], usage = { prompt_tokens: 12, completion_tokens: 3 }, noStreamOptions = false } = {}) {
  const seen = []
  const fetch = async (url, init = {}) => {
    seen.push({ url, init })
    if (init.headers?.authorization !== `Bearer ${key}`) return new Response('{"error":{"message":"Authentication Fails"}}', { status: 401 })
    if (url.endsWith('/models')) return Response.json({ data: models.map((id) => ({ id })) })
    const body = JSON.parse(init.body)
    if (noStreamOptions && body.stream_options) return new Response('{"error":"unknown field stream_options"}', { status: 400 })
    if (!models.includes(body.model)) return new Response('{"error":{"message":"Model Not Exist"}}', { status: 400 })
    const frames = [...reply.map((text) => ({ choices: [{ delta: { content: text } }] })), { choices: [{ delta: { reasoning_content: 'hmm' } }] }, ...(body.stream_options ? [{ choices: [], usage }] : [])]
    const text = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`
    return new Response(new Blob([text]).stream(), { headers: { 'content-type': 'text/event-stream' } })
  }
  return { fetch, seen }
}

function memorySettings() {
  let current = providers.cleanBotSettings({})
  return { get: () => current, save: async (patch) => { current = providers.cleanBotSettings({ ...current, ...patch }) } }
}

function setUp(options = {}) {
  const provider = fakeProvider(options)
  const settings = memorySettings()
  const keychain = createKeychain({ platform: 'linux' })
  let offline = false
  const cloud = createCloud({ core: providers, settings, keychain, fetch: provider.fetch, offline: () => offline, now: () => new Date('2026-09-29T10:00:00Z') })
  return { cloud, settings, keychain, provider, goOffline: (value = true) => { offline = value } }
}

test('connect: paste a key → OSAT checks it, keeps it in the Keychain, and the model answers', async () => {
  const { cloud, settings, keychain } = setUp()
  const made = await cloud.connect({ preset: 'deepseek', key: `  ${KEY} ` })
  assert.deepEqual([made.id, made.model, made.models], ['deepseek', 'deepseek-chat', ['deepseek-chat', 'deepseek-reasoner']])
  assert.equal(await keychain.get('cloud-model-deepseek'), KEY)
  assert.equal(settings.get().model, 'cloud:deepseek:deepseek-chat', 'connecting picks it: it just works')
  assert.ok(!JSON.stringify(settings.get()).includes(KEY), 'the key is never in the settings')
  assert.deepEqual(cloud.models().map((model) => [model.id, model.offline, model.where]), [['cloud:deepseek:deepseek-chat', false, 'DeepSeek']])
  const status = cloud.status()
  assert.deepEqual([status.model, status.leavesMac, status.lasting], ['cloud:deepseek:deepseek-chat', 'DeepSeek', false])
  assert.ok(!JSON.stringify(status).includes(KEY), 'Settings never sees the key')
})

test('connect: a bad key is one plain line, and nothing is kept', async () => {
  const { cloud, settings, keychain } = setUp()
  await assert.rejects(cloud.connect({ preset: 'deepseek', key: 'sk-wrongwrongwrongwrong' }), /DeepSeek didn’t accept that key\. Copy it again/)
  await assert.rejects(cloud.connect({ preset: 'deepseek', key: 'short' }), /cut off/)
  assert.deepEqual([settings.get().providers, settings.get().model, await keychain.get('cloud-model-deepseek')], [[], 'local', null])
})

test('asking: the answer streams, thinking is left out, and the running total grows', async () => {
  const { cloud, settings } = setUp()
  await cloud.connect({ preset: 'deepseek', key: KEY })
  const heard = []
  const text = await cloud.chatStream({ model: 'cloud:deepseek:deepseek-chat', messages: [{ role: 'user', content: 'Hi' }] }, (delta) => heard.push(delta))
  assert.deepEqual([text, heard], ['Hello', ['Hel', 'lo']])
  assert.deepEqual(settings.get().usage.deepseek, { requests: 1, input: 12, output: 3, since: '2026-09-29T10:00:00.000Z' })
  const status = cloud.status().providers[0]
  assert.equal(status.cost, 'under a cent')
  assert.equal(status.usagePage, 'https://platform.deepseek.com/usage')
})

test('asking: a provider without stream_options is asked again without it; no usage means an estimate', async () => {
  const { cloud, settings, provider } = setUp({ noStreamOptions: true })
  await cloud.connect({ preset: 'deepseek', key: KEY })
  assert.equal(await cloud.chatStream({ model: 'cloud:deepseek:deepseek-chat', messages: [{ role: 'user', content: 'Hello there' }] }), 'Hello')
  assert.equal(provider.seen.filter((call) => call.url.endsWith('/chat/completions')).length, 2)
  assert.equal(settings.get().usage.deepseek.estimated, true)
})

test('offline: the cloud model steps aside, and asking says it waits', async () => {
  const { cloud, goOffline } = setUp()
  await cloud.connect({ preset: 'deepseek', key: KEY })
  goOffline()
  assert.deepEqual(cloud.models(), [], 'the AI on this Mac answers meanwhile')
  await assert.rejects(cloud.chatStream({ model: 'cloud:deepseek:deepseek-chat', messages: [{ role: 'user', content: 'Hi' }] }), /offline\. DeepSeek waits/)
  await assert.rejects(cloud.connect({ preset: 'openai', key: KEY }), /waits until you’re back online/)
  assert.equal(cloud.status().leavesMac, 'DeepSeek', 'still chosen, for when it comes back')
})

test('choosing and removing: another model, back to this Mac, and Remove takes the key away', async () => {
  const { cloud, settings, keychain } = setUp()
  await cloud.connect({ preset: 'deepseek', key: KEY })
  await cloud.choose('cloud:deepseek:deepseek-reasoner')
  assert.equal(settings.get().providers[0].model, 'deepseek-reasoner')
  await cloud.choose('local')
  assert.deepEqual(cloud.models(), [])
  await assert.rejects(cloud.choose('cloud:nobody:x'), /Connect that provider first/)
  await cloud.choose('cloud:deepseek:deepseek-chat')
  await cloud.remove('deepseek')
  assert.deepEqual([settings.get().model, settings.get().providers, await keychain.get('cloud-model-deepseek')], ['local', [], null])
  await assert.rejects(cloud.chatStream({ model: 'cloud:deepseek:deepseek-chat', messages: [{ role: 'user', content: 'Hi' }] }), /isn’t connected any more/)
})

test('a model the provider doesn’t have says so plainly', async () => {
  const { cloud } = setUp()
  await cloud.connect({ preset: 'deepseek', key: KEY })
  await cloud.choose('local')
  const settingsProvider = cloud.status().providers[0]
  assert.equal(settingsProvider.model, 'deepseek-chat')
  await assert.rejects(cloud.chatStream({ model: 'cloud:deepseek:deepseek-v9', messages: [{ role: 'user', content: 'Hi' }] }), /doesn’t have a model called “deepseek-v9”/)
})

test('stream frames: text, usage, done, and errors from the provider', () => {
  assert.deepEqual(readFrame('data: {"choices":[{"delta":{"content":"Hi"}}]}'), { text: 'Hi', usage: null })
  assert.deepEqual(readFrame('data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}'), { text: '', usage: { input: 5, output: 2 } })
  assert.deepEqual(readFrame('data: [DONE]'), { done: true })
  assert.deepEqual(readFrame(': keep-alive'), {})
  assert.deepEqual(readFrame('data: {"error":{"message":"overloaded"}}'), { error: 'overloaded' })
})

test('settings file: saved in one piece, read back, never a key in it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-bots-'))
  const file = path.join(dir, 'bots.json')
  const settings = createSettings({ file, clean: providers.cleanBotSettings })
  assert.equal((await settings.load()).model, 'local')
  await Promise.all([
    settings.save({ providers: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }] }),
    settings.save({ model: 'cloud:deepseek:deepseek-chat', key: KEY }),
  ])
  const again = createSettings({ file, clean: providers.cleanBotSettings })
  assert.equal((await again.load()).model, 'cloud:deepseek:deepseek-chat')
  const saved = await fs.readFile(file, 'utf8')
  assert.ok(!saved.includes(KEY))
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  assert.deepEqual((await fs.readdir(dir)).sort(), ['bots.json'], 'no temp files left behind')
})
