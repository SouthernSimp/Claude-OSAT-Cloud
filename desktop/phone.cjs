/* Your iPhone, through iCloud Drive. Off until Nate turns it on in Settings.
   OSAT keeps one folder there:
     OSAT/Inbox   a text file dropped here (by the Add to OSAT shortcut, the Share
                  menu or the Files app) becomes a thought in Unsorted, then moves
                  to Inbox/Added. Nothing is deleted.
     OSAT/Notes   a read-only Markdown copy of every note, for the Files app. Only
                  files OSAT wrote (listed in .osat-mirror.json) are ever changed.
   `capture(text)` adds the thought through the store; `snapshot()` returns the
   notes and folders to copy. The file system and the clock are passed in. */
const path = require('node:path')
const nodeFs = require('node:fs/promises')

const TEXT = new Set(['.txt', '.md', '.markdown', '.text', ''])
const MAX_BYTES = 1024 * 1024
const SETTLE_MS = 3000
const MANIFEST = '.osat-mirror.json'

const README = `This folder belongs to OSAT on your Mac.

Inbox: put text here from your iPhone (the Add to OSAT shortcut, Share → Save to Files,
or the Files app). Each file becomes a thought in Unsorted, then moves to Inbox/Added.

Notes: a copy of your notes, kept up to date by OSAT, to read on your iPhone.
Edit your notes in OSAT; changes made to this copy are not read back.
`

/* A title as a file name: no slashes, colons or control characters, not too long. */
function fileName(title) {
  const clean = String(title || '').replace(/[\u0000-\u001f/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  return (clean.slice(0, 80).trim() || 'Untitled')
}

/* Where each note's copy goes: its folder path, Unsorted, or Days for daily pages. */
function mirrorPlan(notes, folders) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const folderPath = (id) => {
    const parts = []
    for (let folder = byId.get(id), depth = 0; folder && depth < 20; folder = byId.get(folder.parentId), depth += 1) parts.unshift(fileName(folder.name))
    return parts
  }
  const plan = new Map()
  const taken = new Set()
  const ordered = [...notes]
    .filter((note) => note && !note.trashedAt && !note.archived)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)))
  for (const note of ordered) {
    const dir = note.kind === 'day' && note.date ? ['Days'] : note.unsorted ? ['Unsorted'] : folderPath(note.folderId)
    const base = note.kind === 'day' && note.date ? note.date : fileName(note.title)
    let relative = path.join(...dir, `${base}.md`)
    for (let n = 2; taken.has(relative.toLowerCase()); n += 1) relative = path.join(...dir, `${base} (${n}).md`)
    taken.add(relative.toLowerCase())
    plan.set(note.id, { relative, content: note.markdown.endsWith('\n') ? note.markdown : `${note.markdown}\n` })
  }
  return plan
}

function createPhoneBridge({ root, capture, snapshot, fs = nodeFs, now = () => Date.now(), onStatus = () => {} }) {
  const inbox = path.join(root, 'Inbox')
  const added = path.join(inbox, 'Added')
  const notesDir = path.join(root, 'Notes')
  let status = { root, lastCapture: null, error: '' }
  let written = null // noteId → { relative, content } as last written
  let scanning = null
  let mirroring = null
  let mirrorAgain = false

  const setStatus = (patch) => {
    status = { ...status, ...patch }
    onStatus(status)
  }

  async function prepare() {
    await fs.mkdir(added, { recursive: true })
    await fs.mkdir(notesDir, { recursive: true })
    await fs.writeFile(path.join(root, 'What lives here.txt'), README)
  }

  async function uniqueTarget(dir, name) {
    const ext = path.extname(name)
    const stem = name.slice(0, name.length - ext.length)
    for (let n = 1; ; n += 1) {
      const candidate = path.join(dir, n === 1 ? name : `${stem} ${n}${ext}`)
      try { await fs.access(candidate) } catch { return candidate }
    }
  }

  /* Each settled text file in the Inbox becomes one thought, then moves to Added. */
  async function scanInbox() {
    let entries
    try {
      entries = await fs.readdir(inbox, { withFileTypes: true })
    } catch (error) {
      setStatus({ error: error.code === 'ENOENT' ? 'The OSAT folder in iCloud Drive is missing. Turn the iPhone link off and on again.' : `OSAT couldn't read the Inbox (${error.code || error.message}).` })
      return 0
    }
    let count = 0
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || !TEXT.has(path.extname(entry.name).toLowerCase())) continue
      const file = path.join(inbox, entry.name)
      try {
        const stat = await fs.stat(file)
        // Still arriving from iCloud, or too big to be a thought: leave it for now.
        if (now() - stat.mtimeMs < SETTLE_MS || stat.size > MAX_BYTES) continue
        const text = (await fs.readFile(file, 'utf8')).replace(/^﻿/, '').trim()
        if (text) {
          capture(text)
          count += 1
        }
        await fs.rename(file, await uniqueTarget(added, entry.name))
      } catch {
        // Not downloaded yet or busy: the next scan tries again.
      }
    }
    if (count) setStatus({ lastCapture: new Date(now()).toISOString(), error: '' })
    return count
  }

  function scan() {
    scanning ??= scanInbox().finally(() => { scanning = null })
    return scanning
  }

  // The manifest sits in iCloud Drive, where other devices write too: only paths
  // that stay inside Notes are trusted.
  const inside = (relative) => typeof relative === 'string' && !path.isAbsolute(relative)
    && path.resolve(notesDir, relative).startsWith(`${path.resolve(notesDir)}${path.sep}`)

  async function readManifest() {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(notesDir, MANIFEST), 'utf8'))
      return new Map(Object.entries(saved.files || {}).filter(([, relative]) => inside(relative)).map(([id, relative]) => [id, { relative, content: null }]))
    } catch {
      return new Map()
    }
  }

  /* Writes the notes that changed and removes copies of notes that are gone. */
  async function mirrorOnce() {
    written ??= await readManifest()
    const { notes, folders } = snapshot()
    const plan = mirrorPlan(notes, folders)
    let changed = false
    for (const [id, before] of written) {
      const next = plan.get(id)
      if (!next || next.relative !== before.relative) {
        await fs.rm(path.join(notesDir, before.relative), { force: true })
        written.delete(id)
        changed = true
      }
    }
    for (const [id, next] of plan) {
      const before = written.get(id)
      if (before?.relative === next.relative && before.content === next.content) continue
      const target = path.join(notesDir, next.relative)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, next.content)
      written.set(id, next)
      changed = true
    }
    if (changed) {
      const files = Object.fromEntries([...written].map(([id, entry]) => [id, entry.relative]))
      await fs.writeFile(path.join(notesDir, MANIFEST), `${JSON.stringify({ files }, null, 1)}\n`)
    }
    return plan.size
  }

  /* One copy at a time; changes that arrive meanwhile are copied right after. */
  function mirror() {
    if (mirroring) {
      mirrorAgain = true
      return mirroring
    }
    mirroring = mirrorOnce().then(
      (count) => { if (status.error) setStatus({ error: '' }); return count },
      (error) => { setStatus({ error: `OSAT couldn't update the copy of your notes (${error.code || error.message}).` }) },
    ).finally(() => {
      mirroring = null
      if (mirrorAgain) {
        mirrorAgain = false
        mirror()
      }
    })
    return mirroring
  }

  /* Removes only the copies OSAT wrote. The Inbox and anything else stay. */
  async function removeCopies() {
    written ??= await readManifest()
    for (const entry of written.values()) await fs.rm(path.join(notesDir, entry.relative), { force: true })
    written = new Map()
    await fs.rm(path.join(notesDir, MANIFEST), { force: true })
  }

  return { prepare, scan, mirror, removeCopies, status: () => status }
}

module.exports = { createPhoneBridge, mirrorPlan, fileName }
