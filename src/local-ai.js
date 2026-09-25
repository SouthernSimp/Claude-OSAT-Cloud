const API_ROOT = '/api/local-ai'
const MAX_MESSAGE_CHARS = 32_000
const MAX_MESSAGES = 50

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

export function isLoopbackOrigin(origin) {
  if (!origin) return true
  try {
    const { hostname, protocol } = new URL(origin)
    return ['http:', 'https:'].includes(protocol) && ['localhost', '127.0.0.1', '::1'].includes(hostname)
  } catch {
    return false
  }
}

/* Parses one OpenAI-style SSE frame into its text delta.
   Returns '' for keep-alives and null for the terminal [DONE] frame. */
export function parseStreamFrame(frame) {
  const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
  if (!data) return ''
  if (data === '[DONE]') return null
  try {
    const parsed = JSON.parse(data)
    if (parsed.error) throw new Error(typeof parsed.error === 'string' ? parsed.error : parsed.error.message || 'Local AI failed.')
    return parsed.choices?.[0]?.delta?.content || ''
  } catch (error) {
    if (error instanceof SyntaxError) return ''
    throw error
  }
}

export { validateLocalChatPayload }

async function request(path, options = {}) {
  const native = globalThis.window?.osatLocalAI
  if (native) {
    options.signal?.throwIfAborted()
    const body = path === '/models' ? await native.models() : await native.chat(JSON.parse(options.body))
    options.signal?.throwIfAborted()
    if (body.error) throw new Error(body.error)
    return body
  }
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers: { 'content-type': 'application/json', ...options.headers } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Local AI is unavailable (${response.status}).`)
  return body
}

export async function getLocalModels({ signal } = {}) {
  const body = await request('/models', { signal })
  return Array.isArray(body.models) ? body.models : []
}

export async function sendLocalMessage({ model, messages, signal }) {
  const body = await request('/chat', {
    method: 'POST',
    signal,
    body: JSON.stringify(validateLocalChatPayload({ model, messages })),
  })
  if (typeof body.response !== 'string') throw new Error('Local AI returned no response.')
  return body.response
}

/* Streams a reply, calling onDelta with each text fragment as it arrives.
   Resolves with the complete text. Aborting keeps whatever already streamed. */
export async function streamLocalMessage({ model, messages, signal, onDelta }) {
  const payload = validateLocalChatPayload({ model, messages })
  const emit = (text) => {
    if (text) onDelta?.(text)
  }

  const native = globalThis.window?.osatLocalAI
  if (native?.chatStream) {
    signal?.throwIfAborted()
    return native.chatStream(payload, emit, signal)
  }

  const response = await fetch(`${API_ROOT}/chat`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(payload),
  })

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Local AI is unavailable (${response.status}).`)
  }

  // Non-streaming fallback if the runtime answered with plain JSON.
  if (!/text\/event-stream/i.test(response.headers.get('content-type') || '')) {
    const body = await response.json().catch(() => ({}))
    if (body.error) throw new Error(body.error)
    if (typeof body.response !== 'string') throw new Error('Local AI returned no response.')
    emit(body.response)
    return body.response
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const delta = parseStreamFrame(frame)
        if (delta === null) return text
        text += delta
        emit(delta)
      }
    }
    const tail = parseStreamFrame(buffer)
    if (tail) {
      text += tail
      emit(tail)
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  if (!text.trim()) throw new Error('The local model returned no answer. Try again.')
  return text
}

export { API_ROOT, MAX_MESSAGE_CHARS, MAX_MESSAGES }
