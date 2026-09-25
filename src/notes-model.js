/* Notes organization: folders, wikilinks, backlinks, smart lists, outline.
   Pure functions over the workspace so the views stay thin and the logic is
   testable without a browser. */

import { normalizeNote, parseTags } from './note-core.js'

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const clean = (value, fallback = '') => (typeof value === 'string' ? value : fallback)
export const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

/* ---------- folders ---------- */

export function normalizeFolders(value) {
  const seen = new Set()
  const folders = (Array.isArray(value) ? value : []).flatMap((folder) => {
    if (!isObject(folder) || !clean(folder.id) || !clean(folder.name).trim() || seen.has(folder.id)) return []
    seen.add(folder.id)
    return [{
      id: folder.id,
      name: folder.name.trim().slice(0, 80),
      parentId: clean(folder.parentId) || null,
      createdAt: clean(folder.createdAt, new Date().toISOString()),
      collapsed: Boolean(folder.collapsed),
      color: clean(folder.color) || null,
    }]
  })
  // A parent must exist and must not create a cycle; otherwise the folder moves to the root.
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  folders.forEach((folder) => {
    if (folder.parentId === folder.id || !byId.has(folder.parentId)) { folder.parentId = null; return }
    const visited = new Set([folder.id])
    let cursor = folder.parentId
    while (cursor) {
      if (visited.has(cursor)) { folder.parentId = null; break }
      visited.add(cursor)
      cursor = byId.get(cursor)?.parentId || null
    }
  })
  return folders
}

export function createFolder(name, parentId = null) {
  const cleanName = clean(name).trim().slice(0, 80)
  if (!cleanName) return null
  return { id: uid('folder'), name: cleanName, parentId: parentId || null, createdAt: new Date().toISOString(), collapsed: false, color: null }
}

export function folderChildren(folders, parentId = null) {
  return folders.filter((folder) => (folder.parentId || null) === (parentId || null))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/* Every folder id inside `folderId`, itself included. */
export function folderSubtree(folders, folderId) {
  const ids = new Set([folderId])
  let grew = true
  while (grew) {
    grew = false
    folders.forEach((folder) => {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); grew = true }
    })
  }
  return ids
}

export function folderPath(folders, folderId) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const names = []
  let cursor = byId.get(folderId)
  const guard = new Set()
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id)
    names.unshift(cursor.name)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null
  }
  return names
}

/* Depth-first flattening for a tree list: [{ folder, depth }]. */
export function folderTree(folders, parentId = null, depth = 0) {
  return folderChildren(folders, parentId).flatMap((folder) => [
    { folder, depth },
    ...(folder.collapsed ? [] : folderTree(folders, folder.id, depth + 1)),
  ])
}

export function canMoveFolder(folders, folderId, targetParentId) {
  if (!targetParentId) return true
  if (folderId === targetParentId) return false
  return !folderSubtree(folders, folderId).has(targetParentId)
}

/* Deleting a folder keeps its notes: they move to the parent (or the root). */
export function deleteFolder(state, folderId) {
  const folder = state.folders.find((item) => item.id === folderId)
  if (!folder) return state
  const removed = folderSubtree(state.folders, folderId)
  return {
    ...state,
    folders: state.folders.filter((item) => !removed.has(item.id)),
    notes: state.notes.map((note) => removed.has(note.folderId) ? { ...note, folderId: folder.parentId || null } : note),
  }
}

/* ---------- note status ---------- */

export const isActiveNote = (note) => Boolean(note) && !note.trashedAt && !note.archived
export const isVisibleNote = (note) => Boolean(note) && !note.trashedAt

export function noteCounts(state) {
  const active = state.notes.filter(isActiveNote)
  return {
    all: active.length,
    pinned: active.filter((note) => note.pinned).length,
    unfiled: active.filter((note) => !note.folderId).length,
    daily: active.filter(isDailyNote).length,
    archived: state.notes.filter((note) => note.archived && !note.trashedAt).length,
    trashed: state.notes.filter((note) => note.trashedAt).length,
  }
}

export const DAILY_ID = /^daily-plan-(\d{4}-\d{2}-\d{2})$/
export const isDailyNote = (note) => DAILY_ID.test(note?.id || '')
export const dailyNoteId = (dateKey) => `daily-plan-${dateKey}`

export function dailyNoteFor(state, dateKey, folderId = null) {
  const existing = state.notes.find((note) => note.id === dailyNoteId(dateKey))
  if (existing) return { state, note: existing, created: false }
  const label = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${dateKey}T12:00:00`))
  const note = normalizeNote({
    id: dailyNoteId(dateKey),
    title: `Today’s next steps`,
    tags: ['today'],
    markdown: `# ${label}\n\n- [ ] `,
    folderId,
  })
  return { state: { ...state, notes: [note, ...state.notes] }, note, created: true }
}

/* ---------- wikilinks ---------- */

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g

export function parseWikilinks(markdown) {
  const targets = [], seen = new Set()
  for (const match of String(markdown || '').matchAll(WIKILINK)) {
    const target = match[1].trim()
    const key = target.toLowerCase()
    if (target && !seen.has(key)) { seen.add(key); targets.push(target) }
  }
  return targets
}

const titleKey = (title) => String(title || '').trim().toLowerCase()

export function resolveWikilink(notes, target) {
  const key = titleKey(target)
  if (!key) return null
  return notes.filter(isVisibleNote).find((note) => titleKey(note.title) === key) || null
}

/* Which notes mention this one by title? Sorted newest first. */
export function backlinks(notes, note) {
  if (!note) return []
  const key = titleKey(note.title)
  if (!key) return []
  return notes
    .filter((other) => other.id !== note.id && isVisibleNote(other) && parseWikilinks(other.markdown).some((target) => titleKey(target) === key))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export function outgoingLinks(notes, note) {
  if (!note) return []
  return parseWikilinks(note.markdown).map((target) => ({ target, note: resolveWikilink(notes, target) }))
}

/* Pairs of note ids joined by wikilinks in either direction (deduplicated). */
export function wikilinkPairs(notes) {
  const pairs = new Map()
  const visible = notes.filter(isVisibleNote)
  visible.forEach((note) => {
    parseWikilinks(note.markdown).forEach((target) => {
      const other = resolveWikilink(visible, target)
      if (!other || other.id === note.id) return
      const key = [note.id, other.id].sort().join('|')
      if (!pairs.has(key)) pairs.set(key, { a: note.id, b: other.id })
    })
  })
  return [...pairs.values()]
}

/* Renaming a note rewrites [[Old title]] mentions so links keep pointing at it. */
export function renameWikilinks(notes, oldTitle, newTitle) {
  const key = titleKey(oldTitle)
  const next = String(newTitle || '').trim()
  if (!key || !next || key === titleKey(next)) return notes
  return notes.map((note) => {
    if (typeof note.markdown !== 'string' || !note.markdown.includes('[[')) return note
    const markdown = note.markdown.replace(WIKILINK, (whole, target, alias) => {
      if (titleKey(target) !== key) return whole
      return `[[${next}${alias !== undefined ? `|${alias}` : ''}]]`
    })
    return markdown === note.markdown ? note : { ...note, markdown }
  })
}

/* ---------- lists, search, sort ---------- */

export const SMART_LISTS = [
  ['all', 'All notes'],
  ['pinned', 'Pinned'],
  ['recent', 'Recent'],
  ['daily', 'Daily notes'],
  ['unfiled', 'Unfiled'],
  ['archived', 'Archive'],
  ['trash', 'Trash'],
]

export function notesInList(state, list, folderId = null, now = Date.now()) {
  const { notes, folders } = state
  if (list === 'trash') return notes.filter((note) => note.trashedAt)
  if (list === 'archived') return notes.filter((note) => note.archived && !note.trashedAt)
  const active = notes.filter(isActiveNote)
  if (list === 'folder' && folderId) {
    const scope = folderSubtree(folders, folderId)
    return active.filter((note) => scope.has(note.folderId))
  }
  if (list === 'pinned') return active.filter((note) => note.pinned)
  if (list === 'recent') return active.filter((note) => now - Date.parse(note.updatedAt) < 7 * 86400000)
  if (list === 'daily') return active.filter(isDailyNote)
  if (list === 'unfiled') return active.filter((note) => !note.folderId)
  return active
}

/* Query grammar: free words match title/body; `#tag` requires the tag. */
export function parseQuery(query) {
  const tags = [], words = []
  String(query || '').split(/\s+/).filter(Boolean).forEach((token) => {
    if (token.startsWith('#') && token.length > 1) tags.push(token.slice(1).toLowerCase())
    else words.push(token.toLowerCase())
  })
  return { tags, words }
}

export function searchNotes(notes, query, tagFilter = []) {
  const { tags, words } = parseQuery(query)
  const required = [...new Set([...tags, ...tagFilter.map((tag) => tag.toLowerCase())])]
  return notes.filter((note) => {
    if (required.some((tag) => !note.tags.includes(tag))) return false
    if (!words.length) return true
    const haystack = `${note.title}\n${note.markdown}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export const SORTS = [['updated', 'Last edited'], ['created', 'Date created'], ['title', 'Title']]

export function sortNotes(notes, sort = 'updated') {
  const list = [...notes]
  const byTime = (field) => (a, b) => String(b[field]).localeCompare(String(a[field]))
  if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  else if (sort === 'created') list.sort(byTime('createdAt'))
  else list.sort(byTime('updatedAt'))
  // Pinned notes float, in the chosen order.
  return [...list.filter((note) => note.pinned), ...list.filter((note) => !note.pinned)]
}

export function tagIndex(notes) {
  const counts = new Map()
  notes.filter(isActiveNote).forEach((note) => note.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)))
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }))
}

/* ---------- reading a note ---------- */

export function outline(markdown) {
  const items = []
  let fence = false
  String(markdown || '').split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return }
    if (fence) return
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (match) items.push({ level: match[1].length, text: match[2], line: index })
  })
  return items
}

export function wordCount(markdown) {
  const words = String(markdown || '').replace(/[`*_>#\[\]()-]/g, ' ').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word))
  return words.length
}

export function excerpt(markdown, length = 110) {
  const text = String(markdown || '')
    .replace(/^#{1,6}\s+.*$/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, alias) => alias || target)
    .replace(/(^|[^\p{L}\p{N}_-])#[\p{L}\p{N}_-]+/gu, '$1') // tags are shown as chips, not prose
    .replace(/[*_`>#~]/g, '')
    .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/gm, '☐ ')
    .replace(/^\s*[-+*]\s+/gm, '• ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

/* ---------- mutations ---------- */

export function createNote(state, patch = {}) {
  const now = new Date().toISOString()
  const note = normalizeNote({ id: uid('note'), title: 'Untitled note', markdown: '', createdAt: now, updatedAt: now, ...patch })
  return { state: { ...state, notes: [note, ...state.notes] }, note }
}

/* Capture is a note immediately. Inbox keeps its original text and review state. */
export function noteFromCapture(state, capture) {
  const existing = state.notes.find((note) => note.originCaptureId === capture.id)
  if (existing) return { state, note: existing }
  const markdown = capture.summary && capture.summary !== capture.title
    ? `${capture.title}\n\n${capture.summary}` : capture.title
  return createNote(state, {
    title: capture.title.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'A thought',
    markdown, originCaptureId: capture.id,
  })
}

export function captureThought(state, text, source = 'Quick capture') {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value) return { state, note: null }
  const capture = { id: uid('capture'), title: value, summary: value, source,
    createdAt: new Date().toISOString(), type: 'capture', status: 'inbox', bookmarked: false }
  return noteFromCapture({ ...state, capture, records: [capture, ...state.records] }, capture)
}

export function updateNote(state, id, patch) {
  const now = new Date().toISOString()
  const before = state.notes.find((note) => note.id === id)
  if (!before) return state
  const nextTitle = patch.title ?? before.title
  const nextMarkdown = patch.markdown ?? before.markdown
  let notes = state.notes.map((note) => note.id === id
    ? { ...note, ...patch, tags: parseTags(`${nextTitle}\n${nextMarkdown}`), updatedAt: now }
    : note)
  if (patch.title !== undefined && patch.title.trim() && patch.title.trim() !== before.title.trim()) {
    notes = renameWikilinks(notes, before.title, patch.title)
  }
  return { ...state, notes }
}

export function trashNotes(state, ids) {
  const set = new Set(ids), now = new Date().toISOString()
  return { ...state, notes: state.notes.map((note) => set.has(note.id) ? { ...note, trashedAt: now, pinned: false } : note) }
}

export function restoreNotes(state, ids) {
  const set = new Set(ids)
  return { ...state, notes: state.notes.map((note) => set.has(note.id) ? { ...note, trashedAt: null } : note) }
}

export function purgeNotes(state, ids) {
  const set = new Set(ids)
  return { ...state, notes: state.notes.filter((note) => !set.has(note.id)) }
}

export function emptyTrash(state) {
  return { ...state, notes: state.notes.filter((note) => !note.trashedAt) }
}

export function moveNotes(state, ids, folderId) {
  const set = new Set(ids)
  const target = folderId && state.folders.some((folder) => folder.id === folderId) ? folderId : null
  return { ...state, notes: state.notes.map((note) => set.has(note.id) ? { ...note, folderId: target } : note) }
}

export function duplicateNote(state, id) {
  const source = state.notes.find((note) => note.id === id)
  if (!source) return { state, note: null }
  return createNote(state, { ...source, id: undefined, title: `${source.title} copy`, pinned: false, createdAt: undefined, updatedAt: undefined })
}
