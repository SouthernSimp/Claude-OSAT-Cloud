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
  return { model: model.trim(), messages }
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
  if (!(await localAiModels()).some((model) => model.id === valid.model)) throw new Error('Choose a loaded local model.')
  const upstream = await fetch(`${LOCAL_AI_UPSTREAM}/v1/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...valid, max_tokens: MAX_TOKENS, stream: true }),
  })
  if (!upstream.ok || !upstream.body) throw new Error('LM Studio rejected the local request.')
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
  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) if (drain(frame)) return text
  }
  drain(buffer)
  if (!text.trim()) throw new Error('Local AI returned no response.')
  return text
}

module.exports = { localAiChatStream, localAiModels, validateLocalChatPayload }
