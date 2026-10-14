/* The Mac's own keyboard shortcuts (System Settings → Keyboard → Keyboard Shortcuts), read from
   com.apple.symbolichotkeys with `plutil`: a local, read-only look, nothing changed. Settings → Shortcuts
   shows them next to OSAT's keys, and a new OSAT key that one of them holds is refused by name.
   Off the Mac (the Linux tests) there are none. `run` and `file` are passed in for the tests. */
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')

function createMacKeys({ sharedModule, platform = process.platform, run = execFile, file = path.join(os.homedir(), 'Library/Preferences/com.apple.symbolichotkeys.plist') }) {
  return {
    async read() {
      if (platform !== 'darwin') return []
      const stdout = await new Promise((resolve) => {
        run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, out) => resolve(error ? '' : String(out)))
      })
      try {
        return (await sharedModule('keys-model.mjs')).fromSymbolic(JSON.parse(stdout))
      } catch {
        return []
      }
    },
  }
}

module.exports = { createMacKeys }
