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
    proc.kill = () => { log.push('kill'); setImmediate(() => proc.emit('exit', 0)) }
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

test('a stopped download says when it has really stopped, so it can resume at once', async () => {
  let started = 0
  // Re-hashing a large .part at the start doesn't hear the stop straight away.
  const slowStart = async ({ signal }) => {
    started += 1
    await new Promise((resolve) => setTimeout(resolve, 30))
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve))
    throw new Error('aborted')
  }
  const ai = createAi({ dir: await temp(), totalMemory: 8 * GB, fork: fakeEngine([]), download: slowStart })
  await ai.choose('light')
  const stopping = ai.cancel()
  assert.equal(ai.status().download.state, 'running', 'still stopping')
  await stopping
  assert.equal(ai.status().download.state, 'paused')
  ai.resume()
  assert.equal(ai.status().download.state, 'running')
  assert.equal(started, 2)
  ai.dispose()
})

test('the practice model answers without any download', async () => {
  const ai = createAi({ dir: await temp(), totalMemory: 8 * GB, mock: true })
  await ai.choose('light')
  assert.equal(ai.models()[0].name, 'Practice model')
  const text = await ai.chatStream({ messages: [{ role: 'user', content: 'What is next?' }] }, () => {})
  assert.match(text, /What is next\?/)
})

const settle = async (check) => {
  for (let i = 0; i < 100; i += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('condition did not settle')
}

async function pool(options = {}) {
  const dir = await temp()
  const procs = []
  const killed = []
  const confirmations = []
  const factory = () => {
    const proc = new EventEmitter()
    procs.push(proc)
    proc.postMessage = (message) => {
      if (message.type === 'load') {
        proc.tier = TIERS.find((tier) => message.modelPath.endsWith(tier.file)).id
        setImmediate(() => proc.emit('message', { type: 'loaded' }))
      } else if (message.type === 'chat') {
        proc.job = message.id
        if (message.messages[0].content !== 'hold') setImmediate(() => {
          proc.emit('message', { type: 'delta', id: message.id, text: proc.tier })
          proc.emit('message', { type: 'done', id: message.id })
        })
      } else if (message.type === 'cancel') {
        setImmediate(() => proc.emit('message', { type: 'done', id: message.id }))
      }
    }
    proc.kill = () => { killed.push(proc.tier); setTimeout(() => proc.emit('exit', 0), 5) }
    return proc
  }
  const ai = createAi({ dir, totalMemory: 64 * GB, chosen: 'light', fork: factory, idle: 1000,
    download: instantDownload, freeMemory: () => 48 * GB, estimate: async () => ({ bytes: 4 * GB }),
    confirmLoad: async (info) => { confirmations.push(info); return info.keepOthers ? 'alongside' : 'replace' },
    confirmUnload: async () => true, ...options })
  await ai.install(TIERS.map((tier) => tier.id))
  await settle(() => ai.status().queued.length === 0)
  return { ai, dir, procs, killed, confirmations }
}

test('installing all three is sequential, preserves the default, and never loads them', async () => {
  const { ai, procs } = await pool()
  assert.equal(ai.status().chosen, 'light')
  assert.equal(ai.models().length, 3)
  assert.deepEqual(ai.status().tiers.map((tier) => tier.state), ['idle', 'idle', 'idle'])
  await ai.select('deep')
  assert.equal(ai.models()[0].id, 'osat:deep')
  assert.equal(procs.length, 0)
  ai.dispose()
})

test('a request routes to its own model; retained models survive switching and idle', async () => {
  const { ai, killed, confirmations } = await pool({ idle: 10 })
  await ai.setRetained('light', true)
  await ai.setRetained('balanced', true)
  assert.equal(confirmations.length, 1)
  assert.equal(confirmations[0].keepOthers, true)
  assert.equal(await ai.chatStream({ model: 'osat:balanced', messages: [{ role: 'user', content: 'hello' }] }, () => {}, undefined, { interactive: true }), 'balanced')
  assert.equal(ai.status().chosen, 'light')
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.deepEqual(ai.status().tiers.map((tier) => tier.state), ['ready', 'ready', 'idle'])
  assert.deepEqual(killed, [])
  const freed = await ai.unloadAll()
  assert.deepEqual(freed.unloaded, ['light', 'balanced'])
  assert.deepEqual(killed, ['light', 'balanced'])
  assert.equal(ai.models().length, 3, 'unloading never removes downloaded files')
  ai.dispose()
})

test('ordinary switching releases the old process, and a larger-model cancellation changes nothing', async () => {
  let approve = true
  const { ai, procs, killed } = await pool({ confirmLoad: async () => approve ? 'replace' : 'cancel' })
  await ai.load('light', { interactive: true })
  await ai.load('balanced', { interactive: true })
  assert.deepEqual(killed, ['light'])
  assert.equal(ai.status().tiers[0].state, 'idle')
  approve = false
  await assert.rejects(ai.load('deep', { interactive: true }), /cancelled/)
  assert.equal(ai.status().tiers[1].state, 'ready')
  assert.equal(procs.length, 2)
  ai.dispose()
})

test('busy work prevents unloading; success waits for process exit before saying memory is free', async () => {
  const { ai, procs, killed } = await pool()
  await ai.load('light', { interactive: true })
  const reply = ai.chatStream({ model: 'osat:light', messages: [{ role: 'user', content: 'hold' }] }, () => {}, undefined, { interactive: true })
  await settle(() => Boolean(procs[0].job))
  await assert.rejects(ai.unload('light'), /busy/)
  assert.deepEqual(killed, [])
  const free = await ai.unloadAll()
  assert.deepEqual(free.busyModels, ['light'])
  procs[0].emit('message', { type: 'done', id: procs[0].job })
  await reply
  const stopping = ai.unload('light')
  await settle(() => ai.status().tiers[0].state === 'unloading')
  assert.equal(ai.status().tiers[0].busy, true)
  await stopping
  assert.equal(ai.status().tiers[0].state, 'idle')
  ai.dispose()
})

test('a manually unloaded model cannot be woken by background work; the next question can wake it', async () => {
  const { ai, procs, dir } = await pool()
  await ai.load('light', { interactive: true })
  await ai.unload('light')
  await assert.rejects(ai.chatStream({ model: 'osat:light', messages: [{ role: 'user', content: 'scan' }] }, () => {}), /unloaded/)
  assert.equal(procs.length, 1)
  assert.equal(await ai.chatStream({ model: 'osat:light', messages: [{ role: 'user', content: 'question' }] }, () => {}, undefined, { interactive: true }), 'light')
  assert.equal((await fs.stat(path.join(dir, TIERS[0].file))).size, TIERS[0].size)
  ai.dispose()
})

test('a question queued during an unload confirmation protects its model', async () => {
  for (const all of [false, true]) {
    let approve
    const { ai, procs, killed } = await pool({ confirmUnload: () => new Promise((resolve) => { approve = resolve }) })
    await ai.load('balanced', { interactive: true })
    const freeing = all ? ai.unloadAll() : ai.unload('balanced')
    await settle(() => Boolean(approve))
    const answer = ai.chatStream({ model: 'osat:balanced', messages: [{ role: 'user', content: 'hold' }] }, () => {}, undefined, { interactive: true })
    assert.equal(ai.status().tiers[1].busy, true)
    approve(true)
    if (all) {
      const result = await freeing
      assert.deepEqual(result.unloaded, [])
      assert.deepEqual(result.busyModels, ['balanced'])
    } else await assert.rejects(freeing, /busy/)
    assert.deepEqual(killed, [])
    await settle(() => Boolean(procs[0].job))
    procs[0].emit('message', { type: 'done', id: procs[0].job })
    await answer
    ai.dispose()
  }
})

test('an offline launch can load its downloaded default without starting a queued download', async () => {
  const dir = await temp()
  await fs.writeFile(path.join(dir, TIERS[0].file), '')
  await fs.truncate(path.join(dir, TIERS[0].file), TIERS[0].size)
  let downloads = 0
  const procs = []
  const ai = createAi({ dir, totalMemory: 64 * GB, chosen: 'light', startup: true, downloadQueue: ['balanced'],
    fork: fakeEngine(procs), estimate: async () => ({ bytes: 2 * GB }), freeMemory: () => 48 * GB,
    download: async () => { downloads += 1 } })
  ai.start({ downloads: false })
  await settle(() => ai.status().tiers[0].state === 'ready')
  assert.equal(downloads, 0)
  assert.deepEqual(ai.status().queued, ['balanced'])
  ai.dispose()
})

test('a demanding first model warns about memory, and cancelling never allocates a model', async () => {
  const warnings = []
  const { ai, procs } = await pool({ freeMemory: () => 2 * GB, estimate: async () => ({ bytes: 12 * GB }),
    confirmLoad: async (info) => { warnings.push(info); return 'cancel' } })
  await assert.rejects(ai.load('deep', { interactive: true }), /cancelled/)
  assert.equal(warnings[0].low, true)
  assert.equal(warnings[0].others.length, 0)
  assert.equal(procs.length, 0)
  ai.dispose()
})

test('a missing estimate is reported honestly before loading alongside another model', async () => {
  const warnings = []
  const { ai } = await pool({ estimate: async () => null, confirmLoad: async (info) => { warnings.push(info); return 'alongside' } })
  await ai.setRetained('light', true)
  await ai.setRetained('deep', true)
  assert.equal(warnings[0].estimatedMemory, null)
  assert.equal(warnings[0].combinedMemory, null)
  assert.equal(warnings[0].others.length, 1)
  ai.dispose()
})

test('only ordinary idle models unload automatically', async () => {
  const { ai, killed } = await pool({ idle: 10 })
  await ai.load('light', { interactive: true })
  await settle(() => ai.status().tiers[0].state === 'idle')
  assert.deepEqual(killed, ['light'])
  assert.equal(ai.status().tiers[0].blocked, false, 'automatic rest is not a manual unload')
  ai.dispose()
})

test('startup preference is persisted, selection keeps it, and startup loads only the default', async () => {
  const saved = []
  const { ai, procs } = await pool({ saveStartup: async (value) => saved.push(value) })
  await ai.setStartup(true)
  await ai.select('balanced')
  ai.start()
  await settle(() => ai.status().tiers[1].state === 'ready')
  assert.deepEqual(saved, [true])
  assert.equal(ai.status().startup, true)
  assert.equal(procs.length, 1)
  assert.equal(procs[0].tier, 'balanced')
  ai.dispose()
})
