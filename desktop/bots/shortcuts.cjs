/* Siri and Shortcuts (Phase 47): a ready-made shortcut (shared/shortcut-file.mjs) becomes a file
   Shortcuts will add. Apple's own `shortcuts sign` signs it on this Mac for "people who know me":
   that uses the Mac's own iCloud identity, takes a moment and needs no network (the "anyone" mode
   asks Apple's servers, so OSAT never uses it). Everything sits in a private folder in the data
   folder: the unsigned file is removed at once; a signed one holds the key, but Shortcuts reads it
   after OSAT hands it over, so it is removed once it is an hour old (`sweep`, also at start).
   `build(id, where)` gives { name, text }; `run` is passed in for the tests. */
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')

const SHORTCUTS_TOOL = '/usr/bin/shortcuts'
const KEEP_MS = 60 * 60 * 1000

function runFile(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 30000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr: String(stderr || '') })) : resolve()))
  })
}

function createShortcuts({ dir, build, run = runFile, platform = process.platform, now = Date.now }) {
  async function sweep() {
    for (const name of await fs.readdir(dir).catch(() => [])) {
      const file = path.join(dir, name)
      const info = await fs.stat(file).catch(() => null)
      if (info && now() - info.mtimeMs > KEEP_MS) await fs.rm(file, { force: true })
    }
  }

  /* Resolves the signed file's path, named as the shortcut is, for Shortcuts to open. */
  async function make(id, where) {
    if (platform !== 'darwin') throw new Error('Shortcuts are made in the Mac app.')
    const { name, text } = build(id, where)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    await sweep()
    const unsigned = path.join(dir, `${name}.unsigned.shortcut`)
    const signed = path.join(dir, `${name}.shortcut`)
    await fs.writeFile(unsigned, text, { mode: 0o600 })
    try {
      await run(SHORTCUTS_TOOL, ['sign', '--mode', 'people-who-know-me', '--input', unsigned, '--output', signed])
    } catch (error) {
      const why = String(error.stderr || error.message || '').replace(/^Error:\s*/, '').split('\n')[0].trim()
      throw new Error(`Shortcuts couldn’t get “${name}” ready${why ? ` (${why})` : ''}. It signs with your iCloud account, so check you’re signed in to iCloud, or make one by hand with the Shortcuts and scripts lines above.`)
    } finally {
      await fs.rm(unsigned, { force: true })
    }
    return signed
  }

  return { make, sweep }
}

module.exports = { createShortcuts, SHORTCUTS_TOOL }
