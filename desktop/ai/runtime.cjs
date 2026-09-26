/* The AI engine, in its own process (Electron utilityProcess) so a model that runs
   out of memory can never take the notes down with it. It loads one model file
   and answers one chat at a time; the main process sends:
     { type: 'probe' }                      → { type: 'probe', gpu }  (the engine loads; no model needed)
     { type: 'load', modelPath }            → { type: 'loaded' } | { type: 'error', message }
     { type: 'chat', id, messages, maxTokens } → { type: 'delta', id, text }… then { type: 'done', id } | { type: 'error', id, message }
     { type: 'cancel', id }                                                                      */
const port = process.parentPort

let engine = null
let queue = Promise.resolve()
const running = new Map()

let llamaReady = null
function llama() {
  llamaReady ??= import('node-llama-cpp').then(({ getLlama }) => getLlama({ build: 'never', logLevel: 'error' }))
  return llamaReady
}

async function load(modelPath) {
  const { LlamaChat, resolveChatWrapper } = await import('node-llama-cpp')
  const model = await (await llama()).loadModel({ modelPath })
  const context = await model.createContext({ contextSize: { max: 8192 } })
  // Gemma 4 thinks out loud by default; OSAT wants a calm, direct answer.
  const chatWrapper = resolveChatWrapper(model, { customWrapperSettings: { gemma4: { reasoning: false } } })
  engine = { chat: new LlamaChat({ contextSequence: context.getSequence(), chatWrapper }) }
}

const toHistory = (messages) => messages.map((message) => (
  message.role === 'assistant'
    ? { type: 'model', response: [message.content] }
    : { type: message.role, text: message.content }
))

async function chat({ id, messages, maxTokens }, controller) {
  try {
    if (!controller.signal.aborted) await engine.chat.generateResponse(toHistory(messages), {
      signal: controller.signal,
      stopOnAbortSignal: true,
      maxTokens,
      budgets: { thoughtTokens: 0 },
      onTextChunk: (text) => port.postMessage({ type: 'delta', id, text }),
    })
    port.postMessage({ type: 'done', id })
  } finally {
    running.delete(id)
  }
}

port.on('message', ({ data }) => {
  if (data?.type === 'probe') {
    llama().then(
      (engine) => port.postMessage({ type: 'probe', gpu: engine.gpu || 'cpu' }),
      (error) => port.postMessage({ type: 'error', message: String(error?.message || error) }),
    )
  } else if (data?.type === 'load') {
    load(data.modelPath).then(
      () => port.postMessage({ type: 'loaded' }),
      (error) => port.postMessage({ type: 'error', message: String(error?.message || error) }),
    )
  } else if (data?.type === 'chat') {
    if (!engine) {
      port.postMessage({ type: 'error', id: data.id, message: 'The model is not loaded yet.' })
      return
    }
    // Queued chats can be cancelled before their turn comes.
    const controller = new AbortController()
    running.set(data.id, controller)
    queue = queue.then(() => chat(data, controller)).catch((error) => {
      port.postMessage({ type: 'error', id: data.id, message: String(error?.message || error) })
    })
  } else if (data?.type === 'cancel') {
    running.get(data.id)?.abort()
  }
})
