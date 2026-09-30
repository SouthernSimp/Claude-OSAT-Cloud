/* The quick search's brain (Phase 13): how what is typed is read, how the answers of each source
   (files, the clipboard, apps, notes and nodes, a sum, Nate's keywords) become one list of rows, what
   Return does on a row and what ⌘K offers, and the details shown under the preview. The panel
   (src/surfaces/QuickSearch.jsx) and the desk's line use the same rules. Pure. */
import { calculate } from './calc.mjs'
import { groupItems, searchItems, titleOf, whenCopied } from './clipboard-model.mjs'
import { keywordAddress, matchKeyword } from './launcher-model.mjs'
import { findLayouts } from './window-layouts.mjs'

/* The tabs under the field. Only the sources that are on show. */
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
  const hit = matchKeyword(settings, typed)
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

/* One list from what every source answered. `found` is { files, recentFiles, clipboard, apps, notes }
   (each an array; the clipboard is main's list()). Order in Everything: a sum, Nate's keyword, then
   apps, files, the clipboard, notes. Under one tab, that source alone, at more length. */
export function buildRows(read, found, settings, { now = new Date(), fileFilter = 'all', clipFilter = 'all' } = {}) {
  const rows = []
  const pins = settings.pins || []
  const isPinned = (item) => pins.some((pin) => pin.rootId === item.rootId && pin.relative === item.relative)
  const files = (list, section) => list.map((item) => ({ ...fileRow(item, section), pinned: isPinned(item) }))

  if (read.math) rows.push({ key: 'calc', source: 'calc', kind: 'calc', title: `= ${read.math.text}`, subtitle: read.typed, section: 'Calculator', data: read.math })
  if (read.keyword) {
    const { keyword, query } = read.keyword
    if (keyword.app) rows.push({ key: `kw:${keyword.id}`, source: 'keyword', kind: 'keyword-app', title: `Open ${keyword.label}`, subtitle: `${keyword.keyword} · app`, section: 'Keywords', data: { app: keyword.app } })
    else rows.push({ key: `kw:${keyword.id}`, source: 'keyword', kind: 'keyword-link', title: `Search ${keyword.label} for “${query}”`, subtitle: `${keyword.keyword} · web address`, section: 'Keywords', data: { url: keywordAddress(keyword, query) } })
  }

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

  if (has) {
    rows.push(...rankApps(found.apps || [], read.query).slice(0, 3).map((item) => appRow(item, 'Apps')))
    rows.push(...files(found.files || [], 'Files').slice(0, 6))
    rows.push(...clipFound.slice(0, 4).map((item) => clipRow(item, now, 'Clipboard')))
    rows.push(...(found.notes || []).slice(0, 5).map((item) => noteRow(item, 'Notes')))
    // "left half", "max": a layout, when the words are about a window.
    if (settings.sources.windows?.on && read.query.length >= 3) rows.push(...findLayouts(read.query).slice(0, 2).map((layout) => layoutRow(layout, keys)))
  } else {
    rows.push(...files(pins, 'Pinned'))
    rows.push(...files(found.recentFiles || [], 'Recent files').slice(0, 5))
    rows.push(...clipboard.slice(0, 5).map((item) => clipRow(item, now, 'Clipboard')))
  }
  return dedupe(rows)
}

function dedupe(rows) {
  const seen = new Set()
  return rows.filter((row) => !seen.has(row.key) && seen.add(row.key))
}

/* What ⌘K lists for a row; the first is what Return does. `offer` is a customer the copy could be
   added to ({ folderId, folderName }). */
export function actionsFor(row, { offer = null, canAsk = false } = {}) {
  if (!row) return []
  const pin = (on) => ({ id: 'pin', label: on ? 'Unpin' : 'Pin', keys: '⌘P' })
  switch (row.kind) {
    case 'file':
    case 'folder':
      return [
        { id: 'open', label: row.kind === 'folder' ? 'Open in Files' : 'Open', keys: '↵' },
        { id: 'reveal', label: 'Show in Finder', keys: '⌘↵' },
        { id: 'copy-path', label: 'Copy path', keys: '⇧⌘C' },
        ...(canAsk && row.kind === 'file' ? [{ id: 'ask', label: 'Ask about it', keys: '⇧⌘A' }] : []),
        ...(row.kind === 'file' ? [{ id: 'add', label: 'Add to a node…', keys: '⇧⌘N' }] : []),
        pin(row.pinned),
        { id: 'delete', label: 'Delete', hint: 'Moves it to the Bin', keys: '⌘⌫', danger: true },
      ]
    case 'image':
      return [
        { id: 'paste', label: 'Paste', keys: '↵' },
        { id: 'copy', label: 'Copy', keys: '⌘↵' },
        pin(row.data.pinned),
        { id: 'delete', label: 'Delete', hint: 'Forgets this copy', keys: '⌘⌫', danger: true },
      ]
    case 'text': case 'link': case 'email': case 'phone': case 'number':
      return [
        { id: 'paste', label: 'Paste', keys: '↵' },
        { id: 'copy', label: 'Copy', keys: '⌘↵' },
        ...(row.kind === 'link' ? [{ id: 'open-link', label: 'Open the link', keys: '⌘O' }] : []),
        ...(offer ? [{ id: 'offer', label: `Add to ${offer.folderName}`, hint: 'As a sticky in that node', keys: '⇧⌘N' }] : []),
        { id: 'add', label: 'Add to a node…', ...(offer ? {} : { keys: '⇧⌘N' }) },
        pin(row.data.pinned),
        { id: 'delete', label: 'Delete', hint: 'Forgets this copy', keys: '⌘⌫', danger: true },
      ]
    case 'app': return [{ id: 'open-app', label: 'Open', keys: '↵' }, { id: 'reveal-app', label: 'Show in Finder', keys: '⌘↵' }]
    case 'note': return [{ id: 'go', label: 'Open', keys: '↵' }]
    case 'node': return [{ id: 'go', label: 'Open in the Sky', keys: '↵' }]
    case 'room': return [{ id: 'go', label: 'Open', keys: '↵' }]
    case 'calc': return [{ id: 'copy-text', label: 'Copy the answer', keys: '↵' }, { id: 'paste-text', label: 'Paste the answer', keys: '⌘↵' }]
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
    case 'note': return [['Kind', 'Note'], ['Where', row.subtitle]]
    case 'node': return [['Kind', 'Node'], ['Where', row.subtitle]]
    default: return []
  }
}
