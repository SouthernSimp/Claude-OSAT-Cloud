/* Installed models, a default for new questions, and one isolated process per
   loaded model. Selecting never loads; interactive requests may wake a model.
   Retained models stay until quit. Ordinary ones release memory after ten minutes. */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { setTimeout: sleep } = require('node:timers/promises')
const { TIERS, pickTier, tierById } = require('./catalog.cjs')
const { downloadFile } = require('./download.cjs')

const IDLE = 10 * 60 * 1000
const MAX_TOKENS = 2048
const GB = 1024 ** 3

function createAi({
  dir, totalMemory, chosen: initial = null, save = async () => {}, fork, emit = () => {},
  download = downloadFile, mock = false, idle = IDLE, retryDelay = 3000,
  estimate = async () => null, freeMemory = () => os.freemem(),
  confirmLoad = async () => 'cancel', confirmUnload = async () => false,
  startup = false, saveStartup = async () => {}, downloadQueue = [], saveQueue = async () => {},
  stopTimeout = 10000,
}) {
  let chosen = tierById(initial) ? initial : null
  let autoLoad = startup === true
  let transfer = null
  let queued = downloadQueue.filter((id, index, list) => tierById(id) && list.indexOf(id) === index)
  let paused = false
  let disposed = false
  let seq = 0
  let lastEmit = 0
  let lifecycle = Promise.resolve()
  const engines = new Map()
  const blocked = new Set()
  const estimates = new Map()
  const fileFor = (tier) => path.join(dir, tier.file)
  const isReady = (tier) => {
    if (mock) return true
    try { return fs.statSync(fileFor(tier)).size === tier.size } catch { return false }
  }
  const stateOf = (id) => engines.get(id)?.state || 'idle'
  const busy = (entry) => entry.state === 'loading' || entry.state === 'unloading' || entry.requests > 0
  const exclusive = (fn) => {
    const run = lifecycle.catch(() => {}).then(() => {
      if (disposed) throw new Error('The AI has closed.')
      return fn()
    })
    lifecycle = run.catch(() => {})
    return run
  }

  function status() {
    return {
      recommended: pickTier(totalMemory).id, chosen, startup: autoLoad, totalMemory,
      tiers: TIERS.map((tier) => {
        const entry = engines.get(tier.id)
        return { id: tier.id, label: tier.label, model: tier.model, blurb: tier.blurb,
          size: tier.size, ready: isReady(tier), state: stateOf(tier.id),
          busy: Boolean(entry && busy(entry)), retained: Boolean(entry?.retained),
          blocked: blocked.has(tier.id), message: entry?.message || '',
          estimatedMemory: entry?.bytes || estimates.get(tier.id)?.bytes || null }
      }),
      download: transfer && { tier: transfer.tier, received: transfer.received, total: transfer.total, state: transfer.state, message: transfer.message },
      queued: [...queued],
      engine: stateOf(chosen), message: engines.get(chosen)?.message || '',
    }
  }

  function changed(force = false) {
    const now = Date.now()
    if (!force && now - lastEmit < 250) return
    lastEmit = now
    emit(status())
  }

  /* One resumable transfer at a time. Installation never changes the default. */
  async function rememberQueue() { await saveQueue([...queued]) }
  function pump() {
    if (disposed || paused || transfer?.state === 'running') return transfer?.done
    while (queued.length && isReady(tierById(queued[0]))) queued.shift()
    const tier = tierById(queued[0])
    if (!tier) { transfer = null; changed(true); return Promise.resolve() }
    const controller = new AbortController()
    const mine = { tier: tier.id, received: 0, total: tier.size, state: 'running', message: '', abort: () => controller.abort() }
    transfer = mine
    changed(true)
    mine.done = (async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await download({ url: tier.url, dest: fileFor(tier), size: tier.size, sha256: tier.sha256, signal: controller.signal,
            onProgress: (received) => { mine.received = received; if (transfer === mine) changed() } })
          if (transfer !== mine) return
          queued = queued.filter((id) => id !== tier.id)
          await rememberQueue()
          transfer = null
          changed(true)
          pump()
          return
        } catch (error) {
          if (transfer !== mine) return
          if (controller.signal.aborted) { transfer = { ...mine, state: 'paused' }; changed(true); return }
          if (attempt >= 4 || error.code === 'NO_SPACE' || error.code === 'CHECKSUM') {
            paused = true
            transfer = { ...mine, state: 'failed', message: error.code ? error.message : 'The download stopped. Check the internet connection, then try again.' }
            changed(true)
            return
          }
          try { await sleep(retryDelay * attempt, undefined, { signal: controller.signal }) } catch {
            transfer = { ...mine, state: 'paused' }; changed(true); return
          }
        }
      }
    })()
    return mine.done
  }

  async function install(ids) {
    const list = Array.isArray(ids) ? ids : [ids]
    if (!list.length || list.length > TIERS.length || list.some((id) => !tierById(id))) throw new Error('Choose an OSAT model to download.')
    await fsp.mkdir(dir, { recursive: true })
    const before = [...queued]
    for (const id of list) if (!isReady(tierById(id)) && !queued.includes(id)) queued.push(id)
    try { await rememberQueue() } catch (error) { queued = before; throw error }
    paused = false
    pump()
    return status()
  }

  async function select(id) {
    if (!tierById(id)) throw new Error('That size is not one OSAT knows.')
    const previous = chosen
    chosen = id
    try { await save(id) } catch (error) { chosen = previous; throw error }
    changed(true)
    return status()
  }
  // First-run compatibility: the welcome explicitly chooses and downloads a size.
  async function choose(id) { await select(id); return install(id) }
  function cancel() { paused = true; transfer?.abort?.(); return transfer?.done }
  function resume() {
    if (transfer?.state === 'running') return transfer.done
    if (!queued.length && chosen && !isReady(tierById(chosen))) queued.push(chosen)
    paused = false
    const done = pump()
    rememberQueue().catch(() => {})
    return done
  }
  async function setStartup(value) {
    if (typeof value !== 'boolean') throw new Error('Choose whether AI loads at startup.')
    await saveStartup(value)
    autoLoad = value
    changed(true)
    return status()
  }
  function start({ downloads = true } = {}) {
    for (const tier of TIERS) if (!isReady(tier) && fs.existsSync(fileFor(tier) + '.part') && !queued.includes(tier.id)) queued.push(tier.id)
    rememberQueue().then(() => { if (downloads) pump() }).catch(() => {})
    if (autoLoad && chosen && isReady(tierById(chosen))) {
      load(chosen, { interactive: false }).catch((error) => {
        const entry = engines.get(chosen) || newEntry(chosen)
        entry.state = 'error'; entry.message = error.message; changed(true)
      })
    }
  }

  function newEntry(id) {
    const entry = { id, state: 'idle', message: '', child: null, loading: null, stopping: null,
      requests: 0, pending: new Map(), timer: null, retained: false, bytes: null }
    engines.set(id, entry)
    return entry
  }
  function failPending(entry, message) {
    for (const job of entry.pending.values()) job.reject(new Error(message))
    entry.pending.clear()
  }
  async function stop(entry, manual = false) {
    if (entry.stopping) return entry.stopping
    clearTimeout(entry.timer)
    entry.timer = null
    if (!entry.child) {
      entry.state = 'idle'; entry.retained = false
      if (manual) blocked.add(entry.id)
      changed(true)
      return
    }
    entry.state = 'unloading'
    changed(true)
    const proc = entry.child
    entry.stopping = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { entry.stopping = null; reject(new Error('The AI process has not stopped yet. Try again.')) }, stopTimeout)
      const exited = () => {
        clearTimeout(timer)
        proc.removeAllListeners?.()
        entry.child = null; entry.loading = null; entry.stopping = null
        entry.state = 'idle'; entry.retained = false; entry.message = ''
        if (manual) blocked.add(entry.id)
        changed(true)
        resolve()
      }
      proc.once('exit', exited)
      try { proc.kill() } catch (error) { clearTimeout(timer); proc.removeListener('exit', exited); entry.stopping = null; reject(error) }
    })
    return entry.stopping
  }
  function restartIdle(entry) {
    clearTimeout(entry.timer)
    if (entry.retained || entry.requests || entry.state !== 'ready') return
    entry.timer = setTimeout(() => exclusive(async () => {
      if (!entry.requests && !entry.retained && entry.state === 'ready') await stop(entry)
    }).catch(() => {}), idle)
    entry.timer.unref?.()
  }

  async function preflight(id, keepOthers = false) {
    const tier = tierById(id)
    if (!tier || !isReady(tier)) throw new Error('Download this model in Settings → AI first.')
    let measured = estimates.get(id)
    if (!measured) {
      measured = mock ? { bytes: 1024 } : await Promise.resolve().then(() => estimate(fileFor(tier))).catch(() => null)
      if (Number.isFinite(measured?.bytes) && measured.bytes > 0) estimates.set(id, measured)
      else measured = null
    }
    const others = [...engines.values()].filter((entry) => entry.id !== id && (entry.child || mock && entry.state === 'ready') && entry.state !== 'error')
    const retained = others.filter((entry) => entry.retained)
    const replacing = keepOthers ? [] : others.filter((entry) => !entry.retained)
    const free = mock ? totalMemory : Math.max(0, Math.min(totalMemory, Number(freeMemory()) || 0))
    const reserve = Math.max(2 * GB, totalMemory * 0.1)
    const released = replacing.reduce((sum, entry) => sum + (entry.bytes || 0), 0)
    const remaining = measured ? free + released - measured.bytes : null
    const low = tier.minMemory > totalMemory * 1.03 || (remaining !== null && remaining < reserve)
    const lowKeeping = tier.minMemory > totalMemory * 1.03 || (measured && free - measured.bytes < reserve)
    return { tier: id, label: tier.label, totalMemory, freeMemory: free, estimatedMemory: measured?.bytes || null,
      combinedMemory: measured && others.every((entry) => entry.bytes) ? measured.bytes + others.reduce((sum, entry) => sum + entry.bytes, 0) : null,
      others: others.map((entry) => ({ id: entry.id, label: tierById(entry.id).label, retained: entry.retained, busy: busy(entry) })),
      replacing: replacing.map((entry) => entry.id), low, lowKeeping: Boolean(lowKeeping), keepOthers, estimate: measured,
      needsConfirmation: low || replacing.some((entry) => entry.id !== 'light') || (others.length > 0 && (keepOthers || retained.length > 0)) }
  }

  async function wake(entry) {
    if (entry.state === 'ready' || entry.state === 'loading') return entry.loading
    entry.state = 'loading'; entry.message = ''; changed(true)
    if (mock) { entry.state = 'ready'; changed(true); return }
    let proc
    try { proc = fork() } catch (error) { entry.state = 'error'; entry.message = error.message; changed(true); throw error }
    entry.child = proc
    entry.loading = new Promise((resolve, reject) => {
      const loadingTimer = setTimeout(() => {
        entry.message = 'The model took too long to start. Try a smaller model.'
        reject(new Error(entry.message))
        failPending(entry, entry.message)
        stop(entry).catch(() => {})
      }, 180000)
      loadingTimer.unref?.()
      proc.on('message', (message) => {
        if (entry.child !== proc || entry.state === 'unloading') return
        if (message?.type === 'loaded') {
          clearTimeout(loadingTimer)
          entry.state = 'ready'; changed(true); resolve()
        } else if (message?.type === 'error' && !message.id) {
          clearTimeout(loadingTimer)
          entry.message = 'The model could not start (' + message.message + ').'
          reject(new Error(entry.message))
          const errorText = entry.message
          stop(entry).then(() => { entry.state = 'error'; entry.message = errorText; changed(true) }).catch(() => {})
        } else {
          const job = entry.pending.get(message?.id)
          if (!job) return
          if (message.type === 'delta') { job.text += message.text; job.onDelta(message.text) }
          else {
            entry.pending.delete(message.id)
            if (message.type === 'done') job.resolve(job.text)
            else job.reject(new Error(message.message || 'The AI could not answer.'))
          }
        }
      })
      proc.on('exit', () => {
        clearTimeout(loadingTimer)
        if (entry.child !== proc || entry.state === 'unloading') return
        entry.child = null; entry.loading = null
        const wasLoading = entry.state === 'loading'
        entry.state = 'error'
        entry.message = wasLoading ? 'The model stopped while starting. This Mac may need a smaller size.' : 'The AI stopped unexpectedly. Try again.'
        reject(new Error(entry.message)); failPending(entry, entry.message); changed(true)
      })
    })
    proc.postMessage({ type: 'load', modelPath: fileFor(tierById(entry.id)) })
    return entry.loading
  }

  async function ensure(id, { interactive = false, keepOthers = false, retain = false, signal } = {}) {
    signal?.throwIfAborted()
    const entry = engines.get(id) || newEntry(id)
    if (!interactive && blocked.has(id)) throw new Error('The AI is unloaded. Ask a question or load it in Settings → AI.')
    if (entry.state === 'ready') {
      if (retain) entry.retained = true
      if (interactive) blocked.delete(id)
      clearTimeout(entry.timer)
      changed(true)
      return entry
    }
    if (entry.state === 'unloading') throw new Error('The model is still unloading. Try again in a moment.')
    const info = await preflight(id, keepOthers || retain)
    if (!interactive && (info.others.length || info.low)) throw new Error('Load this model in Settings → AI before using it in the background.')
    let mode = (keepOthers || retain) ? 'alongside' : 'replace'
    if (info.needsConfirmation) {
      if (!interactive) throw new Error('This model needs a memory review in Settings → AI.')
      mode = await confirmLoad(info)
      if (!['replace', 'alongside'].includes(mode)) throw new Error('Model loading cancelled.')
    }
    // Both checks and allocation are inside the lifecycle queue; a second window
    // cannot race the approval or reclaim another question's process.
    signal?.throwIfAborted()
    const others = [...engines.values()].filter((other) => other.id !== id && (other.child || mock && other.state === 'ready'))
    const replacing = mode === 'replace' ? others.filter((other) => !other.retained) : []
    if (replacing.some(busy)) throw new Error('Another model is busy. Wait until it finishes or choose Keep both.')
    if (mode === 'alongside') for (const other of others) { other.retained = true; clearTimeout(other.timer) }
    for (const other of replacing) await stop(other)
    entry.retained = retain || mode === 'alongside'
    entry.bytes = info.estimatedMemory
    if (interactive) blocked.delete(id)
    await wake(entry)
    restartIdle(entry)
    return entry
  }
  function load(id, options = {}) { return exclusive(async () => { await ensure(id, options); return status() }) }
  function setRetained(id, value) {
    if (typeof value !== 'boolean' || !tierById(id)) return Promise.reject(new Error('Choose whether to keep this model loaded.'))
    if (value) return load(id, { interactive: true, retain: true, keepOthers: true })
    return exclusive(() => {
      const entry = engines.get(id)
      if (entry) { entry.retained = false; restartIdle(entry); changed(true) }
      return status()
    })
  }
  function unload(id, { interactive = true } = {}) {
    return exclusive(async () => {
      const entry = engines.get(id)
      if (!tierById(id)) throw new Error('Choose an OSAT model.')
      if (entry && busy(entry)) throw new Error('This model is busy. Wait until its work finishes.')
      if (entry?.child && id !== 'light' && interactive && !(await confirmUnload([id]))) return status()
      if (entry && busy(entry)) throw new Error('This model is busy. Wait until its work finishes.')
      if (entry) await stop(entry, true)
      else blocked.add(id)
      changed(true)
      return status()
    })
  }
  function unloadAll() {
    return exclusive(async () => {
      const idleEntries = [...engines.values()].filter((entry) => entry.state === 'ready' && !busy(entry))
      const busyModels = () => [...engines.values()].filter((entry) => busy(entry)).map((entry) => entry.id)
      if (idleEntries.some((entry) => entry.id !== 'light') && !(await confirmUnload(idleEntries.map((entry) => entry.id)))) return { ...status(), unloaded: [], busyModels: busyModels(), cancelled: true }
      // A question can queue while the native confirmation is open. It takes
      // precedence over reclaiming its model, even before inference begins.
      const unloading = idleEntries.filter((entry) => !busy(entry))
      for (const entry of unloading) await stop(entry, true)
      for (const tier of TIERS) if (!engines.get(tier.id)?.requests && stateOf(tier.id) !== 'loading') blocked.add(tier.id)
      changed(true)
      return { ...status(), unloaded: unloading.map((entry) => entry.id), busyModels: busyModels() }
    })
  }
  function remove(id) {
    return exclusive(async () => {
      if (!tierById(id)) throw new Error('Choose an OSAT model.')
      const entry = engines.get(id)
      if (entry && busy(entry)) throw new Error('This model is busy. Wait until its work finishes.')
      if (entry) await stop(entry, true)
      if (transfer?.tier === id) { transfer.abort?.(); await transfer.done; transfer = null }
      queued = queued.filter((item) => item !== id)
      await rememberQueue()
      await fsp.rm(fileFor(tierById(id)), { force: true })
      await fsp.rm(fileFor(tierById(id)) + '.part', { force: true })
      estimates.delete(id)
      if (chosen === id) { await save(null); chosen = null }
      changed(true)
      if (!paused) pump()
      return status()
    })
  }

  async function practiceAnswer(messages, onDelta, signal) {
    const content = String(messages.at(-1)?.content || '')
    const question = content.split('\n')[0].slice(0, 160)
    const files = (content.match(/^\[FILE: /gm) || []).length
    const text = 'This is OSAT\'s practice model, used for tests. You asked: “' + question + '”' + (files ? ' It read ' + (files === 1 ? 'one file' : files + ' files') + '.' : '')
    for (const word of text.split(/(?<= )/)) { if (signal?.aborted) break; onDelta(word); await sleep(4) }
    return text
  }

  async function chatStream({ model, messages, schema }, onDelta, signal, { interactive = false } = {}) {
    const id = model ? (model.startsWith('osat:') ? model.slice(5) : null) : chosen
    if (!tierById(id) || !isReady(tierById(id))) throw new Error('The AI is not set up yet. Choose a size in Settings → AI.')
    signal?.throwIfAborted()
    const entry = engines.get(id) || newEntry(id)
    entry.requests += 1
    clearTimeout(entry.timer); changed(true)
    try {
      await exclusive(() => ensure(id, { interactive, signal }))
      signal?.throwIfAborted()
      if (mock) return await practiceAnswer(messages, onDelta, signal)
      const jobId = 'chat-' + ++seq
      let abort
      try {
        return await new Promise((resolve, reject) => {
          entry.pending.set(jobId, { text: '', onDelta, resolve, reject })
          abort = () => entry.child?.postMessage({ type: 'cancel', id: jobId })
          signal?.addEventListener('abort', abort, { once: true })
          entry.child.postMessage({ type: 'chat', id: jobId, messages, maxTokens: MAX_TOKENS, schema })
        })
      } finally { signal?.removeEventListener('abort', abort) }
    } finally { entry.requests -= 1; restartIdle(entry); changed(true) }
  }

  function models() {
    const ready = TIERS.filter(isReady)
    const preferred = ready.find((tier) => tier.id === chosen) || ready.find((tier) => tier.id === pickTier(totalMemory).id) || ready[0]
    return ready.sort((a, b) => Number(b === preferred) - Number(a === preferred)).map((tier) => ({
      id: 'osat:' + tier.id, name: mock ? 'Practice model' : tier.model + ' · ' + tier.label,
      label: tier.label, runtime: 'osat', offline: true, state: stateOf(tier.id),
      recommended: tier.id === pickTier(totalMemory).id,
    }))
  }
  function dispose() {
    disposed = true; paused = true; transfer?.abort?.()
    for (const entry of engines.values()) {
      clearTimeout(entry.timer)
      failPending(entry, 'The AI was stopped.')
      entry.child?.kill()
    }
  }

  return { status, choose, select, install, cancel, remove, resume, start, models, chatStream, dispose,
    preflight, load, unload, unloadAll, setRetained, setStartup }
}
module.exports = { createAi, MAX_TOKENS }
