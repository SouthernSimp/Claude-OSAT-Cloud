/* Tidy my Desktop (Phase 21b): the pure rules. OSAT proposes a plan, Nate decides.
   A "destination" is `{ to: 'folder', folder: 'Money' }` (a folder inside Documents, up to three
   levels), `{ to: 'bin' }` or `{ to: 'stay' }` (left on the Desktop). Its key is a string:
   `folder:Money`, `bin`, `stay`. Shared by the main process (which asks the AI and moves files) and
   the Files room (which draws the plan). Nothing here touches a file. */

export const BATCH = 25 // files per question to the AI
export const MAX_AI = 100 // more than this on the Desktop: the rest are sorted by kind alone
export const OLD_DAYS = 30
export const LAYOUT = ['Projects', 'Money', 'Home', 'School', 'Archive']

const KINDS = {
  picture: 'jpg jpeg png gif heic heif webp tif tiff bmp svg raw dng',
  pdf: 'pdf',
  document: 'doc docx rtf rtfd pages txt md odt key ppt pptx xls xlsx numbers csv',
  installer: 'dmg pkg mpkg',
  archive: 'zip rar 7z tar gz tgz',
  video: 'mov mp4 m4v avi mkv webm',
  audio: 'mp3 m4a wav aiff flac aac',
}
const BY_EXT = new Map(Object.entries(KINDS).flatMap(([kind, list]) => list.split(' ').map((ext) => [ext, kind])))
const SHOT = /^(screenshot|screen ?shot|screen recording|cleanshot|simulator screen)/i

/* What a Desktop item is. `isPackage` is true for what Finder shows as one file (an app, a Pages document). */
export function kindOf(name, { isPackage = false } = {}) {
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
  if (ext === 'app') return 'app'
  if (SHOT.test(name)) return 'screenshot'
  const kind = BY_EXT.get(ext)
  if (kind) return kind
  return isPackage || ['sh', 'command', 'py', 'js', 'scpt', 'workflow'].includes(ext) ? 'app' : 'other'
}

const RULES = {
  screenshot: 'Screenshots',
  picture: 'Pictures',
  pdf: 'Papers',
  document: 'Papers',
  archive: 'Archive',
  video: 'Videos',
  audio: 'Audio',
}
const NOUNS = {
  screenshot: ['screenshot', 'screenshots'],
  picture: ['picture', 'pictures'],
  pdf: ['PDF', 'PDFs'],
  document: ['document', 'documents'],
  installer: ['installer', 'installers'],
  archive: ['zip file', 'zip files'],
  video: ['video', 'videos'],
  audio: ['song', 'songs'],
}

export const keyOfDest = (dest) => (dest?.to === 'folder' ? `folder:${dest.folder}` : dest?.to === 'bin' ? 'bin' : 'stay')
export function destOfKey(key) {
  if (key === 'bin') return { to: 'bin' }
  if (typeof key === 'string' && key.startsWith('folder:')) {
    const folder = cleanFolder(key.slice(7))
    if (folder) return { to: 'folder', folder }
  }
  return { to: 'stay' }
}

/* A folder path someone (or the AI) named, inside Documents: plain names, no dots at the start, at most three levels. */
export function cleanFolder(value) {
  const parts = String(value ?? '').split('/').map((part) => part.trim())
  if (!parts.length || parts.length > 3) return null
  if (parts.some((part) => !part || part.startsWith('.') || part.length > 80 || /[:\\\0]/.test(part))) return null
  return parts.join('/')
}

/* The plain rule for a kind: apps, scripts and unknown things stay where they are; installers go to the Bin. */
export function ruleDest(kind) {
  if (kind === 'installer') return { to: 'bin' }
  return RULES[kind] ? { to: 'folder', folder: RULES[kind] } : { to: 'stay' }
}

/* The folders the AI (and Nate's "Move to") may pick: the ones already in Documents, then the usual ones. */
export function menuFolders(existing = []) {
  const seen = new Set()
  return [...existing, ...Object.values(RULES), ...LAYOUT, 'Money', 'Screenshots'].filter((name) => {
    const clean = cleanFolder(name)
    const key = clean?.toLowerCase()
    if (!clean || clean.includes('/') || seen.has(key) || ['bin', 'stay'].includes(key)) return false
    seen.add(key)
    return true
  }).slice(0, 40)
}

export function tidySchema(menu) {
  return {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        maxItems: BATCH,
        items: { type: 'object', properties: { n: { type: 'integer' }, to: { enum: [...menu, 'Bin', 'Stay'] } } },
      },
    },
  }
}

const KIND_LABEL = { screenshot: 'screenshot', picture: 'picture', pdf: 'PDF', document: 'document', installer: 'installer', archive: 'zip file', video: 'video', audio: 'song', app: 'app', other: 'file' }
const size = (bytes) => (bytes >= 1e6 ? `${Math.round(bytes / 1e5) / 10} MB` : `${Math.max(1, Math.round((bytes || 0) / 1e3))} KB`)

/* The question for one batch: `files` are { name, kind, size, modifiedAt, peek? }. */
export function tidyMessages({ files, menu }) {
  const system = `You help tidy someone's Mac Desktop for OSAT, a private notes app. For each numbered file, pick the one best place for it from this list: ${[...menu, 'Bin', 'Stay'].join(', ')}.
- The places are folders inside Documents. "Stay" leaves the file on the Desktop when you are not sure. "Bin" is only for installers (.dmg, .pkg) that are no longer needed.
- Judge by the name (and the words inside, when they are shown). Invoices, receipts, statements and taxes go to Money; homework, syllabi and courses to School; work for a client or a build to Projects; things about the house, travel or family to Home.
- Give every file exactly once, as { n, to }. Never invent a place.`
  const lines = files.map((file, index) => {
    const date = file.modifiedAt ? ` · ${String(file.modifiedAt).slice(0, 10)}` : ''
    const peek = file.peek ? `\n   starts: ${String(file.peek).replace(/\s+/g, ' ').slice(0, 240)}` : ''
    return `${index + 1}. ${file.name} (${KIND_LABEL[file.kind] || 'file'}, ${size(file.size)}${date})${peek}`
  })
  return [{ role: 'system', content: system }, { role: 'user', content: lines.join('\n') }]
}

/* The AI's answer as one destination per file (same order). A name outside the menu, a missing
   number, or the Bin for something that isn't an installer falls back to the plain rule for its
   kind; an app or script never moves. ponytail: the Bin is limited to installers here so a
   wrong guess can't bin a document. */
export function readTidyAnswer(answer, files, menu) {
  const picks = new Map()
  for (const item of Array.isArray(answer?.files) ? answer.files : []) {
    if (Number.isInteger(item?.n) && item.n >= 1 && item.n <= files.length && typeof item.to === 'string') picks.set(item.n, item.to.trim())
  }
  const byName = new Map(menu.map((name) => [name.toLowerCase(), name]))
  return files.map((file, index) => {
    const rule = ruleDest(file.kind)
    if (file.kind === 'app') return { to: 'stay' }
    const pick = picks.get(index + 1)?.toLowerCase()
    if (pick === 'stay') return { to: 'stay' }
    if (pick === 'bin') return file.kind === 'installer' ? { to: 'bin' } : rule
    const folder = byName.get(pick)
    return folder ? { to: 'folder', folder } : rule
  })
}

/* Files with their destinations → the plan's lines: one group per place, biggest first, the Bin
   last; what stays is left out (`left` says how many, for the code, never for the page to count). */
export function groupPlan(files, dests) {
  const groups = new Map()
  let left = 0
  files.forEach((file, index) => {
    const dest = dests[index] || { to: 'stay' }
    if (dest.to === 'stay') { left += 1; return }
    const id = keyOfDest(dest)
    if (!groups.has(id)) groups.set(id, { id, dest, names: [], kinds: new Set() })
    const group = groups.get(id)
    group.names.push(file.name)
    group.kinds.add(file.kind)
  })
  const list = [...groups.values()].map(({ kinds, ...group }) => ({ ...group, kind: kinds.size === 1 ? [...kinds][0] : 'other' }))
  list.sort((a, b) => (a.dest.to === 'bin') - (b.dest.to === 'bin') || b.names.length - a.names.length)
  return { groups: list, left }
}

export const placeLabel = (dest) => (dest?.to === 'bin' ? 'the Bin' : dest?.to === 'folder' ? `Documents/${dest.folder}` : 'the Desktop')

/* "12 screenshots → Documents/Screenshots", "3 installers → the Bin". */
export function describeGroup({ names, kind, dest }) {
  const [one, many] = NOUNS[kind] || ['file', 'files']
  return `${names.length} ${names.length === 1 ? one : many} → ${placeLabel(dest)}`
}

/* The toast after a tidy. */
export function describeDone({ moved = 0, binned = 0 }) {
  const total = moved + binned
  if (!total) return 'Nothing needed moving.'
  return `Tidied ${total === 1 ? '1 thing' : `${total} things`}${binned ? (binned === total ? ' into the Bin' : `, ${binned} into the Bin`) : ''}`
}

/* ---- Keeps itself tidy (off unless Nate turns it on) ---- */

export const monthKey = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
export const archiveFolder = (now = new Date()) => `Archive/${monthKey(now)}`

/* Names of files nobody has touched for a month. `files` are { name, kind, modifiedAt (ms or date) }; apps stay. */
export function oldFiles(files, now = new Date(), days = OLD_DAYS) {
  const cutoff = now.getTime() - days * 86400000
  return files.filter((file) => file.kind !== 'app' && new Date(file.modifiedAt).getTime() < cutoff).map((file) => file.name)
}
