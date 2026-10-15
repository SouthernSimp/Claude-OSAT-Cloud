import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { TIERS } = require('../desktop/ai/catalog.cjs')
const { createAi } = require('../desktop/ai/index.cjs')
const { createVision, serverArgs, toServer } = require('../desktop/ai/vision.cjs')
const { localAiChatStream, readStream, validateLocalChatPayload } = require('../desktop/local-ai.cjs')

const GB = 1024 ** 3
const made = []
const temp = async () => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-pictures-')); made.push(dir); return dir }
after(() => Promise.all(made.map((dir) => fs.rm(dir, { recursive: true, force: true }))))
const settle = async (check, tries = 2000) => { for (let i = 0; i < tries && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5)) }
const place = async (dir, file, size) => { await fs.writeFile(path.join(dir, file), ''); await fs.truncate(path.join(dir, file), size) }
const picture = { type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }

/* A download that "fetches" by making the file the right size, saying how far it got. */
function fakeDownload(log) {
  return async ({ url, dest, size, onProgress }) => {
    log.push(path.basename(dest))
    onProgress?.(Math.floor(size / 2))
    await fs.writeFile(dest, '')
    await fs.truncate(dest, size)
    onProgress?.(size)
    void url
  }
}

test('every model comes with its picture part, from the same pinned revision, checked the same way', () => {
  const files = new Set()
  for (const tier of TIERS) {
    assert.ok(tier.vision, `${tier.id} has its picture part`)
    const [, repo, rev] = /^https:\/\/huggingface\.co\/(.+?)\/resolve\/([0-9a-f]{40})\//.exec(tier.url)
    assert.match(tier.vision.url, new RegExp(`^https://huggingface\\.co/${repo.replace(/[.]/g, '\\.')}/resolve/${rev}/[^/]+\\.gguf$`), `${tier.id}: same repository and revision as the model`)
    assert.match(tier.vision.sha256, /^[0-9a-f]{64}$/)
    assert.ok(tier.vision.size > 100e6 && tier.vision.size < 2e9, `${tier.id}: a believable size`)
    assert.ok(!files.has(tier.vision.file), `${tier.id}: its own file name (three Qwen parts share one name upstream)`)
    files.add(tier.vision.file)
    assert.equal(tier.can.pictures, true)
    assert.ok([null, 'on', 'off'].includes(tier.can.thinking))
  }
  assert.equal(TIERS.filter((tier) => tier.can.code === 'best').length, 1, 'one model is the one for code')
})

test('a new model comes down whole: the model, then its picture part, as one transfer', async () => {
  const dir = await temp()
  const log = []
  const ai = createAi({ dir, totalMemory: 64 * GB, download: fakeDownload(log), fork: () => { throw new Error('no engine here') } })
  await ai.install('light')
  await settle(() => ai.status().tiers[0].sees)
  const light = TIERS.find((tier) => tier.id === 'light')
  assert.deepEqual(log, [light.file, light.vision.file])
  const status = ai.status().tiers.find((tier) => tier.id === 'light')
  assert.deepEqual([status.ready, status.sees, status.visionSize], [true, true, light.vision.size])
  assert.deepEqual(ai.status().queued, [])
  ai.dispose()
})

test('a model already here gets only its picture part, the one in use first; a complete one gets nothing', async () => {
  const dir = await temp()
  const light = TIERS.find((tier) => tier.id === 'light')
  const balanced = TIERS.find((tier) => tier.id === 'balanced')
  await place(dir, light.file, light.size)
  await place(dir, balanced.file, balanced.size)
  await place(dir, balanced.vision.file, balanced.vision.size)
  const deep = TIERS.find((tier) => tier.id === 'deep')
  await place(dir, deep.file, deep.size)
  const log = []
  const ai = createAi({ dir, totalMemory: 64 * GB, chosen: 'deep', download: fakeDownload(log), fork: () => { throw new Error('no engine here') } })
  assert.equal(ai.status().tiers.find((tier) => tier.id === 'light').ready, true, 'it answers in words meanwhile')
  assert.equal(ai.status().tiers.find((tier) => tier.id === 'light').sees, false)
  ai.start()
  await settle(() => log.length === 2 && !ai.status().download)
  assert.deepEqual(log, [deep.vision.file, light.vision.file], 'the model in use first; Balanced was already whole')
  ai.dispose()
})

test('removing a model removes its picture part too', async () => {
  const dir = await temp()
  const light = TIERS.find((tier) => tier.id === 'light')
  await place(dir, light.file, light.size)
  await place(dir, light.vision.file, light.vision.size)
  await place(dir, `${light.vision.file}.part`, 10)
  const ai = createAi({ dir, totalMemory: 64 * GB, download: async () => {}, fork: () => { throw new Error('no engine') } })
  await ai.remove('light')
  assert.deepEqual(await fs.readdir(dir), [])
  ai.dispose()
})

test('a question with a picture goes to the picture reader with the model and its picture part', async () => {
  const dir = await temp()
  const light = TIERS.find((tier) => tier.id === 'light')
  await place(dir, light.file, light.size)
  const asked = []
  const vision = { see: async (job) => { asked.push(job); job.onDelta('A note app.'); return 'A note app.' }, rest: async () => {}, stop: async () => {} }
  const ai = createAi({ dir, totalMemory: 64 * GB, vision, download: async () => new Promise(() => {}), fork: () => { throw new Error('no engine') } })
  const messages = [{ role: 'user', content: 'What is this?', images: [picture] }]
  await assert.rejects(ai.chatStream({ model: 'osat:light', messages }, () => {}), /once its picture part is here\. Get it in Settings → AI/)
  ai.start()
  await assert.rejects(ai.chatStream({ model: 'osat:light', messages }, () => {}), /downloading now/)
  ai.dispose()

  await place(dir, light.vision.file, light.vision.size)
  const ready = createAi({ dir, totalMemory: 64 * GB, vision, download: async () => {}, fork: () => { throw new Error('no engine') } })
  const pieces = []
  assert.equal(await ready.chatStream({ model: 'osat:light', messages }, (piece) => pieces.push(piece)), 'A note app.')
  assert.equal(asked[0].model, path.join(dir, light.file))
  assert.equal(asked[0].vision, path.join(dir, light.vision.file))
  assert.equal(asked[0].messages, messages)
  assert.deepEqual(pieces, ['A note app.'])
  assert.equal(ready.models().find((model) => model.id === 'osat:light').sees, true, 'Ask knows it takes pictures')
  ready.dispose()
})

test('the practice model (tests and CI) says it saw the pictures', async () => {
  const ai = createAi({ dir: await temp(), totalMemory: 64 * GB, mock: true, chosen: 'light', fork: () => { throw new Error('no engine') } })
  const text = await ai.chatStream({ model: 'osat:light', messages: [{ role: 'user', content: 'What is this?', images: [picture, picture] }] }, () => {})
  assert.match(text, /It saw 2 pictures\.$/)
  ai.dispose()
})

/* llama.cpp's server, stood in for: a child that answers /health and streams a reply. */
function fakeServer({ healthyAfter = 2 } = {}) {
  const spawned = []
  const requests = []
  let health = 0
  const spawn = (bin, args) => {
    const child = new EventEmitter()
    child.stderr = new EventEmitter()
    child.killed = false
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', 0)) }
    spawned.push({ bin, args, child })
    return child
  }
  const fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/health')) {
      health += 1
      return { ok: health >= healthyAfter }
    }
    const frames = ['data: {"choices":[{"delta":{"content":"A note "}}]}\n\n', 'data: {"choices":[{"delta":{"content":"app."}}]}\n\n', 'data: [DONE]\n\n']
    return { ok: true, body: (async function* () { for (const frame of frames) yield new TextEncoder().encode(frame) })() }
  }
  return { spawned, requests, spawn, fetch }
}

test('the picture reader: this Mac only, a new key, the model and its part; reused, and restarted for another model', async () => {
  const fake = fakeServer()
  let next = 40001
  const vision = createVision({ bin: '/app/helpers/llama/llama-server', spawn: fake.spawn, fetch: fake.fetch, port: async () => next++, wait: async () => {}, there: () => true })
  const messages = [{ role: 'user', content: 'What is this?', images: [picture] }]
  const pieces = []
  assert.equal(await vision.see({ model: '/m/light.gguf', vision: '/m/light-mmproj.gguf', messages, onDelta: (piece) => pieces.push(piece) }), 'A note app.')
  assert.deepEqual(pieces, ['A note ', 'app.'])
  const { args } = fake.spawned[0]
  assert.deepEqual(args.slice(0, 4), ['--jinja', '--host', '127.0.0.1', '--port'])
  assert.equal(args[args.indexOf('-m') + 1], '/m/light.gguf')
  assert.equal(args[args.indexOf('--mmproj') + 1], '/m/light-mmproj.gguf')
  const key = args[args.indexOf('--api-key') + 1]
  assert.match(key, /^[0-9a-f]{48}$/)
  const chat = fake.requests.find((request) => request.url.endsWith('/v1/chat/completions'))
  assert.equal(chat.url, 'http://127.0.0.1:40001/v1/chat/completions')
  assert.equal(chat.options.headers.authorization, `Bearer ${key}`)
  const body = JSON.parse(chat.options.body)
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false }, 'it answers directly, no thinking out loud')
  assert.equal(body.messages[0].content[1].image_url.url, `data:image/png;base64,${picture.data}`)

  await vision.see({ model: '/m/light.gguf', vision: '/m/light-mmproj.gguf', messages, onDelta: () => {} })
  assert.equal(fake.spawned.length, 1, 'the same model reuses its server')
  await vision.see({ model: '/m/deep.gguf', vision: '/m/deep-mmproj.gguf', messages, onDelta: () => {} })
  assert.equal(fake.spawned.length, 2)
  assert.equal(fake.spawned[0].child.killed, true, 'another model: the first server stops')
  const second = fake.spawned[1].args
  assert.notEqual(second[second.indexOf('--api-key') + 1], key, 'a new key each start')
  await vision.rest()
  assert.equal(fake.spawned[1].child.killed, true, 'it steps aside for a word model when it isn’t answering')
})

test('the picture reader: a copy of OSAT without it, or a server that dies, says so calmly', async () => {
  const missing = createVision({ bin: '/nowhere/llama-server', there: () => false })
  await assert.rejects(missing.see({ model: 'm', vision: 'v', messages: [] }), /isn’t in this copy of OSAT/)
  const fake = fakeServer({ healthyAfter: Infinity })
  const dies = createVision({ bin: '/b', spawn: (...args) => { const child = fake.spawn(...args); setImmediate(() => child.emit('exit', 1)); return child }, fetch: fake.fetch, port: async () => 40100, wait: async () => new Promise((resolve) => setTimeout(resolve, 2)), there: () => true })
  await assert.rejects(dies.see({ model: 'm', vision: 'v', messages: [{ role: 'user', content: 'x' }] }), /stopped while starting/)
})

test('what the server reads: each picture an image part beside the words; words alone stay words', () => {
  assert.deepEqual(toServer([{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'What is it?', images: [picture] }]), [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: [{ type: 'text', text: 'What is it?' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${picture.data}` } }] },
  ])
  assert.equal(serverArgs({ model: 'm', vision: 'v', port: 1, key: 'k' }).includes('0.0.0.0'), false)
})

test('a question carries at most four pictures, each a real picture under 10 MB, and only a question carries them', async () => {
  const ask = (images, role = 'user') => validateLocalChatPayload({ model: 'osat:light', messages: [{ role, content: 'What is this?', images }] })
  assert.deepEqual(ask([picture]).messages[0].images, [picture])
  assert.throws(() => ask([picture], 'assistant'), /up to four pictures/)
  assert.throws(() => ask(Array(5).fill(picture)), /up to four pictures/)
  assert.throws(() => ask([]), /up to four pictures/)
  assert.throws(() => ask([{ type: 'image/svg+xml', data: 'PHN2Zz4=' }]), /can’t be read/)
  assert.throws(() => ask([{ type: 'image/png', data: 'not base64!' }]), /can’t be read/)
  assert.throws(() => ask([{ type: 'image/png', data: 'A'.repeat(14_000_001) }]), /can’t be read/)
  const words = validateLocalChatPayload({ model: 'osat:light', messages: [{ role: 'user', content: 'Hi', extra: 'dropped' }] })
  assert.deepEqual(words.messages, [{ role: 'user', content: 'Hi' }])
  await assert.rejects(localAiChatStream({ model: 'lm-studio-model', messages: [{ role: 'user', content: 'x', images: [picture] }] }, () => {}), /Pictures go to OSAT’s own AI/)
})

test('the stream reader keeps its pieces whole across chunk edges', async () => {
  const chunks = ['data: {"choices":[{"delta":{"content":"Hel', 'lo"}}]}\n\ndata: [DONE]\n\n']
  const pieces = []
  const text = await readStream((async function* () { for (const chunk of chunks) yield new TextEncoder().encode(chunk) })(), (piece) => pieces.push(piece))
  assert.equal(text, 'Hello')
  assert.deepEqual(pieces, ['Hello'])
})
