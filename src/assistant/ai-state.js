/* What the AI can do right now, in one calm line with a way forward. Pure, so every
   screen that asks the AI says the same thing for the same state.

   aiState({ status, model, models, offline, job, now }) →
     { key, line, action, canAsk, busy, giveUp }
   - status: the built-in AI's status from the Mac app (null in the browser preview)
   - model:  the model that would answer (null when there is none)
   - models: the model list (null while it is still being read)
   - offline: Offline mode is on
   - job:    null, { since } while a question is out, { failed: message } or { slow: true }
             after the last one
   - fallback: what happens instead when the AI can't answer (said after the reason)
   `action` is what the way-forward button does: 'setup' or 'download' (Settings → AI), 'resume'
   (the download), 'retry', 'stop' or null. `giveUp` says a waking engine has taken too long:
   the caller stops waiting and uses matching words. */

export const WAKE_SLOW_MS = 20_000
// The Mac app gives up on a model that hasn't started after 180 s; we stop waiting sooner.
export const WAKE_GIVE_UP_MS = 120_000

const isCloud = (model) => String(model?.id || '').startsWith('cloud:')

/* The first model that runs on this Mac (the built-in AI or LM Studio), never a cloud one:
   sorting reads many stickies at once, so it stays on the Mac. */
export const localModel = (models) => models?.find((item) => item?.offline === true && !isCloud(item)) || null

/* The engine behind a model: { state, blocked, message } for the built-in AI, null otherwise. */
export function engineOf(status, model) {
  const id = String(model?.id || '')
  if (!id.startsWith('osat:')) return null
  const tier = status?.tiers?.find((item) => item.id === id.slice(5))
  return tier ? { state: tier.state || 'idle', blocked: Boolean(tier.blocked), message: tier.message || '' } : { state: model.state || 'idle', blocked: false, message: '' }
}

const percentOf = (download) => (download?.total ? Math.floor((download.received / download.total) * 100) : 0)
export const WORDS = 'Matching words suggest homes for now.'

export function aiState({ status = null, model = null, models = null, offline = false, job = null, now = Date.now(), fallback = WORDS } = {}) {
  const engine = engineOf(status, model)
  const say = (key, line, extra = {}) => ({ key, line: line.replace(/\s{2,}/g, ' ').trim(), action: null, canAsk: false, busy: false, giveUp: false, ...extra })

  // A question is out: waking, or reading.
  if (job?.since) {
    const waited = Math.max(0, now - job.since)
    if (engine && engine.state !== 'ready') {
      if (waited >= WAKE_GIVE_UP_MS) return say('slow', `The AI is taking too long to wake. ${fallback} Try the AI again in a minute.`, { action: 'retry', canAsk: true, giveUp: true })
      return say('waking', waited >= WAKE_SLOW_MS
        ? 'Still waking the AI. Bigger models take a minute the first time. If OSAT asked about memory, answer that first.'
        : 'Waking the AI…', { action: 'stop', busy: true })
    }
    return say('thinking', 'The AI is reading…', { action: 'stop', busy: true })
  }
  if (job?.slow) return say('slow', `The AI is taking too long to wake. ${fallback} Try the AI again in a minute.`, { action: 'retry', canAsk: true })
  if (job?.failed) return say('failed', `${String(job.failed).replace(/\.?\s*$/, '.')} ${fallback}`, { action: 'retry', canAsk: Boolean(model) })

  if (!models) return say('checking', 'Checking the AI…')

  if (model) {
    if (!engine) return say('ready', isCloud(model) ? 'The AI is ready.' : 'The AI on this Mac is ready.', { canAsk: true })
    if (engine.state === 'ready') return say('ready', 'The AI on this Mac is awake.', { canAsk: true })
    if (engine.state === 'loading') return say('waking', 'The AI is waking up…', { canAsk: true })
    if (engine.state === 'unloading') return say('unloading', 'The AI is putting itself away. Try again in a moment.')
    if (engine.state === 'error') return say('asleep', `The AI stopped last time${engine.message ? ` (${engine.message.replace(/\.$/, '')})` : ''}. Asking tries again.`, { canAsk: true })
    return say('asleep', engine.blocked
      ? 'The AI is resting since its memory was freed. Asking wakes it.'
      : 'The AI is resting. Asking wakes it; the first answer takes a few seconds.', { canAsk: true })
  }

  // No model to ask: say why, and what would change that.
  const download = status?.download
  if (download?.state === 'running') return say('downloading', `The AI is still downloading · ${percentOf(download)}%. ${fallback}`, { action: 'download' })
  if (download && offline) return say('offline', `You’re offline, so the AI download waits at ${percentOf(download)}%. ${fallback}`)
  if (download?.state === 'paused') return say('paused', `The AI download is paused at ${percentOf(download)}%. ${fallback}`, { action: 'resume' })
  if (download?.state === 'failed') return say('download-failed', `${download.message || 'The AI download stopped.'} ${fallback}`, { action: 'resume' })
  if (offline) return say('offline', `You’re offline, so the AI can’t be set up yet. ${fallback}`)
  return say('none', `The AI isn’t set up yet. ${fallback}`, { action: 'setup' })
}

/* The words on the way-forward button. */
export const actionLabel = (action) => ({ setup: 'Set up the AI', download: 'See the download', resume: 'Resume download', retry: 'Try the AI again', stop: 'Stop' }[action] || '')
