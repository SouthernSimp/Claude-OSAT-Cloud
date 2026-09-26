/* The shape of the workspace. The store (shared/store-core.mjs) keeps it as
   plain JSON; this file turns whatever is stored into a well-formed workspace
   the views can rely on. Opening a window runs it once; only real differences
   are written back. */
import { createEmptyDoc, migrate, SCHEMA } from '../shared/store-core.mjs'
import { normalizeChat } from './assistant/chats.js'
import { normalizeHabits, normalizeReflections } from './daily-practice.js'
import { normalizeFocusSession } from './focus-session.js'
import { normalizeNote, parseTags } from './note-core.js'
import { normalizeFolders } from './notes-model.js'
import { normalizeBoardDoc, reconcileBoards } from './board-model.js'

export { normalizeNote, parseTags }

export const BACKUP_FORMAT = 'osat-backup'

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

function cleanString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeProjects(value) {
  return (Array.isArray(value) ? value : []).flatMap((project) => {
    if (!isObject(project) || !cleanString(project.title).trim()) return []
    return [{
      id: cleanString(project.id) || uid('project'),
      title: project.title,
      summary: cleanString(project.summary),
      status: ['active', 'paused', 'done'].includes(project.status) ? project.status : 'active',
      url: safeHttpUrl(project.url) || '',
      folder: cleanString(project.folder),
      folderGrantId: cleanString(project.folderGrantId),
      createdAt: cleanString(project.createdAt, new Date().toISOString()),
    }]
  })
}

function normalizeBudget(value) {
  const input = isObject(value) ? value : {}
  const cleanEntry = (entry, recurring = false) => {
    if (!isObject(entry) || !Number.isSafeInteger(entry.amountMinor) || !cleanString(entry.label).trim()) return null
    return {
      id: cleanString(entry.id) || uid(recurring ? 'recurring' : 'transaction'),
      label: entry.label.trim(),
      amountMinor: entry.amountMinor,
      category: cleanString(entry.category, 'Uncategorized').trim() || 'Uncategorized',
      date: cleanString(entry.date, new Date().toISOString().slice(0, 10)),
      ...(recurring ? { cadence: ['weekly', 'monthly', 'yearly'].includes(entry.cadence) ? entry.cadence : 'monthly' } : {}),
    }
  }
  return {
    currency: 'USD',
    transactions: (Array.isArray(input.transactions) ? input.transactions : []).map((entry) => cleanEntry(entry)).filter(Boolean),
    recurring: (Array.isArray(input.recurring) ? input.recurring : []).map((entry) => cleanEntry(entry, true)).filter(Boolean),
  }
}

function normalizeCalendar(value) {
  const input = isObject(value) ? value : {}
  return {
    events: (Array.isArray(input.events) ? input.events : []).flatMap((event) => {
      if (!isObject(event) || !cleanString(event.title).trim() || !cleanString(event.start)) return []
      return [{
        id: cleanString(event.id) || uid('event'),
        title: event.title.trim(),
        start: event.start,
        end: cleanString(event.end),
        notes: cleanString(event.notes),
      }]
    }),
  }
}

export function createDefaultWorkspace() {
  return normalizeWorkspace(createEmptyDoc())
}

export function normalizeWorkspace(value) {
  const input = isObject(value) ? value : {}
  const folders = normalizeFolders(input.folders)
  const folderIds = new Set(folders.map((folder) => folder.id))
  const seenNotes = new Set()
  const notes = (Array.isArray(input.notes) ? input.notes : []).map(normalizeNote).filter((note) => note && !seenNotes.has(note.id) && seenNotes.add(note.id))
    .map((note) => note.folderId && !folderIds.has(note.folderId) ? { ...note, folderId: null } : note)
  const state = {
    schema: SCHEMA,
    rev: Number.isInteger(input.rev) ? input.rev : 0,
    theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
    habits: normalizeHabits(input.habits),
    reflections: normalizeReflections(input.reflections),
    focus: normalizeFocusSession(input.focus),
    notes,
    folders,
    projects: normalizeProjects(input.projects),
    budget: normalizeBudget(input.budget),
    calendar: normalizeCalendar(input.calendar),
    settings: isObject(input.settings) ? input.settings : {},
    chats: (Array.isArray(input.chats) ? input.chats : []).map(normalizeChat).filter(Boolean),
    sorter: null,
  }
  state.sorter = reconcileBoards({ ...state, sorter: normalizeBoardDoc(input.sorter) })
  return state
}

/* A backup is the whole workspace in a small envelope. Reject damaged input
   before normalizing, so a broken file can't quietly become an empty workspace. */
export function makeBackup(workspace, exportedAt = new Date().toISOString()) {
  const { rev, ...rest } = workspace
  return { format: BACKUP_FORMAT, version: 1, exportedAt, workspace: rest }
}

export function readWorkspaceBackup(payload) {
  const raw = payload?.workspace
  const lists = ['notes', 'folders', 'projects', 'habits', 'chats']
  // Backups from an earlier schema are upgraded; ones from a newer OSAT are refused.
  const input = isObject(raw) && Number.isInteger(raw.schema) && raw.schema <= SCHEMA ? migrate(raw) : null
  if (payload?.format !== BACKUP_FORMAT || payload.version !== 1 || !isObject(input)
    || lists.some((key) => input[key] !== undefined && (!Array.isArray(input[key]) || input[key].some((item) => !isObject(item))))
    || !Array.isArray(input.notes)
    || (input.sorter != null && (!isObject(input.sorter) || !Array.isArray(input.sorter.boards)))) {
    throw new Error('This backup is incomplete, damaged, or from an unsupported version. Your workspace has not changed.')
  }
  const ids = new Set()
  for (const note of input.notes) {
    if (typeof note.id !== 'string' || !note.id || ids.has(note.id) || typeof note.markdown !== 'string') {
      throw new Error('This backup contains damaged or duplicate notes. Your workspace has not changed.')
    }
    ids.add(note.id)
  }
  return normalizeWorkspace(input)
}

export function parseMoneyToMinor(value) {
  const normalized = String(value ?? '').trim().replace(/[$,\s]/g, '')
  if (!/^[+-]?(?:\d+|\d*\.\d{1,2})$/.test(normalized)) return null
  const sign = normalized.startsWith('-') ? -1 : 1
  const unsigned = normalized.replace(/^[+-]/, '')
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) ? minor * sign : null
}

export function formatMinor(amountMinor, currency = 'USD') {
  if (!Number.isSafeInteger(amountMinor)) return 'Not set'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100)
}

export function parseBudgetCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  const raw = String(text || '').replace(/^\uFEFF/, '')
  for (let index = 0; index <= raw.length; index += 1) {
    const character = raw[index] ?? '\n'
    if (quoted) {
      if (character === '"' && raw[index + 1] === '"') { field += '"'; index += 1 }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n') { row.push(field); if (row.some((cell) => cell.trim())) rows.push(row); row = []; field = '' }
    else if (character !== '\r') field += character
  }
  if (quoted) return { rows: [], errors: ['CSV contains an unterminated quoted field.'] }
  if (!rows.length) return { rows: [], errors: ['No rows found.'] }
  const header = rows[0].map((cell) => cell.trim().toLowerCase())
  const indexOf = (...names) => names.map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1
  const dateIndex = indexOf('date')
  const labelIndex = indexOf('label', 'description', 'name')
  const amountIndex = indexOf('amount', 'value')
  const categoryIndex = indexOf('category')
  if (dateIndex < 0 || labelIndex < 0 || amountIndex < 0) return { rows: [], errors: ['CSV needs date, label (or description), and amount columns.'] }
  const parsed = [], errors = []
  rows.slice(1).forEach((cells, index) => {
    const line = index + 2
    const amountMinor = parseMoneyToMinor(cells[amountIndex])
    const date = cleanString(cells[dateIndex]).trim()
    const label = cleanString(cells[labelIndex]).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !label || amountMinor === null) {
      errors.push(`Line ${line} needs a YYYY-MM-DD date, label, and amount with at most two decimals.`)
      return
    }
    parsed.push({ id: uid('transaction'), date, label, amountMinor, category: cleanString(cells[categoryIndex], 'Uncategorized').trim() || 'Uncategorized' })
  })
  return { rows: parsed, errors }
}

export function safeHttpUrl(value) {
  const raw = cleanString(value).trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function icsEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function icsDate(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') : ''
}

export function calendarToIcs(events) {
  const stamp = icsDate(new Date().toISOString())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OSAT//Local Calendar//EN', 'CALSCALE:GREGORIAN']
  ;(Array.isArray(events) ? events : []).forEach((event) => {
    const start = icsDate(event.start)
    if (!start || !event.title) return
    lines.push('BEGIN:VEVENT', `UID:${icsEscape(event.id || uid('event'))}@osat.local`, `DTSTAMP:${stamp}`, `DTSTART:${start}`)
    const end = icsDate(event.end)
    if (end) lines.push(`DTEND:${end}`)
    lines.push(`SUMMARY:${icsEscape(event.title)}`)
    if (event.notes) lines.push(`DESCRIPTION:${icsEscape(event.notes)}`)
    lines.push('END:VEVENT')
  })
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}
