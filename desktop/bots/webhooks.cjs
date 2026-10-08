/* Webhooks (Phase 46, Settings → Bots), off until Nate adds an address or turns the inbox on.
     out   each moment he ticked (a sticky added or filed, a topic added, the journal written) is
           sent as JSON to the addresses he gave, one after another, through the main process's
           fetch (so Offline holds it). Offline, up to 100 wait in memory and go when he is back
           online; a network error or a 5xx is tried once more after 30 s, then said calmly.
     in    "Let services add stickies": an ntfy topic with a random name. Services send words to
           it; OSAT reads it every minute while online, and each message becomes a sticky in
           Unsorted (source Webhook). The Mac never listens to the internet.
   `model` is shared/webhook-model.mjs; `addSticky(text)` commits through the store as the app
   "Webhook" (bots/index.cjs), so its sticky carries source Webhook and the connector's list can undo it. */
const { randomBytes, randomUUID } = require('node:crypto')
const { createSettings } = require('./settings.cjs')

const MAX_WAITING = 100
const RETRY_MS = 30 * 1000
const POLL_MS = 60 * 1000
const JOURNAL_MS = 60 * 1000
const TIMEOUT_MS = 15 * 1000

function createWebhooks({
  file, model, store, fetch, addSticky,
  offline = () => false,
  onStatus = () => {},
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  newTopic = () => randomBytes(24).toString('base64url'),
}) {
  const settings = createSettings({ file, clean: model.cleanHookSettings })
  let waiting = [] // offline: { id, body }, oldest first
  let sending = Promise.resolve()
  let seen = null // the workspace as of the last commit, to tell what changed
  let stopCommits = null
  let pollTimer = null
  let polling = null
  let inboxError = ''
  let wasOffline = offline()
  let running = false
  const journal = new Map() // date → { timer, line }: at most one send a minute per day
  const retries = new Set()

  const iso = () => new Date(now()).toISOString()
  const hookById = (id) => settings.get().hooks.find((hook) => hook.id === id)
  const host = (address) => { try { return new URL(address).host } catch { return address } }

  function status() {
    const { hooks, inbox } = settings.get()
    return {
      offline: offline(),
      hooks: hooks.map((hook) => ({ ...hook, waiting: waiting.filter((item) => item.id === hook.id).length })),
      inbox: { on: inbox.on, server: inbox.server, host: host(inbox.server), address: inbox.on ? model.ntfyAddress(inbox) : '', lastAt: inbox.lastAt, error: inboxError },
    }
  }
  const changed = () => onStatus(status())

  async function remember(id, last) {
    if (!hookById(id)) return
    await settings.save({ hooks: settings.get().hooks.map((hook) => (hook.id === id ? { ...hook, last: { at: iso(), ...last } } : hook)) })
    changed()
  }

  /* One delivery. Resolves the result line it remembered ({ ok, text }), or null while it waits.
     `force` sends to an address that is switched off (Send a test). */
  async function deliver(id, body, { retry = true, force = false } = {}) {
    const hook = hookById(id)
    if (!hook || (!hook.on && !force)) return null
    if (offline()) return wait(id, body)
    let problem
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'OSAT' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      response.body?.cancel().catch(() => {})
      if (response.ok) return done(id, { ok: true, text: '' })
      if (response.status < 500) return done(id, { ok: false, text: `${hook.name} answered ${response.status}. Check the address.` })
      problem = `${hook.name} answered ${response.status}`
    } catch (error) {
      if (error.code === 'OFFLINE' || offline()) return wait(id, body)
      problem = `${hook.name} couldn’t be reached`
    }
    if (!retry) return done(id, { ok: false, text: `${problem}, even after a second try, so that one wasn’t sent.` })
    const timer = setTimer(() => {
      retries.delete(timer)
      queue(id, body, { retry: false })
    }, RETRY_MS)
    retries.add(timer)
    return done(id, { ok: false, text: `${problem}. OSAT tries again in 30 seconds.` })
  }
  async function done(id, last) {
    await remember(id, last)
    return last
  }
  function wait(id, body) {
    waiting = [...waiting, { id, body }].slice(-MAX_WAITING)
    changed()
    return null
  }
  // One at a time, in the order they happened.
  function queue(id, body, options) {
    const next = sending.then(() => deliver(id, body, options))
    sending = next.catch(() => {})
    return next
  }

  function send(moment, doc) {
    const hooks = settings.get().hooks.filter((hook) => hook.on && hook.events.includes(moment.event))
    if (!hooks.length) return
    const body = model.payloadFor(moment, doc, { at: iso() })
    if (body) for (const hook of hooks) queue(hook.id, body)
  }

  /* The journal changes with every few letters: its newest line goes out a minute after the
     first change, and only when it is new. */
  function journalSoon(date) {
    const day = journal.get(date) || { timer: null, line: '' }
    journal.set(date, day)
    if (day.timer) return
    day.timer = setTimer(() => {
      day.timer = null
      const doc = store.load().doc
      const body = model.payloadFor({ event: 'journal.written', date }, doc, { at: iso() })
      if (!body || body.journal.line === day.line) return
      day.line = body.journal.line
      for (const hook of settings.get().hooks) if (hook.on && hook.events.includes('journal.written')) queue(hook.id, body)
    }, JOURNAL_MS)
  }

  function onCommit(from, ops) {
    const before = seen
    seen = store.load().doc
    // A whole workspace brought in (Settings → Data → Import) isn't news.
    if (from === 'replace' || !settings.get().hooks.some((hook) => hook.on && hook.events.length)) return
    for (const moment of model.momentsOf(before, seen, ops, { now: now() })) {
      if (moment.event === 'journal.written') journalSoon(moment.date)
      else send(moment, seen)
    }
  }

  /* ---- in: the ntfy topic ---- */

  function pollSoon(wait = POLL_MS) {
    clearTimer(pollTimer)
    pollTimer = null
    if (!running || !settings.get().inbox.on || offline()) return
    pollTimer = setTimer(() => { pollTimer = null; poll().finally(() => pollSoon()) }, wait)
  }

  function poll() {
    polling ||= read().finally(() => { polling = null })
    return polling
  }

  async function read() {
    const inbox = settings.get().inbox
    if (!inbox.on || offline()) return
    try {
      const response = await fetch(model.ntfyPollUrl(inbox), { headers: { 'user-agent': 'OSAT' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) {
        response.body?.cancel().catch(() => {})
        throw new Error(`it answered ${response.status}`)
      }
      const { texts, last } = model.readNtfy(await response.text(), { after: inbox.after })
      // Reset or turned off meanwhile: nothing from the old address counts.
      const current = settings.get().inbox
      if (!current.on || current.topic !== inbox.topic || current.server !== inbox.server) return
      for (const text of texts) await addSticky(text)
      if (last) await settings.save({ inbox: { ...current, since: last, ...(texts.length ? { lastAt: iso() } : {}) } })
      inboxError = ''
    } catch (error) {
      if (error.code !== 'OFFLINE' && !offline()) inboxError = `OSAT couldn’t check ${host(inbox.server)} (${error.message}). It tries again in a minute.`
    } finally {
      changed()
    }
  }

  /* A new address: what was sent to the old one is never read. Reading starts from now. */
  function freshInbox(patch = {}) {
    const seconds = Math.floor(now() / 1000)
    return { ...settings.get().inbox, topic: newTopic(), since: String(seconds), after: seconds, ...patch }
  }

  async function inboxOn() {
    const inbox = settings.get().inbox
    await settings.save({ inbox: inbox.topic ? { ...inbox, on: true } : freshInbox({ on: true }) })
    inboxError = ''
    pollSoon(0)
    return status()
  }

  async function inboxOff() {
    clearTimer(pollTimer)
    pollTimer = null
    inboxError = ''
    await settings.save({ inbox: { ...settings.get().inbox, on: false } })
    return status()
  }

  async function inboxReset() {
    if (!settings.get().inbox.on) throw new Error('Turn it on first.')
    await settings.save({ inbox: freshInbox() })
    inboxError = ''
    pollSoon(0)
    return status()
  }

  async function inboxServer(value) {
    const server = value ? model.ntfyServer(value) : model.NTFY_SERVER
    const seconds = Math.floor(now() / 1000)
    await settings.save({ inbox: { ...settings.get().inbox, server, since: String(seconds), after: seconds } })
    inboxError = ''
    pollSoon(0)
    return status()
  }

  /* ---- out: the addresses ---- */

  async function add({ url, name, events } = {}) {
    const address = model.webhookAddress(url)
    if (settings.get().hooks.length >= model.MAX_HOOKS) throw new Error(`OSAT keeps up to ${model.MAX_HOOKS} addresses. Remove one first.`)
    const hook = { id: `hook-${randomUUID()}`, name: String(name || '').trim().slice(0, 40) || model.hookName(address), url: address, on: true, events: Array.isArray(events) ? events : [] }
    await settings.save({ hooks: [...settings.get().hooks, hook] })
    changed()
    return status()
  }

  async function change(id, patch = {}) {
    if (!hookById(id)) throw new Error('That address isn’t in OSAT any more.')
    const next = {}
    if (typeof patch.on === 'boolean') next.on = patch.on
    if (Array.isArray(patch.events)) next.events = patch.events
    if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim().slice(0, 40)
    await settings.save({ hooks: settings.get().hooks.map((hook) => (hook.id === id ? { ...hook, ...next } : hook)) })
    if (next.on === false) waiting = waiting.filter((item) => item.id !== id)
    changed()
    return status()
  }

  async function remove(id) {
    waiting = waiting.filter((item) => item.id !== id)
    await settings.save({ hooks: settings.get().hooks.filter((hook) => hook.id !== id) })
    changed()
    return status()
  }

  /* Send a test: answered with how it went, never retried and never held. */
  async function test(id) {
    if (!hookById(id)) throw new Error('That address isn’t in OSAT any more.')
    if (offline()) throw new Error('Sending waits until you’re back online.')
    const result = await queue(id, model.payloadFor({ event: 'test' }, null, { at: iso() }), { retry: false, force: true })
    if (!result) throw new Error('Sending waits until you’re back online.')
    if (!result.ok) throw new Error(result.text)
    return status()
  }

  /* Offline changed (main tells the bots): back online, what waited goes, and the inbox is read. */
  function nudge() {
    const off = offline()
    if (off === wasOffline) return
    wasOffline = off
    if (off) {
      clearTimer(pollTimer)
      pollTimer = null
    } else {
      const held = waiting
      waiting = []
      for (const item of held) queue(item.id, item.body)
      pollSoon(0)
    }
    changed()
  }

  async function start() {
    await settings.load()
    seen = store.load().doc
    stopCommits = store.onCommit(onCommit)
    running = true
    pollSoon(0)
  }

  function stop() {
    running = false
    stopCommits?.()
    stopCommits = null
    clearTimer(pollTimer)
    pollTimer = null
    for (const timer of retries) clearTimer(timer)
    retries.clear()
    for (const day of journal.values()) clearTimer(day.timer)
    journal.clear()
  }

  return {
    start, stop, status, nudge, add, change, remove, test, inboxOn, inboxOff, inboxReset, inboxServer,
    address: () => model.ntfyAddress(settings.get().inbox),
    // For tests: wait for every delivery and read now under way.
    settle: async () => { await sending; await polling },
  }
}

module.exports = { createWebhooks }
