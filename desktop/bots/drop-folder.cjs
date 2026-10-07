/* The drop folder (~/Documents/OSAT Nodes): a bot (Muse, Grok Bot, Claude) or Nate saves a
   node file there, and it becomes a node in the Sky, then moves to Added. A file OSAT
   can't read moves to "Set aside" with a calm word in Settings → Bots. Nothing is deleted.
   It is a folder on this Mac, so it works offline too.
   `core` is shared/node-file.mjs; `take(tree, { name, hash })` puts the node in the store
   and answers { folder } or { duplicate }. The file system and the clock are passed in. */
const path = require('node:path')
const nodeFs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { moveInto, oneAtATime, settledFiles } = require('../folder-watch.cjs')

const README = 'What lives here.txt'
const MAX_BYTES = 2 * 1024 * 1024
const KEEP = 5 // how many recent arrivals and set-aside files Settings lists

/* The same words saved twice make the same fingerprint, whatever the file is called. */
const fingerprint = (value) => createHash('sha256').update(String(value).replace(/\r\n?/g, '\n').trim()).digest('hex')

function createDropFolder({ dir, core, take, fs = nodeFs, now = () => Date.now(), onStatus = () => {} }) {
  const added = path.join(dir, 'Added')
  const aside = path.join(dir, 'Set aside')
  let status = { dir, arrived: [], setAside: [], error: '' }

  const setStatus = (patch) => {
    status = { ...status, ...patch }
    onStatus(status)
  }
  const stamp = () => new Date(now()).toISOString()

  /* The folder, Added, and a note in it for whoever looks (the bot instructions). */
  async function prepare() {
    await fs.mkdir(added, { recursive: true })
    await fs.writeFile(path.join(dir, README), core.botInstructions(dir))
  }

  async function setAside(file, name, why) {
    try {
      await moveInto(fs, file, aside)
    } catch {
      return // busy or gone: the next look tries again
    }
    setStatus({ setAside: [{ name, why, at: stamp() }, ...status.setAside].slice(0, KEEP) })
  }

  /* Each settled node file becomes one node, then moves to Added. */
  async function look() {
    let files
    try {
      files = await settledFiles(dir, {
        fs,
        now,
        maxBytes: MAX_BYTES,
        accept: (name) => name !== README && core.NODE_FILE_TYPES.includes(path.extname(name).toLowerCase()),
      })
    } catch (error) {
      setStatus({ error: error.code === 'EPERM' || error.code === 'EACCES'
        ? 'OSAT isn’t allowed into Documents yet. Allow it in System Settings → Privacy & Security → Files and Folders.'
        : `OSAT couldn’t look in the folder (${error.code || error.message}).` })
      return 0
    }
    if (status.error) setStatus({ error: '' })
    let count = 0
    for (const { name, file, tooBig } of files) {
      if (tooBig) {
        await setAside(file, name, 'It’s bigger than a topic file can be (2 MB).')
        continue
      }
      let body
      try {
        body = await fs.readFile(file, 'utf8')
      } catch {
        continue // not ready yet
      }
      let tree
      try {
        tree = core.readNodeFile(body, name)
      } catch (error) {
        await setAside(file, name, error instanceof core.NodeFileError ? error.message : 'OSAT couldn’t read it.')
        continue
      }
      const result = take(tree, { name, hash: fingerprint(body) })
      try {
        await moveInto(fs, file, added)
      } catch {
        // It stays; its fingerprint keeps the next look from making it twice.
      }
      const arrival = result.duplicate
        ? { name, node: result.duplicate.name, same: true, at: stamp() }
        : { name, node: result.folder.name, source: tree.source, packed: core.isPacked(tree), at: stamp() }
      setStatus({ arrived: [arrival, ...status.arrived].slice(0, KEEP) })
      if (!result.duplicate) count += 1
    }
    return count
  }

  return { prepare, look: oneAtATime(look), status: () => status }
}

module.exports = { createDropFolder, fingerprint }
