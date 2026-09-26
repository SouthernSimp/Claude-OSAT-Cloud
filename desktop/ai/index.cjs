/* The AI that sets itself up. It keeps track of which size Nate chose, fetches
   that model in the background (resuming after a quit or a dropped connection),
   and runs it in a separate process that starts on the first question and stops
   after ten quiet minutes, so the memory comes back when the AI isn't in use.
   `fork` starts runtime.cjs; `mock` answers without a model, for tests and CI. */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')
const { TIERS, pickTier, tierById } = require('./catalog.cjs')
const { downloadFile } = require('./download.cjs')

const IDLE = 10 * 60 * 1000
const MAX_TOKENS = 2048

function createAi({
  dir, totalMemory, chosen: initial = null, save = async () => {}, fork, emit = () => {},
  download = downloadFile, mock = false, idle = IDLE, retryDelay = 3000,
}) {
  let chosen = tierById(initial) ? initial : null
  let transfer = null
  let engine = { state: 'idle', message: '' }
  let child = null
  let childTier = null
  let loading = null
  let idleTimer = null
  let seq = 0
  let lastEmit = 0
  const pending = new Map()

  const fileFor = (tier) => path.join(dir, tier.file)
  const isReady = (tier) => {
    if (mock) return true
    try { return fs.statSync(fileFor(tier)).size === tier.size } catch { return false }
  }

  function status() {
    return {
      recommended: pickTier(totalMemory).id,
      chosen,
      tiers: TIERS.map((tier) => ({ id: tier.id, label: tier.label, model: tier.model, blurb: tier.blurb, size: tier.size, ready: isReady(tier) })),
      download: transfer && { tier: transfer.tier, received: transfer.received, total: transfer.total, state: transfer.state, message: transfer.message },
      engine: engine.state,
      message: engine.message,
    }
  }

  // Progress arrives many times a second; windows hear about it four times a second.
  function changed(force = false) {
    const now = Date.now()
    if (!force && now - lastEmit < 250) return
    lastEmit = now
    emit(status())
  }

  /* ---- the model file ---- */

  function fetchTier(id) {
    const tier = tierById(id)
    if (!tier || isReady(tier) || (transfer?.tier === id && transfer.state === 'running')) return transfer?.done
    transfer?.abort?.()
    const controller = new AbortController()
    const mine = { tier: id, received: 0, total: tier.size, state: 'running', message: '', abort: () => controller.abort() }
    const settle = (next) => {
      if (transfer !== mine) return
      transfer = next
      changed(true)
    }
    transfer = mine
    changed(true)
    mine.done = (async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await download({
            url: tier.url, dest: fileFor(tier), size: tier.size, sha256: tier.sha256, signal: controller.signal,
            onProgress: (received) => { mine.received = received; if (transfer === mine) changed() },
          })
          settle(null)
          return
        } catch (error) {
          if (controller.signal.aborted) { settle({ ...mine, state: 'paused' }); return }
          if (attempt >= 4 || error.code === 'NO_SPACE' || error.code === 'CHECKSUM') {
            settle({ ...mine, state: 'failed', message: error.code ? error.message : 'The download stopped. Check the internet connection, then try again.' })
            return
          }
          try { await sleep(retryDelay * attempt, undefined, { signal: controller.signal }) } catch { settle({ ...mine, state: 'paused' }); return }
        }
      }
    })()
    return mine.done
  }

  async function choose(id) {
    if (!tierById(id)) throw new Error('That size is not one OSAT knows.')
    chosen = id
    await save(id)
    if (childTier && childTier !== id) stopEngine()
    changed(true)
    if (!isReady(tierById(id))) fetchTier(id)
    return status()
  }

  function cancel() {
    transfer?.abort?.()
  }

  async function remove(id) {
    const tier = tierById(id)
    if (!tier) return status()
    if (transfer?.tier === id) {
      transfer.abort?.()
      await transfer.done
      transfer = null
    }
    if (childTier === id) stopEngine()
    await fsp.rm(fileFor(tier), { force: true })
    await fsp.rm(`${fileFor(tier)}.part`, { force: true })
    if (chosen === id) {
      chosen = null
      await save(null)
    }
    changed(true)
    return status()
  }

  /* On launch: a download that was under way carries on by itself. */
  function start() {
    const tier = tierById(chosen)
    if (tier && !isReady(tier) && fs.existsSync(`${fileFor(tier)}.part`)) fetchTier(tier.id)
  }

  /* ---- the engine process ---- */

  function failPending(message) {
    for (const job of pending.values()) job.reject(new Error(message))
    pending.clear()
  }

  function stopEngine() {
    clearTimeout(idleTimer)
    idleTimer = null
    if (child) {
      const old = child
      child = null
      old.removeAllListeners?.()
      old.kill()
    }
    failPending('The AI was stopped.')
    childTier = null
    loading = null
    if (engine.state !== 'error') engine = { state: 'idle', message: '' }
  }

  function restartIdleTimer() {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => { if (!pending.size) { stopEngine(); changed(true) } }, idle)
    idleTimer.unref?.()
  }

  function ensureEngine() {
    const tier = tierById(chosen)
    if (!tier || !isReady(tier)) return Promise.reject(new Error('The AI is not set up yet. Choose a size in Settings → AI.'))
    if (child && childTier === tier.id) return loading
    stopEngine()
    childTier = tier.id
    engine = { state: 'loading', message: '' }
    changed(true)
    const proc = fork()
    child = proc
    loading = new Promise((resolve, reject) => {
      proc.on('message', (message) => {
        if (message?.type === 'loaded') {
          engine = { state: 'ready', message: '' }
          changed(true)
          resolve()
        } else if (message?.type === 'error' && !message.id) {
          engine = { state: 'error', message: `The model could not start (${message.message}).` }
          stopEngine()
          changed(true)
          reject(new Error(engine.message))
        } else {
          const job = pending.get(message?.id)
          if (!job) return
          if (message.type === 'delta') {
            job.text += message.text
            job.onDelta(message.text)
          } else {
            pending.delete(message.id)
            if (message.type === 'done') job.resolve(job.text)
            else job.reject(new Error(message.message || 'The AI could not answer.'))
          }
        }
      })
      proc.on('exit', () => {
        if (child !== proc) return
        child = null
        childTier = null
        loading = null
        failPending('The AI stopped unexpectedly. Try again.')
        if (engine.state === 'loading') {
          engine = { state: 'error', message: 'The model stopped while starting. This Mac may need a smaller size.' }
          reject(new Error(engine.message))
        } else {
          engine = { state: 'idle', message: '' }
        }
        changed(true)
      })
    })
    proc.postMessage({ type: 'load', modelPath: fileFor(tier) })
    return loading
  }

  async function practiceAnswer(messages, onDelta, signal) {
    const content = String(messages.at(-1)?.content || '')
    const question = content.split('\n')[0].slice(0, 160)
    const files = (content.match(/^\[FILE: /gm) || []).length
    const text = `This is OSAT's practice model, used for tests. You asked: “${question}”${files ? ` It read ${files === 1 ? 'one file' : `${files} files`}.` : ''}`
    for (const word of text.split(/(?<= )/)) {
      if (signal?.aborted) break
      onDelta(word)
      await sleep(4)
    }
    return text
  }

  async function chatStream({ messages }, onDelta, signal) {
    if (mock) return practiceAnswer(messages, onDelta, signal)
    await ensureEngine()
    clearTimeout(idleTimer)
    const id = `chat-${++seq}`
    try {
      return await new Promise((resolve, reject) => {
        pending.set(id, { text: '', onDelta, resolve, reject })
        signal?.addEventListener('abort', () => child?.postMessage({ type: 'cancel', id }), { once: true })
        child.postMessage({ type: 'chat', id, messages, maxTokens: MAX_TOKENS })
      })
    } finally {
      restartIdleTimer()
    }
  }

  /* What Ask lists: the chosen size, once it is on this Mac. */
  function models() {
    const tier = tierById(chosen)
    if (!tier || !isReady(tier)) return []
    return [{ id: `osat:${tier.id}`, name: mock ? 'Practice model' : `${tier.model} · ${tier.label}`, runtime: 'osat', offline: true }]
  }

  function dispose() {
    transfer?.abort?.()
    stopEngine()
  }

  return { status, choose, cancel, remove, resume: () => fetchTier(chosen), start, models, chatStream, dispose }
}

module.exports = { createAi, MAX_TOKENS }
