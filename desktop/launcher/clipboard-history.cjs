/* The clipboard history (Phase 13): the last few hundred things copied, kept only on this Mac, in
   `<data folder>/clipboard/` (history.json, and pictures as files in images/). It looks at the
   clipboard every ~700 ms while OSAT runs, and never at anything else.
   - Skips what password managers and the Mac mark as concealed or one-time.
   - Can be paused, cleared (Undo brings it back for a few minutes) and limited (how many, how old).
   - Pins keep a copy as a snippet: no limit touches it.
   - Never logs, sends or hands to the AI what was copied. Files are private to this Mac user.
   The rules that need no clipboard (kinds, repeats, limits, groups) are shared/clipboard-model.mjs.
   Electron's `clipboard` and `nativeImage` are passed in, so the tests use stand-ins. */
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const sha = (data) => crypto.createHash('sha1').update(data).digest('hex')
// What was removed stays back (with its picture files) this long, so Undo has something to bring.
const HOLD_MS = 5 * 60 * 1000

function createClipboardHistory({
  dir, clipboard, nativeImage, model, every = 700, now = () => new Date(),
  // Which app was in front when it was copied ('' when nobody can say) and how much to keep.
  frontApp = async () => '', limits = () => ({}), onCopy = () => {},
}) {
  const file = path.join(dir, 'history.json')
  const pictures = path.join(dir, 'images')
  let items = []
  let paused = false
  let watching = true
  let last = ''
  const privateCopies = new Set()
  let busy = false
  let timer = null
  let saveTimer = null
  let held = null
  let lookedAtAge = 0

  const pictureFile = (id) => path.join(pictures, `${id}.png`)
  // Only a name this history made can name a file: a page can't reach anywhere else.
  const find = (id) => items.find((item) => item.id === String(id))
  const max = () => limits().items || model.MAX_ITEMS
  const days = () => (limits().days === undefined ? model.MAX_DAYS : limits().days)

  /* What is on the clipboard now: text, else a picture; `sig` says whether it is the same as
     the last look. A picture is read as bytes first (cheap), decoded only when it is new. */
  function peek() {
    const text = clipboard.readText()
    if (text && text.trim()) return { sig: `t:${text}`, text }
    for (const format of ['public.png', 'public.tiff']) {
      let buffer = null
      try { buffer = clipboard.readBuffer(format) } catch { /* no such format here */ }
      if (buffer?.length) return { sig: `i:${sha(buffer)}`, image: () => nativeImage.createFromBuffer(buffer) }
    }
    // ponytail: off the Mac there are no UTIs, so the picture is decoded and hashed every look.
    const image = clipboard.readImage()
    if (image && !image.isEmpty()) return { sig: `i:${sha(image.toPNG())}`, image: () => image }
    return null
  }

  /* electron's availableFormats() lists only the common types; `has` sees any of them. */
  function concealed() {
    try { if (model.CONCEALED_TYPES.some((type) => clipboard.has(type))) return true } catch { /* not asked */ }
    try { return model.isConcealed(clipboard.availableFormats()) } catch { return false }
  }

  // What is on the clipboard now counts as already seen (after starting, resuming, or OSAT's own writes).
  function prime() {
    try { last = peek()?.sig || '' } catch { last = '' }
  }

  function saveNow() {
    clearTimeout(saveTimer)
    saveTimer = null
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ version: 2, paused, items }), { mode: 0o600 })
    fs.renameSync(temporary, file)
  }
  function saveSoon() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { try { saveNow() } catch { /* the next change tries again */ } }, 300)
    saveTimer.unref?.()
  }

  const dropPictures = (list) => Promise.all(list.filter((item) => item.kind === 'image').map((item) => fsp.rm(pictureFile(item.id), { force: true }))).catch(() => {})

  /* What goes is held for a few minutes (only the newest removal), pictures and all: Undo. */
  function hold(gone, at = []) {
    if (!gone.length) return null
    if (held) { clearTimeout(held.timer); dropPictures(held.items) }
    const token = crypto.randomUUID()
    const entry = { token, items: gone, at }
    entry.timer = setTimeout(() => { if (held === entry) { held = null; dropPictures(gone) } }, HOLD_MS)
    entry.timer.unref?.()
    held = entry
    return token
  }

  function add(incoming, id = crypto.randomUUID()) {
    const result = model.addItem(items, incoming, { id, now: now(), max: max() })
    items = result.items
    // What fell off the end stays gone; it isn't something anyone removed.
    dropPictures(result.dropped)
    saveSoon()
    return { added: result.added, repeat: result.added.id !== id }
  }

  async function record(seen) {
    const app = await frontApp().catch(() => '')
    if (seen.text !== undefined) {
      const full = seen.text.replace(/\r\n?/g, '\n')
      const text = full.slice(0, model.MAX_TEXT)
      return add({ kind: model.classify(text), text, more: full.length > text.length, app })
    }
    const image = seen.image()
    const png = image.toPNG()
    if (!png.length || png.length > model.MAX_IMAGE_BYTES) return null
    const key = sha(png)
    const same = items.find((item) => item.kind === 'image' && item.hash === key)
    if (same) return add({ kind: 'image', key, image: same.image, thumb: same.thumb, app })
    const id = crypto.randomUUID()
    await fsp.mkdir(pictures, { recursive: true, mode: 0o700 })
    await fsp.writeFile(pictureFile(id), png, { mode: 0o600 })
    const { width, height } = image.getSize()
    return add({ kind: 'image', key, image: { w: width, h: height, bytes: png.length }, thumb: image.resize({ width: Math.min(width, 96) }).toDataURL(), app }, id)
  }

  /* Old copies go once an hour (and at start): the age limit. */
  function tidyAge() {
    const result = model.expire(items, { now: now(), days: days() })
    if (!result.dropped.length) return
    items = result.items
    dropPictures(result.dropped)
    saveSoon()
  }

  /* One look. Never throws, and never says what it saw. */
  async function poll() {
    if (paused || busy || !watching) return
    busy = true
    try {
      const seen = peek()
      const sig = seen?.sig || ''
      if (sig === last) return
      last = sig
      if (!seen || concealed() || privateCopies.has(sha(sig))) return
      const result = await record(seen)
      if (result && !result.repeat) onCopy(result.added)
      if (Date.now() - lookedAtAge > 3600000) { lookedAtAge = Date.now(); tidyAge() }
    } catch {
      // A look that fails is skipped; the next one tries again.
    } finally {
      busy = false
    }
  }

  const bump = (item) => { items = [{ ...item, at: now().toISOString() }, ...items.filter((other) => other !== item)]; saveSoon() }
  const summary = (item) => (item.kind === 'image'
    ? { id: item.id, kind: 'image', at: item.at, image: item.image, thumb: item.thumb, ...(item.pinned ? { pinned: true } : {}), ...(item.app ? { app: item.app } : {}) }
    : { id: item.id, kind: item.kind, at: item.at, text: item.text.slice(0, model.PREVIEW_CHARS), chars: item.text.length, ...(item.more ? { more: true } : {}), ...(item.pinned ? { pinned: true } : {}), ...(item.app ? { app: item.app } : {}) })

  function begin() {
    clearInterval(timer)
    if (!watching) return
    prime()
    timer = setInterval(poll, every)
    timer.unref?.()
  }

  return {
    poll,
    prime,
    async start() {
      try {
        const saved = JSON.parse(await fsp.readFile(file, 'utf8'))
        items = model.cleanItems(saved.items, { max: max() })
        paused = saved.paused === true
      } catch {
        items = []
      }
      tidyAge()
      // A picture no copy points to (a crash between the two writes) goes.
      const kept = new Set(items.filter((item) => item.kind === 'image').map((item) => `${item.id}.png`))
      for (const name of await fsp.readdir(pictures).catch(() => [])) if (!kept.has(name)) await fsp.rm(path.join(pictures, name), { force: true }).catch(() => {})
      begin()
    },
    stop() {
      clearInterval(timer)
      // Undo doesn't outlast OSAT: what was removed leaves the disk now.
      if (held) {
        clearTimeout(held.timer)
        for (const item of held.items) if (item.kind === 'image') fs.rmSync(pictureFile(item.id), { force: true })
        held = null
      }
      if (saveTimer) { try { saveNow() } catch { /* nothing more to do at quit */ } }
    },
    /* Turns the watching off (the Clipboard source is off in Settings → Launcher) or back on. What was
       copied meanwhile is never kept, as with a pause. */
    watch(on) {
      watching = on !== false
      begin()
      return watching
    },
    /* For the windows: long text is cut (the whole copy stays here), pictures are a small thumb. */
    list() {
      return { paused, watching, items: items.map(summary) }
    },
    item: (id) => { const item = find(id); return item ? summary(item) : null },
    /* The whole of a copy's words, for putting it in a sticky (the list only carries the start). */
    textOf(id) {
      const item = find(id)
      return item && item.kind !== 'image' ? item.text : null
    },
    async image(id) {
      const item = find(id)
      if (item?.kind !== 'image') return null
      return fsp.readFile(pictureFile(item.id)).then((data) => `data:image/png;base64,${data.toString('base64')}`, () => null)
    },
    /* Puts a copy back on the clipboard (so ⌘V pastes it), and moves it to the top. */
    use(id) {
      const item = find(id)
      if (!item) return false
      if (item.kind === 'image') {
        const picture = nativeImage.createFromPath(pictureFile(item.id))
        if (picture.isEmpty()) return false
        clipboard.writeImage(picture)
      } else {
        clipboard.writeText(item.text)
      }
      prime()
      bump(item)
      return true
    },
    pin(id, on) {
      if (!find(id)) return false
      items = model.setPinned(items, String(id), on === true)
      saveSoon()
      return true
    },
    /* Forgetting one copy answers a token: `undo(token)` puts it back where it was. */
    forget(id) {
      const item = find(id)
      if (!item) return null
      const at = items.indexOf(item)
      items = model.removeItem(items, item.id)
      saveSoon()
      return hold([item], [at])
    },
    /* Clear removes them all; the same Undo brings them back. */
    clear() {
      const gone = items
      items = []
      saveNow()
      return hold(gone) || 'empty'
    },
    undo(token) {
      if (!held || held.token !== token) return false
      clearTimeout(held.timer)
      const { items: back, at } = held
      held = null
      const list = [...items]
      // A single copy goes back where it was; everything cleared goes back after what was copied since.
      back.forEach((item, index) => list.splice(Math.min(at[index] ?? list.length, list.length), 0, item))
      items = list
      saveNow()
      return true
    },
    setPaused(on) {
      paused = on === true
      if (!paused) prime()
      saveSoon()
      return paused
    },
    /* A change to the limits (Settings → Launcher) is applied now. */
    limitsChanged() {
      tidyAge()
      const trimmed = model.cleanItems(items, { max: max() })
      if (trimmed.length !== items.length) {
        const kept = new Set(trimmed.map((item) => item.id))
        dropPictures(items.filter((item) => !kept.has(item.id)))
        items = items.filter((item) => kept.has(item.id))
        saveSoon()
      }
    },
    /* A clipboard that OSAT itself writes to (a key for the connector) and never keeps. */
    quiet: (target) => ({ writeText: (text) => { privateCopies.add(sha(`t:${text}`)); target.writeText(text); prime() }, readText: () => target.readText() }),
  }
}

module.exports = { createClipboardHistory }
