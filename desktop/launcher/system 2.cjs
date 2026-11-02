/* The Mac's own commands from the quick bar (shared/system-commands.mjs): lock the screen, sleep, turn the screen
   off, dark mode, mute, hide other apps, empty the Bin. Each is one short command the Mac already has (pmset,
   AppleScript); nothing else changes. Locking and hiding other apps press keys or ask System Events, so they need
   Accessibility; dark mode and the Bin ask System Events and Finder, which macOS asks Nate about once. `exec` and
   `trusted` are passed in, so the tests use stand-ins. */
const { run } = require('../mac-files.cjs')

const OSA = {
  lock: 'tell application "System Events" to keystroke "q" using {control down, command down}',
  'dark-mode': 'tell application "System Events" to tell appearance preferences to set dark mode to not dark mode',
  mute: 'set volume output muted not (output muted of (get volume settings))',
  'hide-others': 'tell application "System Events" to set visible of (every process whose visible is true and frontmost is false) to false',
  'empty-bin': 'tell application "Finder" to empty the trash',
}
const NEEDS_ACCESS = new Set(['lock', 'hide-others'])

function createSystem({ exec = run, platform = process.platform, trusted = () => false, model }) {
  return {
    /* → { ok: true } or { ok: false, reason: 'mac' | 'access' | 'nothing' | 'failed' }. */
    async run(id) {
      if (!model.systemCommand(id)) return { ok: false, reason: 'nothing' }
      if (platform !== 'darwin') return { ok: false, reason: 'mac' }
      if (NEEDS_ACCESS.has(id) && !trusted()) return { ok: false, reason: 'access' }
      try {
        if (id === 'sleep') await exec('pmset', ['sleepnow'], { timeout: 5000 })
        else if (id === 'screen-off') await exec('pmset', ['displaysleepnow'], { timeout: 5000 })
        else await exec('osascript', ['-e', OSA[id]], { timeout: 15000 })
        return { ok: true }
      } catch {
        return { ok: false, reason: 'failed' }
      }
    },
  }
}

module.exports = { OSA, createSystem }
