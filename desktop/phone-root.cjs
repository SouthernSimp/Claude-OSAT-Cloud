/* Where the OSAT folder in iCloud lives. Until the iPhone app has been opened it is a
   plain folder in iCloud Drive (<drive>/OSAT). Once the app's own iCloud folder exists
   (<container>, which Files also shows as "OSAT"), everything moves in there so the Mac
   and the iPhone share one folder. It only moves things: anything already in the app's
   folder stays (a clash moves in beside it as "name (2)"), OSAT's own "What lives here"
   is written again, and the old folder is removed only once it is empty. */
const path = require('node:path')
const nodeFs = require('node:fs/promises')

const exists = (fs, target) => fs.access(target).then(() => true, () => false)

const README = 'What lives here.txt' // OSAT writes it again in the new folder

async function moveInto(fs, from, to) {
  if (!(await exists(fs, to))) {
    await fs.rename(from, to)
    return
  }
  if ((await fs.stat(from)).isDirectory()) {
    for (const name of await fs.readdir(from)) await moveInto(fs, path.join(from, name), path.join(to, name))
    await fs.rmdir(from).catch(() => {}) // only if now empty
    return
  }
  if (path.basename(from) === README) {
    await fs.rm(from, { force: true })
    return
  }
  // The same name on both sides: the Mac's copy moves in beside the app's.
  const ext = path.extname(to)
  for (let n = 2; ; n += 1) {
    const beside = `${to.slice(0, to.length - ext.length)} (${n})${ext}`
    if (!(await exists(fs, beside))) {
      await fs.rename(from, beside)
      return
    }
  }
}

async function settleRoot({ drive, container, fs = nodeFs }) {
  const plain = path.join(drive, 'OSAT')
  if (!container || !(await exists(fs, container))) return plain
  if (await exists(fs, plain)) {
    for (const name of await fs.readdir(plain)) await moveInto(fs, path.join(plain, name), path.join(container, name))
    await fs.rmdir(plain).catch(() => {})
  }
  return container
}

module.exports = { settleRoot }
