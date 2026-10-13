/* The listening model: whisper.cpp's large-v3-turbo (OpenAI's Whisper, MIT), one file pinned to an exact
   revision and checked against its SHA-256, in `<data folder>/models/` beside the AI's. It is fetched the
   same resumable way (ai/download.cjs), by the main process, so Offline's lock covers it; the engine that
   reads it (listen.cjs) is never given an address to fetch from. */
const fs = require('node:fs')
const path = require('node:path')
const { downloadFile } = require('../ai/download.cjs')

const EARS = {
  file: 'ggml-large-v3-turbo-q5_0.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin',
  size: 574041195,
  sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
}

function createEars({ dir, download = downloadFile, emit = () => {}, ears = EARS }) {
  const file = path.join(dir, ears.file)
  let transfer = null

  const ready = () => {
    try { return fs.statSync(file).size === ears.size } catch { return false }
  }
  const status = () => ({
    ready: ready(),
    size: ears.size,
    download: transfer && { received: transfer.received, total: ears.size, state: transfer.state, message: transfer.message },
  })
  let last = 0
  const changed = (force = false) => {
    const now = Date.now()
    if (!force && now - last < 250) return
    last = now
    emit(status())
  }

  /* Starts (or picks up again) the download. Returns at once; `emit` says how it goes. */
  function install() {
    if (ready() || transfer?.state === 'running') return status()
    const controller = new AbortController()
    const mine = { received: 0, state: 'running', message: '', abort: () => controller.abort() }
    transfer = mine
    mine.done = download({
      url: ears.url, dest: file, size: ears.size, sha256: ears.sha256, signal: controller.signal,
      onProgress: (received) => { mine.received = received; if (transfer === mine) changed() },
    }).then(
      () => { if (transfer === mine) transfer = null; changed(true) },
      (error) => {
        if (transfer !== mine) return
        transfer = controller.signal.aborted
          ? { ...mine, state: 'paused' }
          : { ...mine, state: 'failed', message: error.code ? error.message : 'The download stopped. Check the internet connection, then try again.' }
        changed(true)
      },
    )
    changed(true)
    return status()
  }

  function cancel() {
    transfer?.abort?.()
    return status()
  }

  return { status, install, cancel, path: () => (ready() ? file : null), done: () => transfer?.done || Promise.resolve() }
}

module.exports = { EARS, createEars }
