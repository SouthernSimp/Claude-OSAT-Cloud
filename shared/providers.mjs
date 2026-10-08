/* Cloud models: any AI provider Nate (or anyone) connects in Settings → Bots, next to the
   AI on this Mac, which stays the default. OpenAI-compatible providers first (DeepSeek,
   OpenAI, xAI and most others speak it); each provider has a `kind`, so Anthropic-style
   ones can follow with their own adapter. Keys never live here: they go in the Keychain.
   Pure: shared by main, Settings and the tests. */

export const KINDS = ['openai'] // 'anthropic' next: its own request shape, same settings

/* Providers people are likely to have a key for. `price` is a rough USD cost per million
   tokens (input, output), only where it is well known, for the running total; the exact
   bill is always on the provider's own usage page. */
export const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', keys: 'https://platform.deepseek.com/api_keys', usage: 'https://platform.deepseek.com/usage', price: { input: 0.28, output: 0.42 } },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', keys: 'https://platform.openai.com/api-keys', usage: 'https://platform.openai.com/usage' },
  { id: 'xai', name: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', model: '', keys: 'https://console.x.ai', usage: 'https://console.x.ai' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', keys: 'https://openrouter.ai/keys', usage: 'https://openrouter.ai/activity' },
  { id: 'mistral', name: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: '', keys: 'https://console.mistral.ai/api-keys', usage: 'https://console.mistral.ai/usage' },
  { id: 'groq', name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: '', keys: 'https://console.groq.com/keys', usage: 'https://console.groq.com/dashboard/usage' },
]

/* Anything else that speaks the OpenAI way: a name and its address. */
export const OTHER = { id: 'other', name: 'Another provider', kind: 'openai', baseUrl: '', model: '' }

export const presetFor = (id) => PRESETS.find((preset) => preset.id === id) || null

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/

/* A provider's address, cleaned: https (plain http only on this Mac, for a local server),
   no user or password in it, no trailing slash. Throws a plain sentence when it won't do. */
export function cleanBaseUrl(value) {
  let url
  try {
    url = new URL(String(value || '').trim())
  } catch {
    throw new Error('That address doesn’t look right. It should start with https://, like https://api.deepseek.com.')
  }
  if (url.username || url.password) throw new Error('Leave the key out of the address; paste it in the key box instead.')
  if (url.protocol === 'http:' && !LOOPBACK.test(url.hostname)) throw new Error('Use the https:// address, so the key travels encrypted.')
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('That address doesn’t look right. It should start with https://.')
  if (url.search || url.hash) throw new Error('Use the address without anything after ? or #.')
  return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}`
}

/* An API key as pasted: spaces and quotes around it go; anything else odd means it was cut
   or mixed up. Throws a plain sentence saying how to fix it. */
export function cleanKey(value, name = 'the provider') {
  const key = String(value || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/^Bearer\s+/i, '')
  if (!key) throw new Error(`Paste your ${name} API key first.`)
  if (/\s/.test(key)) throw new Error('That key has a space in it. Copy it again in one piece and paste it here.')
  if (!/^[A-Za-z0-9._~+/=:@-]+$/.test(key)) throw new Error(`That doesn’t look like an API key. Copy it again from ${name}’s API keys page.`)
  if (key.length < 16) throw new Error(`That key looks cut off. Copy the whole key from ${name}’s API keys page.`)
  if (key.length > 400) throw new Error('That’s longer than an API key. Copy just the key and paste it again.')
  return key
}

const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
const MODEL = /^[\w.:/@+-]{1,120}$/

/* A provider as Settings sends it ({ preset, name, baseUrl, model }) → the one kept in
   settings: { id, name, kind, baseUrl, model }. Its key goes to the Keychain separately. */
export function providerFrom(input) {
  const preset = presetFor(input?.preset)
  const name = String(input?.name || preset?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40)
  if (!name) throw new Error('Give the provider a name, like “DeepSeek”.')
  const kind = preset?.kind || (KINDS.includes(input?.kind) ? input.kind : 'openai')
  const baseUrl = cleanBaseUrl(input?.baseUrl || preset?.baseUrl)
  const model = String(input?.model ?? preset?.model ?? '').trim()
  if (model && !MODEL.test(model)) throw new Error('That model name doesn’t look right.')
  return { id: preset?.id || `custom-${slug(name) || 'provider'}`, name, kind, baseUrl, model }
}

/* Settings keep providers as they were saved; anything malformed is dropped. */
export function cleanProviders(list) {
  const seen = new Set()
  return (Array.isArray(list) ? list : []).flatMap((item) => {
    try {
      const provider = { ...providerFrom({ ...item, preset: presetFor(item?.id) ? item.id : undefined }), id: String(item.id || '') }
      if (!/^[a-z0-9-]{1,48}$/.test(provider.id) || seen.has(provider.id)) return []
      seen.add(provider.id)
      const models = Array.isArray(item.models) ? item.models.filter((id) => typeof id === 'string' && MODEL.test(id)).slice(0, 200) : []
      return [{ ...provider, models }]
    } catch {
      return []
    }
  })
}

/* The model OSAT asks, as the id the windows see: 'cloud:<provider>:<model>'. */
export const cloudModelId = (providerId, model) => `cloud:${providerId}:${model}`
export function parseCloudModelId(id) {
  const match = /^cloud:([a-z0-9-]{1,48}):(.+)$/.exec(String(id || ''))
  return match ? { providerId: match[1], model: match[2] } : null
}

const NOT_CHAT = /embed|tts|whisper|dall-e|image|moderation|audio|realtime|transcri|search|rerank|vision-preview|computer-use|guard/i

/* The models worth offering from a provider's list (no embeddings, speech or images), and
   the one to start with: the preset's, else the first. */
export function chatModels(ids, preferred = '') {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && MODEL.test(id) && !NOT_CHAT.test(id)))].sort()
  const first = preferred && list.includes(preferred) ? preferred : list[0] || preferred || ''
  return { list, first }
}

/* What went wrong with a provider, in one plain line with a way forward. */
export function explainFailure({ status, body = '', code = '', name = 'The provider', model = '' }) {
  const text = String(body).slice(0, 2000)
  if (code === 'OFFLINE') return `OSAT is offline. ${name} waits until you’re back online; the AI on this Mac still answers.`
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Nothing answered at ${name}’s address. Check your internet, or the address in Settings → Bots.`
  if (code === 'TIMEOUT') return `${name} took too long to answer. Try again in a moment.`
  if (status === 401 || (status === 403 && /key|auth|token/i.test(text))) return `${name} didn’t accept that key. Copy it again from ${name}’s API keys page and paste it here.`
  if (status === 402 || /insufficient.{0,20}(balance|credit|quota)/i.test(text)) return `Your ${name} account is out of credit. Add some on ${name}’s website, then try again.`
  if (status === 403) return `${name} said no to this request. Check that the key is allowed to use this model.`
  if (status === 404 || /model.{0,40}(not exist|not found|does not exist)/i.test(text)) return model ? `${name} doesn’t have a model called “${model}”. Pick another in Settings → Bots.` : `Nothing answered at that address. Check it in Settings → Bots.`
  if (status === 429) return `${name} says too many requests right now. Wait a minute and try again.`
  if (status >= 500) return `${name} isn’t answering right now. Try again in a moment.`
  if (status) return `${name} couldn’t answer (${status}). Try again, or pick another model in Settings → Bots.`
  return `OSAT couldn’t reach ${name}. Check your internet connection and try again.`
}

/* A running total per provider: { requests, input, output (tokens), since }. `usage` is
   what the provider reported, or an estimate from the words (about four characters a token). */
export function addUsage(totals, providerId, usage, at = new Date().toISOString()) {
  const before = totals?.[providerId] || { requests: 0, input: 0, output: 0, since: at }
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0)
  return {
    ...totals,
    [providerId]: {
      requests: before.requests + 1,
      input: before.input + count(usage?.input),
      output: before.output + count(usage?.output),
      since: before.since || at,
      ...(usage?.estimated || before.estimated ? { estimated: true } : {}),
    },
  }
}

export const estimateTokens = (text) => Math.ceil(String(text || '').length / 4)

/* The rough cost of a total in dollars, or null when the provider's prices aren't known. */
export function roughCost(total, price) {
  if (!total || !price) return null
  return (total.input * price.input + total.output * price.output) / 1e6
}

/* "about $0.03", "under a cent" or null. */
export function costLine(total, price) {
  const cost = roughCost(total, price)
  if (cost === null) return null
  if (cost < 0.01) return 'under a cent'
  return `about $${cost < 10 ? cost.toFixed(2) : Math.round(cost)}`
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const whole = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0)

/* Settings → Bots as kept in bots.json (never a key): which model answers ('local' or a
   connected provider's), the providers, what each has used, and the connector. Anything
   malformed falls back to the safe default: the AI on this Mac. */
export function cleanBotSettings(value) {
  const input = isObject(value) ? value : {}
  const providers = cleanProviders(input.providers)
  const parsed = parseCloudModelId(input.model)
  const model = parsed && providers.some((provider) => provider.id === parsed.providerId) ? input.model : 'local'
  const usage = Object.fromEntries(Object.entries(isObject(input.usage) ? input.usage : {})
    .filter(([id, total]) => providers.some((provider) => provider.id === id) && isObject(total))
    .map(([id, total]) => [id, {
      requests: whole(total.requests), input: whole(total.input), output: whole(total.output),
      since: typeof total.since === 'string' ? total.since.slice(0, 40) : '',
      ...(total.estimated === true ? { estimated: true } : {}),
    }]))
  const port = Number.isInteger(input.connector?.port) && input.connector.port > 1024 && input.connector.port < 65536 ? input.connector.port : 0
  return { model, providers, usage, connector: { on: input.connector?.on === true, port, apps: cleanApps(input.connector?.apps) } }
}

/* An app's name as shown in Settings and on what it adds: one line, at most 40 characters. */
export const cleanAppName = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 40) : '')

/* The apps that may reach the connector (Phase 44), each with its own key in the Keychain
   (never here): { id, name, access: 'read' | 'write', createdAt, usedAt? }. The id is part of
   the key's Keychain name, so only plain letters, digits and dashes pass. */
function cleanApps(value) {
  const seen = new Set()
  const stamp = (at) => (typeof at === 'string' ? at.slice(0, 40) : '')
  return (Array.isArray(value) ? value : []).flatMap((app) => {
    const name = cleanAppName(app?.name)
    if (!isObject(app) || typeof app.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(app.id) || seen.has(app.id) || !name || !['read', 'write'].includes(app.access)) return []
    seen.add(app.id)
    return [{ id: app.id, name, access: app.access, createdAt: stamp(app.createdAt), ...(stamp(app.usedAt) ? { usedAt: stamp(app.usedAt) } : {}) }]
  })
}
