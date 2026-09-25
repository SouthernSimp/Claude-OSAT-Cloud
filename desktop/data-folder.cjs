const path = require('node:path')
const nodeFs = require('node:fs')

// OSAT keeps its data in ~/Library/Application Support/OSAT. Older apps also used a
// folder named "OSAT"; if one is found without our marker it is renamed aside,
// never deleted or read.
const DATA_MARKER = 'osat-data-folder.json'
const APP_ID = 'ai.mccreery.osat'

function claimDataFolder(folder, { fs = nodeFs, now = () => new Date() } = {}) {
  const marker = path.join(folder, DATA_MARKER)
  let movedAside = null
  if (fs.existsSync(folder) && !fs.existsSync(marker) && fs.readdirSync(folder).length > 0) {
    const day = now().toISOString().slice(0, 10)
    movedAside = `${folder} (before ${day})`
    for (let n = 2; fs.existsSync(movedAside); n += 1) movedAside = `${folder} (before ${day}) ${n}`
    fs.renameSync(folder, movedAside)
  }
  fs.mkdirSync(folder, { recursive: true })
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, `${JSON.stringify({ app: APP_ID, createdAt: now().toISOString() }, null, 2)}\n`)
  }
  return { folder, movedAside }
}

module.exports = { APP_ID, DATA_MARKER, claimDataFolder }
