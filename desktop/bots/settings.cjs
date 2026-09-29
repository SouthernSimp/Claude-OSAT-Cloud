/* Settings → Bots, kept in <data folder>/bots.json: which model answers, the providers
   (never their keys: those are in the Keychain), what each has used, and the connector. Saves take turns, each writing the newest settings in one piece. `clean`
   is cleanBotSettings from shared/providers.mjs. */
const path = require('node:path')
const nodeFs = require('node:fs/promises')

function createSettings({ file, clean, fs = nodeFs }) {
  let current = clean({})
  let writing = Promise.resolve()

  async function write(settings) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(settings, null, 1)}\n`, { mode: 0o600 })
    await fs.rename(temp, file)
  }

  return {
    async load() {
      try {
        current = clean(JSON.parse(await fs.readFile(file, 'utf8')))
      } catch {
        // None yet, or unreadable: the defaults (the AI on this Mac) stand.
      }
      return current
    },
    get: () => current,
    save(patch) {
      current = clean({ ...current, ...patch })
      const settings = current
      writing = writing.catch(() => {}).then(() => write(settings))
      return writing
    },
  }
}

module.exports = { createSettings }
