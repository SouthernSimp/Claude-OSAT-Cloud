/* Tidy my Desktop (Phase 21b), the main process's half. The built-in AI reads the names on the
   Desktop (and the first words of a few PDFs and documents), in batches, and answers in a fixed
   shape (a JSON-schema grammar, like scans do); the answer is cleaned in shared/tidy-model.mjs.
   Without the AI it sorts by kind of file. Planning moves nothing: only `files:tidy-do`, called
   after Nate ticked the groups he wants, changes anything, and the whole tidy is ONE undo token
   (files.cjs's `keepUndo`), so `files:undo` puts every file back and removes the folders it made.
   Everything goes through files.cjs's checks: Desktop and Documents only, never hidden, never a
   link, a taken name numbered, nothing overwritten, the Bin for "delete". Files.cjs passes in
   what it owns. */
const fs = require('node:fs/promises')
const path = require('node:path')
const { isPackage, restoreItem } = require('./mac-files.cjs')
const { moveInto, toBin } = require('./file-ops.cjs')

const PEEKS = 8 // PDFs and documents whose first words the AI may read, per tidy

async function registerTidy({ handle, fail, getGrant, approvedPath, approvedWritePath, folderPath, sourcePath, binTrash, keepUndo, dataDir, ai, extractText, sharedModule, now = () => new Date() }) {
  const model = await sharedModule('tidy-model.mjs')
  const prefsFile = path.join(dataDir, 'tidy.json')

  async function readPrefs() {
    try {
      const raw = JSON.parse(await fs.readFile(prefsFile, 'utf8'))
      return { archive: raw.archive === true, later: typeof raw.later === 'string' ? raw.later : '' }
    } catch {
      return { archive: false, later: '' }
    }
  }
  const writePrefs = async (prefs) => { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(prefsFile, `${JSON.stringify(prefs)}\n`) }

  /* Loose things on the Desktop: files and what Finder shows as one file. Folders, hidden things
     and links are left alone. */
  async function desktopFiles() {
    const dir = await approvedPath(getGrant('desktop'), '')
    const found = []
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.isSymbolicLink()) continue
      const stat = await fs.lstat(path.join(dir, item.name)).catch(() => null)
      const packaged = item.isDirectory() && isPackage(item.name)
      if (!stat || (stat.isDirectory() && !packaged) || (!stat.isFile() && !packaged)) continue
      // ponytail: the later of "changed" and "made" stands in for Finder's Date Added; a touched file just looks newer.
      found.push({ name: item.name, kind: model.kindOf(item.name, { isPackage: packaged }), size: stat.size, modifiedAt: new Date(Math.max(stat.mtimeMs, stat.ctimeMs)).toISOString() })
    }
    return found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }

  async function documentsFolders() {
    try {
      const dir = await approvedPath(getGrant('documents'), '')
      return (await fs.readdir(dir, { withFileTypes: true })).filter((item) => item.isDirectory() && !item.name.startsWith('.') && !isPackage(item.name)).map((item) => item.name).sort()
    } catch {
      return [] // Documents not opened yet: the usual folders are still offered.
    }
  }

  /* ---- the plan (moves nothing) ---- */
  handle('files:tidy-plan', async () => {
    const desktop = await approvedPath(getGrant('desktop'), '')
    const files = await desktopFiles()
    const menu = model.menuFolders(await documentsFolders())
    const dests = files.map((file) => model.ruleDest(file.kind))
    let how = 'rules'
    if (ai?.()?.models().length && files.length) {
      let asked = 0
      const candidates = files.map((file, index) => index).filter((index) => files[index].kind !== 'app').slice(0, model.MAX_AI)
      let peeks = 0
      for (let start = 0; start < candidates.length; start += model.BATCH) {
        const batch = candidates.slice(start, start + model.BATCH).map((index) => ({ index, file: { ...files[index] } }))
        for (const { file } of batch) {
          if (peeks < PEEKS && (file.kind === 'pdf' || file.kind === 'document')) {
            peeks += 1
            try { file.peek = (await extractText(path.join(desktop, file.name))).text.slice(0, 300) } catch { /* names alone will do */ }
          }
        }
        try {
          const answer = JSON.parse(await ai().chatStream({ messages: model.tidyMessages({ files: batch.map((item) => item.file), menu }), schema: model.tidySchema(menu) }, () => {}))
          model.readTidyAnswer(answer, batch.map((item) => item.file), menu).forEach((dest, i) => { dests[batch[i].index] = dest })
          asked += 1
        } catch {
          // This batch keeps the rules' answer.
        }
      }
      if (asked) how = 'ai'
    }
    const { groups, left } = model.groupPlan(files, dests)
    return { how, groups, left, menu }
  }, { from: 'app' })

  /* ---- do it: the groups Nate ticked, as one undo ---- */
  async function makeFolders(rel, made) {
    const grant = getGrant('documents')
    let at = ''
    for (const part of rel.split('/')) {
      at = at ? `${at}/${part}` : part
      const target = await approvedWritePath(grant, at)
      if (!(await fs.lstat(target).catch(() => null))) { await fs.mkdir(target); made.push(target) }
    }
    return folderPath(grant, rel)
  }

  const removeEmpty = async (made) => { for (const dir of [...made].reverse()) await fs.rmdir(dir).catch(() => {}) }

  async function tidy(groups) {
    if (!Array.isArray(groups) || !groups.length || groups.length > 60) fail('Tick something to tidy.')
    const undos = []
    const made = []
    let moved = 0
    let binned = 0
    let failed = null
    for (const group of groups) {
      if (failed) break
      try {
        const names = (Array.isArray(group?.names) ? group.names : []).filter((name) => typeof name === 'string' && name && !name.includes('/') && !name.startsWith('.'))
        const sources = []
        for (const name of names.slice(0, 500)) sources.push(await sourcePath(getGrant('desktop'), name).catch(() => null))
        const present = sources.filter(Boolean) // gone since the plan was made: left out, calmly
        if (!present.length) continue
        if (group.to === 'bin') {
          const done = await toBin(present, binTrash, process.platform === 'darwin' ? restoreItem : undefined)
          binned += done.done.length
          failed = done.failed
          if (done.undo) undos.push(done.undo)
        } else if (group.to === 'folder') {
          const rel = model.cleanFolder(group.folder)
          if (!rel) fail('That folder name can’t be used.')
          const done = await moveInto(present, await makeFolders(rel, made), { trash: binTrash })
          moved += done.done.length
          failed = done.failed
          if (done.undo) undos.push(done.undo)
        }
      } catch (error) {
        // Whatever moved before this stays moved, and stays undoable.
        failed = error?.code === 'EPERM' || error?.code === 'EACCES' ? 'OSAT isn’t allowed to change that folder yet.' : error?.message && !error.code ? error.message : 'Something on your Mac wouldn’t let OSAT finish.'
      }
    }
    const undo = undos.length || made.length ? async () => {
      let problem = null
      for (const back of [...undos].reverse()) problem ||= (await back())?.failed || null
      await removeEmpty(made)
      return { failed: problem }
    } : null
    return { moved, binned, failed, undo: undo && keepUndo(undo) }
  }
  handle('files:tidy-do', tidy, { from: 'app' })

  /* ---- a simple set of folders to grow into ---- */
  handle('files:tidy-layout', async () => {
    const have = new Set((await documentsFolders()).map((name) => name.toLowerCase()))
    const made = []
    const create = []
    for (const name of model.LAYOUT.filter((item) => !have.has(item.toLowerCase()))) await makeFolders(name, create).then(() => made.push(name))
    return { made, undo: create.length ? keepUndo(async () => { await removeEmpty(create); return { failed: null } }) : null }
  }, { from: 'app' })

  /* ---- keeps itself tidy: an offer, only when Nate has switched it on ---- */
  async function offer() {
    const prefs = await readPrefs()
    if (!prefs.archive) return { on: false, offer: null }
    const today = now()
    if (prefs.later === model.monthKey(today)) return { on: true, offer: null }
    const names = model.oldFiles(await desktopFiles(), today)
    return { on: true, offer: names.length ? { folder: model.archiveFolder(today), names } : null }
  }
  handle('files:tidy-offer', offer, { from: 'app' })
  handle('files:tidy-set', async (on) => { await writePrefs({ ...(await readPrefs()), archive: on === true }); return offer() }, { from: 'app' })
  handle('files:tidy-later', async () => { await writePrefs({ ...(await readPrefs()), later: model.monthKey(now()) }); return offer() }, { from: 'app' })

  return { tidy, offer }
}

module.exports = { registerTidy }
