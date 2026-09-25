import { normalizeHabits, normalizeReflections } from './daily-practice.js'
import { normalizeFocusSession } from './focus-session.js'
import { normalizeNote, parseTags } from './note-core.js'
import { normalizeFolders } from './notes-model.js'
import { reconcileBoards } from './board-model.js'

export { normalizeNote, parseTags }

export const CANONICAL_SCHEMA = 2
export const CANONICAL_DB_NAME = 'osat-field-local-v1'
export const CANONICAL_STORE_NAME = 'workspace'
export const CANONICAL_RECORD_KEY = 'primary'

export const LEGACY_KEYS = {
  capture: 'nateos.capture',
  records: 'nateos.records.v1',
  savedIds: 'nateos.saved.ids',
  savedLegacy: 'nateos.saved',
  canvas: 'nateos.canvas.v1',
  theme: 'nateos.theme',
  habits: 'nateos.habits.v1',
  habitsWeekly: 'nateos.habits.v1w',
  reflections: 'nateos.reflections.v1',
  focus: 'nateos.focus.v1',
  notes: 'nateos.notes.v1',
  budget: 'nateos.budget.v1',
  calendar: 'nateos.calendar.v1',
  projects: 'nateos.projects.v1',
  mindmap: 'nateos.mindmap.v1',
}

const DEFAULT_CAPTURE = {
  id: 'seed-capture',
  title: 'Design a calmer way to turn conversations into knowledge I can use.',
  summary: 'Turn conversations into knowledge I can use.',
  source: 'Private note',
  createdAt: '2026-08-01T17:00:00.000Z',
}

const DEFAULT_PROJECT = {
  id: 'nateos',
  title: 'OSAT',
  summary: 'Private, local-first workspace',
  status: 'active',
  url: '',
  folder: '',
  folderGrantId: '',
  createdAt: '2026-08-01T17:00:00.000Z',
}

const NOTE_COLORS = ['paper', 'mint', 'sky', 'sand', 'rose', 'lilac']

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function cleanString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeCapture(value) {
  if (!isObject(value) || !cleanString(value.title).trim()) return { ...DEFAULT_CAPTURE }
  return {
    id: cleanString(value.id, uid('capture')),
    title: value.title,
    summary: cleanString(value.summary, value.title),
    source: cleanString(value.source, 'Private note'),
    createdAt: cleanString(value.createdAt, new Date().toISOString()),
  }
}

function normalizeRecords(value, capture) {
  const records = Array.isArray(value) ? value.flatMap((record) => {
    if (!isObject(record) || !cleanString(record.id)) return []
    if (record.type === 'capture' && cleanString(record.title).trim()) {
      return [{
        ...normalizeCapture(record),
        type: 'capture',
        status: ['inbox', 'parked', 'idea'].includes(record.status) ? record.status : 'inbox',
        bookmarked: Boolean(record.bookmarked),
      }]
    }
    if (record.type === 'journal' && cleanString(record.title).trim()) {
      return [{
        id: record.id,
        type: 'journal',
        title: record.title,
        summary: cleanString(record.summary),
        body: cleanString(record.body),
        createdAt: cleanString(record.createdAt, new Date().toISOString()),
        built: Array.isArray(record.built) ? record.built.filter((item) => typeof item === 'string') : [],
      }]
    }
    return []
  }) : []
  if (!records.some((record) => record.id === capture.id)) {
    records.unshift({ ...capture, type: 'capture', status: 'inbox', bookmarked: false })
  }
  return records
}

function normalizeProjects(value) {
  const projects = Array.isArray(value) ? value.flatMap((project) => {
    if (!isObject(project) || !cleanString(project.title).trim()) return []
    return [{
      id: cleanString(project.id, uid('project')),
      title: project.title,
      summary: cleanString(project.summary, cleanString(project.body)),
      status: ['active', 'paused', 'done'].includes(project.status) ? project.status : 'active',
      url: safeHttpUrl(project.url) || '',
      folder: cleanString(project.folder),
      folderGrantId: cleanString(project.folderGrantId),
      createdAt: cleanString(project.createdAt, new Date().toISOString()),
    }]
  }) : []
  if (!projects.some((project) => project.id === DEFAULT_PROJECT.id)) projects.unshift({ ...DEFAULT_PROJECT })
  return projects
}

function normalizeBudget(value) {
  const input = isObject(value) ? value : {}
  const cleanEntry = (entry, recurring = false) => {
    if (!isObject(entry) || !Number.isSafeInteger(entry.amountMinor) || !cleanString(entry.label).trim()) return null
    return {
      id: cleanString(entry.id, uid(recurring ? 'recurring' : 'transaction')),
      label: entry.label.trim(),
      amountMinor: entry.amountMinor,
      category: cleanString(entry.category, 'Uncategorized').trim() || 'Uncategorized',
      date: cleanString(entry.date, new Date().toISOString().slice(0, 10)),
      ...(recurring ? { cadence: ['weekly', 'monthly', 'yearly'].includes(entry.cadence) ? entry.cadence : 'monthly' } : {}),
    }
  }
  return {
    currency: input.currency === 'USD' ? 'USD' : 'USD',
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
        id: cleanString(event.id, uid('event')),
        title: event.title.trim(),
        start: event.start,
        end: cleanString(event.end),
        notes: cleanString(event.notes),
      }]
    }),
  }
}

function legacyCanvasToBoard(canvas, notes, projects, records) {
  const value = isObject(canvas) ? canvas : {}
  const nodes = []
  const geometry = {}
  ;(Array.isArray(value.nodes) ? value.nodes : []).forEach((node, index) => {
    if (!isObject(node) || !cleanString(node.id)) return
    let entityType = node.kind === 'project' ? 'project' : node.kind === 'capture' || node.kind === 'idea' ? 'capture' : 'note'
    let entityId = cleanString(node.sourceId)
    if (entityType === 'project' && !projects.some((item) => item.id === entityId)) entityId = DEFAULT_PROJECT.id
    if (entityType === 'capture' && !records.some((item) => item.id === entityId)) {
      const next = normalizeCapture({ id: entityId || `legacy-${node.id}`, title: cleanString(node.title, 'Imported capture'), summary: cleanString(node.body), source: 'Imported from the earlier canvas' })
      records.push({ ...next, type: 'capture', status: node.kind === 'idea' ? 'idea' : 'inbox', bookmarked: false })
      entityId = next.id
    }
    if (entityType === 'note') {
      const next = normalizeNote({
        id: entityId || `legacy-${node.id}`,
        title: cleanString(node.title, 'Imported note'),
        markdown: cleanString(node.body),
      }, index)
      if (!notes.some((item) => item.id === next.id)) notes.push(next)
      entityId = next.id
    }
    nodes.push({ id: node.id, entityType, entityId })
    geometry[node.id] = {
      x: finite(node.x, 80 + (index % 3) * 260),
      y: finite(node.y, 70 + Math.floor(index / 3) * 210),
      w: clamp(finite(node.w, 224), 140, 640),
      h: clamp(finite(node.h, 164), 110, 640),
      color: NOTE_COLORS.includes(node.color) ? node.color : NOTE_COLORS[index % NOTE_COLORS.length],
      rot: clamp(finite(node.rot, 0), -2, 2),
    }
  })
  return normalizeMindmap({
    viewport: value.viewport,
    nodes,
    geometry,
    links: value.links,
    views: value.views,
    tagColors: value.tagColors,
    hiddenEntityKeys: value.hiddenEntityKeys,
  })
}

function normalizeMindmap(value) {
  const input = isObject(value) ? value : {}
  const geometry = isObject(input.geometry) ? input.geometry : {}
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).flatMap((node) => {
    if (!isObject(node) || !cleanString(node.id) || !['note', 'capture', 'project'].includes(node.entityType) || !cleanString(node.entityId)) return []
    return [{ id: node.id, entityType: node.entityType, entityId: node.entityId }]
  })
  const cleanGeometry = Object.fromEntries(nodes.map((node, index) => {
    const position = isObject(geometry[node.id]) ? geometry[node.id] : {}
    return [node.id, {
      x: finite(position.x, 80 + (index % 4) * 260),
      y: finite(position.y, 70 + Math.floor(index / 4) * 210),
      w: clamp(finite(position.w, 224), 140, 640),
      h: clamp(finite(position.h, 164), 110, 640),
      color: NOTE_COLORS.includes(position.color) ? position.color : NOTE_COLORS[index % NOTE_COLORS.length],
      rot: clamp(finite(position.rot, 0), -2, 2),
    }]
  }))
  const nodeIds = new Set(nodes.map((node) => node.id))
  return {
    version: 1,
    viewport: {
      x: finite(input.viewport?.x, 120),
      y: finite(input.viewport?.y, 90),
      zoom: clamp(finite(input.viewport?.zoom, 1), .2, 3.2),
    },
    nodes,
    geometry: cleanGeometry,
    links: (Array.isArray(input.links) ? input.links : []).flatMap((link) => {
      if (!isObject(link) || !nodeIds.has(link.a) || !nodeIds.has(link.b) || link.a === link.b) return []
      return [{ id: cleanString(link.id, uid('link')), a: link.a, b: link.b, label: cleanString(link.label), arrow: link.arrow !== false }]
    }),
    views: (Array.isArray(input.views) ? input.views : []).flatMap((view) => {
      if (!isObject(view) || !cleanString(view.name).trim()) return []
      return [{
        id: cleanString(view.id, uid('view')),
        name: view.name.trim(),
        tags: Array.isArray(view.tags) ? view.tags.filter((tag) => typeof tag === 'string') : [],
        mode: view.mode === 'all' ? 'all' : 'any',
        query: cleanString(view.query),
        flags: isObject(view.flags) ? { untagged: Boolean(view.flags.untagged), unconnected: Boolean(view.flags.unconnected) } : { untagged: false, unconnected: false },
        viewport: isObject(view.viewport || view.cam) ? {
          x: finite((view.viewport || view.cam).x, 120),
          y: finite((view.viewport || view.cam).y, 90),
          zoom: clamp(finite((view.viewport || view.cam).zoom ?? (view.viewport || view.cam).z, 1), .2, 3.2),
        } : null,
      }]
    }),
    tagColors: isObject(input.tagColors) ? Object.fromEntries(Object.entries(input.tagColors).filter(([, color]) => NOTE_COLORS.includes(color))) : {},
    hiddenEntityKeys: [...new Set((Array.isArray(input.hiddenEntityKeys) ? input.hiddenEntityKeys : []).filter((key) => typeof key === 'string' && key))],
  }
}

export function createDefaultWorkspace(now = new Date().toISOString()) {
  const capture = { ...DEFAULT_CAPTURE }
  const state = {
    schema: CANONICAL_SCHEMA,
    updatedAt: now,
    importedLegacyAt: null,
    legacySnapshot: {},
    capture,
    records: [{ ...capture, type: 'capture', status: 'inbox', bookmarked: false }],
    savedIds: [],
    theme: 'light',
    habits: [],
    reflections: [],
    focus: { status: 'idle' },
    notes: [],
    folders: [],
    projects: [{ ...DEFAULT_PROJECT }],
    budget: { currency: 'USD', transactions: [], recurring: [] },
    calendar: { events: [] },
    mindmap: normalizeMindmap({}),
    sorter: null,
  }
  state.sorter = reconcileBoards(state)
  return state
}

export function normalizeWorkspace(value) {
  const input = isObject(value) ? value : {}
  const capture = normalizeCapture(input.capture)
  const folders = normalizeFolders(input.folders)
  const folderIds = new Set(folders.map((folder) => folder.id))
  const seenNotes = new Set()
  const notes = (Array.isArray(input.notes) ? input.notes : []).map(normalizeNote).filter((note) => note && !seenNotes.has(note.id) && seenNotes.add(note.id))
    .map((note) => note.folderId && !folderIds.has(note.folderId) ? { ...note, folderId: null } : note)
  const projects = normalizeProjects(input.projects)
  const state = {
    schema: CANONICAL_SCHEMA,
    updatedAt: cleanString(input.updatedAt, new Date().toISOString()),
    importedLegacyAt: cleanString(input.importedLegacyAt) || null,
    legacySnapshot: isObject(input.legacySnapshot) ? input.legacySnapshot : {},
    capture,
    records: normalizeRecords(input.records, capture),
    savedIds: Array.isArray(input.savedIds) ? [...new Set(input.savedIds.filter((id) => typeof id === 'string'))] : [],
    theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
    habits: normalizeHabits(input.habits),
    reflections: normalizeReflections(input.reflections),
    focus: normalizeFocusSession(input.focus),
    notes,
    folders,
    projects,
    budget: normalizeBudget(input.budget),
    calendar: normalizeCalendar(input.calendar),
    mindmap: normalizeMindmap(input.mindmap),
    sorter: isObject(input.sorter) && Array.isArray(input.sorter.boards) && input.sorter.boards.length ? input.sorter : null,
  }
  state.sorter = reconcileBoards(state)
  return state
}

// Backups replace the workspace, so reject damaged input before normalization
// can quietly turn missing data into an empty collection.
export function readWorkspaceBackup(payload) {
  const input = payload?.workspace
  const collections = ['notes', 'records', 'projects', 'habits', 'reflections']
  if (payload?.format !== 'osat-local-backup' || payload.version !== 1 || !isObject(input)
    || ![1, CANONICAL_SCHEMA].includes(input.schema)
    || collections.some((key) => !Array.isArray(input[key]) || input[key].some((item) => !isObject(item)))
    || !isObject(input.budget) || !Array.isArray(input.budget.transactions) || !Array.isArray(input.budget.recurring)
    || !isObject(input.calendar) || !Array.isArray(input.calendar.events)
    || (input.folders !== undefined && !Array.isArray(input.folders))
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

function mergeLegacyHabits(primary, weekly) {
  const habits = new Map()
  ;[primary, weekly].forEach((source) => (Array.isArray(source) ? source : []).forEach((rawHabit) => {
    const habit = normalizeHabits([rawHabit])[0]
    if (!habit) return
    const existing = habits.get(habit.id)
    habits.set(habit.id, existing ? { ...existing, doneDates: [...new Set([...existing.doneDates, ...habit.doneDates])] } : habit)
  }))
  return [...habits.values()]
}

export function importLegacyStorage(storage, now = new Date().toISOString()) {
  const snapshot = {}
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith('nateos.')) snapshot[key] = storage.getItem(key)
    }
  } catch {
    // A locked-down browser can still use the in-memory workspace.
  }
  const capture = normalizeCapture(parseJson(snapshot[LEGACY_KEYS.capture], DEFAULT_CAPTURE))
  const records = normalizeRecords(parseJson(snapshot[LEGACY_KEYS.records], []), capture)
  const notes = (parseJson(snapshot[LEGACY_KEYS.notes], []) || []).map(normalizeNote).filter(Boolean)
  const projects = normalizeProjects(parseJson(snapshot[LEGACY_KEYS.projects], []))
  const explicitMindmap = parseJson(snapshot[LEGACY_KEYS.mindmap], null)
  const legacyCanvas = parseJson(snapshot[LEGACY_KEYS.canvas], null)
  const state = {
    schema: CANONICAL_SCHEMA,
    updatedAt: now,
    importedLegacyAt: now,
    legacySnapshot: snapshot,
    capture,
    records,
    savedIds: parseJson(snapshot[LEGACY_KEYS.savedIds], snapshot[LEGACY_KEYS.savedLegacy] === 'true' ? ['seed-capture'] : []),
    theme: snapshot[LEGACY_KEYS.theme] || 'system',
    habits: mergeLegacyHabits(
      parseJson(snapshot[LEGACY_KEYS.habits], []),
      parseJson(snapshot[LEGACY_KEYS.habitsWeekly], []),
    ),
    reflections: parseJson(snapshot[LEGACY_KEYS.reflections], []),
    focus: parseJson(snapshot[LEGACY_KEYS.focus], { status: 'idle' }),
    notes,
    folders: [],
    projects,
    budget: parseJson(snapshot[LEGACY_KEYS.budget], {}),
    calendar: parseJson(snapshot[LEGACY_KEYS.calendar], {}),
    mindmap: explicitMindmap || legacyCanvasToBoard(legacyCanvas, notes, projects, records),
  }
  return normalizeWorkspace(state)
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
