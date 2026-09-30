/* The apps on this Mac, for the quick search (Phase 13): the `.app` bundles in the usual places,
   looked at again after a minute. Only a path this list holds can be opened (main checks with `has`),
   so a window can't ask OSAT to open anything else. */
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const DIRS = () => [
  '/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities',
  path.join(os.homedir(), 'Applications'),
]

/* `.app` folders inside `dir`, and inside plain folders one level down (Adobe's, a vendor's). */
async function appsIn(dir, { readdir = fs.readdir, depth = 1 } = {}) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.name.endsWith('.app')) found.push({ name: entry.name.slice(0, -4), path: full })
    else if (depth > 0 && entry.isDirectory()) found.push(...await appsIn(full, { readdir, depth: depth - 1 }))
  }
  return found
}

function createApps({ dirs = DIRS, readdir = fs.readdir, now = Date.now, keep = 60000 } = {}) {
  let list = []
  let looked = -Infinity
  let looking = null
  async function refresh() {
    const all = (await Promise.all(dirs().map((dir) => appsIn(dir, { readdir })))).flat()
    // The same app twice (a copy in ~/Applications) shows once.
    const byName = new Map()
    for (const item of all) if (!byName.has(item.name.toLowerCase())) byName.set(item.name.toLowerCase(), item)
    list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
    looked = now()
  }
  return {
    async list() {
      if (now() - looked > keep) await (looking ??= refresh().finally(() => { looking = null }))
      return list
    },
    async has(appPath) {
      return (await this.list()).some((item) => item.path === appPath)
    },
    /* An app by the name Nate typed for a keyword ("Spotify"): the exact name, or the one that starts with it. */
    async named(name) {
      const lower = String(name || '').toLowerCase()
      const apps = await this.list()
      return apps.find((item) => item.name.toLowerCase() === lower) || apps.find((item) => item.name.toLowerCase().startsWith(lower)) || null
    },
  }
}

module.exports = { appsIn, createApps }
