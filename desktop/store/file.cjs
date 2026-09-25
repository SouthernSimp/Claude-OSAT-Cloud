/* Reading and writing the workspace file without ever leaving it half-written.
   - workspace.json is replaced atomically: write a temp file, flush it to disk, rename.
   - The first save of each day first copies yesterday's file into snapshots/ (14 kept).
   - A file that can't be read is set aside, never deleted, and the newest snapshot is used. */
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const nodeFs = require('node:fs/promises')
const fsSync = require('node:fs')

const FILE = 'workspace.json'
const SNAPSHOTS = 'snapshots'
const KEEP = 14

const dayKey = (date) => date.toISOString().slice(0, 10)

function createFileStore({ dir, fs = nodeFs, now = () => new Date(), keep = KEEP }) {
  const file = path.join(dir, FILE)
  const snapshotDir = path.join(dir, SNAPSHOTS)
  // The newest revision on disk. A slower, older write never replaces a newer one.
  let newest = -Infinity
  const isStale = (doc) => Number.isInteger(doc?.rev) && doc.rev < newest
  const markWritten = (doc) => { if (Number.isInteger(doc?.rev)) newest = Math.max(newest, doc.rev) }

  async function readJson(target) {
    const parsed = JSON.parse(await fs.readFile(target, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('NOT_A_WORKSPACE')
    return parsed
  }

  async function snapshots() {
    try {
      return (await fs.readdir(snapshotDir)).filter((name) => /^workspace-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  /* Returns { doc, recovered } — doc is null when there is nothing yet. */
  async function read() {
    try {
      return { doc: await readJson(file), recovered: null }
    } catch (error) {
      if (error.code === 'ENOENT') return { doc: null, recovered: null }
      const aside = path.join(dir, `workspace.unreadable-${now().toISOString().replace(/[:.]/g, '-')}.json`)
      await fs.rename(file, aside).catch(() => {})
      for (const name of (await snapshots()).reverse()) {
        try {
          return { doc: await readJson(path.join(snapshotDir, name)), recovered: { from: name, setAside: aside } }
        } catch {
          // try the next older snapshot
        }
      }
      return { doc: null, recovered: { from: null, setAside: aside } }
    }
  }

  async function snapshotIfNewDay() {
    const name = `workspace-${dayKey(now())}.json`
    const existing = await snapshots()
    if (existing.includes(name)) return
    try {
      await fs.access(file)
    } catch {
      return // nothing saved yet
    }
    await fs.mkdir(snapshotDir, { recursive: true })
    await fs.copyFile(file, path.join(snapshotDir, name))
    const all = await snapshots()
    for (const old of all.slice(0, Math.max(0, all.length - keep))) await fs.rm(path.join(snapshotDir, old), { force: true })
  }

  async function write(doc) {
    await fs.mkdir(dir, { recursive: true })
    await snapshotIfNewDay()
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(doc)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (isStale(doc)) return
      await fs.rename(temporary, file)
      markWritten(doc)
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  /* The last save as the app quits, when there is no time to wait. */
  function writeSync(doc) {
    if (isStale(doc)) return
    fsSync.mkdirSync(dir, { recursive: true })
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    try {
      const handle = fsSync.openSync(temporary, 'wx', 0o600)
      try {
        fsSync.writeFileSync(handle, `${JSON.stringify(doc)}\n`, 'utf8')
        fsSync.fsyncSync(handle)
      } finally {
        fsSync.closeSync(handle)
      }
      fsSync.renameSync(temporary, file)
      markWritten(doc)
    } finally {
      fsSync.rmSync(temporary, { force: true })
    }
  }

  return { file, snapshotDir, read, write, writeSync, snapshots }
}

module.exports = { createFileStore, FILE, SNAPSHOTS }
