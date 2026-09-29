/* Scans: printer → Google Drive → OSAT. Nate's printer uploads scans to a Google Drive
   folder; with Google Drive for Desktop that folder is also on this Mac, and OSAT watches
   it (Settings → Bots → Scans). No Google sign-in, no API, and it works offline.
   Each new PDF or image becomes a packed New node ("from Scan"): OSAT copies it into its
   own data folder (<data>/scans) and never moves, renames or deletes the original, so
   whatever else reads that folder (Nate's scan → Word flow) keeps working. Then, on this
   Mac, it reads the words on it (readScan) and asks the chosen model for a name and a
   summary, shown on the node for one click to confirm.
   The files already there when a folder is picked are noted, not brought in, until Nate
   asks. Which scans were taken is kept by fingerprint (seen.json), so a scan renamed in
   Drive is still the same scan. The file system, the clock and the reading are passed in. */
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const nodeFs = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const { oneAtATime, settledFiles } = require('../folder-watch.cjs')

const TYPES = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.heic', '.tif', '.tiff'])
const MAX_BYTES = 100 * 1024 * 1024
const KEEP = 5

/* A scan's fingerprint: the same bytes, whatever the file is called. */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')))
  })
}

/* "Scan_2026-09-29_101403.pdf" → "Scan 2026-09-29 101403". */
const nameOf = (file) => path.basename(file, path.extname(file)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 72) || 'Scan'

function createScans({ dataDir, folder, take, addText, propose, read, fs = nodeFs, hash = hashFile, now = () => Date.now(), makeId = randomUUID, onStatus = () => {} }) {
  const store = path.join(dataDir, 'scans')
  const seenFile = path.join(store, 'seen.json')
  let seen = null // fingerprint → { file, at, scan?, before? }
  let status = { arrived: [], waiting: 0, error: '', naming: '' }
  let naming = Promise.resolve()

  const setStatus = (patch) => {
    status = { ...status, ...patch }
    onStatus(status)
  }
  const stamp = () => new Date(now()).toISOString()

  async function load() {
    if (seen) return seen
    try {
      seen = JSON.parse(await fs.readFile(seenFile, 'utf8'))
      if (!seen || typeof seen !== 'object' || Array.isArray(seen)) seen = {}
    } catch {
      seen = {}
    }
    setStatus({ waiting: Object.values(seen).filter((item) => item.before).length })
    return seen
  }

  async function save() {
    await fs.mkdir(store, { recursive: true })
    const temp = `${seenFile}.${process.pid}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(seen)}\n`)
    await fs.rename(temp, seenFile)
  }

  const listed = async (dir) => (await settledFiles(dir, { fs, now, maxBytes: MAX_BYTES, accept: (name) => TYPES.has(path.extname(name).toLowerCase()) })).filter((item) => !item.tooBig)

  /* A folder was just picked: what is in it now is noted as already there, not brought in. */
  async function baseline(dir) {
    await load()
    let count = 0
    for (const { name, file } of await listed(dir)) {
      try {
        const print = await hash(file)
        if (seen[print]) continue
        seen[print] = { file: name, at: stamp(), before: true }
        count += 1
      } catch {
        // Not downloaded yet: it will count as new when it arrives.
      }
    }
    await save()
    setStatus({ waiting: Object.values(seen).filter((item) => item.before).length, error: '' })
    return count
  }

  /* One scan in: a copy kept by OSAT, a packed New node, then its words and a proposed name. */
  async function bring(file, name, print) {
    const scan = `scan-${makeId()}${path.extname(name).toLowerCase()}`
    await fs.mkdir(store, { recursive: true })
    await fs.copyFile(file, path.join(store, scan))
    const result = take({ title: nameOf(name), summary: '', source: 'Scan', leaves: [], branches: [] }, { name, hash: print, source: 'Scan', scan })
    seen[print] = { file: name, at: stamp(), scan }
    await save()
    if (result.duplicate) return null
    setStatus({ arrived: [{ name, node: result.folder.name, at: stamp() }, ...status.arrived].slice(0, KEEP) })
    // Reading and naming take their time: one scan after another, never holding up the next look.
    naming = naming.then(() => understand(result.folder.id, path.join(store, scan), name)).catch(() => {})
    return result.folder
  }

  async function understand(folderId, copy, name) {
    let text = ''
    try {
      text = await read(copy)
    } catch {
      text = ''
    }
    if (text) addText(folderId, text)
    if (!text) {
      setStatus({ naming: `OSAT couldn’t read words on “${name}”. Name it yourself in the Sky.` })
      return
    }
    try {
      setStatus({ naming: `Naming “${name}”…` })
      await propose(folderId, text, name)
      setStatus({ naming: '' })
    } catch (error) {
      setStatus({ naming: `“${name}” is in the Sky, but it wasn’t named: ${error.message}` })
    }
  }

  /* Each new, settled scan in the folder. */
  async function look() {
    const dir = folder()
    if (!dir) return 0
    await load()
    let files
    try {
      files = await listed(dir)
    } catch (error) {
      setStatus({ error: error.code === 'ENOENT'
        ? 'The scan folder isn’t there any more. Pick it again below.'
        : error.code === 'EPERM' || error.code === 'EACCES'
          ? 'OSAT isn’t allowed into that folder yet. Allow it in System Settings → Privacy & Security → Files and Folders.'
          : `OSAT couldn’t look in the scan folder (${error.code || error.message}).` })
      return 0
    }
    if (status.error) setStatus({ error: '' })
    let count = 0
    for (const { name, file } of files) {
      try {
        const print = await hash(file)
        if (seen[print]) continue
        if (await bring(file, name, print)) count += 1
      } catch {
        // Still downloading from Drive, or busy: the next look tries again.
      }
    }
    return count
  }

  /* The scans that were already there when the folder was picked, brought in now. */
  async function bringWaiting() {
    const dir = folder()
    if (!dir) return 0
    await load()
    let count = 0
    for (const { name, file } of await listed(dir)) {
      try {
        const print = await hash(file)
        if (!seen[print]?.before) continue
        if (await bring(file, name, print)) count += 1
      } catch {
        // The next try picks it up.
      }
    }
    setStatus({ waiting: Object.values(seen).filter((item) => item.before).length })
    return count
  }

  return {
    look: oneAtATime(look),
    baseline,
    bringWaiting,
    status: () => status,
    copyPath: (scan) => (/^scan-[A-Za-z0-9_-]{1,80}\.[a-z0-9]{2,5}$/.test(scan) ? path.join(store, scan) : null),
    settled: () => naming,
  }
}

module.exports = { createScans, hashFile, nameOf, SCAN_TYPES: TYPES }
