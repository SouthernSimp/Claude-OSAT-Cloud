/* Finding a file in plain words (Phase 21, step 1). "pdf taxes last week" means PDFs changed
   since last Monday with "taxes" in the name or inside. The main process turns what was read
   into a Spotlight query (`spotlightQuery`), or walks the folders itself where there is no
   Spotlight (`matchesFile`); the Files room says back what it understood
   (`describeFileQuery`). Words in "quotes" are only ever words. Pure. */

/* Kinds: the words that name them, Spotlight's clause, and the extensions for the walk. */
export const FILE_KINDS = [
  { id: 'pdf', label: 'PDFs', words: ['pdf', 'pdfs'], types: ['com.adobe.pdf'], exts: ['pdf'] },
  {
    id: 'picture', label: 'Pictures', words: ['photo', 'photos', 'picture', 'pictures', 'pic', 'pics', 'image', 'images'],
    types: ['public.image'], exts: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'gif', 'tif', 'tiff', 'webp', 'bmp'],
  },
  {
    id: 'screenshot', label: 'Screenshots', words: ['screenshot', 'screenshots'],
    clause: 'kMDItemIsScreenCapture == 1', exts: ['png'], name: /^(screenshot|screen shot)\b/i,
  },
  { id: 'video', label: 'Videos', words: ['video', 'videos', 'movie', 'movies'], types: ['public.movie'], exts: ['mov', 'mp4', 'm4v', 'avi', 'mkv'] },
  {
    id: 'audio', label: 'Audio', words: ['audio', 'music', 'song', 'songs', 'recording', 'recordings'],
    types: ['public.audio'], exts: ['mp3', 'm4a', 'wav', 'aiff', 'aif', 'flac', 'aac'],
  },
  {
    id: 'word', label: 'Word documents', words: ['word', 'docx'],
    types: ['org.openxmlformats.wordprocessingml.document', 'com.microsoft.word.doc'], exts: ['doc', 'docx'],
  },
  {
    id: 'spreadsheet', label: 'Spreadsheets', words: ['spreadsheet', 'spreadsheets', 'excel', 'xlsx', 'csv'],
    types: ['public.spreadsheet', 'public.comma-separated-values-text'], exts: ['xls', 'xlsx', 'csv', 'numbers', 'tsv'],
  },
  {
    id: 'presentation', label: 'Presentations', words: ['presentation', 'presentations', 'slides', 'keynote', 'powerpoint', 'pptx'],
    types: ['public.presentation'], exts: ['key', 'ppt', 'pptx'],
  },
  { id: 'archive', label: 'Zip files', words: ['zip', 'zips'], types: ['public.archive'], exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz'] },
  { id: 'folder', label: 'Folders', words: ['folder', 'folders'], types: ['public.folder'], folder: true },
]

const KIND_BY_WORD = new Map(FILE_KINDS.flatMap((kind) => kind.words.map((word) => [word, kind])))

/* Words that only glue a sentence together; dropped once the search names a kind or a time,
   so "photos from the trip last month" looks for "trip". */
const FILLER = new Set([
  'a', 'about', 'all', 'an', 'and', 'any', 'at', 'called', 'changed', 'edited', 'file', 'files', 'find', 'for', 'from',
  'i', 'in', 'made', 'me', 'my', 'named', 'of', 'on', 'or', 'saved', 'show', 'since', 'that', 'the', 'to', 'with',
])

const UNITS = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30, year: 365, years: 365 }

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const daysBack = (now, days) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
const monday = (now) => daysBack(now, (now.getDay() + 6) % 7)

/* The time phrases, longest first. Each answers the day the search starts from. "Last week"
   reaches back to last week's Monday, so nothing from last week is missed. */
const TIMES = [
  [['this', 'week'], (now) => monday(now)],
  [['last', 'week'], (now) => daysBack(monday(now), 7)],
  [['past', 'week'], (now) => daysBack(now, 7)],
  [['this', 'month'], (now) => new Date(now.getFullYear(), now.getMonth(), 1)],
  [['last', 'month'], (now) => new Date(now.getFullYear(), now.getMonth() - 1, 1)],
  [['past', 'month'], (now) => daysBack(now, 30)],
  [['this', 'year'], (now) => new Date(now.getFullYear(), 0, 1)],
  [['last', 'year'], (now) => new Date(now.getFullYear() - 1, 0, 1)],
  [['past', 'year'], (now) => daysBack(now, 365)],
  [['today'], (now) => startOfDay(now)],
  [['yesterday'], (now) => daysBack(now, 1)],
  [['recent'], (now) => daysBack(now, 14)],
  [['recently'], (now) => daysBack(now, 14)],
  [['lately'], (now) => daysBack(now, 14)],
]

/* "pdf taxes last week" → { words: ['taxes'], kinds: [pdf], since: Date, text }. */
export function parseFileQuery(text, now = new Date()) {
  const raw = String(text || '').trim().slice(0, 100)
  const tokens = []
  for (const [, quoted, plain] of raw.matchAll(/"([^"]*)"?|(\S+)/g)) {
    if (quoted !== undefined) tokens.push(...quoted.split(/\s+/).filter(Boolean).map((word) => ({ word, quoted: true })))
    else tokens.push({ word: plain, quoted: false })
  }
  const kinds = []
  let since = null
  const words = []
  for (let i = 0; i < tokens.length; i += 1) {
    const { word, quoted } = tokens[i]
    const lower = word.toLowerCase().replace(/[.,!?;:]+$/, '')
    if (!quoted) {
      // "last 3 days", "past 2 weeks"
      const count = Number(tokens[i + 1]?.word)
      const unit = UNITS[tokens[i + 2]?.word.toLowerCase().replace(/[.,!?;:]+$/, '')]
      if ((lower === 'last' || lower === 'past') && Number.isInteger(count) && count > 0 && count < 1000 && unit && !tokens[i + 1].quoted) {
        since = daysBack(now, count * unit)
        i += 2
        continue
      }
      const phrase = TIMES.find(([parts]) => parts.every((part, at) => {
        const next = tokens[i + at]
        return next && !next.quoted && next.word.toLowerCase().replace(/[.,!?;:]+$/, '') === part
      }))
      if (phrase) {
        since = phrase[1](now)
        i += phrase[0].length - 1
        continue
      }
      const kind = KIND_BY_WORD.get(lower)
      if (kind) {
        if (!kinds.includes(kind)) kinds.push(kind)
        continue
      }
    }
    words.push({ word: word.replace(/["\\*?]/g, ''), quoted })
  }
  const filtered = kinds.length > 0 || since !== null
  const kept = words.filter(({ word, quoted }) => word && (quoted || !filtered || !FILLER.has(word.toLowerCase())))
  return { words: kept.map(({ word }) => word), kinds, since, text: raw }
}

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const DAY_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/* What the Files room says it looked for: "PDFs changed since Mon, Sep 21 with “taxes”".
   Empty when the search is only words. */
export function describeFileQuery(query, now = new Date()) {
  if (!query.kinds.length && !query.since) return ''
  const what = query.kinds.length ? joinWords(query.kinds.map((kind) => kind.label)) : 'Files'
  let when = ''
  if (query.since) {
    const day = startOfDay(query.since)
    if (day.getTime() === startOfDay(now).getTime()) when = ' changed today'
    else when = ` changed since ${day.getFullYear() === now.getFullYear() ? DAY.format(day) : DAY_YEAR.format(day)}`
  }
  const words = query.words.length ? ` with ${joinWords(query.words.map((word) => `“${word}”`))}` : ''
  return `${what}${when}${words}`
}

function joinWords(list) {
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}

const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/* Spotlight's query: every word in the name or inside the file, any of the kinds, changed
   since the day. null when there is nothing to look for. */
export function spotlightQuery(query) {
  const parts = query.words.map((word) => `(kMDItemFSName == "*${word}*"cd || kMDItemTextContent == "${word}*"cdw)`)
  if (query.kinds.length) {
    const clauses = query.kinds.flatMap((kind) => kind.clause ? [kind.clause] : kind.types.map((type) => `kMDItemContentTypeTree == "${type}"`))
    parts.push(clauses.length > 1 ? `(${clauses.join(' || ')})` : clauses[0])
  }
  if (query.since) parts.push(`kMDItemFSContentChangeDate >= $time.iso(${iso(query.since)})`)
  return parts.length ? parts.join(' && ') : null
}

/* The same test for one file, where there is no Spotlight (the tests, and OSAT from source
   on Linux). `inside` is the file's text when it could be read. */
export function matchesFile(query, { name, folder = false, modifiedAt = null, inside = '' }) {
  if (query.since && !(modifiedAt && new Date(modifiedAt) >= query.since)) return false
  if (query.kinds.length && !query.kinds.some((kind) => kindMatches(kind, name, folder))) return false
  const own = name.toLowerCase()
  const text = String(inside || '').toLowerCase()
  return query.words.every((word) => {
    const needle = word.toLowerCase()
    return own.includes(needle) || new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(text)
  })
}

function kindMatches(kind, name, folder) {
  if (kind.folder) return folder
  if (folder) return false
  if (kind.name && !kind.name.test(name)) return false
  return kind.exts.includes(name.split('.').pop().toLowerCase())
}

/* Where the words were found, for the results: 'name' when the name holds every word. */
export const matchedBy = (query, name) => (query.words.every((word) => name.toLowerCase().includes(word.toLowerCase())) ? 'name' : 'inside')
