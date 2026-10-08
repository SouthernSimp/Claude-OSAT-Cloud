/* Ask can act (Phase 48): in Ask, OSAT's AI uses tools step by step (the loop is shared/agent.mjs).
   Its tools are OSAT's own, the connector's (shared/connector-tools.mjs), run on the store with the
   source "Ask", and the tools of the apps Nate connected (`bots.askApps`, when there): a change in
   another app waits until Nate allows it, and offline those wait. Everything one run changed in OSAT
   undoes at once (the last 10 runs, in memory; after a restart that Undo is gone).
   The built-in model gets each step's JSON schema as a grammar; cloud models and LM Studio get the
   same instructions in words. The final answer streams like any other answer.
     agent:run (id, { model, messages }) → { answer, steps, undo, error? }, with agent:event:<id> events to
       the asking window: { type: 'step', … } · { type: 'confirm', stepId, text } · { type: 'delta', text }
     agent:confirm (id, stepId, yes) · agent:cancel (id) · agent:undo (undoId) · agent:apps → app names
   `answer(question)` is the connector's "ask" (Siri, Shortcuts, Claude): read-only tools only, no
   questions back, the first answering model, 90 seconds at most, a short plain answer. */
const { randomUUID } = require('node:crypto')
const { validateLocalChatPayload } = require('./local-ai.cjs')

const RUN_ID = /^agent-[\w-]{1,64}$/
const KEEP_UNDOS = 10
const APPS_WAIT_MS = 10000
const ASK_LIMIT_MS = 90000

// The promise's answer, or `fallback` after `ms` (another app's tools must never hold a question up).
function within(promise, ms, fallback) {
  let timer
  const late = new Promise((resolve) => { timer = setTimeout(resolve, ms, fallback) })
  return Promise.race([promise.catch(() => fallback), late]).finally(() => clearTimeout(timer))
}

const slug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'app'

async function createAgent({ store, sharedModule, chat, bots, findFiles, ipcMain, trust, models, offline = () => false, now = () => new Date().toISOString(), makeId = (prefix) => `${prefix}-${randomUUID()}` }) {
  const agent = await sharedModule('agent.mjs')
  const tools = await sharedModule('connector-tools.mjs')
  const { applyOps } = await sharedModule('store-core.mjs')
  const client = store.connect(() => {})
  const runs = new Map() // `<window>:<run id>` → { controller, waiting: stepId → answer }
  const undos = new Map() // undo id → what undoes each change of one run, oldest first
  let undoSeq = 0

  // OSAT's own tools (never "ask" itself); each change commits through the store and its inverse joins `changes`.
  const ownTools = (changes) => tools.TOOLS.filter((tool) => tool.name !== 'ask').map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    readOnly: tool.annotations.readOnlyHint === true,
    external: false,
    async run(args) {
      const result = await tools.runTool(tool.name, args, { doc: store.load().doc, now: now(), makeId, source: 'Ask', findFiles })
      if (result.ops?.length) {
        const { inverse } = applyOps(store.load().doc, result.ops)
        store.commit(client, result.ops)
        changes.push(inverse)
      }
      return { text: result.text }
    },
  }))

  // The apps Nate connected: [{ app, appName, name, description, inputSchema, readOnly }], named so they never clash.
  async function appTools() {
    if (typeof bots?.askApps?.tools !== 'function') return []
    const listed = await within(Promise.resolve().then(() => bots.askApps.tools()), APPS_WAIT_MS, [])
    const taken = new Set(tools.TOOLS.map((tool) => tool.name))
    return (Array.isArray(listed) ? listed : []).filter((tool) => tool && typeof tool.name === 'string' && tool.name).map((tool) => {
      const appName = String(tool.appName || tool.app || 'another app')
      let name = `${slug(appName)}.${tool.name}`
      for (let n = 2; taken.has(name); n += 1) name = `${slug(appName)}.${tool.name}-${n}`
      taken.add(name)
      return {
        name,
        title: tool.name,
        appName,
        description: `In ${appName}: ${tool.description || tool.name}`,
        inputSchema: tool.inputSchema,
        readOnly: tool.readOnly === true,
        external: true,
        run: (args) => (offline() ? { text: `${appName} waits until you’re back online.`, isError: true } : bots.askApps.call(tool.app, tool.name, args)),
      }
    })
  }

  function keepUndo(changes) {
    const id = `undo-${++undoSeq}`
    undos.set(id, changes)
    while (undos.size > KEEP_UNDOS) undos.delete(undos.keys().next().value)
    return id
  }

  /* One question, acted on. Never throws once something may have changed: the steps and the
     Undo come back with the error, so the window can still offer them. */
  async function act({ model, messages, readOnly = false, onEvent = () => {}, confirm, signal }) {
    const changes = []
    const shown = new Map()
    // A cloud model never learns what files are on this Mac (Ask promises that copies and files stay here).
    const cloud = model.startsWith('cloud:')
    const all = [...ownTools(changes), ...await appTools()].filter((tool) => (!readOnly || tool.readOnly) && !(cloud && tool.name === 'find_files'))
    // Only the built-in model takes a grammar; the window never sends a schema (main's chatWith passes it on).
    const ask = (convo, { schema }) => chat({ model, messages: convo, ...(model.startsWith('osat:') ? { schema } : {}) }, () => {}, signal)
    let answer = ''
    let error = ''
    try {
      const { results } = await agent.runAgent({
        ask,
        tools: all,
        messages,
        confirm,
        signal,
        onStep: (step) => { shown.set(step.id, step); onEvent({ type: 'step', ...step }) },
      })
      if (!signal?.aborted) answer = await chat({ model, messages: agent.answerMessages(messages, results) }, (text) => onEvent({ type: 'delta', text }), signal)
    } catch (problem) {
      if (!signal?.aborted) error = problem?.message || 'The AI could not answer.'
    }
    return { answer: typeof answer === 'string' ? answer : '', steps: [...shown.values()], undo: changes.length ? keepUndo(changes) : null, ...(error ? { error } : {}) }
  }

  const runKey = (event, id) => `${event.sender.id}:${id}`

  ipcMain.handle('agent:run', async (event, id, payload) => {
    trust(event)
    if (typeof id !== 'string' || !RUN_ID.test(id)) throw new Error('Bad run id.')
    const { model, messages } = validateLocalChatPayload(payload)
    const controller = new AbortController()
    const waiting = new Map()
    const key = runKey(event, id)
    runs.set(key, { controller, waiting })
    const send = (message) => { if (!event.sender.isDestroyed()) event.sender.send(`agent:event:${id}`, message) }
    const confirm = ({ tool, args, why, stepId }) => new Promise((resolve) => {
      waiting.set(stepId, resolve)
      send({ type: 'confirm', stepId, text: agent.confirmText({ tool, args, why }) })
    })
    // Stop answers every question still waiting with "not now"; so does closing the window that asked.
    controller.signal.addEventListener('abort', () => { for (const resolve of waiting.values()) resolve(false) }, { once: true })
    const gone = () => controller.abort()
    event.sender.once?.('destroyed', gone)
    try {
      return await act({ model, messages, onEvent: send, confirm, signal: controller.signal })
    } finally {
      runs.delete(key)
      event.sender.removeListener?.('destroyed', gone)
    }
  })
  ipcMain.handle('agent:confirm', async (event, id, stepId, yes) => {
    trust(event)
    const run = runs.get(runKey(event, id))
    const resolve = run?.waiting.get(stepId)
    if (!resolve) return false
    run.waiting.delete(stepId)
    resolve(yes === true)
    return true
  })
  ipcMain.on('agent:cancel', (event, id) => {
    try { trust(event) } catch { return }
    runs.get(runKey(event, id))?.controller.abort()
  })
  ipcMain.handle('agent:undo', async (event, undoId) => {
    trust(event)
    const changes = undos.get(undoId)
    if (!changes) throw new Error('That can’t be undone any more.')
    // Newest first, in one commit: one change for the windows, Undo's history and sync.
    store.commit(client, [...changes].reverse().flat())
    undos.delete(undoId)
    return true
  })
  // The connected apps' names, so a question naming one acts.
  ipcMain.handle('agent:apps', async (event) => {
    trust(event)
    return [...new Set((await appTools()).map((tool) => tool.appName))]
  })

  async function answer(question) {
    const model = (await models())?.models?.[0]?.id
    if (!model) throw new Error('OSAT’s AI isn’t set up yet. Choose one in Settings → AI.')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ASK_LIMIT_MS)
    try {
      const messages = [{ role: 'system', content: agent.spokenPrompt(new Date(now())) }, { role: 'user', content: question }]
      const result = await act({ model, messages, readOnly: true, confirm: async () => false, signal: controller.signal })
      if (controller.signal.aborted) throw new Error('OSAT’s AI took too long. Try a shorter question.')
      if (result.error) throw new Error(result.error)
      return { text: agent.spoken(result.answer) }
    } finally {
      clearTimeout(timer)
    }
  }

  return { act, answer }
}

module.exports = { createAgent }
