/* The morning brief (Phase 49): each morning OSAT's AI writes Nate a short plan for the day at the
   top of today's journal page. Off until turned on (Settings → AI, or the desk's one offer).
   Main checks every few minutes, when the Mac wakes and when the desk shows; once the set time has
   passed and none was written today, Ask's agent (desktop/agent.cjs) writes it with read-only tools
   only: OSAT's own (never files) and the connected apps' (not while offline), told up front what
   OSAT's calendar, the Mac's Calendar and Reminders (only when OSAT may already read them),
   Unsorted and yesterday hold. The block goes in through the store (windows, sync and Undo see it);
   writing again replaces only that block. With no AI set up, nothing happens.
   brief.json in the data folder: { on, time, last (YYYY-MM-DD), unseen (the desk says so once) }.
     brief:status → { on, time, last, unseen, ai, writing } · brief:set ({ on?, time? }) · brief:write
     (Write it now) · brief:seen · brief:undo (the last one written, while OSAT stays open)
   The rules (due, the question, where it goes) are shared/brief-model.mjs. */
const fs = require('node:fs/promises')
const path = require('node:path')

const EVERY_MS = 5 * 60 * 1000
const RETRY_MS = 30 * 60 * 1000
const LIMIT_MS = 3 * 60 * 1000
const NO_AI = 'The morning brief needs OSAT’s AI: choose a size below, or start LM Studio.'
const NOT_WRITTEN = 'The brief couldn’t be written just now. OSAT will try again later.'

async function createBrief({ store, sharedModule, agent, dataDir, models, handle, fail, offline = () => false, macToday = async () => ({ events: [], reminders: [] }), onWake, now = () => new Date(), timeZone }) {
  const brief = await sharedModule('brief-model.mjs')
  const tools = await sharedModule('connector-tools.mjs')
  const { applyOps } = await sharedModule('store-core.mjs')
  const client = store.connect(() => {})
  const file = path.join(dataDir, 'brief.json')
  let running = null
  let triedAt = -Infinity
  let undo = null
  let timer = null

  async function read() {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'))
      return { ...brief.cleanSettings(raw), last: typeof raw.last === 'string' ? raw.last : '', unseen: raw.unseen === true }
    } catch {
      return { ...brief.cleanSettings(), last: '', unseen: false }
    }
  }
  // Saves take turns, each on the newest file.
  let saving = Promise.resolve()
  const save = (patch) => (saving = saving.catch(() => {}).then(async () => {
    const next = { ...await read(), ...patch }
    await fs.mkdir(dataDir, { recursive: true })
    await fs.writeFile(file, `${JSON.stringify(next)}\n`)
    return next
  }))

  const firstModel = async () => (await models().catch(() => null))?.models?.[0]?.id || null
  const status = async () => ({ ...await read(), ai: Boolean(await firstModel()), writing: Boolean(running) })

  /* What OSAT itself knows, in words, through the connector's own reads (the same days as the
     journal: this Mac's clock). */
  async function question(day) {
    const doc = store.load().doc
    const say = (name, args) => {
      try { return tools.runTool(name, args, { doc, now: now().toISOString() }).text } catch { return '' }
    }
    const [y, m, d] = day.split('-').map(Number)
    const mac = await macToday({ from: new Date(y, m - 1, d).toISOString(), to: new Date(y, m - 1, d + 1).toISOString(), day }).catch(() => null)
    const known = {
      events: say('list_events', { from: day, to: day }),
      mac: brief.macText(mac || {}, day, timeZone),
      journal: say('read_journal', { date: brief.dayBefore(day) }),
      topics: say('list_nodes', {}),
    }
    return brief.briefMessages({ day, doc, known, timeZone })
  }

  /* Writes today's brief (again). → { written: true, day } or { error }. One at a time. */
  function write({ auto = false } = {}) {
    if (running) return running
    running = (async () => {
      const model = await firstModel()
      if (!model) return { error: NO_AI }
      triedAt = now().getTime()
      const { day } = brief.localParts(now(), timeZone)
      const controller = new AbortController()
      const late = setTimeout(() => controller.abort(), LIMIT_MS)
      let result
      try {
        result = await agent.act({
          model,
          messages: await question(day),
          readOnly: true,
          use: (tool) => tool.name !== 'find_files' && !(tool.external && offline()),
          confirm: async () => false,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(late)
      }
      const text = brief.cleanBrief(result?.answer)
      if (controller.signal.aborted || result?.error || !text) return { error: NOT_WRITTEN }
      const ops = brief.briefOps(store.load().doc, text, { day, now: now().toISOString() })
      undo = applyOps(store.load().doc, ops).inverse
      store.commit(client, ops)
      await save({ last: day, unseen: auto })
      return { written: true, day }
    })().finally(() => { running = null })
    return running
  }

  /* Due? Then write it. A try that didn't work waits half an hour before the next. Never throws. */
  async function check() {
    try {
      if (running) return null
      const settings = await read()
      if (!brief.due(now(), settings, settings.last, timeZone) || now().getTime() - triedAt < RETRY_MS) return null
      return await write({ auto: true })
    } catch (error) {
      console.error('Morning brief:', error)
      return null
    }
  }

  handle('brief:status', () => status(), { from: 'app' })
  handle('brief:set', async (patch) => {
    const asked = patch && typeof patch === 'object' ? patch : {}
    const next = brief.cleanSettings({ ...await read(), ...asked })
    await save({ on: next.on, time: next.time })
    check()
    return status()
  }, { from: 'app' })
  handle('brief:write', async () => {
    const result = await write()
    if (result.error) fail(result.error)
    return status()
  }, { from: 'app' })
  handle('brief:seen', async () => { await save({ unseen: false }); return true }, { from: 'app' })
  handle('brief:undo', async () => {
    if (!undo) fail('That can’t be undone any more.')
    store.commit(client, undo)
    undo = null
    return true
  }, { from: 'app' })

  return {
    check,
    write,
    start() {
      timer = setInterval(check, EVERY_MS)
      onWake?.(check)
    },
    stop() { clearInterval(timer) },
  }
}

module.exports = { createBrief }
