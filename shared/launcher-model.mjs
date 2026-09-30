/* The launcher's settings and the words that drive it (Phase 13): which sources the quick search
   and the line look in, each one's keyword and hotkey, Nate's own keywords (`ss` opens Spotify,
   `g cats` searches the web), and how a line of typing is read (a sum, a keyword, a bot job).
   Settings → Launcher edits this; `launcher.json` in the data folder keeps it. The same rules run in
   main and in the windows. Pure. */

import { calculate } from './calc.mjs'

export const SEARCH_HOTKEY = 'Command+Shift+Space'
export const HYPER = ['Control', 'Alt', 'Shift', 'Command']

/* The places the launcher looks. `letter` is the Hyper key that opens the quick search on it. */
export const SOURCES = [
  { id: 'files', label: 'Files', blurb: 'Documents, pictures and folders on this Mac, the ones you used lately first', keyword: 'f', letter: 'S' },
  { id: 'clipboard', label: 'Clipboard', blurb: 'Everything you copy, kept only on this Mac', keyword: 'v', letter: 'V' },
  { id: 'apps', label: 'Apps', blurb: 'Open any app on this Mac', keyword: 'a', letter: 'A' },
  { id: 'notes', label: 'Notes and nodes', blurb: 'Your own notes, nodes and rooms', keyword: 'n', letter: 'N' },
  { id: 'calc', label: 'Calculator', blurb: 'Type a sum and the answer is right there', keyword: null, letter: null },
  // `panel: false` until the quick search has rows for it (window layouts come with window snapping).
  { id: 'windows', label: 'Window layouts', blurb: 'Snap the front window to a half, a third or a corner', keyword: 'w', letter: 'W', panel: false },
]

/* Words that open something: an app (`ss` → Spotify) or a web address with the search in it. */
export const DEFAULT_KEYWORDS = [
  { id: 'kw-spotify', keyword: 'ss', label: 'Spotify', app: 'Spotify' },
  { id: 'kw-google', keyword: 'g', label: 'Google', url: 'https://www.google.com/search?q={query}' },
]

export const hyper = (letter) => (letter ? [...HYPER, String(letter).toUpperCase()].join('+') : null)

/* "Control+Alt+Shift+Command+V" → "Hyper V"; any other → its symbols. `symbols` is desk.cjs's hotkeyLabel. */
export function hyperLabel(accelerator, symbols = (value) => value) {
  const parts = String(accelerator || '').split('+')
  const key = parts.pop()
  return parts.length === 4 && HYPER.every((part) => parts.includes(part)) ? `Hyper ${key}` : symbols(accelerator)
}

const KEYWORD = /^[a-z0-9]{1,12}$/
const clean = (value) => String(value ?? '').trim().toLowerCase()
export const validKeyword = (value) => KEYWORD.test(clean(value))

/* http(s) only, and only an address that can be opened; `{query}` is where the words go. */
export function validAddress(value) {
  const text = String(value || '').trim()
  if (text.length > 300 || !/^https?:\/\/[^\s]+$/i.test(text)) return false
  try { return Boolean(new URL(text.replace('{query}', 'x')).host) } catch { return false }
}

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  view: 'bar',
  sources: Object.fromEntries(SOURCES.map((source) => [source.id, { on: true, keyword: source.keyword, hotkey: hyper(source.letter) }])),
  keywords: DEFAULT_KEYWORDS,
  clipboard: { items: 200, days: 30, offers: true },
  pins: [],
  // Window snapping and the ring are read by their own modules (later steps of Phase 13).
  windows: { hotkeys: {} },
  ring: { on: true, items: null },
})

/* What a saved file may hold: only the fields OSAT writes; anything broken falls back to the default.
   `validHotkey` is desk.cjs's; passed in so this file stays pure and shared. */
export function cleanSettings(saved, { validHotkey = () => true } = {}) {
  const from = saved && typeof saved === 'object' ? saved : {}
  const sources = {}
  const used = new Set()
  for (const source of SOURCES) {
    const own = from.sources?.[source.id] || {}
    // Its own word if that is fine and free; else the usual one; else none.
    let keyword = own.keyword === null ? null : clean(own.keyword ?? source.keyword)
    if (keyword !== null && (!validKeyword(keyword) || used.has(keyword))) keyword = source.keyword && !used.has(source.keyword) ? source.keyword : null
    if (keyword) used.add(keyword)
    sources[source.id] = {
      on: own.on !== false,
      keyword,
      hotkey: own.hotkey === null ? null : validHotkey(own.hotkey) ? own.hotkey : hyper(source.letter),
    }
  }
  const keywords = []
  const list = Array.isArray(from.keywords) ? from.keywords : DEFAULT_KEYWORDS
  for (const item of list.slice(0, 40)) {
    const keyword = clean(item?.keyword)
    const label = String(item?.label || '').trim().slice(0, 40)
    const app = String(item?.app || '').trim().slice(0, 80)
    const url = String(item?.url || '').trim()
    if (!validKeyword(keyword) || used.has(keyword) || (!app && !validAddress(url)) || (app && /[/\\]/.test(app))) continue
    used.add(keyword)
    keywords.push({ id: String(item.id || `kw-${keyword}`).slice(0, 40), keyword, label: label || app || keyword, ...(app ? { app } : { url }) })
  }
  const pins = (Array.isArray(from.pins) ? from.pins : []).filter((pin) => pin && typeof pin.rootId === 'string' && typeof pin.relative === 'string' && typeof pin.name === 'string' && ['file', 'folder'].includes(pin.kind))
    .slice(0, 30).map(({ rootId, relative, name, kind, where }) => ({ kind, rootId, relative, name, where: typeof where === 'string' ? where.slice(0, 200) : '' }))
  const clip = from.clipboard || {}
  return {
    version: 1,
    view: from.view === 'full' ? 'full' : 'bar',
    sources,
    keywords,
    clipboard: { items: [50, 100, 200, 500].includes(clip.items) ? clip.items : 200, days: [0, 7, 30, 90].includes(clip.days) ? clip.days : 30, offers: clip.offers !== false },
    pins,
    windows: { hotkeys: from.windows?.hotkeys && typeof from.windows.hotkeys === 'object' ? Object.fromEntries(Object.entries(from.windows.hotkeys).filter(([id, key]) => /^[a-z-]{2,24}$/.test(id) && (key === null || validHotkey(key))).slice(0, 40)) : {} },
    ring: { on: from.ring?.on !== false, items: Array.isArray(from.ring?.items) ? from.ring.items.filter((id) => typeof id === 'string' && /^[a-z-]{2,24}$/.test(id)).slice(0, 12) : null },
  }
}

/* The sources that are on, as the panel's tabs. */
export const activeSources = (settings) => SOURCES.filter((source) => settings.sources[source.id]?.on)

/* What a typed line starts with: a source's keyword ("v invoice" → the clipboard for "invoice"),
   or one of Nate's own keywords. A keyword counts only as a whole word at the start, so "very good"
   is not the clipboard. Answers { source, query } | { keyword, query } | null. */
export function matchKeyword(settings, text) {
  const line = String(text || '').trim()
  const first = /^(\S+)(?:\s+([\s\S]*))?$/.exec(line)
  if (!first) return null
  const word = first[1].toLowerCase()
  const query = (first[2] || '').trim()
  for (const source of SOURCES) {
    const own = settings.sources[source.id]
    if (own?.on && own.keyword === word) return { source: source.id, query }
  }
  const custom = settings.keywords.find((item) => item.keyword === word)
  if (!custom) return null
  // An app opens on its word alone; a web search wants words to search for.
  if (custom.app) return query ? null : { keyword: custom, query: '' }
  return query ? { keyword: custom, query } : null
}

export const keywordAddress = (keyword, query) => keyword.url.replace('{query}', encodeURIComponent(query))

/* A line of typing on the desk, read for the launcher: the words left once a source's keyword is taken off
   (`scope` is that source: "v invoice" → clipboard, "invoice"), one of Nate's keywords (`ss`, `g cats`), a sum
   (`2*49`) or a job for a bot (`> research …`). A sentence is never hijacked: a keyword is a whole word at the
   start, and the line always keeps "Save as a sticky" first. */
export function readLine(text, settings) {
  const typed = String(text || '').trim()
  const bot = botJob(typed)
  const hit = bot ? null : matchKeyword(settings, typed)
  return {
    typed,
    scope: hit?.source || null,
    keyword: hit?.keyword ? hit : null,
    words: hit?.source ? hit.query : typed,
    sum: bot || !settings.sources.calc?.on ? null : calculate(typed),
    bot,
  }
}

/* "> research best CRMs" hands a job to a bot: → { job } or null. */
export function botJob(text) {
  const match = /^>\s*([\s\S]+)$/.exec(String(text || '').trim())
  return match?.[1].trim() ? { job: match[1].trim().slice(0, 2000) } : null
}

/* Bots that can take a job register here: { id, name, run(job) }. Today none can (Settings → Bots
   holds the drop folder, cloud models and the connector, which bring things in), so a job is
   never sent anywhere, and the words say so plainly. The seam is here so a later phase only has to
   register its bots. */
export function handOff(job, takers = []) {
  const taker = takers.find((item) => typeof item?.run === 'function')
  if (!taker) return { ok: false, message: 'No bot takes jobs yet. Bots that can are planned; Settings → Bots shows what is connected today.' }
  return { ok: true, taker, run: () => taker.run(job) }
}
