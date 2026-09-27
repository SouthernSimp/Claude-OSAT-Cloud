/* Incognito: OSAT with the internet off. One flag, kept in prefs.json as `under`,
   read before anything that could reach the internet starts. While it is on, only
   this Mac answers: files and pages inside the app, and loopback (LM Studio). Main
   does the pausing and the waking (`down`, `up`); this holds the flag and the order. */

const LOCAL_SCHEMES = new Set(['about:', 'blob:', 'chrome:', 'chrome-extension:', 'data:', 'devtools:'])
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/

/* Never leaves the Mac: in-app pages, and addresses on this Mac itself. */
function isLocal(url) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return false
  }
  if (LOCAL_SCHEMES.has(parsed.protocol)) return true
  // file://server/share would reach another machine.
  if (parsed.protocol === 'file:') return parsed.hostname === '' || parsed.hostname === 'localhost'
  return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) && (LOOPBACK.test(parsed.hostname) || parsed.hostname.endsWith('.localhost'))
}

class OfflineError extends Error {
  constructor() {
    super('OSAT is offline in Incognito. It will reach the internet again when you come up.')
    this.name = 'OfflineError'
    this.code = 'OFFLINE'
  }
}

/* The main process's fetch: loopback always passes; the rest only while above.
   Under, a loopback answer can't redirect it elsewhere: fetch would follow on its own. */
function guardFetch(fetch, isUnder) {
  return function guardedFetch(input, init) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url
    if (!isUnder()) return fetch(input, init)
    if (!isLocal(url)) return Promise.reject(new OfflineError())
    return fetch(input, { ...init, redirect: 'error' })
  }
}

/* What each refused channel says while under. Everything else works as always. */
const WAITS = [
  [/^browser:(open|navigate)$/, 'The web waits until you come up.'],
  [/^files:/, 'Files wait until you come up.'],
  [/^media:/, 'Music waits until you come up.'],
  [/^desk:launch$/, 'Apps open again when you come up.'],
  [/^terminal:start$/, 'A new terminal waits until you come up.'],
  // ai:choose is refused in its handler, only for a size that would download.
  [/^ai:resume$/, 'Downloads wait until you come up.'],
  [/^phone:enable$/, 'The iPhone link waits until you come up.'],
  // Turning it off takes the copy of the notes out of iCloud Drive, which iCloud sends on.
  [/^phone:disable$/, 'Turning the iPhone link off waits until you come up.'],
]
const refusal = (channel) => WAITS.find(([pattern]) => pattern.test(channel))?.[1] || null

/* Going under: the flag is on before anything else moves, then `down` pauses what
   reaches out, then it is saved. If that fails, it all comes back up. Coming up is
   saved first, so a failed save leaves OSAT safely under. One change at a time. */
function createUnder({ save = async () => {}, down = async () => {}, up = async () => {}, changed = () => {} } = {}) {
  let on = false
  let turning = Promise.resolve()

  function set(next) {
    const result = turning.catch(() => {}).then(async () => {
      next = next === true
      if (next === on) return on
      if (next) {
        on = true
        try {
          await down()
          await save(true)
        } catch (error) {
          on = false
          await up().catch(() => {})
          throw new Error(`OSAT couldn’t go under (${error.message}). Nothing changed.`)
        }
      } else {
        try {
          await save(false)
        } catch (error) {
          throw new Error(`OSAT couldn’t come up (${error.message}). It is still offline.`)
        }
        on = false
        // Whatever doesn't wake still leaves OSAT online, and the windows must hear it.
        await up().catch((error) => console.error('Something didn’t wake after coming up:', error))
      }
      changed(on)
      return on
    })
    turning = result
    return result
  }

  return {
    get on() { return on },
    // At launch, from prefs.under: nothing is paused yet because nothing has started.
    begin(value) { on = value === true },
    set,
  }
}

module.exports = { OfflineError, createUnder, guardFetch, isLocal, refusal }
