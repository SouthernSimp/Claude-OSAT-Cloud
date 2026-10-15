const LOCAL_AI_UPSTREAM = 'http://127.0.0.1:1234'
const MAX_MESSAGE_CHARS = 32_000
const MAX_MESSAGES = 50
const MAX_TOKENS = 2048

function validateLocalChatPayload(payload) {
  const { model, messages } = payload || {}
  if (typeof model !== 'string' || !model.trim() || model.length > 300 || /:\/\//.test(model) || model.startsWith('/')) {
    throw new Error('Choose a local model.')
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new Error('A chat needs between 1 and 50 messages.')
  }
  for (const message of messages) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' || !message.content.trim() || message.content.length > MAX_MESSAGE_CHARS) {
      throw new Error('Messages must have a role and non-empty text.')
    }
  }
  // `background`: filing on its own (src/sky/useAutoFile.js) never wakes a model the way a question does.
  return { model: model.trim(), messages: messages.map(withPictures), ...(payload.background === true ? { background: true } : {}) }
}

/* A question may carry pictures (Phase 37b): up to four, each a PNG, JPEG, WebP or GIF as base64, none over
   about 10 MB. Only a question (a user message) carries them; anything else about a picture is refused. */
const MAX_PICTURES = 4
const MAX_PICTURE_CHARS = 14_000_000
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
function withPictures(message) {
  if (message.images === undefined) return { role: message.role, content: message.content }
  if (message.role !== 'user' || !Array.isArray(message.images) || !message.images.length || message.images.length > MAX_PICTURES) {
    throw new Error('A question can carry up to four pictures.')
  }
  const images = message.images.map((image) => {
    if (!image || !PICTURE_TYPES.includes(image.type) || typeof image.data !== 'string' || !image.data
      || image.data.length > MAX_PICTURE_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
      throw new Error('That picture can’t be read. Try a PNG or JPEG under 10 MB.')
    }
    return { type: image.type, data: image.data }
  })
  return { role: 'user', content: message.content, images }
}

const hasPictures = (messages) => messages.some((message) => message.images?.length)

/* An OpenAI-style answer as it streams: each piece to onDelta, the whole of it back. */
async function readStream(body, onDelta) {
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const drain = (frame) => {
    const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
    if (!data || data === '[DONE]') return data === '[DONE]'
    try {
      const delta = JSON.parse(data).choices?.[0]?.delta?.content
      if (delta) {
        text += delta
        onDelta(delta)
      }
    } catch {
      /* keep-alives and partial frames are not fatal */
    }
    return false
  }
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) if (drain(frame)) return text
  }
  drain(buffer)
  if (!text.trim()) throw new Error('Local AI returned no response.')
  return text
}

async function localAiModels() {
  const response = await fetch(`${LOCAL_AI_UPSTREAM}/api/v0/models`, { signal: AbortSignal.timeout(1500) })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error('LM Studio rejected the local request.')
  return (body.data || []).filter((model) => model.type === 'llm' && model.state === 'loaded')
    .map((model) => ({ id: model.id, name: model.id === 'osat-local' ? 'Llama 3.3 · 70B' : model.id, runtime: 'lm-studio', offline: true }))
}

/* Streams an answer from LM Studio, invoking onDelta with each text fragment. */
async function localAiChatStream(payload, onDelta, signal) {
  const valid = validateLocalChatPayload(payload)
  if (hasPictures(valid.messages)) throw new Error('Pictures go to OSAT’s own AI for now. Choose it in the model menu.')
  if (!(await localAiModels()).some((model) => model.id === valid.model)) throw new Error('Choose a loaded local model.')
  const upstream = await fetch(`${LOCAL_AI_UPSTREAM}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: valid.model, messages: valid.messages, max_tokens: MAX_TOKENS, stream: true }),
  })
  if (!upstream.ok || !upstream.body) throw new Error('LM Studio rejected the local request.')
  return readStream(upstream.body, onDelta)
}

module.exports = { localAiChatStream, localAiModels, validateLocalChatPayload, readStream, hasPictures }
