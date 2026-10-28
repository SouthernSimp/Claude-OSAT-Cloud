/* The Passwords room (Phase 58, Tools → Passwords), main process. Everything secret lives here and nowhere else.
     passwords:status · create · unlock · lock · touch · list · save · remove · restore · reveal · copy · generate
     passwords:set-auto-lock · change-master · export · import-pick · import · import-csv · logins · fill
   The file is `vault.json` in the data folder: this Mac only, mode 0600, written whole to a temporary file and moved into
   place. It is NEVER part of workspace.json, sync, snapshots, the iPhone folder, Ask, the connector, the agent, webhooks or
   the overnight/brief jobs: none of them import this file (tests/vault-fence.test.mjs fails if one does).
   The sealing is shared/vault-format.mjs; the rules are shared/password-model.mjs.
   * Locked at every launch. Locks: idle (a setting, 5 minutes), Mac sleep, screen lock, the desk put away, leaving the
     room, quit. A lock overwrites the key and drops the decrypted entries; the window is told (`passwords:locked`).
   * The window gets id/title/username/url/updatedAt and nothing more. A password leaves only for Reveal (the window hides it
     after 10 seconds), Copy (written here, concealed, cleared after 30 seconds if the clipboard still holds it) or a fill in
     the Web room (Phase 102: handed from here straight to the page in front, never through the window).
   * The master password is never kept: it derives the key and is let go. There is no way back in without it.
   * Nothing here is logged, and an error that reaches the window is one of this file's own calm sentences, never the
     underlying error (which could name a path or, one day, a value). */
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')

class Calm extends Error {
  constructor(message) {
    super(message)
    this.calm = true
  }
}
const LOCKED = 'Your passwords are locked. Unlock them first.'
const GENERIC = 'Passwords couldn’t do that. Nothing was changed.'

/* A file written whole, then moved into place: a quit or a crash leaves the old one or the new one, never half. */
async function writeAtomic(file, text, { fs = fsp } = {}) {
  const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`
  let handle
  try {
    handle = await fs.open(temporary, 'wx', 0o600)
    await handle.writeFile(text, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.rename(temporary, file)
  } catch (error) {
    await handle?.close().catch(() => {})
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function createPasswords({
  dataDir, sharedModule, handle, fail, dialog, mainWindow = () => null, clipboard, writeConcealed, send = () => {},
  now = () => Date.now(), timers = { set: setTimeout, clear: clearTimeout }, fs = fsp,
  // The Web room's front tab ({ url, fill }) and the Bin, both from main.
  page = () => null, trash = async () => { throw new Error('no Bin') },
}) {
  const format = await sharedModule('vault-format.mjs')
  const model = await sharedModule('password-model.mjs')
  const file = path.join(dataDir, 'vault.json')

  let session = null // { key, kdf, data: { entries, settings }, deleted: [] }; null = locked
  let epoch = 0 // a lock bumps it, so a slow unlock that finishes after a lock throws its result away
  let idleTimer = null
  let clearTimer = null
  let copied = null // sha256 of what Copy put on the clipboard (never the words themselves)
  let pickedBackup = null // the text of a backup file chosen, waiting for its password
  let tries = { failed: 0, lastAt: 0 }
  let queue = Promise.resolve()

  const digest = (text) => crypto.createHash('sha256').update(String(text), 'utf8').digest()
  const readFile = async () => { try { return await fs.readFile(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
  const calm = (error) => (error?.calm ? error : new Calm(GENERIC))

  /* One thing at a time that touches the file or the session. */
  function serial(task) {
    const run = queue.then(task)
    queue = run.catch(() => {})
    return run
  }
  const unlocked = () => { if (!session) throw new Calm(LOCKED); return session }
  const publicList = () => session.data.entries.map(model.listing).sort(model.byTitle)

  /* ---- Locking ---- */
  function clearClipboardIfOurs() {
    timers.clear(clearTimer)
    clearTimer = null
    if (!copied) return
    try {
      if (crypto.timingSafeEqual(digest(clipboard.readText()), copied)) clipboard.clear()
    } catch { /* the clipboard wasn't ours to clear */ }
    copied = null
  }
  function lock() {
    epoch += 1
    timers.clear(idleTimer)
    idleTimer = null
    const was = session
    session = null
    if (was) format.wipe(was)
    if (was?.deleted) { for (const entry of was.deleted) entry.password = ''; was.deleted.length = 0 }
    pickedBackup = null
    clearClipboardIfOurs()
    if (was) send('passwords:locked')
  }
  function arm() {
    timers.clear(idleTimer)
    idleTimer = null
    if (!session) return
    idleTimer = timers.set(lock, session.data.settings.autoLockMinutes * 60000)
    idleTimer?.unref?.()
  }
  const touch = () => { if (session) arm() }

  /* ---- Saving: sealed now (a fresh nonce), written after, in order ---- */
  async function persist(from, data) {
    const text = format.seal(from.key, from.kdf, data) // synchronous: a lock can't zero the key under it
    await writeAtomic(file, text, { fs })
    return text
  }
  /* Change the vault's data and write it; the memory follows the disk, not the other way round. */
  async function commitData(change) {
    const mine = unlocked()
    const next = { entries: [...mine.data.entries], settings: { ...mine.data.settings } }
    const result = change(next)
    await persist(mine, next)
    if (session === mine) mine.data = next
    return result
  }

  /* ---- Wrong guesses ---- */
  const waiting = () => model.waitFor(tries.failed, tries.lastAt, now())
  /* The count kept in the file survives a quit; the larger of it and the one in memory counts. */
  function loadTries(text) {
    try {
      const saved = format.parse(text).attempts
      if (saved) tries = { failed: Math.max(tries.failed, saved.failed), lastAt: Math.max(tries.lastAt, saved.lastAt) }
    } catch { /* not a file to read a count from */ }
  }
  async function guessWrong(text) {
    tries = { failed: tries.failed + 1, lastAt: now() }
    if (text) await writeAtomic(file, format.withAttempts(text, tries), { fs }).catch(() => {})
    const wait = waiting()
    return new Calm(wait ? `${model.COULDNT_UNLOCK} ${model.waitWords(wait)}` : model.COULDNT_UNLOCK)
  }
  async function guessRight(text) {
    const had = tries.failed > 0
    tries = { failed: 0, lastAt: 0 }
    if (had && text) await writeAtomic(file, format.withAttempts(text, null), { fs }).catch(() => {})
  }
  function refuseWhileWaiting() {
    const wait = waiting()
    if (wait) throw new Calm(model.waitWords(wait))
  }

  /* The master password asked for twice: long enough, and the same. */
  function checkNew(password, again) {
    const text = typeof password === 'string' ? password : ''
    if (!format.sameSecret(text, again)) throw new Calm('The two master passwords don’t match.')
    if (text.length > model.MAX_MASTER) throw new Calm('That master password is too long.')
    if (!model.strengthOf(text).ok) throw new Calm(model.strengthOf(text).label)
    return text
  }

  const register = (channel, operation, { quiet = false } = {}) => handle(channel, async (...args) => {
    try {
      const result = await operation(...args)
      if (!quiet) touch()
      return result
    } catch (error) {
      throw fail(calm(error).message)
    }
  }, { from: 'app' })

  const randomInt = (n) => crypto.randomInt(n)
  const ask = (show, options) => { const window = mainWindow(); return window ? show.call(dialog, window, options) : show.call(dialog, options) }

  register('passwords:status', async () => {
    const text = await readFile().catch(() => 'unreadable')
    if (text) loadTries(text)
    const exists = text !== null
    return { exists, unlocked: Boolean(session), waitMs: waiting(), autoLockMinutes: session ? session.data.settings.autoLockMinutes : model.DEFAULT_AUTO_LOCK }
  }, { quiet: true })

  register('passwords:create', (password, again) => serial(async () => {
    if (session) throw new Calm('Your passwords are already set up.')
    if ((await readFile()) !== null) throw new Calm('A passwords file is already here. Unlock it instead.')
    const text = checkNew(password, again)
    const mine = epoch
    const data = { entries: [], settings: { autoLockMinutes: model.DEFAULT_AUTO_LOCK } }
    const made = await format.create(text, data)
    if (mine !== epoch) { format.wipe(made.session); throw new Calm(LOCKED) }
    await writeAtomic(file, made.text, { fs })
    session = { ...made.session, deleted: [] }
    tries = { failed: 0, lastAt: 0 }
    arm()
    return publicList()
  }))

  register('passwords:unlock', (password) => serial(async () => {
    if (session) return publicList()
    const text = await readFile()
    if (text === null) throw new Calm('There are no passwords here yet.')
    if (typeof password !== 'string' || password.length > model.MAX_MASTER) throw await guessWrong(text)
    format.parse(text) // a file that isn't one says so; tampering says what a wrong password says
    loadTries(text)
    refuseWhileWaiting()
    const mine = epoch
    let opened
    try {
      opened = await format.open(text, password)
    } catch (error) {
      if (error?.code === 'cannot-open') throw await guessWrong(text)
      throw error
    }
    if (mine !== epoch) { format.wipe(opened); throw new Calm(LOCKED) } // locked while it was working
    await guessRight(text)
    const data = model.cleanVault(opened.data, { newId: () => crypto.randomUUID() })
    format.wipe({ data: opened.data }) // the raw copy; the cleaned one is what the session keeps
    session = { key: opened.key, kdf: opened.kdf, data, deleted: [] }
    arm()
    return publicList()
  }))

  register('passwords:lock', () => { lock(); return true }, { quiet: true })
  register('passwords:touch', () => { touch(); return true }, { quiet: true })
  register('passwords:list', () => { unlocked(); return publicList() })

  register('passwords:save', (raw) => serial(async () => {
    const mine = unlocked()
    const previous = typeof raw?.id === 'string' ? mine.data.entries.find((entry) => entry.id === raw.id) : null
    if (raw?.id && !previous) throw new Calm('That password isn’t here any more.')
    const entry = model.cleanEntry(raw, { previous, newId: () => crypto.randomUUID() })
    if (!entry) throw new Calm('A password needs a name and a password.')
    await commitData((next) => { next.entries = [...next.entries.filter((item) => item.id !== entry.id), entry] })
    return { id: entry.id, list: publicList() }
  }))

  /* Deleted entries wait in memory until the next lock, so Undo can bring one back. A list of ids is an import's Undo. */
  register('passwords:remove', (id) => serial(async () => {
    const mine = unlocked()
    const ids = new Set(Array.isArray(id) ? id : [id])
    const gone = mine.data.entries.filter((entry) => ids.has(entry.id))
    if (!gone.length) throw new Calm('That password isn’t here any more.')
    await commitData((next) => { next.entries = next.entries.filter((entry) => !ids.has(entry.id)) })
    mine.deleted = [...mine.deleted, ...gone]
    return { id, title: gone[0].title, list: publicList() }
  }))
  register('passwords:restore', (id) => serial(async () => {
    const mine = unlocked()
    const back = mine.deleted.find((entry) => entry.id === id)
    if (!back) throw new Calm('That one can’t be brought back now.')
    await commitData((next) => { next.entries = [...next.entries, back] })
    mine.deleted = mine.deleted.filter((entry) => entry.id !== id)
    return publicList()
  }))

  const entryFor = (id) => {
    const entry = unlocked().data.entries.find((item) => item.id === id)
    if (!entry) throw new Calm('That password isn’t here any more.')
    return entry
  }
  register('passwords:reveal', (id) => entryFor(id).password)
  register('passwords:copy', async (id) => {
    const words = entryFor(id).password
    try { await writeConcealed(words) } catch { throw new Calm('The password couldn’t be copied safely, so it wasn’t copied.') }
    timers.clear(clearTimer)
    copied = digest(words)
    clearTimer = timers.set(clearClipboardIfOurs, model.COPY_CLEAR_MS)
    clearTimer?.unref?.()
    return { clearsInSeconds: model.COPY_CLEAR_MS / 1000 }
  })

  register('passwords:generate', (options) => model.generate(options && typeof options === 'object' ? options : {}, randomInt))

  register('passwords:set-auto-lock', (minutes) => serial(async () => {
    if (!model.AUTO_LOCK_CHOICES.includes(minutes)) throw new Calm('Pick one of the times on the list.')
    await commitData((next) => { next.settings.autoLockMinutes = minutes })
    arm()
    return minutes
  }))

  /* A new master password: checked against the old one, a new salt and key, everything sealed again. */
  register('passwords:change-master', (current, next, again) => serial(async () => {
    const mine = unlocked()
    refuseWhileWaiting()
    const text = await readFile()
    const proof = await format.deriveKey(typeof current === 'string' ? current : '', mine.kdf)
    const right = crypto.timingSafeEqual(proof, mine.key)
    proof.fill(0)
    if (!right) throw await guessWrong(text)
    await guessRight(text)
    const fresh = checkNew(next, again)
    const kdf = format.newKdf()
    const key = await format.deriveKey(fresh, kdf)
    const data = mine.data
    try {
      if (session !== mine) throw new Calm(LOCKED)
      await writeAtomic(file, format.seal(key, kdf, data), { fs })
    } catch (error) {
      key.fill(0)
      throw error
    }
    mine.key.fill(0)
    if (session !== mine) { key.fill(0); return true } // locked while it wrote: the file has the new password, nothing stays open
    mine.key = key
    mine.kdf = kdf
    return true
  }))

  /* A backup is this same sealed file: no plain-text copy of anything is ever made. */
  register('passwords:export', () => serial(async () => {
    unlocked()
    const text = await readFile()
    if (text === null) throw new Calm('There is nothing to back up yet.')
    const where = await ask(dialog.showSaveDialog, { title: 'Back up your passwords', defaultPath: 'OSAT passwords backup.json', filters: [{ name: 'Passwords backup', extensions: ['json'] }] })
    if (where.canceled || !where.filePath) return null
    await writeAtomic(where.filePath, format.withAttempts(text, null), { fs })
    return path.basename(where.filePath)
  }))

  register('passwords:import-pick', () => serial(async () => {
    const where = await ask(dialog.showOpenDialog, { title: 'Choose a passwords backup', properties: ['openFile'], filters: [{ name: 'Passwords backup', extensions: ['json'] }] })
    if (where.canceled || !where.filePaths?.[0]) return null
    const picked = where.filePaths[0]
    if ((await fs.stat(picked)).size > 32 * 1024 * 1024) throw new Calm('That file is too big to be a passwords backup.')
    const text = await fs.readFile(picked, 'utf8')
    try { format.parse(text) } catch (error) { throw error?.calm ? error : new Calm('That isn’t a passwords file OSAT can read.') }
    pickedBackup = text
    return { name: path.basename(picked) }
  }))
  /* With passwords unlocked, a backup is added to them. With none set up yet, it becomes them (its password is the master). */
  register('passwords:import', (password) => serial(async () => {
    if (!pickedBackup) throw new Calm('Choose a backup file first.')
    refuseWhileWaiting()
    const backup = pickedBackup
    const mine = epoch
    let opened
    try {
      opened = await format.open(backup, typeof password === 'string' ? password : '')
    } catch (error) {
      if (error?.code === 'cannot-open') throw await guessWrong(null)
      throw error
    }
    if (mine !== epoch) { format.wipe(opened); throw new Calm(LOCKED) }
    const incoming = model.cleanVault(opened.data, { newId: () => crypto.randomUUID() })
    format.wipe({ data: opened.data })
    try {
      if (session) {
        const merged = model.mergeEntries(session.data.entries, incoming.entries)
        await commitData((next) => { next.entries = merged.entries })
        pickedBackup = null
        return { added: merged.added, updated: merged.updated, list: publicList() }
      }
      if ((await readFile()) !== null) throw new Calm('A passwords file is already here. Unlock it, then add the backup.')
      await writeAtomic(file, format.withAttempts(backup, null), { fs })
      session = { key: opened.key, kdf: opened.kdf, data: incoming, deleted: [] }
      opened = null
      pickedBackup = null
      arm()
      return { added: incoming.entries.length, updated: 0, list: publicList() }
    } finally {
      if (opened) format.wipe(opened)
    }
  }))

  /* Phase 102: the file Chrome or Apple Passwords exports, read here, added to what is unlocked (a login already here is
     skipped), then moved to the Bin, because it holds every password in plain words. → { added: ids, binned, name, list } */
  register('passwords:import-csv', () => serial(async () => {
    unlocked()
    const where = await ask(dialog.showOpenDialog, { title: 'Choose the passwords file you exported', properties: ['openFile'], filters: [{ name: 'Exported passwords', extensions: ['csv'] }] })
    if (where.canceled || !where.filePaths?.[0]) return null
    const picked = where.filePaths[0]
    if ((await fs.stat(picked)).size > 32 * 1024 * 1024) throw new Calm('That file is too big to be exported passwords.')
    const rows = model.fromCsv(await fs.readFile(picked, 'utf8'))
    if (!rows) throw new Calm('That isn’t a passwords file OSAT can read. Export it from Chrome or Apple Passwords as a .csv file.')
    const here = new Set(unlocked().data.entries.map(model.loginKey))
    const added = []
    for (const row of rows) {
      const entry = model.cleanEntry(row, { newId: () => crypto.randomUUID() })
      if (!entry || here.has(model.loginKey(entry))) continue
      here.add(model.loginKey(entry))
      added.push(entry)
    }
    if (added.length) await commitData((next) => { next.entries = [...next.entries, ...added] })
    const binned = await Promise.resolve().then(() => trash(picked)).then(() => true, () => false)
    return { added: added.map((entry) => entry.id), binned, name: path.basename(picked), list: publicList() }
  }))

  /* The Web room's key (Phase 102). The site is main's own front tab, never an address the window sends. `logins` lists the
     ones for it (never a password); `fill` checks the site again and hands the login straight to the tab, which fills only
     while it is still on that page. */
  register('passwords:logins', async () => {
    const where = page()?.url() || ''
    const site = /^https:/i.test(where) ? model.hostOf(where) : ''
    if (!session) return { site, locked: (await readFile().catch(() => 'unreadable')) !== null, logins: [] }
    return { site, locked: false, logins: session.data.entries.filter((entry) => model.forSite(entry.url, where)).map(model.listing).sort(model.byTitle) }
  })
  register('passwords:fill', async (id) => {
    const entry = entryFor(id)
    const tab = page()
    const where = tab?.url() || ''
    if (!model.forSite(entry.url, where)) throw new Calm('That password isn’t for this page.')
    const filled = await tab.fill({ origin: new URL(where).origin, username: entry.username, password: entry.password }).catch(() => '')
    if (!filled) throw new Calm('OSAT couldn’t find where this page takes a password.')
    return true
  })

  return { lock, locked: () => !session, stop: lock }
}

module.exports = { createPasswords, writeAtomic, LOCKED }
