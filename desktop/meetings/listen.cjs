/* The listening engine (whisper.cpp through @fugood/whisper.node), in its own process (Electron
   utilityProcess), like the AI's: a crash or a lack of memory can never take the notes down, and when
   the meeting is written up the process ends and the model's memory goes with it. The main process sends:
     { type: 'transcribe', id, modelPath, pcmPath, language, windows } → { type: 'progress', id, percent }…
                                                              then { type: 'done', id, segments: [{ start, end, text }] (ms) }
                                                              or { type: 'error', id, message }
     { type: 'cancel', id }
     { type: 'probe' }                                      → { type: 'probe', ok } (the engine loads; no model needed: CI's check)
   `pcmPath` is raw 16 kHz mono 16-bit sound and `windows` ([{ start, end }], ms) the stretches of it with someone
   talking (shared/meeting-model.mjs speechWindows): only those are heard, one at a time, because whisper
   shown a long silence makes words up. The segments come back with their times in the whole sound. The engine is never given a download address, so it
   cannot fetch anything itself (the fence in tests/under.test.mjs). */
const fs = require('node:fs/promises')
const port = process.parentPort

let context = null
const stops = new Map()
const cancelled = new Set()

async function hear({ id, modelPath, pcmPath, language, windows }) {
  const { initWhisper } = require('@fugood/whisper.node')
  const bytes = await fs.readFile(pcmPath)
  const sound = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - (bytes.byteLength % 2))
  context ??= await initWhisper({ filePath: modelPath, useGpu: true })
  const segments = []
  cancelled.delete(id)
  for (const [index, window] of windows.entries()) {
    // 16 samples a millisecond, 2 bytes each.
    const piece = sound.slice(Math.floor(window.start * 16) * 2, Math.min(sound.byteLength, Math.floor(window.end * 16) * 2))
    const { stop, promise } = context.transcribeData(piece, { language })
    stops.set(id, stop)
    const result = await promise
    if (result.isAborted || cancelled.has(id)) throw new Error('Stopped.')
    for (const segment of result.segments) segments.push({ start: segment.t0 + window.start, end: segment.t1 + window.start, text: segment.text })
    port.postMessage({ type: 'progress', id, percent: ((index + 1) / windows.length) * 100 })
  }
  return segments
}

async function transcribe(job) {
  let answer
  try {
    answer = { type: 'done', id: job.id, segments: await hear(job) }
  } catch (error) {
    answer = { type: 'error', id: job.id, message: String(error?.message || error) }
  }
  stops.delete(job.id)
  cancelled.delete(job.id)
  // The model's memory goes back before anything is said (the AI needs it next), so that ending this process never
  // finds the GPU in use.
  const finished = context
  context = null
  await finished?.release().catch(() => {})
  port.postMessage(answer)
}

port.on('message', ({ data }) => {
  if (data?.type === 'transcribe') transcribe(data)
  else if (data?.type === 'cancel') { cancelled.add(data.id); stops.get(data.id)?.() }
  else if (data?.type === 'probe') {
    try {
      require('@fugood/whisper.node')
      port.postMessage({ type: 'probe', ok: true })
    } catch (error) {
      port.postMessage({ type: 'probe', ok: false, message: String(error?.message || error) })
    }
  }
})
