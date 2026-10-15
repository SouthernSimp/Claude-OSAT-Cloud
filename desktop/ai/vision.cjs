/* Pictures for the AI on this Mac (Phase 37b). The engine OSAT talks to for words (node-llama-cpp) can't read
   pictures, so a question with a picture goes to llama.cpp's own server, which ships inside the app
   (scripts/build-helpers.mjs fetches one pinned release and checks it). It is started for one model and its
   picture part (the vision projector the catalog downloads with it) when a picture question comes, listens on
   127.0.0.1 only with a new key each time it starts, and stops after ten idle minutes, when another model is
   asked about a picture, or at quit. It thinks quietly: thinking is off, as for Gemma in the word engine.
   Nothing here reaches the network. */
const { spawn: spawnProcess } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const { readStream } = require('../local-ai.cjs')

const IDLE = 10 * 60 * 1000
const START_TIMEOUT = 180000

/* A port nothing on this Mac is using right now (127.0.0.1 only). */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/* OSAT's messages ({ role, content, images? }) as the server reads them: each picture an image part. */
function toServer(messages) {
  return messages.map((message) => (message.images?.length
    ? {
      role: message.role,
      content: [
        { type: 'text', text: message.content },
        ...message.images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.type};base64,${image.data}` } })),
      ],
    }
    : { role: message.role, content: message.content }))
}

/* The server's arguments: one model and its picture part, this Mac only, a key, room for a long question. */
const serverArgs = ({ model, vision, port, key }) => [
  '--jinja', '--host', '127.0.0.1', '--port', String(port), '--api-key', key,
  '-m', model, '--mmproj', vision, '-c', '16384', '--no-webui',
]

/* `bin` is the server inside the app; `spawn`, `fetch`, `port` and `wait` are passed in so tests can stand in. */
function createVision({ bin, spawn = spawnProcess, fetch = globalThis.fetch, port = freePort, idle = IDLE, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), there = (file) => fs.existsSync(file) }) {
  let server = null

  async function stop() {
    const mine = server
    server = null
    if (!mine) return
    clearTimeout(mine.timer)
    if (mine.dead) return
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 5000)
      mine.child.once('exit', () => { clearTimeout(done); resolve() })
      try { mine.child.kill() } catch { clearTimeout(done); resolve() }
    })
  }

  function rest(mine) {
    clearTimeout(mine.timer)
    mine.timer = setTimeout(() => { if (server === mine && !mine.requests) stop().catch(() => {}) }, idle)
    mine.timer.unref?.()
  }

  async function startFor(model, vision) {
    if (server && !server.dead && server.model === model && server.vision === vision) { await server.ready; return server }
    await stop()
    if (!there(bin)) throw new Error('The picture reader isn’t in this copy of OSAT. Update OSAT to read pictures.')
    const key = crypto.randomBytes(24).toString('hex')
    const at = await port()
    const child = spawn(bin, serverArgs({ model, vision, port: at, key }), { stdio: ['ignore', 'ignore', 'pipe'] })
    const mine = { model, vision, key, port: at, child, requests: 0, timer: null, dead: false, log: '' }
    child.stderr?.on('data', (chunk) => { mine.log = (mine.log + chunk).slice(-4000) })
    child.on('exit', () => { mine.dead = true; if (server === mine) server = null })
    child.on('error', () => { mine.dead = true; if (server === mine) server = null })
    server = mine
    mine.ready = (async () => {
      const end = Date.now() + START_TIMEOUT
      while (Date.now() < end) {
        if (mine.dead) throw new Error('The picture reader stopped while starting. This Mac may need a smaller model.')
        try {
          const response = await fetch(`http://127.0.0.1:${at}/health`, { headers: { authorization: `Bearer ${key}` } })
          if (response.ok) return
        } catch { /* not listening yet */ }
        await wait(300)
      }
      throw new Error('The picture reader took too long to start. Try a smaller model.')
    })()
    try {
      await mine.ready
    } catch (error) {
      await stop()
      throw error
    }
    return mine
  }

  /* One question with pictures: the answer streams to onDelta, and the whole of it comes back. */
  async function see({ model, vision, messages, onDelta, signal, maxTokens = 2048 }) {
    signal?.throwIfAborted()
    const mine = await startFor(model, vision)
    mine.requests += 1
    clearTimeout(mine.timer)
    try {
      const response = await fetch(`http://127.0.0.1:${mine.port}/v1/chat/completions`, {
        method: 'POST',
        signal,
        headers: { authorization: `Bearer ${mine.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messages: toServer(messages), stream: true, max_tokens: maxTokens, temperature: 0.4, chat_template_kwargs: { enable_thinking: false } }),
      })
      if (!response.ok || !response.body) throw new Error('The picture reader couldn’t answer that. Try a smaller picture.')
      return await readStream(response.body, onDelta)
    } finally {
      mine.requests -= 1
      if (server === mine) rest(mine)
    }
  }

  return {
    see,
    stop,
    // Room for a word model: the picture reader steps aside when it isn't answering.
    rest: () => (server && !server.requests ? stop() : Promise.resolve()),
    busy: () => Boolean(server?.requests),
  }
}

module.exports = { createVision, toServer, serverArgs, freePort }
