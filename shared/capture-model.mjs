/* Screenshots and screen recording from the launcher (the ring, the quick search, a key of their own).
   When CleanShot X is on this Mac, OSAT asks it through CleanShot's own URL commands
   (https://cleanshot.com/docs-api): every capture below works. Without it, the Mac's own `screencapture`
   does the three plain screenshots; recording, scrolling and text need CleanShot (see docs/BACKLOG.md for
   what building recording ourselves would take). Nothing here leaves the Mac: CleanShot's `upload` action
   is never built. Pure. */

export const CLEANSHOT_ID = 'pl.maketheweb.cleanshotx'
export const CLEANSHOT_APP = '/Applications/CleanShot X.app'

/* Every capture. `cleanshot` is CleanShot's command (`action` says it takes ?action=); `mac` is screencapture's
   flags when the Mac can do it alone. */
export const CAPTURES = [
  { id: 'area', label: 'Screenshot an area', words: 'screenshot capture area region part snip select', cleanshot: 'capture-area', action: true, mac: ['-i'] },
  { id: 'window', label: 'Screenshot a window', words: 'screenshot capture window app', cleanshot: 'capture-window', action: true, mac: ['-i', '-w'] },
  { id: 'fullscreen', label: 'Screenshot the whole screen', words: 'screenshot capture full whole screen fullscreen display', cleanshot: 'capture-fullscreen', action: true, mac: [] },
  { id: 'scrolling', label: 'Scrolling screenshot', words: 'screenshot capture scrolling scroll long page', cleanshot: 'scrolling-capture' },
  { id: 'all-in-one', label: 'Screenshot or record', words: 'screenshot record capture all in one choose', cleanshot: 'all-in-one' },
  { id: 'record', label: 'Record screen', words: 'record recording video screen movie gif', cleanshot: 'record-screen' },
  { id: 'text', label: 'Copy text from the screen', words: 'text ocr copy read words recognize screenshot', cleanshot: 'capture-text' },
  { id: 'history', label: 'Past screenshots', words: 'screenshot history recent past captures recordings', cleanshot: 'open-history' },
]

export const captureById = (id) => CAPTURES.find((item) => item.id === id) || null

/* What CleanShot may do after a screenshot. Never `upload`: that would send it to CleanShot Cloud. */
export const ACTIONS = ['copy', 'save', 'annotate', 'pin']

/* The URL that asks CleanShot for one capture: cleanshot://capture-area, cleanshot://capture-area?action=copy. */
export function cleanshotUrl(id, { action = null } = {}) {
  const item = captureById(id)
  if (!item) return null
  return `cleanshot://${item.cleanshot}${item.action && ACTIONS.includes(action) ? `?action=${action}` : ''}`
}

/* main opens only a URL that looks exactly like one cleanshotUrl makes (capture.cjs checks it on the line that opens it). */
export const CLEANSHOT_URL = /^cleanshot:\/\/[a-z-]+(\?action=(copy|save|annotate|pin))?$/

/* What can be done here: everything with CleanShot, the three screenshots with the Mac alone, nothing elsewhere. */
export function available({ cleanshot = false, mac = false } = {}) {
  if (cleanshot) return CAPTURES.map((item) => item.id)
  return mac ? CAPTURES.filter((item) => item.mac).map((item) => item.id) : []
}

/* Where the Mac's own screenshots go when CleanShot isn't here. */
export const SAVE_TO = [
  ['desktop', 'OSAT Captures on the Desktop'],
  ['pictures', 'OSAT Captures in Pictures'],
  ['clipboard', 'The clipboard only'],
]
export const FOLDER_NAME = 'OSAT Captures'

export function cleanCaptureSettings(saved, { validHotkey = () => true } = {}) {
  const from = saved && typeof saved === 'object' ? saved : {}
  const hotkeys = {}
  for (const item of CAPTURES) {
    const key = from.hotkeys?.[item.id]
    hotkeys[item.id] = typeof key === 'string' && validHotkey(key) ? key : null
  }
  return {
    hotkeys,
    // Recent captures in the quick search read CleanShot's own folder, so they are off until turned on.
    recent: from.recent === true,
    saveTo: SAVE_TO.some(([id]) => id === from.saveTo) ? from.saveTo : 'desktop',
  }
}

const two = (value) => String(value).padStart(2, '0')
/* "Screenshot 2026-10-05 at 22.32.49.png" in local time; the Mac's own pattern, with OSAT's 24-hour clock. */
export function captureName(date = new Date()) {
  return `Screenshot ${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} at ${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}.png`
}

/* Never overwrite: "name.png", then "name 2.png", "name 3.png"… `taken(name)` says whether a name is in use. */
export function freeName(name, taken) {
  if (!taken(name)) return name
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 2; n < 1000; n += 1) if (!taken(`${stem} ${n}${ext}`)) return `${stem} ${n}${ext}`
  return `${stem} ${Date.now()}${ext}`
}

/* screencapture's arguments: to the clipboard (-c) or to a file. */
export function macArgs(id, { file = null } = {}) {
  const item = captureById(id)
  if (!item?.mac) return null
  return file ? [...item.mac, file] : [...item.mac, '-c']
}

/* The quick search: captures whose words match what was typed (every word must be found). */
export function findCaptures(query, ids, { cleanshot = false } = {}) {
  // "screenshots" finds what "screenshot" does.
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean).map((word) => (word.length > 3 ? word.replace(/s$/, '') : word))
  if (!words.length) return []
  return CAPTURES
    .filter((item) => ids.includes(item.id) && words.every((word) => `${item.label} ${item.words}`.toLowerCase().split(/[^a-z0-9-]+/).some((part) => part.startsWith(word))))
    .map((item) => ({
      key: `capture:${item.id}`,
      source: 'capture',
      kind: 'capture',
      title: item.label,
      subtitle: cleanshot ? 'With CleanShot X' : 'With the Mac’s own screenshot',
      section: 'Screenshots',
      data: { capture: item.id },
    }))
}

/* Words that ask for the recent captures in the quick search. */
export const wantsRecent = (query) => /^(screenshots?|captures?|recordings?|recent (screenshots?|captures?))$/i.test(String(query || '').trim())

/* CleanShot keeps each capture as media/<folder>/<file>. Only what another app can use: pictures and videos, not its
   own .cleanshot projects. → newest first, at most `limit`. */
const KEEP = /\.(png|jpe?g|gif|heic|mp4|mov)$/i
export const isVideo = (name) => /\.(mp4|mov|gif)$/i.test(name)
export function newestMedia(entries, limit = 12) {
  return entries
    .filter((entry) => entry && KEEP.test(entry.name) && /^[^/\\]+\/[^/\\]+$/.test(entry.id) && !entry.id.split('/').some((part) => part === '..' || part.startsWith('.')))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}

/* A capture file id is "media_xxx/name.png": two parts, nothing hidden, no way up. */
export const validMediaId = (id) => typeof id === 'string' && id.length < 400 && newestMedia([{ id, name: id, at: 0 }]).length === 1

export function recentRows(items, { now = new Date() } = {}) {
  return items.map((item) => ({
    key: `shot:${item.id}`,
    source: 'capture',
    kind: 'shot',
    title: item.name,
    subtitle: [isVideo(item.name) ? 'Recording' : 'Screenshot', whenTaken(item.at, now)].join(' · '),
    section: 'Recent captures',
    data: item,
  }))
}

function whenTaken(at, now) {
  const minutes = Math.round((now - at) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
