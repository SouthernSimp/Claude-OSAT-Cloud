/* Ask can act (Phase 48): OSAT's AI uses tools, one step at a time, and every step shows.
   Pure (no Node or DOM): desktop/agent.cjs hands in the model (`ask`), the tools and the conversation
   Ask built, then streams the final answer from `answerMessages`. Each turn the model answers ONE
   JSON object:
     { "why": "<a few plain words Nate reads>", "use": "<tool name>", "with": { …its arguments } }
   or { "done": true }. The built-in model gets `stepSchema` as a grammar, so it can only answer that;
   cloud models and LM Studio read the same words and are read forgivingly (`readStep`).
   A tool is { name, title?, description, inputSchema, readOnly, external, appName?, run(args) → { text, isError } }.
   Another app's changing tool waits for Nate (`confirm`); OSAT's own changes don't: their one Undo is the safety. */

export const RESULT_CHARS = 4000
export const MAX_STEPS = 6

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isPrimitive = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value)
const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text)
const BASIC = ['string', 'number', 'integer', 'boolean', 'null']
const ANY = { type: ['string', 'number', 'boolean', 'null'] }

/* A tool's arguments as node-llama-cpp's grammar takes them (its GbnfJsonSchema): oneOf for anyOf,
   only the keys it reads, and, since it writes every property (it ignores `required`), an optional
   one may be null. What it can't express becomes a plain value. */
export function grammarSafe(schema, depth = 0) {
  if (!isObject(schema) || depth > 8) return ANY
  if ('const' in schema) return isPrimitive(schema.const) ? { const: schema.const } : ANY
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter(isPrimitive)
    return values.length ? { enum: values } : ANY
  }
  const choices = schema.oneOf || schema.anyOf
  if (Array.isArray(choices) && choices.length) return { oneOf: choices.map((choice) => grammarSafe(choice, depth + 1)) }
  const types = [].concat(schema.type ?? (isObject(schema.properties) ? 'object' : [])).filter((type) => typeof type === 'string')
  if (types.includes('object')) {
    const entries = Object.entries(isObject(schema.properties) ? schema.properties : {})
    if (!entries.length) return schema.additionalProperties === false ? { type: 'object', properties: {} } : { type: 'object', additionalProperties: true }
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    return {
      type: 'object',
      properties: Object.fromEntries(entries.map(([key, value]) => {
        const safe = grammarSafe(value, depth + 1)
        return [key, required.has(key) ? safe : { oneOf: [safe, { type: 'null' }] }]
      })),
    }
  }
  if (types.includes('array')) return { type: 'array', items: grammarSafe(schema.items, depth + 1) }
  const basic = types.filter((type) => BASIC.includes(type))
  return basic.length ? { type: basic.length === 1 ? basic[0] : basic } : ANY
}

/* The one answer a turn may be: a step with one of these tools, or done. */
export function stepSchema(tools) {
  return {
    oneOf: [
      ...tools.map((tool) => ({
        type: 'object',
        properties: { why: { type: 'string', maxLength: 120 }, use: { const: tool.name }, with: grammarSafe(tool.inputSchema) },
      })),
      { type: 'object', properties: { done: { const: true } } },
    ],
  }
}

/* The tools in words, for every model (the grammar only says what shape an answer has). */
export function toolsText(tools) {
  return tools.map((tool) => {
    const required = new Set(tool.inputSchema?.required || [])
    const args = Object.entries(tool.inputSchema?.properties || {}).map(([key, value]) => (
      `${key}${required.has(key) ? '' : ' (optional)'}: ${cut(String(value?.description || value?.type || ''), 200)}`
    ))
    return `- ${tool.name}: ${cut(String(tool.description || ''), 400)}${args.length ? `\n  Arguments: ${args.join('; ')}` : '\n  No arguments.'}`
  }).join('\n')
}

export function agentPrompt(tools) {
  return `You can use tools to look things up and get things done for Nate. Answer with ONE JSON object and nothing else:
{"why": "a few plain words Nate will read, like Looking in your notes for garden", "use": "<tool name>", "with": {<its arguments>}}
Use one tool at a time; you will be shown what it answered. When you have what you need, or nothing needs doing, answer {"done": true}.
Never make up an id or a name: look it up first. Do only what Nate asked. Leave out an argument you don't need, or make it null.

The tools:
${toolsText(tools)}`
}

/* The tools' words join the first system message (some chat templates allow only one, at the start). */
function withTools(messages, tools) {
  const prompt = agentPrompt(tools)
  const [first, ...rest] = messages
  return first?.role === 'system'
    ? [{ role: 'system', content: `${first.content}\n\n${prompt}` }, ...rest]
    : [{ role: 'system', content: prompt }, ...messages]
}

/* The first balanced {...} in the text, minding strings: models wrap JSON in prose or fences. */
function firstObject(text) {
  const start = text.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  let quoted = false
  let escaped = false
  for (let at = start; at < text.length; at += 1) {
    const char = text[at]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{') depth += 1
    else if (char === '}' && --depth === 0) return text.slice(start, at + 1)
  }
  return ''
}

/* One turn's answer: { use, with, why } or { done: true }. Unreadable counts as done. A null argument
   (the grammar writes every key) is left out; "tool"/"arguments" are read too, a habit of some models. */
export function readStep(text) {
  let value
  try {
    value = JSON.parse(firstObject(String(text || '')))
  } catch {
    return { done: true }
  }
  const use = isObject(value) && value.done !== true ? value.use ?? value.tool : null
  if (typeof use !== 'string' || !use.trim()) return { done: true }
  const given = value.with ?? value.arguments ?? value.args
  const args = Object.fromEntries(Object.entries(isObject(given) ? given : {}).filter(([, item]) => item !== null))
  return { use: use.trim(), with: args, why: typeof value.why === 'string' ? value.why.trim().slice(0, 120) : '' }
}

/* What a step did, in one short line: the first line of the tool's answer, ids left out, and
   OSAT's older words (node, the Sky) as Nate reads them (topic, the canvas). */
export function summaryOf(text) {
  const line = String(text || '').split('\n').find((item) => item.trim()) || ''
  const plain = line
    .replace(/ \((?:note|folder|event|day)-[^)]+\)/g, '')
    .replace(/\bnodes\b/g, 'topics').replace(/\bnode\b/g, 'topic').replace(/\bSky\b/g, 'canvas')
    .replace(/:\s*$/, '').trim()
  return cut(plain, 120)
}

async function runOne(tool, args) {
  try {
    const result = await tool.run(args)
    return { text: String(result?.text ?? ''), isError: result?.isError === true }
  } catch (error) {
    return { text: error?.message || 'That didn’t work.', isError: true }
  }
}

/* The loop. `ask(messages, { schema })` → the model's words. Stops at done, after `maxSteps` tools,
   at a call made twice the same way, or when `signal` aborts. `onStep` hears each step start and end:
   { id, tool, app, why, state: 'running' | 'done' | 'failed' | 'skipped', summary }. `confirm({ tool, args, why,
   stepId })` → true or false, asked only before another app's changing tool. → { steps, results } */
export async function runAgent({ ask, tools, messages, maxSteps = MAX_STEPS, onStep = () => {}, confirm, signal }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const schema = stepSchema(tools)
  const convo = withTools(messages, tools)
  const steps = []
  const results = []
  const tried = new Set()
  while (steps.length < maxSteps && !signal?.aborted) {
    let reply
    try {
      reply = await ask([...convo], { schema })
    } catch (error) {
      if (signal?.aborted) break
      throw error
    }
    if (signal?.aborted) break
    const step = readStep(reply)
    if (step.done) break
    const call = `${step.use} ${JSON.stringify(step.with)}`
    if (tried.has(call)) break
    tried.add(call)
    const tool = byName.get(step.use)
    const entry = { id: `step-${steps.length + 1}`, tool: step.use, app: tool?.external ? tool.appName || '' : '', why: step.why || tool?.title || step.use, state: 'running', summary: '' }
    steps.push(entry)
    onStep({ ...entry })
    let outcome
    if (!tool) outcome = { text: `There is no tool called “${step.use}”. The tools are: ${[...byName.keys()].join(', ')}.`, isError: true }
    else if (tool.external && !tool.readOnly && !(await confirm?.({ tool, args: step.with, why: entry.why, stepId: entry.id }))) outcome = { text: 'Nate said not now.', skipped: true }
    else outcome = await runOne(tool, step.with)
    entry.state = outcome.skipped ? 'skipped' : outcome.isError ? 'failed' : 'done'
    entry.summary = outcome.skipped ? 'Not now' : summaryOf(outcome.text)
    onStep({ ...entry })
    const text = cut(outcome.text.trim() || 'Nothing.', RESULT_CHARS)
    results.push({ tool: step.use, app: entry.app, why: entry.why, state: entry.state, text })
    convo.push(
      { role: 'assistant', content: JSON.stringify({ why: entry.why, use: step.use, with: step.with }) },
      { role: 'user', content: `What ${step.use} answered:\n${text}` },
    )
  }
  return { steps, results }
}

/* The messages for the final answer: the conversation as Ask built it, the last question carrying
   what the tools answered. A normal chat, no grammar. */
export function answerMessages(messages, results) {
  if (!results.length) return messages
  const lines = results.map((result) => `- ${result.why}${result.app ? ` (in ${result.app})` : ''}${result.state === 'done' ? '' : ` [${result.state === 'skipped' ? 'not done: Nate said not now' : 'it failed'}]`}: ${cut(result.text, 1200)}`)
  const note = `[WHAT YOU DID WITH THE TOOLS, AND WHAT THEY ANSWERED]\n${cut(lines.join('\n'), 8000)}\n\nNow answer Nate in plain words from what the tools answered, and say what changed, if anything did. No JSON and no osat-actions block: the tools already did the work.`
  const last = messages.at(-1)
  return last?.role === 'user'
    ? [...messages.slice(0, -1), { ...last, content: `${last.content}\n\n${note}` }]
    : [...messages, { role: 'user', content: note }]
}

/* What Nate reads before another app changes anything. */
export function confirmText({ tool, args, why }) {
  const details = Object.entries(args || {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${cut(String(value), 80)}`)
  return `Ask wants to change something in ${tool.appName || 'another app'}: ${why || tool.title || tool.name}.${details.length ? ` (${details.join(', ')})` : ''}`
}

/* "Ask OSAT" from Siri, Shortcuts or Claude (the connector's ask tool): a short spoken answer. */
export function spokenPrompt(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(now)
  return `You are OSAT's AI, on Nate's Mac: it holds his notes (stickies in topics), his journal, his calendar and his files. Today is ${day}. Answer in plain spoken sentences, at most about 100 words: no Markdown, no lists, no links. Siri may read it aloud.`
}

export function spoken(text, words = 120) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const list = plain.split(' ')
  return list.length > words ? `${list.slice(0, words).join(' ')}…` : plain
}
