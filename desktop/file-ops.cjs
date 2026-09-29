/* Tidying files: a new folder, rename, move, copy and the Bin. These work on absolute paths
   main has already checked against an approved folder. Nothing is ever erased: "delete" is
   the Bin, and every change hands back `undo`, a function that puts it all back. */
const fs = require('node:fs/promises')
const path = require('node:path')
const { contains } = require('./path-guard.cjs')

class TidyError extends Error {}
const fail = (message) => { throw new TidyError(message) }

/* A name someone typed. Hidden names are refused: OSAT never shows hidden files. */
function cleanName(name) {
  const clean = typeof name === 'string' ? name.trim() : ''
  if (!clean || Buffer.byteLength(clean) > 255 || /[/:\\\0]/.test(clean) || clean === '.' || clean === '..') fail('A name can’t be empty or hold “/” or “:”.')
  if (clean.startsWith('.')) fail('A name starting with a dot would hide it, and OSAT never shows hidden files.')
  return clean
}

/* Paths a drop from Finder handed over (the preload read them off real files): each absolute and
   not a disk, your home folder, one of `keep` (the places and folders OSAT was given) or hidden. */
function cleanDropped(paths, { home, keep = [] }) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 500) fail('Drop something from Finder to put it here.')
  return [...new Set(paths.map((file) => {
    const clean = typeof file === 'string' && path.isAbsolute(file) ? path.resolve(file) : ''
    if (!clean) fail('Drop something from Finder to put it here.')
    if (path.dirname(clean) === clean || clean === home || keep.includes(clean)) fail('That is one of your main folders. OSAT won’t move it.')
    if (path.basename(clean).startsWith('.')) fail('OSAT never shows hidden files, so it won’t move one.')
    return clean
  }))]
}

const exists = (file) => fs.lstat(file).then(() => true, () => false)

/* "Notes.txt" taken → "Notes 2.txt", the way Finder numbers. */
async function freeName(dir, name, folder) {
  const ext = folder ? '' : path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? name : `${base} ${n}${ext}`
    if (!(await exists(path.join(dir, candidate)))) return candidate
  }
}

/* Is something else already at `to`? (The same file under another spelling, "a" → "A", isn't.) */
async function taken(from, to) {
  const there = await fs.lstat(to).catch(() => null)
  if (!there) return false
  const here = await fs.lstat(from)
  return there.ino !== here.ino || there.dev !== here.dev
}

/* Move to exactly `to`, never over something. Across disks it copies first and only then removes. */
async function put(from, to) {
  if (await taken(from, to)) fail('Something with that name is already there.')
  try {
    await fs.rename(from, to)
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
    await fs.rm(from, { recursive: true })
  }
}

/* One plain line for whatever went wrong with `name`. */
function plain(error, name) {
  if (error instanceof TidyError) return error.message
  if (error.code === 'ENOENT') return `“${name}” is no longer there.`
  return `“${name}” couldn’t be changed. Something on your Mac wouldn’t let OSAT.`
}

/* Undo for a list of moves: each back where it came from; what can't go back is said. A file in
   the Bin may be unreadable to OSAT, so `restore(inBin, original)` (Finder's hands) is the second try. */
function putBack(moves, restore) {
  return async () => {
    const failed = []
    for (const { from, to } of [...moves].reverse()) {
      try {
        await put(to, from).catch((error) => {
          if (!restore || (error.code !== 'EPERM' && error.code !== 'EACCES')) throw error
          return restore(to, from)
        })
      } catch (error) {
        failed.push(`“${path.basename(to)}” can’t go back: ${error instanceof TidyError ? error.message : 'it is still in the Bin (Put Back is in its right-click menu).'}`)
      }
    }
    return { failed: failed[0] || null }
  }
}

async function makeFolder(parent) {
  const name = await freeName(parent, 'untitled folder', true)
  await fs.mkdir(path.join(parent, name))
  return name
}

async function rename(from, name) {
  const to = path.join(path.dirname(from), cleanName(name))
  if (to === from) return { to }
  await put(from, to)
  return { to, undo: putBack([{ from, to }]) }
}

/* Sources go into folder `dir` (a copy with `copy`); a taken name is numbered. Stops at the
   first thing that can't go, having done the ones before it. */
async function moveInto(sources, dir, { copy = false, trash } = {}) {
  const done = []
  let failed = null
  for (const from of sources) {
    try {
      const stat = await fs.lstat(from)
      if (stat.isDirectory() && contains(from, dir)) fail('A folder can’t go inside itself.')
      if (!copy && path.dirname(from) === dir) continue
      const to = path.join(dir, await freeName(dir, path.basename(from), stat.isDirectory()))
      if (copy) await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
      else await put(from, to)
      done.push({ from, to })
    } catch (error) {
      failed = plain(error, path.basename(from))
      break
    }
  }
  const undo = !done.length ? undefined
    : copy ? async () => { for (const { to } of done) await trash(to); return { failed: null } }
      : putBack(done)
  return { done, failed, undo }
}

/* `trash(file)` puts it in the Bin and says where it landed, so Undo can fetch it. */
async function toBin(sources, trash, restore) {
  const done = []
  let failed = null
  for (const from of sources) {
    try {
      done.push({ from, to: await trash(from) })
    } catch (error) {
      failed = plain(error, path.basename(from))
      break
    }
  }
  return { done, failed, undo: done.length ? putBack(done, restore) : undefined }
}

module.exports = { TidyError, cleanDropped, cleanName, freeName, makeFolder, moveInto, put, rename, toBin }
