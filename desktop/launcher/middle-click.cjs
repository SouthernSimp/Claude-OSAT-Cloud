/* The ring's middle-click (Phase 13i): Hyper + the middle mouse button opens the ring over any app.
   Electron has no way to see a click outside its own windows, so a small helper does: `osascript -l JavaScript`
   running AppKit's global event monitor for "other" mouse buttons. It writes `ready` once it listens, then one line
   `click <button> <flags>` per press; shared/ring-click.mjs decides which of those is Hyper + middle, so Settings'
   "what the Hyper key sends" applies at once, with no restart.
   - It only watches mouse buttons: no keys, no text, no screen. A mouse monitor needs no macOS permission.
   - It only observes: the click still goes to the app under the pointer (a global monitor cannot swallow it).
   - It starts only on a Mac, while the ring and its middle-click are on, and stops with OSAT; if OSAT dies, the helper
     notices (its parent changed) and leaves. Nothing here touches the network, so Offline has nothing to pause.
   - If it can't listen, `state()` says 'failed' and nothing else happens: Hyper R still opens the ring.
   `spawn` is passed in (main gives child_process's), so the tests never start a process. */

/* The helper, for the OSAT process `owner`. 33554432 is NSEventMaskOtherMouseDown; the policy 1 keeps it out of the
   Dock and the menu bar; every 2 seconds it leaves if its parent is no longer `owner`. */
const script = (owner) => `ObjC.import('Cocoa')
ObjC.import('stdlib')
ObjC.import('unistd')
const out = $.NSFileHandle.fileHandleWithStandardOutput
const say = (line) => out.writeData($(line + '\\n').dataUsingEncoding($.NSUTF8StringEncoding))
$.NSApplication.sharedApplication
$.NSApp.setActivationPolicy(1)
$.NSEvent.addGlobalMonitorForEventsMatchingMaskHandler(33554432, (event) => say('click ' + Number(event.buttonNumber) + ' ' + Number(event.modifierFlags)))
$.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(2, true, () => { if ($.getppid() !== ${Number(owner) || 0}) $.exit(0) })
say('ready')
$.NSApp.run`

function createMiddleClick({ spawn = null, platform = process.platform, owner = process.pid, model, sends = () => 'four', onClick, log = () => {}, retryMs = 2000 }) {
  let child = null
  let timer = null
  let tries = 0
  let startedAt = 0
  // 'unavailable' (not a Mac), 'off', 'starting', 'listening', or 'failed' (Settings says so, calmly).
  let state = platform === 'darwin' && typeof spawn === 'function' ? 'off' : 'unavailable'

  function hear(line) {
    const event = model.readHelperLine(line)
    if (event?.kind === 'ready') state = 'listening'
    else if (event?.kind === 'click' && model.isHyperClick(event, sends())) onClick()
  }

  function start() {
    timer = null
    state = 'starting'
    startedAt = Date.now()
    let proc
    try {
      proc = spawn('osascript', ['-l', 'JavaScript', '-e', script(owner)], { stdio: ['ignore', 'pipe', 'pipe'] })
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
      log(error.message)
    })
    // It ended without being stopped: one that was listening is started again (a few times); one that never was is not.
    proc.on('exit', () => {
      if (child !== proc) return
      child = null
      const worked = state === 'listening'
      tries = worked && Date.now() - startedAt > 60000 ? 1 : tries + 1
      if (worked && tries <= 3) {
        state = 'starting'
        timer = setTimeout(start, retryMs)
      } else {
        state = 'failed'
      }
    })
  }

  function stop() {
    clearTimeout(timer)
    timer = null
    tries = 0
    const proc = child
    child = null
    if (state !== 'unavailable') state = 'off'
    proc?.kill()
  }

  return {
    state: () => state,
    // Listen while `want` is true, and not otherwise. A helper that failed isn't started again by every save; turn it off and on.
    sync(want) {
      if (state === 'unavailable') return
      if (!want) stop()
      else if (state === 'off') start()
    },
    stop,
  }
}

module.exports = { createMiddleClick, script }
