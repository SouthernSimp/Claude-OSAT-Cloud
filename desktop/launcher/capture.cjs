/* Screenshots and screen recording from the launcher (shared/capture-model.mjs has the rules).
   - With CleanShot X on this Mac, each capture is CleanShot's own URL command (cleanshot://capture-area…),
     opened like a link. It is looked for once, when the launcher starts (and again when Settings asks).
   - Without it, the Mac's own `screencapture` takes the three plain screenshots, to the clipboard or to an
     "OSAT Captures" folder, never over another file. "Copy text from the screen" takes an area to a private
     temporary file, reads its words with the Mac's text recognition (`extractText`, as scans are read), puts
     them on the clipboard and removes the picture. macOS asks once before OSAT may see other apps'
     windows (Screen Recording); until then a screenshot shows only the desktop, and OSAT says so once.
   The quick search and the ring are put away first, so they are never in the picture.
   Recent captures (opt-in in Settings → Launcher → Screenshots) are read from CleanShot's own history folder,
   never written to. Nothing here leaves the Mac. */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { extractText, run } = require('../mac-files.cjs')

function createCapture({
  model, shell, clipboard, nativeImage, systemPreferences, exec = run, readText = extractText, platform = process.platform, home = os.homedir(), appPath = model.CLEANSHOT_APP,
  settings, hidePanels = async () => {}, notify = () => {}, thumbnail = async () => null, panel = () => null, on, from = {}, fail = (message) => { throw new Error(message) },
}) {
  const mac = platform === 'darwin'
  const mediaDir = path.join(home, 'Library', 'Application Support', 'CleanShot', 'media')
  let found = null

  /* Is CleanShot here? Spotlight by its id first, then its usual place. */
  async function look() {
    if (!mac) return false
    const spotlight = await exec('mdfind', [`kMDItemCFBundleIdentifier == '${model.CLEANSHOT_ID}'`], { timeout: 4000 }).catch(() => '')
    if (spotlight.split('\n').some((line) => line.endsWith('.app'))) return true
    return fsp.access(appPath).then(() => true, () => false)
  }
  const detect = () => (found = look())
  const screen = () => (mac && systemPreferences?.getMediaAccessStatus ? systemPreferences.getMediaAccessStatus('screen') : 'unavailable')

  async function status() {
    const cleanshot = await (found || detect())
    return { cleanshot, mac, list: model.available({ cleanshot, mac }), recent: settings().recent, saveTo: settings().saveTo, screen: cleanshot ? null : screen() }
  }

  const folderFor = (to) => path.join(home, to === 'pictures' ? 'Pictures' : 'Desktop', model.FOLDER_NAME)

  /* One capture, by id. → { ok: true } or { ok: false, reason: 'cleanshot' (needs it) | 'mac' | 'cancelled' | 'failed' }.
     `tell`: from a key or the ring, where no panel is open to say why nothing happened. */
  let toldScreen = false
  async function take(id, { tell = false } = {}) {
    const now = await status()
    if (!model.captureById(id) || !now.list.includes(id)) {
      if (tell && mac) notify({ title: 'OSAT', body: `${model.captureById(id)?.label || 'That'} needs CleanShot X, and it isn’t on this Mac.` })
      return { ok: false, reason: mac ? 'cleanshot' : 'mac' }
    }
    await hidePanels()
    if (now.cleanshot) {
      const url = model.cleanshotUrl(id)
      // Only cleanshot:// commands OSAT builds itself (never `upload`): CleanShot runs on this Mac.
      if (model.CLEANSHOT_URL.test(url)) await shell.openExternal(url)
      return { ok: true }
    }
    if (now.screen === 'denied' && !toldScreen) {
      toldScreen = true
      notify({ title: 'OSAT', body: 'Screenshots will show only your desktop until OSAT is allowed in System Settings → Privacy & Security → Screen Recording.' })
    }
    if (id === 'text') return copyText()
    let file = null
    if (settings().saveTo !== 'clipboard') {
      const dir = folderFor(settings().saveTo)
      await fsp.mkdir(dir, { recursive: true })
      file = path.join(dir, model.freeName(model.captureName(new Date()), (name) => fs.existsSync(path.join(dir, name))))
    }
    try {
      // An area or a window waits for you to pick it (Esc stops it), so it may take a while.
      await exec('screencapture', model.macArgs(id, { file }), { timeout: 10 * 60000 })
    } catch {
      return { ok: false, reason: 'failed' }
    }
    if (file && !fs.existsSync(file)) return { ok: false, reason: 'cancelled' }
    return { ok: true, ...(file ? { file: path.basename(file) } : {}) }
  }

  /* Copy text from the screen without CleanShot: pick an area, its words go on the clipboard. The panel is already
     away, so a notification says what happened. → { ok, words } or { ok: false, reason: 'cancelled' | 'empty' | 'failed' }. */
  async function copyText() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'osat-text-'))
    const file = path.join(dir, 'area.png')
    try {
      // Esc stops picking: no picture, nothing to say (screencapture may or may not call that an error).
      await exec('screencapture', model.macArgs('text', { file }), { timeout: 10 * 60000 }).catch(() => {})
      if (!fs.existsSync(file)) return { ok: false, reason: 'cancelled' }
      const { text } = await readText(file)
      clipboard.writeText(text)
      const words = text.split(/\s+/).filter(Boolean).length
      notify({ title: 'OSAT', body: `Copied ${words === 1 ? '1 word' : `${words} words`} from the screen. ⌘V pastes them.` })
      return { ok: true, words }
    } catch (error) {
      const empty = error?.message === 'EMPTY'
      notify({ title: 'OSAT', body: empty ? 'No words were found in that part of the screen.' : 'OSAT couldn’t read the words in that part of the screen.' })
      return { ok: false, reason: empty ? 'empty' : 'failed' }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /* ---- Recent captures: CleanShot's history folder, read only ---- */

  async function recent(limit = 12) {
    if (!settings().recent || !(await (found || detect()))) return []
    const folders = await fsp.readdir(mediaDir, { withFileTypes: true }).catch(() => [])
    // ponytail: the newest 40 folders by date; CleanShot makes one per capture, so that is plenty for 12.
    const dated = await Promise.all(folders.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async (entry) => ({ name: entry.name, at: (await fsp.stat(path.join(mediaDir, entry.name)).catch(() => null))?.mtimeMs || 0 })))
    const entries = []
    for (const folder of dated.sort((a, b) => b.at - a.at).slice(0, 40)) {
      for (const name of await fsp.readdir(path.join(mediaDir, folder.name)).catch(() => [])) {
        const stat = await fsp.stat(path.join(mediaDir, folder.name, name)).catch(() => null)
        if (stat?.isFile()) entries.push({ id: `${folder.name}/${name}`, name, at: stat.mtimeMs })
      }
    }
    return model.newestMedia(entries, limit)
  }

  /* A capture's id back to its file, only inside CleanShot's folder. */
  async function fileOf(id) {
    if (!settings().recent || !model.validMediaId(id)) fail('That capture isn’t there any more.')
    const target = await fsp.realpath(path.join(mediaDir, id)).catch(() => null)
    const root = await fsp.realpath(mediaDir).catch(() => mediaDir)
    if (!target || !target.startsWith(root + path.sep)) fail('That capture isn’t there any more.')
    return target
  }

  if (on) {
    on('search:capture', async (id) => take(String(id)))
    on('search:capture-status', async (again) => { if (again === true) detect(); return status() })
    on('search:capture-recent', () => recent())
    on('search:capture-thumb', async (id) => thumbnail(await fileOf(id), 640).catch(() => null))
    on('search:capture-open', async (id) => { if (await shell.openPath(await fileOf(id))) fail('macOS could not open that capture.'); return true })
    on('search:capture-reveal', async (id) => { shell.showItemInFolder(await fileOf(id)); return true })
    on('search:capture-copy', async (id) => {
      const image = nativeImage.createFromPath(await fileOf(id))
      if (image.isEmpty()) fail('Only a picture can be copied; drag a recording instead.')
      clipboard.writeImage(image)
      return true
    })
    // Dragged out of the quick search to another app, as the Mac's own drag (called while the mouse is down).
    on('search:capture-drag', async (id) => {
      const file = await fileOf(id)
      const picture = await thumbnail(file, 128).catch(() => null)
      const window = panel()
      if (window && !window.isDestroyed()) window.webContents.startDrag({ file, icon: picture ? nativeImage.createFromDataURL(picture).resize({ width: 64 }) : nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'trayTemplate@2x.png')) })
      return true
    }, from.panel)
  }

  return { detect, status, take, recent, fileOf }
}

module.exports = { createCapture }
