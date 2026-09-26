import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { TIERS, pickTier } = require('../desktop/ai/catalog.cjs')
const { downloadFile } = require('../desktop/ai/download.cjs')
const { createAi } = require('../desktop/ai/index.cjs')

const GB = 1024 ** 3
const made = []
const temp = async () => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-ai-')); made.push(dir); return dir }
after(() => Promise.all(made.map((dir) => fs.rm(dir, { recursive: true, force: true }))))

test('the recommended size follows the Mac’s memory', () => {
  assert.equal(pickTier(8 * GB).id, 'light')
  assert.equal(pickTier(4 * GB).id, 'light')
  assert.equal(pickTier(16 * GB).id, 'balanced')
  assert.equal(pickTier(24 * GB).id, 'balanced')
  assert.equal(pickTier(32 * GB).id, 'deep')
  assert.equal(pickTier(64 * GB).id, 'deep')
  for (const tier of TIERS) {
    assert.match(tier.sha256, /^[0-9a-f]{64}$/)
    assert.match(tier.url, new RegExp(`^https://huggingface\\.co/.+/resolve/[0-9a-f]{40}/${tier.file.replace(/\./g, '\\.')}$`))
  }
})

/* A tiny file server that honours Range requests (unless told not to). */
async function serve(body, { ignoreRange = false } = {}) {
  const seen = []
  const server = http.createServer((request, response) => {
    seen.push(request.headers.range || null)
    const match = /bytes=(\d+)-/.exec(request.headers.range || '')
    if (match && !ignoreRange) {
      const from = Number(match[1])
      response.writeHead(206, { 'content-length': body.length - from, 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` })
      response.end(body.subarray(from))
    } else {
      response.writeHead(200, { 'content-length': body.length })
      response.end(body)
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}/model.gguf`, seen, close: () => server.close() }
}

const body = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251))
const sha256 = createHash('sha256').update(body).digest('hex')
const plenty = async () => 1e15

test('a model downloads, and a stopped download resumes where it left off', async () => {
  const dir = await temp()
  const dest = path.join(dir, 'model.gguf')
  const server = await serve(body)
  try {
    await fs.writeFile(`${dest}.part`, body.subarray(0, 120_000))
    let last = 0
    await downloadFile({ url: server.url, dest, size: body.length, sha256, free: plenty, onProgress: (received) => { last = received } })
    assert.deepEqual(await fs.readFile(dest), body)
    assert.equal(last, body.length)
    assert.deepEqual(server.seen, ['bytes=120000-'])
    await assert.rejects(fs.stat(`${dest}.part`))
  } finally {
    server.close()
  }
})

test('a server that ignores the range starts the file over', async () => {
  const dir = await temp()
  const dest = path.join(dir, 'model.gguf')
  const server = await serve(body, { ignoreRange: true })
  try {
    await fs.writeFile(`${dest}.part`, Buffer.alloc(50_000, 7))
    await downloadFile({ url: server.url, dest, size: body.length, sha256, free: plenty })
    assert.deepEqual(await fs.readFile(dest), body)
  } finally {
    server.close()
  }
})

test('a damaged download is thrown away, and a full disk is caught before starting', async () => {
  const dir = await temp()
  const dest = path.join(dir, 'model.gguf')
  const server = await serve(body)
  try {
    await assert.rejects(downloadFile({ url: server.url, dest, size: body.length, sha256: '0'.repeat(64), free: plenty }), { code: 'CHECKSUM' })
    await assert.rejects(fs.stat(dest))
    await assert.rejects(fs.stat(`${dest}.part`))
    await assert.rejects(downloadFile({ url: server.url, dest, size: body.length, sha256, free: async () => 1000 }), { code: 'NO_SPACE' })
    assert.equal(server.seen.length, 1)
  } finally {
    server.close()
  }
})

/* A stand-in for the engine process: answers load and chat like runtime.cjs. */
function fakeEngine(log) {
  return () => {
    const proc = new EventEmitter()
    proc.postMessage = (message) => {
      log.push(message.type)
      setImmediate(() => {
        if (message.type === 'load') proc.emit('message', { type: 'loaded' })
        if (message.type === 'chat' && message.messages.at(-1).content === 'crash') proc.emit('exit', 1)
        else if (message.type === 'chat') {
          proc.emit('message', { type: 'delta', id: message.id, text: 'Hel' })
          proc.emit('message', { type: 'delta', id: message.id, text: 'lo' })
          proc.emit('message', { type: 'done', id: message.id })
        }
      })
    }
    proc.kill = () => log.push('kill')
    return proc
  }
}

/* Pretends to download: a sparse file of the catalog's exact size. */
const instantDownload = async ({ dest, size, onProgress }) => {
  await fs.writeFile(dest, '')
  await fs.truncate(dest, size)
  onProgress(size, size)
}

test('choosing a size fetches it, then Ask can use it; the engine starts on the first question', async () => {
  const dir = await temp()
  const log = []
  const saved = []
  const ai = createAi({ dir, totalMemory: 16 * GB, save: async (tier) => saved.push(tier), fork: fakeEngine(log), download: instantDownload })
  assert.equal(ai.status().recommended, 'balanced')
  assert.deepEqual(ai.models(), [])
  await ai.choose('light')
  await ai.resume() // waits for the download under way
  assert.deepEqual(saved, ['light'])
  assert.equal(ai.status().tiers.find((tier) => tier.id === 'light').ready, true)
  assert.equal(ai.models()[0].id, 'osat:light')
  assert.equal(ai.status().engine, 'idle')

  const parts = []
  const text = await ai.chatStream({ messages: [{ role: 'user', content: 'Hi' }] }, (delta) => parts.push(delta))
  assert.equal(text, 'Hello')
  assert.deepEqual(parts, ['Hel', 'lo'])
  assert.equal(ai.status().engine, 'ready')
  assert.deepEqual(log, ['load', 'chat'])

  // A crash fails the question calmly and the next one starts a fresh engine.
  await assert.rejects(ai.chatStream({ messages: [{ role: 'user', content: 'crash' }] }, () => {}), /stopped unexpectedly/)
  assert.equal(await ai.chatStream({ messages: [{ role: 'user', content: 'again' }] }, () => {}), 'Hello')
  assert.deepEqual(log, ['load', 'chat', 'chat', 'load', 'chat'])

  await ai.remove('light')
  assert.deepEqual(ai.models(), [])
  assert.equal(ai.status().chosen, null)
  ai.dispose()
})

test('a failed download says why and can be tried again', async () => {
  const dir = await temp()
  let calls = 0
  const flaky = async (options) => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('This needs about 5 GB free on your Mac.'), { code: 'NO_SPACE' })
    return instantDownload(options)
  }
  const ai = createAi({ dir, totalMemory: 8 * GB, fork: fakeEngine([]), download: flaky, retryDelay: 1 })
  await ai.choose('light')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(ai.status().download.state, 'failed')
  assert.match(ai.status().download.message, /GB free/)
  await ai.resume()
  assert.equal(ai.status().download, null)
  assert.equal(ai.models().length, 1)
})

test('the practice model answers without any download', async () => {
  const ai = createAi({ dir: await temp(), totalMemory: 8 * GB, mock: true })
  await ai.choose('light')
  assert.equal(ai.models()[0].name, 'Practice model')
  const text = await ai.chatStream({ messages: [{ role: 'user', content: 'What is next?' }] }, () => {})
  assert.match(text, /What is next\?/)
})
