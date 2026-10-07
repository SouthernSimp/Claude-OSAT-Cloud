/* The quick bar's brain (Phase 13, one bar since 13c): how what is typed is read, how the answers of each source
   (files, the clipboard, apps, commands, notes and nodes, a sum, Nate's keywords) become one list of rows, what
   Return does on a row and what ⌘K offers, and the details shown under the preview. Whatever is typed can also be
   asked (⌘↵) or saved as a sticky (⌥↵): the last two rows say so. The panel (src/surfaces/QuickSearch.jsx) and the
   desk's line use the same rules. Pure. */
import { calculate } from './calc.mjs'
import { groupItems, searchItems, titleOf, whenCopied } from './clipboard-model.mjs'
import { customizable, favoriteRows, keywordAddress, matchKeyword } from './launcher-model.mjs'
import { findSystem, systemRow } from './system-commands.mjs'
import { findLayouts } from './window-layouts.mjs'

/* One source at a time ("See all", a keyword like "v", or a source's Hyper key). Only the sources that are on. */
export const SCOPES = [['all', 'Everything'], ['files', 'Files'], ['clipboard', 'Clipboard'], ['apps', 'Apps'], ['notes', 'Notes'], ['windows', 'Windows']]
const SCOPE_OF_SOURCE = { files: 'files', clipboard: 'clipboard', apps: 'apps', notes: 'notes', windows: 'windows' }

export function scopesOn(settings) {
  return SCOPES.filter(([id]) => id === 'all' || settings.sources[id]?.on)
}

/* Under Files: the kinds, as words the file search already understands (shared/file-query.mjs). */
export const FILE_FILTERS = [['all', 'All', ''], ['pdf', 'PDFs', 'pdf'], ['picture', 'Pictures', 'photos'], ['screenshot', 'Screenshots', 'screenshots'], ['video', 'Videos', 'videos'], ['word', 'Documents', 'word'], ['spreadsheet', 'Sheets', 'spreadsheets'], ['folder', 'Folders', 'folders']]

export function fileWords(query, filter = 'all') {
  const word = FILE_FILTERS.find(([id]) => id === filter)?.[2] || ''
  return `${word} ${String(query || '').trim()}`.trim()
}

/* What was typed, read: which tab it belongs to (a keyword at the start moves to that source), what is
   left to search for, a sum, or one of Nate's own keywords. */
export function readTyped(text, settings, scope = 'all') {
  const typed = String(text || '').trim()
  let where = scope
  let query = typed
  let keyword = null
  // A keyword picks its tab; on that tab already (clicked, or Tab), it is still not part of the words.
  const hit = matchKeyword(settings, typed, { rows: true })
  if (hit?.source && (scope === 'all' || SCOPE_OF_SOURCE[hit.source] === scope)) { where = SCOPE_OF_SOURCE[hit.source] || scope; query = hit.query }
  else if (hit?.keyword && scope === 'all') keyword = hit
  const math = where === 'all' && settings.sources.calc?.on ? calculate(typed) : null
  return { scope: where, query, keyword, math, typed }
}

/* What each source has to be asked for this reading. The desk's own notes are answered on the spot, so
   only the Mac's are here: Spotlight for words (`files`) or the recent files (`recentFiles`), the
   clipboard, and the apps. */
export function wants(read, settings, { fileFilter = 'all' } = {}) {
  const on = (id) => settings.sources[id]?.on === true
  const all = read.scope === 'all'
  const words = read.scope === 'files' ? fileWords(read.query, fileFilter) : read.query
  return {
    files: on('files') && ((read.scope === 'files' && words.length > 0) || (all && read.query.length >= 2)),
    recentFiles: on('files') && ((read.scope === 'files' && words.length === 0) || (all && read.query.length === 0)),
    clipboard: on('clipboard') && (all || read.scope === 'clipboard'),
    apps: on('apps') && (read.scope === 'apps' || (all && read.query.length > 0)),
  }
}

const KINDS = [
  ['pdf', 'PDF document', ['pdf']],
  ['picture', 'Picture', ['jpg', 'jpeg', 'png', 'heic', 'heif', 'gif', 'tif', 'tiff', 'webp', 'bmp', 'svg']],
  ['video', 'Video', ['mov', 'mp4', 'm4v', 'avi', 'mkv']],
  ['audio', 'Audio', ['mp3', 'm4a', 'wav', 'aiff', 'aif', 'flac', 'aac']],
  ['word', 'Word document', ['doc', 'docx', 'pages', 'rtf', 'odt']],
  ['spreadsheet', 'Spreadsheet', ['xls', 'xlsx', 'csv', 'numbers', 'tsv']],
  ['presentation', 'Presentation', ['key', 'ppt', 'pptx']],
  ['archive', 'Zip file', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'dmg']],
  ['note', 'Note', ['md', 'markdown']],
  ['text', 'Text file', ['txt', 'log', 'json', 'xml', 'yaml', 'yml', 'toml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'sh']],
  ['app', 'Application', ['app']],
]

/* What a file is, in words: "PDF document", "Picture", "Folder". */
export function fileKind(name, folder = false) {
  if (folder) return 'Folder'
  const ext = String(name).includes('.') ? String(name).split('.').pop().toLowerCase() : ''
  return KINDS.find(([, , exts]) => exts.includes(ext))?.[1] || (ext && ext.length <= 5 ? `${ext.toUpperCase()} file` : 'File')
}

/* A file whose preview is a picture Quick Look draws; others show their words. */
export const isPicture = (name) => KINDS.find(([id]) => id === 'picture')[2].includes(String(name).split('.').pop().toLowerCase())

export function sizeText(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)) - 1)
  const value = bytes / 1024 ** (index + 1)
  return `${value >= 100 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const fileRow = (item, section) => ({
  key: `file:${item.rootId}:${item.relative}`,
  source: 'files',
  kind: item.kind === 'folder' ? 'folder' : 'file',
  title: item.name,
  subtitle: item.where || item.relative,
  section,
  data: item,
})

const clipRow = (item, now, section) => ({
  key: `clip:${item.id}`,
  source: 'clipboard',
  kind: item.kind,
  title: titleOf(item),
  subtitle: [item.app, whenCopied(item.at, now)].filter(Boolean).join(' · '),
  section,
  data: item,
})

const layoutRow = (layout, keys = {}) => ({ key: `layout:${layout.id}`, source: 'windows', kind: 'layout', title: layout.label, subtitle: layout.id === 'restore' ? 'Where the window was before OSAT moved it' : 'Move the window you were in', section: 'Windows', data: { layout: layout.id, key: keys[layout.id] || null } })
const appRow = (item, section) => ({ key: `app:${item.path}`, source: 'apps', kind: 'app', title: item.name, subtitle: 'Application', section, data: item })

/* The desk's own search (lib/find.js) gives notes, nodes, rooms and actions. */
const noteRow = (item, section) => ({
  key: item.key,
  source: 'notes',
  kind: item.kind === 'note' ? 'note' : item.kind === 'folder' ? 'node' : 'room',
  title: item.label,
  subtitle: item.hint || (item.kind === 'note' ? 'Note' : item.kind === 'folder' ? 'Node' : 'Open'),
  section,
  data: { go: item.go },
})

/* Commands (lib/find.js's rooms and actions) for the bar: one that has the typed word as a whole word of its name or
   its other words comes first ("note" is Write a sticky, "ask" is Ask the AI), an action before a room. */
export function rankCommands(list, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  const whole = (item) => {
    const own = `${item.label} ${item.also || ''}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    return words.length > 0 && words.every((word) => own.includes(word))
  }
  const rank = (item) => (whole(item) ? 0 : 2) + (item.kind === 'action' ? 0 : 1)
  return list.map((item, index) => [rank(item), index, item]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , item]) => item)
}

/* Whenever words are typed on Everything: ask the AI about them (the first row, ⌘↵) and save them as a sticky (the
   last, ⌥↵). `ai` is { state: 'ready' | 'checking' | 'none' | 'waits', label, offline }: 'waits' is offline with no
   AI on this Mac. [ask, sticky] */
export function wordRows(read, ai = { state: 'checking' }) {
  if (read.scope !== 'all' || !read.typed) return []
  const said = {
    ready: ai.offline ? `Offline, the AI on this Mac still answers · ${ai.label}` : ai.label,
    checking: 'Looking for the AI…',
    none: 'Set up the AI first (Settings → AI)',
    waits: 'Offline: asking waits until you’re back online',
  }[ai.state] || ''
  const words = read.typed.length > 48 ? `${read.typed.slice(0, 47)}…` : read.typed
  return [
    { key: 'do:ask', source: 'do', kind: 'ask', title: `Ask AI “${words}”`, subtitle: said, section: 'Ask', data: { text: read.typed, state: ai.state } },
    { key: 'do:sticky', source: 'do', kind: 'sticky', title: 'Save as a sticky', subtitle: 'The AI files it for you', section: 'Write it down', data: { text: read.typed } },
  ]
}

/* Words that read as a question or a request to the AI ("how do I…", "summarize…", "…?"): Return asks. */
const ASKING = /^(who|what|when|where|why|how|which|can|could|should|would|will|is|are|am|do|does|did|was|were|have|has|explain|summari[sz]e|tell me|help me|write|draft|rewrite|translate|compare|give me|list|suggest|plan)\b/i
export const looksLikeQuestion = (typed) => {
  const words = String(typed || '').trim()
  return words.endsWith('?') || (ASKING.test(words) && words.split(/\s+/).length >= 3)
}

/* Where the highlight starts: on Ask when the words are a question or nothing else was found, else on the first
   thing found (Ask stays one ⌘↵ away). */
export function startRow(rows, read) {
  const ask = rows.findIndex((row) => row.kind === 'ask')
  if (ask < 0) return 0
  if (looksLikeQuestion(read.typed)) return ask
  const found = rows.findIndex((row) => row.source !== 'do')
  return found < 0 ? ask : found
}

/* Names that start with the words come first, then words that start a word of the name, then the rest. */
export function rankApps(apps, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...apps].sort((a, b) => a.name.localeCompare(b.name))
  const tier = (name) => {
    const lower = name.toLowerCase()
    if (lower.startsWith(words.join(' '))) return 0
    if (words.every((word) => lower.split(/[^a-z0-9]+/).some((part) => part.startsWith(word)))) return 1
    return words.every((word) => lower.includes(word)) ? 2 : 3
  }
  return apps.filter((app) => tier(app.name) < 3).sort((a, b) => tier(a.name) - tier(b.name) || a.name.localeCompare(b.name))
}

/* One list from what every source answered. `found` is { files, recentFiles, clipboard, apps, commands, notes }
   (each an array; the clipboard is main's list()). Order in Everything: (with `ai`) Ask AI, a sum, Nate's keyword,
   apps named by the words, commands, other apps, files, the clipboard, notes, then Save as a sticky. Nothing typed:
   the latest copies, pinned files, recent files. One source ("See all"), that source alone, at more length. */
export function buildRows(read, found, settings, { now = new Date(), fileFilter = 'all', clipFilter = 'all', ai = null } = {}) {
  const rows = []
  const pins = settings.pins || []
  const isPinned = (item) => pins.some((pin) => pin.rootId === item.rootId && pin.relative === item.relative)
  const files = (list, section) => list.map((item) => ({ ...fileRow(item, section), pinned: isPinned(item) }))

  if (read.math) rows.push({ key: 'calc', source: 'calc', kind: 'calc', title: `= ${read.math.text}`, subtitle: read.typed, section: 'Calculator', data: read.math })
  if (read.keyword) {
    const { keyword, query } = read.keyword
    // Your own word for something (set from ⌘K): that thing, first.
    if (keyword.row) rows.push({ ...favoriteRows({ custom: [{ ...keyword.row, favorite: true }] })[0], section: `Your word “${keyword.keyword}”`, favorite: keyword.row.favorite })
    else if (keyword.app) rows.push({ key: `kw:${keyword.id}`, source: 'keyword', kind: 'keyword-app', title: `Open ${keyword.label}`, subtitle: `${keyword.keyword} · app`, section: 'Apps', data: { app: keyword.app } })
    else rows.push({ key: `kw:${keyword.id}`, source: 'keyword', kind: 'keyword-link', title: keyword.url.includes('{query}') ? `Search ${keyword.label} for “${query}”` : `Open ${keyword.label}`, subtitle: `${keyword.keyword} · web address`, section: 'Quick links', data: { url: keywordAddress(keyword, query) } })
  }

  // Screenshots and recording, and CleanShot's recent captures (shared/capture-model.mjs), only under Everything.
  if (read.scope === 'all') rows.push(...(found.captures || []), ...(found.shots || []))
  if (read.scope === 'all' && /^(emoji|emojis|symbols?|characters?)$/i.test(read.query)) rows.push({ key: 'emoji', source: 'tools', kind: 'emoji', title: 'Emoji & symbols', subtitle: 'Open the Mac’s character picker', section: 'Tools', data: {} })

  const has = read.query.length > 0
  const clipboard = found.clipboard?.items || []
  const clipFound = searchItems(clipboard, read.query, { kind: read.scope === 'clipboard' ? clipFilter : 'all' })

  if (read.scope === 'clipboard') {
    for (const group of groupItems(clipFound, now)) rows.push(...group.items.map((item) => clipRow(item, now, group.label)))
    return rows
  }
  if (read.scope === 'files') {
    if (fileWords(read.query, fileFilter)) rows.push(...files(found.files || [], 'Files'))
    else rows.push(...files(pins, 'Pinned'), ...files(found.recentFiles || [], 'Recent files'))
    return dedupe(rows)
  }
  if (read.scope === 'apps') return [...rows, ...rankApps(found.apps || [], read.query).slice(0, 40).map((item) => appRow(item, 'Apps'))]
  const keys = settings.windows?.on ? settings.windows.hotkeys : {}
  if (read.scope === 'windows') return [...rows, ...findLayouts(read.query).map((layout) => layoutRow(layout, keys))]
  if (read.scope === 'notes') return [...rows, ...(found.notes || []).map((item) => noteRow(item, 'Notes'))]

  // One list, no tabs (Oct 2026): Ask first, then what was found, each source a few rows with "See all" when there's more.
  const more = (scope, count, section) => ({ key: `more:${scope}`, source: 'more', kind: 'more', title: `See all ${count}`, subtitle: section, section, data: { scope } })
  if (has) {
    const [ask, sticky] = ai ? wordRows(read, ai) : []
    if (ask) rows.unshift(ask)
    const apps = rankApps(found.apps || [], read.query).slice(0, 3)
    const named = apps.filter((item) => item.name.toLowerCase().startsWith(read.query.toLowerCase()))
    rows.push(...named.map((item) => appRow(item, 'Apps')))
    rows.push(...(found.commands || []).slice(0, 3).map((item) => noteRow(item, 'Commands')))
    rows.push(...findSystem(read.query).slice(0, 3).map((item) => systemRow(item)))
    rows.push(...apps.filter((item) => !named.includes(item)).map((item) => appRow(item, 'Apps')))
    rows.push(...files(found.files || [], 'Files').slice(0, 6))
    if ((found.files || []).length > 6) rows.push(more('files', 'files', 'Files'))
    rows.push(...clipFound.slice(0, 4).map((item) => clipRow(item, now, 'Clipboard')))
    if (clipFound.length > 4) rows.push(more('clipboard', `${clipFound.length} copies`, 'Clipboard'))
    rows.push(...(found.notes || []).slice(0, 5).map((item) => noteRow(item, 'Notes')))
    // "left half", "max": a layout, when the words are about a window.
    if (settings.sources.windows?.on && read.query.length >= 3) rows.push(...findLayouts(read.query).slice(0, 2).map((layout) => layoutRow(layout, keys)))
    if (sticky) rows.push(sticky)
  } else {
    // Nothing typed: your favorites, then what you copied last, then your pinned and recent files.
    rows.push(...favoriteRows(settings))
    rows.push(...clipboard.slice(0, 6).map((item) => clipRow(item, now, 'Clipboard')))
    if (clipboard.length > 6) rows.push(more('clipboard', `${clipboard.length} copies`, 'Clipboard'))
    rows.push(...files(pins, 'Pinned'))
    rows.push(...files(found.recentFiles || [], 'Recent files').slice(0, 5))
  }
  return markFavorites(dedupe(rows), settings)
}

// A row that is one of your favorites says so (⌘K offers to take it off).
function markFavorites(rows, settings) {
  const favorite = new Set((settings.custom || []).filter((entry) => entry.favorite).map((entry) => entry.key))
  return favorite.size ? rows.map((row) => (favorite.has(row.key) && !row.favorite ? { ...row, favorite: true } : row)) : rows
}

function dedupe(rows) {
  const seen = new Set()
  return rows.filter((row) => !seen.has(row.key) && seen.add(row.key))
}

/* What ⌘K lists for a row; the first is what Return does (⇧↵ the second; ⌘↵ always asks and ⌥↵ always saves a
   sticky, whatever the row). `offer` is a customer the copy could be added to ({ folderId, folderName }). */
export function actionsFor(row, options = {}) {
  const own = ownActions(row, options)
  // Anything that can be a favorite, or have its own key or word, offers it here, so it is done without Settings.
  return customizable(row) ? [...own, { id: 'favorite', label: row.favorite ? 'Remove from favorites' : 'Add to favorites', keys: '⇧⌘F' }, { id: 'set-key', label: 'Set a key…' }, { id: 'set-word', label: 'Set a word…' }] : own
}

function ownActions(row, { offer = null, canAsk = false } = {}) {
  if (!row) return []
  const pin = (on) => ({ id: 'pin', label: on ? 'Unpin' : 'Pin', keys: '⌘P' })
  switch (row.kind) {
    case 'file':
    case 'folder':
      return [
        { id: 'open', label: row.kind === 'folder' ? 'Open in Files' : 'Open', keys: '↵' },
        { id: 'reveal', label: 'Show in Finder', keys: '⇧↵' },
        { id: 'copy-path', label: 'Copy path', keys: '⇧⌘C' },
        ...(canAsk && row.kind === 'file' ? [{ id: 'ask', label: 'Ask about it', keys: '⇧⌘A' }] : []),
        ...(row.kind === 'file' ? [{ id: 'add', label: 'Add to a node…', keys: '⇧⌘N' }] : []),
        pin(row.pinned),
        { id: 'delete', label: 'Delete', hint: 'Moves it to the Bin', keys: '⌘⌫', danger: true },
      ]
    case 'image':
      return [
        { id: 'paste', label: 'Paste', keys: '↵' },
        { id: 'copy', label: 'Copy', keys: '⇧↵' },
        pin(row.data.pinned),
        { id: 'delete', label: 'Delete', hint: 'Forgets this copy', keys: '⌘⌫', danger: true },
      ]
    case 'text': case 'link': case 'email': case 'phone': case 'number':
      return [
        { id: 'paste', label: 'Paste', keys: '↵' },
        { id: 'copy', label: 'Copy', keys: '⇧↵' },
        ...(row.kind === 'link' ? [{ id: 'open-link', label: 'Open the link', keys: '⌘O' }] : []),
        ...(offer ? [{ id: 'offer', label: `Add to ${offer.folderName}`, hint: 'As a sticky in that node', keys: '⇧⌘N' }] : []),
        { id: 'add', label: 'Add to a node…', ...(offer ? {} : { keys: '⇧⌘N' }) },
        pin(row.data.pinned),
        { id: 'delete', label: 'Delete', hint: 'Forgets this copy', keys: '⌘⌫', danger: true },
      ]
    case 'emoji': return [{ id: 'emoji', label: 'Open', keys: '↵' }]
    case 'capture': return [{ id: 'capture', label: row.data?.capture === 'history' ? 'Open' : 'Start', keys: '↵' }]
    case 'shot': return [
      { id: 'shot-open', label: 'Open', keys: '↵' },
      { id: 'shot-reveal', label: 'Show in Finder', keys: '⇧↵' },
      ...(/\.(mp4|mov|gif)$/i.test(row.title) ? [] : [{ id: 'shot-copy', label: 'Copy', keys: '⇧⌘C' }]),
    ]
    case 'app': return [{ id: 'open-app', label: 'Open', keys: '↵' }, { id: 'reveal-app', label: 'Show in Finder', keys: '⇧↵' }]
    case 'note': return [{ id: 'go', label: 'Open', keys: '↵' }]
    case 'node': return [{ id: 'go', label: 'Open in the Sky', keys: '↵' }]
    case 'room': return [{ id: 'go', label: 'Open', keys: '↵' }]
    case 'calc': return [{ id: 'copy-text', label: 'Copy the answer', keys: '↵' }, { id: 'paste-text', label: 'Paste the answer', keys: '⇧↵' }]
    case 'sticky': return [{ id: 'sticky', label: 'Save as a sticky', keys: '↵' }]
    case 'ask': return [{ id: 'ask-ai', label: 'Ask', keys: '↵' }]
    case 'more': return [{ id: 'scope', label: 'Show all', keys: '↵' }]
    case 'system': return [{ id: 'system', label: row.title, keys: '↵' }]
    case 'keyword-app': return [{ id: 'open-app-named', label: 'Open', keys: '↵' }]
    case 'keyword-link': return [{ id: 'open-link', label: 'Open in your browser', keys: '↵' }]
    case 'layout': return [{ id: 'snap', label: row.data?.layout === 'restore' ? 'Put the window back' : 'Move the window', keys: '↵' }]
    default: return []
  }
}

/* Under the preview: [label, value] lines. */
export function detailsFor(row, { now = new Date() } = {}) {
  if (!row) return []
  const d = row.data || {}
  switch (row.kind) {
    case 'file': case 'folder':
      return [
        ['Where', d.where || d.relative],
        ['Kind', fileKind(d.name, row.kind === 'folder')],
        ...(row.kind === 'file' && Number.isFinite(d.size) ? [['Size', sizeText(d.size)]] : []),
        ...(d.modifiedAt ? [['Changed', DAY.format(new Date(d.modifiedAt))]] : []),
      ]
    case 'image': return [['Kind', 'Image'], ...(d.image?.w ? [['Size', `${d.image.w} × ${d.image.h}`]] : []), ...(d.app ? [['From', d.app]] : []), ['Copied', whenCopied(d.at, now)]]
    case 'text': case 'link': case 'email': case 'phone': case 'number':
      return [['Kind', { text: 'Text', link: 'Link', email: 'Email address', phone: 'Phone number', number: 'Number' }[row.kind]], ...(d.app ? [['From', d.app]] : []), ['Copied', whenCopied(d.at, now)], ...(d.chars > 1 ? [['Length', `${d.chars.toLocaleString('en-US')} characters`]] : [])]
    case 'layout': return [['Moves', 'the window you were in'], ...(d.key ? [['Key', d.key.split('+').map((part) => ({ Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘' }[part] || part)).join('')]] : [])]
    case 'app': return [['Kind', 'Application'], ['Where', d.path]]
    case 'capture': return [['With', row.subtitle.replace(/^With /, '')]]
    case 'shot': return [['Kind', /\.(mp4|mov|gif)$/i.test(d.name) ? 'Recording' : 'Screenshot'], ['Taken', DAY.format(new Date(d.at))], ['Kept by', 'CleanShot X']]
    case 'note': return [['Kind', 'Note'], ['Where', row.subtitle]]
    case 'node': return [['Kind', 'Node'], ['Where', row.subtitle]]
    case 'system': return [['Does', row.title], ['Undo', row.subtitle === 'Can’t be undone' ? 'Can’t be undone' : 'Do it again to switch back']]
    default: return []
  }
}
