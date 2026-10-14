/* The Hyper key, built in (Phase 63; rules and words in shared/hyper-model.mjs). Two parts:
   - `createCapsMapping`: Caps Lock → F20 with the Mac's `hidutil`, added to the mappings already there and taken out
     again alone. It removes only an entry OSAT added (a note, `hyper.json` in the data folder, remembers that); a
     Caps Lock → F20 already there (Raycast leaves one) is used as it is and never removed.
   - `createHyper`: the native helper (desktop/helpers/osat-hyper.swift, built to build/helpers/osat-hyper and shipped in
     the app's Resources). It reads only key codes and flags and says `ready`, `denied` or `stopped`. The Caps Lock
     mapping exists only while the helper is listening: it is added when the helper says `ready` and taken out when the
     helper is stopped, ends, is denied, or OSAT quits, so Caps Lock is never left sending a key nothing hears.
   Runs only on a Mac, only while the switch in Settings → Keyboard is on, and only with Accessibility. Nothing here goes
   on the network, so Offline has nothing to pause. `spawn` and `run` are passed in; the tests never start a process or
   call hidutil. */
const fs = require('node:fs')

/* `run(args)` runs `hidutil <args>` and returns its text (it throws if it fails). */
function createCapsMapping({ run, file, model, platform = process.platform, log = () => {} }) {
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).added === true } catch { return false }
  }
  const note = (added) => {
    try { added ? fs.writeFileSync(file, JSON.stringify({ added: true }), { mode: 0o600 }) : fs.rmSync(file, { force: true }) } catch (error) { log(error.message) }
  }
  const look = () => {
    try { return model.readMappings(run(['property', '--get', 'UserKeyMapping'])) } catch { return { ok: false } }
  }
  const put = (list) => run(['property', '--set', model.setArgument(list)])

  return {
    // Caps Lock → F20 is in place: → { ok, added } (added: by OSAT now, not by something else).
    add() {
      if (platform !== 'darwin') return { ok: false }
      const now = look()
      if (!now.ok) { log('hidutil’s answer was not understood, so the keyboard was left alone'); return { ok: false } }
      if (model.hasOurs(now.list)) return { ok: true, added: false }
      try { put(model.withOurs(now.list)) } catch (error) { log(error.message); return { ok: false } }
      note(true)
      return { ok: true, added: true }
    },
    // Takes out the entry OSAT added, and only that. → { ok }.
    remove() {
      if (platform !== 'darwin' || !read()) return { ok: true }
      const now = look()
      if (!now.ok) { log('hidutil’s answer was not understood, so the keyboard was left alone'); return { ok: false } }
      if (model.hasOurs(now.list)) {
        try { put(model.withoutOurs(now.list)) } catch (error) { log(error.message); return { ok: false } }
      }
      note(false)
      return { ok: true }
    },
    // Whether the entry in place is OSAT's own (so a restart after a crash still cleans up).
    ours: read,
  }
}

function createHyper({ spawn = null, platform = process.platform, owner = process.pid, helperPath, model, mapping, trusted = () => false, log = () => {}, retryMs = 2000 }) {
  let child = null
  let timer = null
  let tries = 0
  let startedAt = 0
  let tapEscape = false
  // 'unavailable' (not a Mac), 'off', 'access' (waiting for Accessibility), 'starting', 'working', 'denied' or 'failed'.
  let state = platform === 'darwin' && typeof spawn === 'function' ? 'off' : 'unavailable'

  function hear(line) {
    const said = model.readHelperLine(line)
    if (said?.kind === 'ready') {
      // The keyboard changes only now, with a helper listening.
      if (mapping.add().ok) state = 'working'
      else { state = 'failed'; end() }
    } else if (said?.kind === 'denied') {
      state = 'denied'
    }
  }

  function start() {
    timer = null
    state = 'starting'
    startedAt = Date.now()
    let proc
    try {
      proc = spawn(helperPath, ['--owner', String(owner), ...(tapEscape ? ['--tap-escape'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      state = 'failed'
      log(error.message)
      return
    }
    child = proc
    let pending = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop()
      lines.forEach(hear)
    })
    proc.stderr.on('data', (chunk) => log(String(chunk).trim().split('\n')[0]))
    proc.on('error', (error) => {
      if (child !== proc) return
      child = null
      state = 'failed'
      mapping.remove()
      log(error.message)
    })
    // It ended without being stopped: Caps Lock goes back to normal at once. One that was listening is started again (a
    // few times); one that was refused or never listened is not.
    proc.on('exit', () => {
      if (child !== proc) return
      child = null
      mapping.remove()
      const worked = state === 'working'
      tries = worked && Date.now() - startedAt > 60000 ? 1 : tries + 1
      if (worked && tries <= 3) {
        state = 'starting'
        timer = setTimeout(start, retryMs)
      } else if (state !== 'denied') {
        state = 'failed'
      }
    })
  }

  // The helper ends and Caps Lock is as it was.
  function end() {
    clearTimeout(timer)
    timer = null
    const proc = child
    child = null
    proc?.kill()
    mapping.remove()
  }

  function stop(next = 'off') {
    tries = 0
    end()
    if (state !== 'unavailable') state = next
  }

  return {
    state: () => state,
    /* Run while `want` is true (and allowed); `tap` makes a quick tap of Caps Lock alone an Esc. A helper that failed or was
       refused isn't started again by every save; turn it off and on. Anything left over from a crash is cleaned up. */
    sync(want, { tap = false } = {}) {
      if (state === 'unavailable') return
      if (!want) { stop(); return }
      if (!trusted()) { stop('access'); return }
      if (tap !== tapEscape && child) stop()
      tapEscape = tap
      if (state === 'off' || state === 'access') start()
    },
    // OSAT quits: the helper goes and Caps Lock is put back, before the process ends.
    stop: () => stop(),
  }
}

module.exports = { createCapsMapping, createHyper }
