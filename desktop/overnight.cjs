/* While you sleep (Phase 53): once a night, on the charger, OSAT's AI on this Mac looks over the
   week's stickies and leaves a few ideas for the canvas (connections, and subjects that keep coming
   up). It reads everything, so it only ever uses a model on this Mac (the built-in one or LM Studio),
   never a cloud one, and it changes nothing: the canvas shows the ideas and Nate keeps or waves
   each away (keeping goes through the canvas, with its Undo). On unless turned off.
   overnight.json in the data folder: { on, last (the night, YYYY-MM-DD), ideas, dismissed, unseen }.
     overnight:status → { on, last, ideas (only those that still fit), ai, thinking, unseen }
     overnight:set ({ on }) · overnight:think (Think now, whatever the hour) · overnight:done (id, dismiss)
     overnight:seen · and 'overnight:changed' to every window when the ideas change.
   The rules (when, which pairs, the questions, reading the answers) are shared/overnight-model.mjs. */
const fs = require('node:fs/promises')
const path = require('node:path')

const EVERY_MS = 10 * 60 * 1000
const RETRY_MS = 60 * 60 * 1000
const LIMIT_MS = 4 * 60 * 1000
const NO_AI = 'Overnight ideas need an AI on this Mac: choose a size in Settings → AI, or start LM Studio.'
const NOT_DONE = 'OSAT couldn’t think it over just now. It will try again later.'

async function createOvernight({ store, sharedModule, dataDir, models, chat, handle, fail, send = () => {}, onBattery = () => false, idleSeconds = () => 0, onWake, now = () => new Date(), timeZone }) {
  const night = await sharedModule('overnight-model.mjs')
  const file = path.join(dataDir, 'overnight.json')
  let running = null
  let triedAt = -Infinity
  let timer = null

  async function read() {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'))
      return {
        ...night.cleanSettings(raw),
        last: typeof raw.last === 'string' ? raw.last : '',
        ideas: Array.isArray(raw.ideas) ? raw.ideas : [],
        dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.filter((id) => typeof id === 'string') : [],
        unseen: raw.unseen === true,
      }
    } catch {
      return { ...night.cleanSettings(), last: '', ideas: [], dismissed: [], unseen: false }
    }
  }
  let saving = Promise.resolve()
  const save = (patch) => (saving = saving.catch(() => {}).then(async () => {
    const next = { ...await read(), ...(typeof patch === 'function' ? patch(await read()) : patch) }
    await fs.mkdir(dataDir, { recursive: true })
    await fs.writeFile(file, `${JSON.stringify(next)}\n`)
    return next
  }))

  // Only a model on this Mac: what it reads is everything Nate wrote this week.
  const localModel = async () => ((await models().catch(() => null))?.models || []).find((model) => model?.id && !model.id.startsWith('cloud:'))?.id || null

  async function status() {
    const saved = await read()
    return { on: saved.on, last: saved.last, unseen: saved.unseen, ideas: night.liveIdeas(store.load().doc, saved.ideas), ai: Boolean(await localModel()), thinking: Boolean(running) }
  }
  const changed = async () => send('overnight:changed', await status())

  async function ask(model, messages) {
    const controller = new AbortController()
    const late = setTimeout(() => controller.abort(), LIMIT_MS)
    try {
      return String(await chat({ model, messages, background: true }, () => {}, controller.signal) || '')
    } finally {
      clearTimeout(late)
    }
  }

  /* One pass: the pairs, then the subjects. → { ideas } or { error }. One at a time. */
  function think({ auto = false } = {}) {
    if (running) return running
    running = (async () => {
      const model = await localModel()
      if (!model) return { error: NO_AI }
      triedAt = now().getTime()
      const { dismissed } = await read()
      const doc = store.load().doc
      const ideas = []
      try {
        const pairs = night.candidatePairs(doc, { now: now(), dismissed })
        if (pairs.length) {
          const yes = night.readPairAnswer(await ask(model, night.pairMessages(doc, pairs)), pairs.length)
          for (const [n, why] of yes) if (ideas.length < night.MOST_LINKS) ideas.push(night.linkIdea(pairs[n - 1], why))
        }
        const stickies = night.recentStickies(doc, now())
        if (stickies.length >= 6) {
          ideas.push(...night.readTopicAnswer(await ask(model, night.topicMessages(doc, stickies)), doc, stickies, { dismissed }).map(night.topicIdea))
        }
      } catch (error) {
        console.error('Overnight:', error)
        return { error: NOT_DONE }
      }
      if (auto && !(await read()).on) return { error: NOT_DONE }
      await save({ last: night.nightOf(now(), timeZone), ideas, unseen: ideas.length > 0 })
      await changed()
      return { ideas }
    })().finally(() => { running = null })
    return running
  }

  /* Due? Then think. A pass that didn't work waits an hour. Never throws. */
  async function check() {
    try {
      if (running) return null
      const saved = await read()
      if (!night.due({ now: now(), settings: saved, last: saved.last, idleSeconds: idleSeconds(), onBattery: onBattery(), timeZone })) return null
      if (now().getTime() - triedAt < RETRY_MS) return null
      return await think({ auto: true })
    } catch (error) {
      console.error('Overnight:', error)
      return null
    }
  }

  handle('overnight:status', () => status(), { from: 'app' })
  handle('overnight:set', async (patch) => {
    await save({ on: night.cleanSettings({ on: patch?.on }).on })
    return status()
  }, { from: 'app' })
  handle('overnight:think', async () => {
    const result = await think()
    if (result.error) fail(result.error)
    return status()
  }, { from: 'app' })
  // Kept (the canvas made the change) or waved away (remembered so it isn't offered again).
  handle('overnight:done', async (id, dismiss) => {
    if (typeof id !== 'string') fail('That idea isn’t there any more.')
    await save((saved) => {
      const idea = saved.ideas.find((item) => item.id === id)
      return {
        ideas: saved.ideas.filter((item) => item.id !== id),
        dismissed: idea && dismiss === true ? [...saved.dismissed.filter((key) => key !== night.dismissKey(idea)), night.dismissKey(idea)].slice(-night.MOST_DISMISSED) : saved.dismissed,
      }
    })
    await changed()
    return status()
  }, { from: 'app' })
  handle('overnight:seen', async () => { await save({ unseen: false }); return true }, { from: 'app' })

  return {
    check,
    think,
    // Last night's ideas in a line, for the morning brief.
    words: async () => night.ideaWords(store.load().doc, (await read()).ideas),
    start() {
      timer = setInterval(check, EVERY_MS)
      onWake?.(check)
    },
    stop() { clearInterval(timer) },
  }
}

module.exports = { createOvernight }
