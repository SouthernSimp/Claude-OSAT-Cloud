/* Files (Phases 20–21): everything main does with the Mac's files, in one place, so main.cjs
   only calls createFiles. It owns the places (Desktop, Documents, Downloads) and the folders
   Nate added (grants, kept in approved-files.json), the checks that a path stays inside one,
   thumbnails, the text Ask reads from a file, the undo tokens for tidying, and every files:*
   handler. Main passes in what it owns (the window, IPC's `handle` and `fail`, Electron's
   pieces) so the trusted-sender checks are written once, there. */
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { PLACES, extractText, inside, isPackage, rankFound, restoreItem, run, searchArgs, trashItem, walkFind } = require('./mac-files.cjs')
const { cleanDropped, cleanName, freeName, makeFolder, moveInto, put, rename, toBin } = require('./file-ops.cjs')
const { registerTidy } = require('./tidy.cjs')
const { recentPaths } = require('./launcher/recent-files.cjs')
const { resolveApprovedPath, resolveApprovedWritePath } = require('./path-guard.cjs')
const { isSafeOpenFilename, isSafeTextPreviewName, readTextFile, writeTextFile } = require('./text-files.cjs')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WRITABLE_EXTENSIONS = new Set(['.canvas', '.markdown', '.md'])

const NOT_ALLOWED = 'OSAT isn’t allowed into that folder yet. Allow it in System Settings → Privacy & Security → Files and Folders.'

function publicGrant(grant) {
  return {
    id: grant.id,
    kind: grant.kind,
    name: grant.name || path.basename(grant.root) || (grant.kind === 'folder' ? 'Folder' : 'File'),
    ...(grant.place ? { place: true } : {}),
  }
}

async function createFiles({ app, BrowserWindow, dialog, nativeImage, shell, mainWindow, dataDir, handle, fail, sharedModule, ai }) {
  const grantsFile = path.join(app.getPath('userData'), 'approved-files.json')
  let grants = []
  let mutation = Promise.resolve()
  const grantAccessStops = new Map()

  /* Desktop, Documents and Downloads are always there to look in; macOS asks once
     before OSAT opens each. Tests (from source) keep them in a stand-in folder. */
  function places() {
    const stand = !app.isPackaged && process.env.OSAT_PLACES_DIR
    return PLACES.map((place) => ({ ...place, kind: 'folder', place: true, root: stand ? path.join(stand, place.name) : app.getPath(place.id) }))
  }

  function getGrant(id) {
    const place = places().find((item) => item.id === id)
    if (place) return place
    if (typeof id !== 'string' || !UUID.test(id)) fail('Invalid file access grant.')
    const grant = grants.find((item) => item.id === id)
    if (!grant) fail('That file access grant is no longer available.')
    return grant
  }

  function stopGrantAccess(id) {
    const stop = grantAccessStops.get(id)
    if (!stop) return
    grantAccessStops.delete(id)
    try {
      stop()
    } catch {
      // The operating system already revoked this session's access.
    }
  }

  function ensureGrantAccess(grant) {
    if (process.platform !== 'darwin' || !process.mas || grantAccessStops.has(grant.id)) return
    if (!grant.bookmark) fail('Choose this location again to restore access.')
    try {
      grantAccessStops.set(grant.id, app.startAccessingSecurityScopedResource(grant.bookmark))
    } catch {
      fail('Choose this location again to restore access.')
    }
  }

  async function approvedPath(grant, relative = '') {
    if (grant.kind === 'file' && relative !== '') fail('A selected file has no child items.')
    // Hidden files and folders stay hidden, as in Finder.
    if (grant.place && String(relative).split('/').some((part) => part.startsWith('.'))) fail('Invalid relative file path.')
    ensureGrantAccess(grant)
    try {
      return await resolveApprovedPath(grant.place ? await fs.realpath(grant.root) : grant.root, relative)
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') fail(NOT_ALLOWED)
      if (error.message === 'INVALID_RELATIVE_PATH' || error.message === 'PATH_OUTSIDE_ROOT') {
        fail('Invalid relative file path.')
      }
      if (error.code === 'ENOENT') fail('That file or folder is no longer available.')
      fail('That approved location can no longer be accessed safely.')
    }
  }

  async function approvedWritePath(grant, relative) {
    if (grant.kind !== 'folder') fail('Writing requires an approved folder.')
    ensureGrantAccess(grant)
    try {
      return await resolveApprovedWritePath(grant.place ? await fs.realpath(grant.root) : grant.root, relative)
    } catch (error) {
      if (error.message === 'INVALID_RELATIVE_PATH' || error.message === 'PATH_OUTSIDE_ROOT') {
        fail('Invalid relative file path.')
      }
      if (error.code === 'ENOENT') fail('The destination folder is no longer available.')
      fail('That approved location can no longer be accessed safely.')
    }
  }

  /* Tidying: a place to change (never a root itself, never hidden, never a link, which would
     change what it points at) and a folder to put things in. */
  async function sourcePath(grant, relative) {
    if (typeof relative !== 'string' || relative.split('/').some((part) => part.startsWith('.'))) fail('Invalid relative file path.')
    const target = await approvedWritePath(grant, relative)
    if (grants.some((item) => item.root === target)) fail('That folder is one you added to OSAT. Take it out of the list first.')
    if (!(await fs.lstat(target).catch(() => null))) fail('That file or folder is no longer available.')
    return target
  }

  async function sourcePaths(items) {
    if (!Array.isArray(items) || !items.length || items.length > 500) fail('Choose something to change.')
    const found = []
    for (const item of items) found.push(await sourcePath(getGrant(item?.rootId), item?.relative))
    return found
  }

  async function folderPath(grant, relative) {
    const dir = await approvedPath(grant, relative)
    if (!(await fs.stat(dir)).isDirectory() || isPackage(path.basename(dir))) fail('That is not a folder OSAT can put things in.')
    return dir
  }

  /* What can be undone for a few minutes: functions kept here, so the window only holds a token. */
  const undos = new Map()
  function keepUndo(undo) {
    if (!undo) return null
    const token = randomUUID()
    undos.set(token, undo)
    if (undos.size > 20) undos.delete(undos.keys().next().value)
    return token
  }

  /* The Bin. Off the Mac (tests, Linux) it is a folder in the data folder, so Undo still works. */
  async function binTrash(file) {
    if (process.platform === 'darwin') return trashItem(file)
    const bin = path.join(dataDir, 'Bin')
    await fs.mkdir(bin, { recursive: true })
    const to = path.join(bin, await freeName(bin, path.basename(file), (await fs.lstat(file)).isDirectory()))
    await put(file, to)
    return to
  }

  async function loadGrants() {
    try {
      const parsed = JSON.parse(await fs.readFile(grantsFile, 'utf8'))
      const seen = new Set()
      grants = Array.isArray(parsed.grants) ? parsed.grants.filter((grant) => {
        const valid = grant && typeof grant.id === 'string' && UUID.test(grant.id) && !seen.has(grant.id) &&
          (grant.kind === 'folder' || grant.kind === 'file') &&
          typeof grant.root === 'string' && path.isAbsolute(grant.root)
        if (valid) seen.add(grant.id)
        return valid
      }).map(({ id, kind, root, bookmark }) => ({
        id,
        kind,
        root,
        ...(typeof bookmark === 'string' && bookmark ? { bookmark } : {}),
      })) : []
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Unable to read approved file grants:', error)
      grants = []
    }
  }

  async function saveGrants(next) {
    await fs.mkdir(path.dirname(grantsFile), { recursive: true })
    const temporary = `${grantsFile}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, `${JSON.stringify({ version: 2, grants: next }, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await fs.rename(temporary, grantsFile)
      grants = next
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  function mutateGrants(change) {
    const result = mutation.then(async () => saveGrants(await change(grants)))
    mutation = result.catch(() => {})
    return result
  }

  async function readForAsk(file) {
    try {
      return await extractText(file)
    } catch (error) {
      if (error.message === 'UNREADABLE') fail('Ask can read text, Markdown, PDFs and Word files.')
      if (error.message === 'EMPTY') fail('That file has no text to read. A scanned PDF is only pictures of pages.')
      if (error.message === 'FILE_TOO_LARGE') fail('That file is too large to read.')
      if (error.message === 'INVALID_UTF8') fail('That file isn’t plain text.')
      if (error.code === 'ENOENT') fail('That file is no longer there.')
      if (error.killed) fail('Reading that file took too long.')
      throw error
    }
  }

  /* Thumbnails come from Quick Look (a page, a picture, or the file's own icon) and
     are kept while the file stays the same. Elsewhere there is only the plain icon. */
  const thumbs = new Map()
  async function thumbnail(file, size = 128) {
    const px = Math.min(Math.max(Math.round(Number(size) || 128), 32), 1024)
    const stat = await fs.stat(file)
    const key = `${file}\0${stat.mtimeMs}\0${px}`
    if (!thumbs.has(key)) {
      if (thumbs.size > 600) thumbs.delete(thumbs.keys().next().value)
      thumbs.set(key, process.platform === 'darwin' || process.platform === 'win32'
        ? nativeImage.createThumbnailFromPath(file, { width: px, height: px }).then((image) => image.toDataURL(), () => null)
        : Promise.resolve(null))
    }
    return thumbs.get(key)
  }

  await loadGrants()

  handle('files:roots', async () => {
    await mutation
    return [...places(), ...grants].map(publicGrant)
  }, { from: 'app' })

  handle('files:choose', async (kind) => {
    if (!['folder', 'file', 'files'].includes(kind)) fail('Choose either a folder or files.')
    const chooseFolder = kind === 'folder'
    const result = await dialog.showOpenDialog(mainWindow(), {
      title: chooseFolder ? 'Choose a folder for OSAT' : 'Choose files for OSAT',
      properties: chooseFolder ? ['openDirectory'] : ['openFile', 'multiSelections'],
      securityScopedBookmarks: process.platform === 'darwin' && process.mas,
    })
    if (result.canceled) return null

    const selected = []
    await mutateGrants(async (current) => {
      const next = [...current]
      for (const [index, selectedPath] of result.filePaths.entries()) {
        const root = await fs.realpath(selectedPath)
        const stat = await fs.stat(root)
        const actualKind = stat.isDirectory() ? 'folder' : stat.isFile() ? 'file' : null
        if (!actualKind || actualKind !== (chooseFolder ? 'folder' : 'file')) continue
        const bookmark = result.bookmarks?.[index]
        const currentIndex = next.findIndex((item) => item.root === root && item.kind === actualKind)
        let grant = currentIndex >= 0 ? next[currentIndex] : null
        if (grant) {
          if (typeof bookmark === 'string' && bookmark) {
            stopGrantAccess(grant.id)
            grant = { ...grant, bookmark }
            next[currentIndex] = grant
          }
        } else {
          grant = {
            id: randomUUID(),
            kind: actualKind,
            root,
            ...(typeof bookmark === 'string' && bookmark ? { bookmark } : {}),
          }
          next.push(grant)
        }
        selected.push(publicGrant(grant))
      }
      return next
    })
    const selectedIds = new Set(selected.map((grant) => grant.id))
    return [...grants.filter((grant) => !selectedIds.has(grant.id)).map(publicGrant), ...selected]
  })

  handle('files:list', async (rootId, relative = '') => {
    const grant = getGrant(rootId)
    if (grant.kind !== 'folder') fail('Only folders can be browsed.')
    const directory = await approvedPath(grant, relative)
    if (!(await fs.stat(directory)).isDirectory()) fail('That item is not a folder.')

    const entries = []
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue
      const itemRelative = relative ? `${relative}/${item.name}` : item.name
      try {
        const resolved = await approvedPath(grant, itemRelative)
        const stat = await fs.stat(resolved)
        // An app or a Pages document is a folder underneath; Finder shows it as one file.
        const kind = stat.isDirectory() ? (isPackage(item.name) ? 'file' : 'folder') : stat.isFile() ? 'file' : null
        if (!kind) continue
        entries.push({
          kind,
          name: item.name,
          relative: itemRelative,
          size: stat.isFile() ? stat.size : undefined,
          modifiedAt: stat.mtime.toISOString(),
        })
      } catch {
        // Broken links and links escaping the approved root stay invisible.
      }
    }
    return entries.sort((a, b) => Number(a.kind === 'file') - Number(b.kind === 'file') || a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, { from: 'app' })

  handle('files:read-text', async (rootId, relative = '') => {
    const grant = getGrant(rootId)
    const file = await approvedPath(grant, relative)
    const filename = path.basename(file)
    if (!isSafeTextPreviewName(filename)) {
      fail('Preview is available only for safe text file types.')
    }

    try {
      return { name: filename, relative, ...await readTextFile(file) }
    } catch (error) {
      if (error.message === 'NOT_A_FILE') fail('That item is not a file.')
      if (error.message === 'FILE_TOO_LARGE') fail('Text previews are limited to 2 MB.')
      if (error.message === 'INVALID_UTF8') fail('That file is not valid UTF-8 text.')
      if (error.message === 'FILE_CHANGED_DURING_READ') fail('That file changed while it was being read. Try again.')
      throw error
    }
  })

  handle('files:write-text', async (rootId, relative, content, expectedHash) => {
    if (typeof relative !== 'string' || !WRITABLE_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      fail('Only Markdown and Canvas files can be written.')
    }
    const target = await approvedWritePath(getGrant(rootId), relative)
    try {
      return { name: path.basename(target), relative, ...await writeTextFile(target, content, expectedHash) }
    } catch (error) {
      if (error.message === 'WRITE_CONFLICT') fail('This file changed after review. Read it again before saving.')
      if (error.message === 'INVALID_CONTENT' || error.message === 'INVALID_EXPECTED_HASH') {
        fail('Invalid reviewed file update.')
      }
      if (error.message === 'FILE_TOO_LARGE') fail('Reviewed file writes are limited to 5 MB.')
      if (error.message === 'INVALID_UTF8') fail('The current file is not valid UTF-8 text.')
      if (error.message === 'FILE_CHANGED_DURING_READ') fail('That file changed after review. Read it again before saving.')
      if (error.message === 'SYMLINK_WRITE_DENIED') fail('Symbolic links cannot be written.')
      throw error
    }
  })

  // Documents, pictures and media open in their app. Folders, apps, scripts and
  // installers are shown in Finder instead, so nothing runs from inside OSAT.
  async function openIt(rootId, relative = '') {
    const target = await approvedPath(getGrant(rootId), relative)
    if (!isSafeOpenFilename(path.basename(target))) {
      shell.showItemInFolder(target)
      return 'shown'
    }
    if (await shell.openPath(target)) fail('The system could not open that item.')
    return 'opened'
  }
  handle('files:open', openIt, { from: 'app' })

  async function revealIt(rootId, relative = '') {
    shell.showItemInFolder(await approvedPath(getGrant(rootId), relative))
    return true
  }
  handle('files:reveal', revealIt, { from: 'app' })

  // What Finder would show for it: a picture of the page, or the file's own icon.
  handle('files:thumb', async (rootId, relative = '', size = 128) => thumbnail(await approvedPath(getGrant(rootId), relative), size), { from: 'app' })

  // The Mac's own Quick Look, over whichever OSAT window asked.
  handle('files:quick-look', async (rootId, relative = '') => {
    const target = await approvedPath(getGrant(rootId), relative)
    const window = BrowserWindow.getFocusedWindow() || mainWindow()
    if (process.platform !== 'darwin' || !window) return false
    window.previewFile(target)
    return true
  }, { from: 'app' })

  // Find a file in plain words ("pdf taxes last week"): the words in its name or inside it, a
  // kind, a time. Spotlight, only in Desktop, Documents, Downloads and folders Nate added;
  // where there is none (tests, Linux) OSAT walks those folders itself.
  // Tests from source (OSAT_NO_SPOTLIGHT) walk their stand-in folders even on a Mac: Spotlight doesn't index them.
  const spotlight = () => process.platform === 'darwin' && !(!app.isPackaged && process.env.OSAT_NO_SPOTLIGHT)
  const lookIn = async () => Promise.all([...places(), ...grants.filter((grant) => grant.kind === 'folder')]
    .map(async (grant) => ({ id: grant.id, root: await fs.realpath(grant.root).catch(() => grant.root) })))

  async function findFiles(query, { limit = 12 } = {}) {
    const words = typeof query === 'string' ? query.trim() : ''
    if (words.length < 2 || words.length > 100) return []
    const { parseFileQuery, spotlightQuery, matchesFile, matchedBy } = await sharedModule('file-query.mjs')
    const asked = parseFileQuery(words)
    const clause = spotlightQuery(asked)
    if (!clause) return []
    const roots = await lookIn()
    const paths = spotlight()
      ? (await run('mdfind', searchArgs(clause, roots.map((item) => item.root)), { timeout: 4000 }).catch(() => '')).split('\n').filter(Boolean).slice(0, 400)
      : await walkFind(roots, (item) => matchesFile(asked, item))
    const filtered = asked.kinds.length > 0 || asked.since !== null
    const candidates = rankFound(inside([...new Set(paths)], roots), asked.words).slice(0, filtered ? 200 : 40)
    const found = (await Promise.all(candidates.map(async (item) => {
      const stat = await fs.stat(path.join(roots.find((root) => root.id === item.rootId).root, item.relative)).catch(() => null)
      if (!stat) return null
      const folder = stat.isDirectory() && !isPackage(item.name)
      return { ...item, kind: folder ? 'folder' : 'file', size: stat.isFile() ? stat.size : undefined, modifiedAt: stat.mtime.toISOString(), match: matchedBy(asked, item.name) }
    }))).filter(Boolean)
    return rankFound(found, asked.words, { newest: filtered }).slice(0, limit).map(({ depth, ...item }) => item)
  }
  handle('files:search', (query) => findFiles(query), { from: 'app' })

  // What was used lately (the quick search's start): { rootId, relative, name, kind, size, modifiedAt }, newest first.
  async function recentFiles(limit = 30) {
    const roots = await lookIn()
    const paths = await recentPaths({
      roots: roots.map((item) => item.root),
      platform: spotlight() ? 'darwin' : 'walk',
      walk: async (since) => {
        const files = await walkFind(roots, ({ modifiedAt }) => Boolean(modifiedAt) && new Date(modifiedAt) >= since, { max: 3000 })
        const stats = await Promise.all(files.map(async (file) => [file, (await fs.stat(file).catch(() => null))?.mtimeMs || 0]))
        return stats.sort((a, b) => b[1] - a[1]).map(([file]) => file)
      },
    })
    const found = []
    for (const item of inside([...new Set(paths)], roots).slice(0, limit * 2)) {
      const stat = await fs.stat(path.join(roots.find((root) => root.id === item.rootId).root, item.relative)).catch(() => null)
      if (!stat || (stat.isDirectory() && !isPackage(item.name))) continue
      found.push({ rootId: item.rootId, relative: item.relative, name: item.name, kind: 'file', size: stat.isFile() ? stat.size : undefined, modifiedAt: stat.mtime.toISOString() })
      if (found.length >= limit) break
    }
    return found
  }

  // "Documents › Taxes": the name of the place a file lives in, then its folders.
  const rootName = (rootId) => publicGrant(getGrant(rootId)).name
  const whereOf = (item) => [rootName(item.rootId), ...item.relative.split('/').slice(0, -1)].join(' › ')

  // The text Ask reads from a file in a folder OSAT can see…
  handle('files:extract', async (rootId, relative = '') => {
    const target = await approvedPath(getGrant(rootId), relative)
    return { name: path.basename(target), ...await readForAsk(target) }
  }, { from: 'app' })

  // …or from one dropped on a chat (the preload turns the dropped file into its path;
  // a page can't make up a path) or chosen here. null asks with the open panel.
  handle('files:attach', async (dropped) => {
    let target = dropped
    if (target === null) {
      const result = await dialog.showOpenDialog({ title: 'Choose a file for Ask', properties: ['openFile'] })
      if (result.canceled || !result.filePaths[0]) return null
      target = result.filePaths[0]
    }
    if (typeof target !== 'string' || !path.isAbsolute(target)) fail('Drop a file from Finder to read it.')
    return { name: path.basename(target), ...await readForAsk(target) }
  }, { from: 'any' })

  // Tidying (Phase 21). Only inside the approved folders; a change hands back a token for Undo.
  handle('files:new-folder', async (rootId, relative = '') => {
    const name = await makeFolder(await folderPath(getGrant(rootId), relative))
    return { name, relative: relative ? `${relative}/${name}` : name }
  }, { from: 'app' })

  handle('files:rename', async (rootId, relative, name) => {
    const from = await sourcePath(getGrant(rootId), relative)
    const { to, undo } = await rename(from, cleanName(name))
    return { name: path.basename(to), relative: [...relative.split('/').slice(0, -1), path.basename(to)].join('/'), undo: keepUndo(undo) }
  }, { from: 'app' })

  // Move (or copy) items into a folder; a taken name is numbered, never overwritten.
  const moveAnswer = async (sources, rootId, relative, copy) => {
    const dir = await folderPath(getGrant(rootId), relative)
    const { done, failed, undo } = await moveInto(sources, dir, { copy: copy === true, trash: binTrash })
    return { moved: done.map(({ to }) => ({ rootId, relative: relative ? `${relative}/${path.basename(to)}` : path.basename(to) })), failed, undo: keepUndo(undo) }
  }
  handle('files:move', async (items, rootId, relative = '', copy = false) => moveAnswer(await sourcePaths(items), rootId, relative, copy), { from: 'app' })

  // Files dropped from Finder or another app come in the same way (the preload turns each dropped file
  // into its path; a page can't make one up). They go only into a folder OSAT can see.
  handle('files:move-in', async (paths, rootId, relative = '', copy = false) => {
    const keep = await Promise.all([...places(), ...grants].map((grant) => fs.realpath(grant.root).catch(() => grant.root)))
    return moveAnswer(cleanDropped(paths, { home: os.homedir(), keep }), rootId, relative, copy)
  }, { from: 'app' })

  // A file carried off the edge of the desk goes on as the Mac's own drag, to the Dock, another
  // screen or whatever app is under it. Called while the mouse is still down.
  handle('files:drag-out', async (items) => {
    const files = await sourcePaths(items)
    const picture = (await thumbnail(files[0], 128).catch(() => null)) || null
    const icon = picture ? nativeImage.createFromDataURL(picture).resize({ width: 64 }) : nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate@2x.png'))
    mainWindow().webContents.startDrag({ files, icon })
    return true
  }, { from: 'app' })

  // "Delete" is the Mac's Bin.
  async function trashIt(items) {
    const { done, failed, undo } = await toBin(await sourcePaths(items), binTrash, process.platform === 'darwin' ? restoreItem : undefined)
    return { count: done.length, failed, undo: keepUndo(undo) }
  }
  handle('files:trash', trashIt, { from: 'app' })

  async function undoIt(token) {
    const undo = undos.get(token)
    if (!undo) fail('That can’t be undone any more.')
    undos.delete(token)
    return undo()
  }
  handle('files:undo', undoIt, { from: 'app' })

  handle('files:forget', async (rootId) => {
    if (getGrant(rootId).place) fail('Desktop, Documents and Downloads are always here.')
    stopGrantAccess(rootId)
    await mutateGrants(async (current) => current.filter((grant) => grant.id !== rootId))
    return grants.map(publicGrant)
  })

  // Tidy my Desktop (Phase 21b): the plan, the ticked groups as one undo, a folder layout (desktop/tidy.cjs).
  await registerTidy({ handle, fail, getGrant, approvedPath, approvedWritePath, folderPath, sourcePath, binTrash, keepUndo, dataDir, ai, extractText, sharedModule })

  // What the quick search (desktop/launcher) asks of the same places, with the same checks.
  return {
    thumbnail,
    find: async (query, options) => (await findFiles(query, options)).map((item) => ({ ...item, where: whereOf(item) })),
    recent: async (limit) => (await recentFiles(limit)).map((item) => ({ ...item, where: whereOf(item) })),
    resolve: (rootId, relative = '') => approvedPath(getGrant(rootId), relative),
    whereOf,
    open: openIt,
    reveal: revealIt,
    trash: trashIt,
    undo: undoIt,
    stop() {
      for (const id of grantAccessStops.keys()) stopGrantAccess(id)
    },
  }
}

module.exports = { NOT_ALLOWED, createFiles }
