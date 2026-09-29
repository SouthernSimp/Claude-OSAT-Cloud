/* Cloud models (Settings → Bots): connect a provider with its key, pick a model, and it
   answers the line, Ask, Help me sort, Unpack with AI and scans. Paste a key → OSAT checks
   it by listing the provider's models → the key goes to the Keychain → it just works.
   A running total of what was used sits beside the key. `core` is shared/providers.mjs;
   the settings, the Keychain, fetch and the clock are passed in. */

const MAX_TOKENS = 2048
const CHECK_MS = 15000

class CloudError extends Error {}

/* One OpenAI-style stream frame: its text, the usage when the provider reports it, or done. */
function readFrame(frame) {
  const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
  if (!data) return {}
  if (data === '[DONE]') return { done: true }
  try {
    const parsed = JSON.parse(data)
    if (parsed.error) return { error: typeof parsed.error === 'string' ? parsed.error : parsed.error.message || 'failed' }
    const usage = parsed.usage ? { input: parsed.usage.prompt_tokens, output: parsed.usage.completion_tokens } : null
    // Reasoning models also stream their thinking (reasoning_content); only the answer shows.
    return { text: parsed.choices?.[0]?.delta?.content || '', usage }
  } catch {
    return {} // keep-alives and partial frames are not fatal
  }
}

const failureOf = (error) => (error?.name === 'TimeoutError' ? 'TIMEOUT' : error?.code || error?.cause?.code || '')

/* The OpenAI way: POST <base>/chat/completions, streamed. Resolves { text, usage }. */
async function openAiStream({ baseUrl, key, model, messages, onDelta = () => {}, signal, fetch, name, explain, maxTokens = MAX_TOKENS }) {
  const send = (withUsage) => fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens, ...(withUsage ? { stream_options: { include_usage: true } } : {}) }),
  })
  let response
  try {
    response = await send(true)
    // A few providers don't know stream_options: ask again without it.
    if (response.status === 400) {
      const body = await response.text()
      if (/stream_options/i.test(body)) response = await send(false)
      else throw new CloudError(explain({ status: 400, body, name, model }))
    }
  } catch (error) {
    if (error instanceof CloudError || error?.name === 'AbortError') throw error
    throw new CloudError(explain({ code: failureOf(error), name }))
  }
  if (!response.ok || !response.body) throw new CloudError(explain({ status: response.status, body: await response.text().catch(() => ''), name, model }))
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage = null
  const take = (frame) => {
    const part = readFrame(frame)
    if (part.error) throw new CloudError(`${name} stopped: ${String(part.error).slice(0, 200)}`)
    if (part.text) { text += part.text; onDelta(part.text) }
    if (part.usage) usage = part.usage
    return part.done
  }
  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      if (frames.some(take)) break
    }
    take(buffer)
  } catch (error) {
    if (error instanceof CloudError || error?.name === 'AbortError') throw error
    throw new CloudError(explain({ code: failureOf(error), name }))
  }
  if (!text.trim()) throw new CloudError(`${name} sent back no answer. Try again.`)
  return { text, usage }
}

/* GET <base>/models with the key: the models on offer, and proof the key works. */
async function openAiModels({ baseUrl, key, fetch, name, explain }) {
  let response
  try {
    response = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(CHECK_MS) })
  } catch (error) {
    throw new CloudError(explain({ code: failureOf(error), name }))
  }
  const body = await response.text().catch(() => '')
  if (!response.ok) throw new CloudError(explain({ status: response.status, body, name }))
  try {
    const data = JSON.parse(body)
    return (Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []).map((item) => item?.id).filter(Boolean)
  } catch {
    throw new CloudError(`Something answered at that address, but it isn’t ${name}’s API. Check the address.`)
  }
}

function createCloud({ core, settings, keychain, fetch = globalThis.fetch, offline = () => false, now = () => new Date() }) {
  const explain = core.explainFailure
  const account = (id) => `cloud-model-${id}`
  const providerOf = (id) => settings.get().providers.find((item) => item.id === id) || null

  /* A provider with its key: checked (by listing its models), then kept. Its model becomes
     the one OSAT asks, unless another cloud model is already chosen. */
  async function connect(input) {
    if (offline()) throw new CloudError('Connecting a cloud model waits until you’re back online.')
    const provider = core.providerFrom(input)
    const key = core.cleanKey(input?.key, provider.name)
    let listed = []
    try {
      listed = await openAiModels({ baseUrl: provider.baseUrl, key, fetch, name: provider.name, explain })
    } catch (error) {
      // Some OpenAI-style servers have no model list; a short question proves the key instead.
      if (!provider.model || !/Nothing answered at that address/.test(error.message)) throw error
      await openAiStream({ baseUrl: provider.baseUrl, key, model: provider.model, messages: [{ role: 'user', content: 'Say OK.' }], fetch, name: provider.name, explain, maxTokens: 4, signal: AbortSignal.timeout(CHECK_MS) })
    }
    const { list, first } = core.chatModels(listed, provider.model)
    if (!first) throw new CloudError(`${provider.name} accepted the key but offers no chat models. Type the model’s name in the model box.`)
    await keychain.set(account(provider.id), key)
    const kept = { ...provider, model: first, models: list }
    const current = settings.get()
    const chosen = current.model === 'local' || !core.parseCloudModelId(current.model) || current.model.startsWith(`cloud:${provider.id}:`)
      ? core.cloudModelId(provider.id, first) : current.model
    await settings.save({ providers: [...current.providers.filter((item) => item.id !== provider.id), kept], model: chosen })
    return kept
  }

  /* The key leaves the Keychain; the running total goes with it. Local answers again. */
  async function remove(id) {
    const current = settings.get()
    if (!providerOf(id)) return
    await keychain.remove(account(id))
    const { [id]: _, ...usage } = current.usage
    await settings.save({
      providers: current.providers.filter((item) => item.id !== id),
      usage,
      model: current.model.startsWith(`cloud:${id}:`) ? 'local' : current.model,
    })
  }

  /* 'local', or a connected provider's model. */
  async function choose(model) {
    if (model !== 'local') {
      const parsed = core.parseCloudModelId(model)
      const provider = parsed && providerOf(parsed.providerId)
      if (!provider) throw new CloudError('Connect that provider first.')
      const providers = settings.get().providers.map((item) => (item.id === provider.id ? { ...item, model: parsed.model } : item))
      await settings.save({ providers, model })
      return
    }
    await settings.save({ model: 'local' })
  }

  /* The chosen cloud model, first in every list of models, while online. */
  function models() {
    const parsed = core.parseCloudModelId(settings.get().model)
    const provider = parsed && providerOf(parsed.providerId)
    if (!provider || offline()) return []
    return [{ id: core.cloudModelId(provider.id, parsed.model), name: `${parsed.model} · ${provider.name}`, runtime: 'cloud', offline: false, where: provider.name }]
  }

  async function chatStream({ model, messages }, onDelta, signal) {
    const parsed = core.parseCloudModelId(model)
    const provider = parsed && providerOf(parsed.providerId)
    if (!provider) throw new CloudError('That cloud model isn’t connected any more. Pick one in Settings → Bots.')
    if (offline()) throw new CloudError(core.explainFailure({ code: 'OFFLINE', name: provider.name }))
    const key = await keychain.get(account(provider.id))
    if (!key) throw new CloudError(`OSAT couldn’t find your ${provider.name} key in the Keychain. Paste it again in Settings → Bots.`)
    const { text, usage } = await openAiStream({ baseUrl: provider.baseUrl, key, model: parsed.model, messages, onDelta, signal, fetch, name: provider.name, explain })
    const counted = usage && (usage.input || usage.output) ? usage : {
      input: core.estimateTokens(messages.map((message) => message.content).join('\n')), output: core.estimateTokens(text), estimated: true,
    }
    await settings.save({ usage: core.addUsage(settings.get().usage, provider.id, counted, now().toISOString()) }).catch(() => {})
    return text
  }

  /* For Settings → Bots: the providers (never their keys), what each has used, and which
     model answers. Everything that leaves the Mac is named here (the switchboard reads it). */
  function status() {
    const current = settings.get()
    const parsed = core.parseCloudModelId(current.model)
    const providers = current.providers.map((provider) => {
      const preset = core.presetFor(provider.id)
      const total = current.usage[provider.id] || null
      return { ...provider, usage: total, cost: core.costLine(total, preset?.price), usagePage: preset?.usage || '', keysPage: preset?.keys || '' }
    })
    const answering = parsed && providers.find((item) => item.id === parsed.providerId)
    return {
      model: answering ? current.model : 'local',
      providers,
      lasting: keychain.lasting,
      leavesMac: answering ? answering.name : '',
    }
  }

  return { connect, remove, choose, models, chatStream, status }
}

module.exports = { CloudError, createCloud, openAiModels, openAiStream, readFrame }
