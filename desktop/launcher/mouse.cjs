/* Mouse (Phase 64): the wheel's direction and speed and the side buttons, through a small helper
   (desktop/helpers/osat-mouse.swift, built by scripts/build-helpers.mjs and shipped as Resources/helpers/osat-mouse).
   The rules and the words are shared/mouse-model.mjs; the settings are `mouse` in launcher.json.
   - It starts only on a Mac, while Mouse is on with something to change, OSAT is allowed in Accessibility and the
     helper is there. It is told the settings as one JSON line on its input, again whenever they change, and until the
     first line arrives it changes nothing.
   - It says only `ready`, `denied` (macOS would not let it listen) or `stopped`. It records nothing about what the
     pointer or the wheel does, and neither does this file.
   - It is stopped when Mouse goes off, Accessibility goes, and at quit. The helper also leaves when its input closes or
     its parent changes, so a crashed OSAT cannot leave the wheel changed: the change lives in the helper's event tap and
     nowhere else.
   - If it can't listen, `state()` says so and nothing else happens. A helper that was working is started again a few
     times; one that was refused or never started is not, until Mouse is turned off and on.
   `spawn` is passed in (main gives child_process's), so the tests never start a process. */
const fs = require('node:fs')
const path = require('node:path')

/* Where the helper is: next to the app's resources when packaged, in build/helpers when run from source. */
function helperPath({ packaged, resources = process.resourcesPath, root = path.join(__dirname, '..', '..') }) {
  return packaged ? path.join(resources, 'helpers', 'osat-mouse') : path.join(root, 'build', 'helpers', 'osat-mouse')
}

function createMouse({ spawn = null, platform = process.platform, helper, exists = (file) => fs.existsSync(file), model, mouse = () => model.cleanMouse(), trusted = () => false, log = () => {}, retryMs = 2000 }) {
  let child = null
  let timer = null
  let tries = 0
  let startedAt = 0
  let sent = ''
  // 'unavailable' (not a Mac), 'off', 'access' (waiting for Accessibility), 'starting', 'listening', 'denied' (macOS said
  // no), 'missing' (this build has no helper) or 'failed'. Settings says each one calmly.
  let state = platform === 'darwin' && typeof spawn === 'function' ? 'off' : 'unavailable'

  function tell(proc) {
    const line = model.configLine(mouse())
    if (line === sent) return
    sent = line
    try { proc.stdin.write(line) } catch (error) { log(error.message) }
  }

  function hear(line) {
    const said = model.readHelperLine(line)
    if (said?.kind === 'ready') state = 'listening'
    else if (said?.kind === 'denied') state = 'denied'
  }

  function start() {
    timer = null
    state = 'starting'
    startedAt = Date.now()
    sent = ''
    let proc
    try {
      proc = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      state = 'failed'
      log(error.message)
      return
    }
    child = proc
    let pending = ''
    proc.stdin?.on?.('error', (error) => log(error.message))
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop()
      lines.forEach(hear)
    })
    proc.stderr?.on?.('data', () => {})
    proc.on('error', (error) => {
      if (child !== proc) return
      child = null
      state = 'failed'
      log(error.message)
    })
    proc.on('exit', () => {
      if (child !== proc) return
      child = null
      if (state === 'denied') return
      const worked = state === 'listening'
      tries = worked && Date.now() - startedAt > 60000 ? 1 : tries + 1
      if (worked && tries <= 3) {
        state = 'starting'
        timer = setTimeout(start, retryMs)
      } else {
        state = 'failed'
      }
    })
    tell(proc)
  }

  function stop(next = 'off') {
    clearTimeout(timer)
    timer = null
    tries = 0
    sent = ''
    const proc = child
    child = null
    if (state !== 'unavailable') state = next
    try { proc?.stdin?.end() } catch {}
    proc?.kill()
  }

  return {
    state: () => state,
    /* Run the helper while it is wanted and allowed; tell a running one the settings as they are now. */
    sync() {
      if (state === 'unavailable') return
      if (!model.wantsHelper(mouse())) { stop(); return }
      if (!trusted()) { stop('access'); return }
      if (child) { tell(child); return }
      if (state === 'access' || state === 'off' || state === 'missing') {
        if (!exists(helper)) { state = 'missing'; return }
        start()
      }
    },
    stop: () => stop(),
  }
}

module.exports = { createMouse, helperPath }
