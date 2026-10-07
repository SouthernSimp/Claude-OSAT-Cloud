/* The launcher's settings and the words that drive it (Phase 13, 13b): which sources the quick search
   and the line look in, each one's word (keyword) and Hyper key, apps with a word or a key (`ss` opens
   Spotify), quick links (`g cats` searches the web), and how a line of typing is read (a sum, a word, a
   bot job). Settings' launcher pages edit this; `launcher.json` in the data folder keeps it. The same
   rules run in main and in the windows. Every key and word in one list (`keysOf`, `wordsOf`) lets
   Settings say who already holds one. Pure. */

import { calculate } from './calc.mjs'
import { CAPTURES, cleanCaptureSettings } from './capture-model.mjs'
import { RING_ITEMS } from './ring-model.mjs'
import { LAYOUTS, cleanWindowKeys } from './window-layouts.mjs'

export const SEARCH_HOTKEY = 'Command+Shift+Space'
export const HYPER = ['Control', 'Alt', 'Shift', 'Command']

/* The places the launcher looks. `letter` is the Hyper key that opens the quick search on it. */
export const SOURCES = [
  { id: 'files', label: 'Files', blurb: 'Documents, pictures and folders on this Mac, the ones you used lately first', keyword: 'f', letter: 'S' },
  { id: 'clipboard', label: 'Clipboard', blurb: 'Everything you copy, kept only on this Mac', keyword: 'v', letter: 'V' },
  { id: 'apps', label: 'Apps', blurb: 'Open any app on this Mac', keyword: 'a', letter: 'A' },
  { id: 'notes', label: 'Notes and topics', blurb: 'Your own notes, topics and rooms', keyword: 'n', letter: 'N' },
  { id: 'calc', label: 'Calculator', blurb: 'Type a sum and the answer is right there', keyword: null, letter: null },
  { id: 'windows', label: 'Window layouts', blurb: 'Snap the window you were in to a half, a third or a corner', keyword: 'w', letter: 'W' },
]

/* Apps with a word or a key of their own, by name (`ss` → Spotify). */
export const DEFAULT_APPS = { Spotify: { keyword: 'ss', hotkey: null } }
/* Quick links: a named web address; `{query}` is where typed words go (`g best crms`). */
export const DEFAULT_LINKS = [{ id: 'link-google', name: 'Google', url: 'https://www.google.com/search?q={query}', keyword: 'g', hotkey: null, on: true }]

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
  version: 2,
  view: 'bar',
  sources: Object.fromEntries(SOURCES.map((source) => [source.id, { on: true, keyword: source.keyword, hotkey: hyper(source.letter) }])),
  apps: DEFAULT_APPS,
  links: DEFAULT_LINKS,
  clipboard: { items: 200, days: 30, offers: true },
  // Ask can look at what you copied and at files in your approved places (never when a cloud model answers).
  ask: { sources: true },
  pins: [],
  custom: [],
  // Window keys (Control+Option+Arrow…) are off until turned on: they are global, and moving windows needs Accessibility.
  windows: { on: false, hotkeys: cleanWindowKeys(undefined) },
  // The ring opens with Hyper + middle-click over any app (`middle`, a small helper: desktop/launcher/middle-click.cjs) or
  // from Hyper R, and with ⌘ + middle-click inside OSAT; null items means the usual eight.
  ring: { on: true, hotkey: hyper('R'), middle: true, items: null },
  // What a Hyper key made by another app sends: all four (⌃⌥⇧⌘), or ⌃⌥⌘ (Raycast's, unless "Include Shift").
  hyper: { sends: 'four' },
  // Screenshots and recording (shared/capture-model.mjs): a key for each, off until given one.
  captures: cleanCaptureSettings(undefined),
})

/* What a saved file may hold: only the fields OSAT writes; anything broken falls back to the default.
   `validHotkey` is desk.cjs's; passed in so this file stays pure and shared. A word belongs to one thing only:
   sources first, then apps, then quick links. A version 1 file's `keywords` become apps and quick links. */
export function cleanSettings(saved, { validHotkey = () => true } = {}) {
  const from = saved && typeof saved === 'object' ? saved : {}
  const used = new Set()
  // Its own word if that is fine and free; else the usual one; else none.
  const word = (value, usual = null) => {
    let keyword = value === null ? null : clean(value ?? usual)
    if (keyword !== null && (!validKeyword(keyword) || used.has(keyword))) keyword = usual && !used.has(usual) ? usual : null
    if (keyword) used.add(keyword)
    return keyword || null
  }
  const key = (value, usual = null) => (value === null ? null : typeof value === 'string' && validHotkey(value) ? value : usual)
  const sources = {}
  for (const source of SOURCES) {
    const own = from.sources?.[source.id] || {}
    sources[source.id] = { on: own.on !== false, keyword: word(own.keyword, source.keyword), hotkey: key(own.hotkey, hyper(source.letter)) }
  }
  // A version 1 file kept `keywords`: an app's word becomes that app's, a web address becomes a quick link.
  const v1 = Array.isArray(from.keywords) && !from.apps && !Array.isArray(from.links)
  const appList = from.apps && typeof from.apps === 'object' ? Object.entries(from.apps)
    : v1 ? from.keywords.filter((item) => item?.app).map((item) => [String(item.app), { keyword: item.keyword }]) : Object.entries(DEFAULT_APPS)
  const linksFrom = Array.isArray(from.links) ? from.links
    : v1 ? from.keywords.filter((item) => item?.url).map((item) => ({ id: item.id, name: item.label, url: item.url, keyword: item.keyword })) : DEFAULT_LINKS
  const apps = {}
  for (const [name, own] of appList.slice(0, 200)) {
    const label = String(name).trim().slice(0, 80)
    if (!label || /[/\\]/.test(label) || apps[label] || !own || typeof own !== 'object') continue
    const entry = { keyword: word(own.keyword ?? null), hotkey: key(own.hotkey ?? null) }
    if (entry.keyword || entry.hotkey) apps[label] = entry
  }
  const links = []
  for (const item of linksFrom.slice(0, 60)) {
    const url = String(item?.url || '').trim()
    if (!validAddress(url)) continue
    const id = String(item.id || `link-${links.length + 1}`).slice(0, 40)
    if (links.some((other) => other.id === id)) continue
    links.push({ id, name: String(item.name || '').trim().slice(0, 40) || hostOf(url), url, keyword: word(item.keyword ?? null), hotkey: key(item.hotkey ?? null), on: item.on !== false })
  }
  // Favorites, keys and words for anything else in the bar (set from ⌘K there): after apps and links, so theirs come first.
  const custom = []
  for (const item of (Array.isArray(from.custom) ? from.custom : []).slice(0, 80)) {
    const row = cleanRow(item)
    if (!row || custom.some((other) => other.key === row.key)) continue
    const entry = { ...row, favorite: item.favorite === true, hotkey: key(item.hotkey ?? null), keyword: word(item.keyword ?? null) }
    if (entry.favorite || entry.hotkey || entry.keyword) custom.push(entry)
  }
  const pins = (Array.isArray(from.pins) ? from.pins : []).filter((pin) => pin && typeof pin.rootId === 'string' && typeof pin.relative === 'string' && typeof pin.name === 'string' && ['file', 'folder'].includes(pin.kind))
    .slice(0, 30).map(({ rootId, relative, name, kind, where }) => ({ kind, rootId, relative, name, where: typeof where === 'string' ? where.slice(0, 200) : '' }))
  const clip = from.clipboard || {}
  return {
    version: 2,
    view: from.view === 'full' ? 'full' : 'bar',
    sources,
    apps,
    links,
    clipboard: { items: [50, 100, 200, 500].includes(clip.items) ? clip.items : 200, days: [0, 7, 30, 90].includes(clip.days) ? clip.days : 30, offers: clip.offers !== false },
    pins,
    custom,
    ask: { sources: from.ask?.sources !== false },
    windows: { on: from.windows?.on === true, hotkeys: cleanWindowKeys(from.windows?.hotkeys, validHotkey) },
    ring: {
      on: from.ring?.on !== false,
      hotkey: key(from.ring?.hotkey, hyper('R')),
      middle: from.ring?.middle !== false,
      items: Array.isArray(from.ring?.items) ? [...new Set(from.ring.items.filter((id) => RING_ITEMS.some((item) => item.id === id)))].slice(0, 8) : null,
    },
    hyper: { sends: from.hyper?.sends === 'three' ? 'three' : 'four' },
    captures: cleanCaptureSettings(from.captures, { validHotkey }),
  }
}

export const hostOf = (url) => {
  try { return new URL(String(url).replace('{query}', 'x')).host.replace(/^www\./, '') } catch { return '' }
}

/* A patch from Settings over what is kept: a source, an app, the clipboard, the window keys, the ring and the Hyper key
   merge one level down (an app set to null goes); lists (quick links, pins) are replaced whole. Then cleanSettings. */
export function applyPatch(settings, patch) {
  const from = patch && typeof patch === 'object' ? patch : {}
  const apps = { ...(settings.apps || {}) }
  for (const [name, own] of Object.entries(from.apps || {})) {
    if (own === null) delete apps[name]
    else apps[name] = { ...(apps[name] || {}), ...own }
  }
  return {
    ...settings,
    ...from,
    sources: Object.fromEntries(Object.entries(settings.sources).map(([id, own]) => [id, { ...own, ...(from.sources?.[id] || {}) }])),
    apps,
    clipboard: { ...settings.clipboard, ...(from.clipboard || {}) },
    ask: { ...settings.ask, ...(from.ask || {}) },
    windows: { ...settings.windows, ...(from.windows || {}), hotkeys: { ...settings.windows.hotkeys, ...(from.windows?.hotkeys || {}) } },
    ring: { ...settings.ring, ...(from.ring || {}) },
    hyper: { ...(settings.hyper || {}), ...(from.hyper || {}) },
    captures: { ...settings.captures, ...(from.captures || {}), hotkeys: { ...settings.captures?.hotkeys, ...(from.captures?.hotkeys || {}) } },
  }
}

/* Every key the launcher holds, by id: `source:files`, `ring`, `snap:left-half`, `app:Spotify`, `link:<id>`. Only the
   ones in use (what main registers), or with `all` every key given to something, on or off (what Settings checks a
   new key against). */
export function keysOf(settings, { all = false } = {}) {
  const keys = {}
  for (const source of SOURCES) {
    const own = settings.sources[source.id]
    if (own?.hotkey && (all || own.on)) keys[`source:${source.id}`] = own.hotkey
  }
  if (settings.ring?.hotkey && (all || settings.ring.on)) keys.ring = settings.ring.hotkey
  if (all || settings.windows?.on) for (const [id, hotkey] of Object.entries(settings.windows?.hotkeys || {})) if (hotkey) keys[`snap:${id}`] = hotkey
  for (const [name, own] of Object.entries(settings.apps || {})) if (own.hotkey) keys[`app:${name}`] = own.hotkey
  for (const link of settings.links || []) if (link.hotkey && (all || link.on !== false)) keys[`link:${link.id}`] = link.hotkey
  for (const [id, hotkey] of Object.entries(settings.captures?.hotkeys || {})) if (hotkey) keys[`capture:${id}`] = hotkey
  for (const entry of settings.custom || []) if (entry.hotkey) keys[`row:${entry.key}`] = entry.hotkey
  return keys
}

/* Every word, by the same ids. */
export function wordsOf(settings) {
  const words = {}
  for (const source of SOURCES) if (settings.sources[source.id]?.keyword) words[`source:${source.id}`] = settings.sources[source.id].keyword
  for (const [name, own] of Object.entries(settings.apps || {})) if (own.keyword) words[`app:${name}`] = own.keyword
  for (const link of settings.links || []) if (link.keyword) words[`link:${link.id}`] = link.keyword
  for (const entry of settings.custom || []) if (entry.keyword) words[`row:${entry.key}`] = entry.keyword
  return words
}

/* What an id is called, for "Hyper S is Files' key". */
export function nameOf(settings, id) {
  const [kind, rest] = id.includes(':') ? [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)] : [id, '']
  if (kind === 'source') return SOURCES.find((source) => source.id === rest)?.label || rest
  if (kind === 'ring') return 'The ring'
  if (kind === 'snap') return LAYOUTS.find((layout) => layout.id === rest)?.label || rest
  if (kind === 'link') return (settings.links || []).find((link) => link.id === rest)?.name || 'A quick link'
  if (kind === 'capture') return CAPTURES.find((item) => item.id === rest)?.label || rest
  if (kind === 'row') return (settings.custom || []).find((entry) => entry.key === rest)?.title || 'Something in the bar'
  return rest || id
}

/* Who holds a key or a word already (not counting `except`, the one being changed): its name, or null. */
export function holderOf(settings, { key = null, word = null } = {}, except = null) {
  const list = key ? keysOf(settings, { all: true }) : wordsOf(settings)
  const wanted = key || clean(word)
  const found = Object.entries(list).find(([id, value]) => id !== except && value === wanted)
  return found ? nameOf(settings, found[0]) : null
}

/* One id's key, set (or taken away): Settings' patch for it, and main's way to put a refused key back. */
export function withKey(settings, id, hotkey) {
  const at = id.indexOf(':')
  const [kind, rest] = at === -1 ? [id, ''] : [id.slice(0, at), id.slice(at + 1)]
  switch (kind) {
    case 'source': return { ...settings, sources: { ...settings.sources, [rest]: { ...settings.sources[rest], hotkey } } }
    case 'ring': return { ...settings, ring: { ...settings.ring, hotkey } }
    case 'snap': return { ...settings, windows: { ...settings.windows, hotkeys: { ...settings.windows.hotkeys, [rest]: hotkey } } }
    case 'app': return { ...settings, apps: { ...settings.apps, [rest]: { keyword: null, ...(settings.apps?.[rest] || {}), hotkey } } }
    case 'link': return { ...settings, links: (settings.links || []).map((link) => (link.id === rest ? { ...link, hotkey } : link)) }
    case 'capture': return { ...settings, captures: { ...settings.captures, hotkeys: { ...settings.captures.hotkeys, [rest]: hotkey } } }
    case 'row': return { ...settings, custom: (settings.custom || []).map((entry) => (entry.key === rest ? { ...entry, hotkey } : entry)) }
    default: return settings
  }
}

/* The keys OSAT registers with the Mac: a Hyper key is what the Hyper key sends. Raycast's leaves ⇧ out unless its
   "Include Shift" is ticked, so with `sends: 'three'` Hyper V is registered as ⌃⌥⌘V. Stored keys stay all four. */
export function systemKey(accelerator, sends = 'four') {
  const parts = String(accelerator || '').split('+')
  const isHyper = parts.length === 5 && HYPER.every((part) => parts.includes(part))
  return isHyper && sends === 'three' ? ['Control', 'Alt', 'Command', parts[4]].join('+') : accelerator
}

/* A recorded key: ⌃⌥⌘ and a key is the Hyper key when that is what the Hyper key sends. */
export function canonicalKey(combo, sends = 'four') {
  const parts = String(combo || '').split('+')
  const mods = parts.slice(0, -1)
  if (sends === 'three' && mods.length === 3 && ['Control', 'Alt', 'Command'].every((part) => mods.includes(part))) return hyper(parts.at(-1))
  return combo
}

/* The sources that are on, as the panel's tabs. */
export const activeSources = (settings) => SOURCES.filter((source) => settings.sources[source.id]?.on)

/* What a typed line starts with: a source's keyword ("v invoice" → the clipboard for "invoice"),
   an app's word or a quick link's. A keyword counts only as a whole word at the start, so "very good"
   is not the clipboard. Answers { source, query } | { keyword, query } | null. */
export function matchKeyword(settings, text, { rows = false } = {}) {
  const line = String(text || '').trim()
  const first = /^(\S+)(?:\s+([\s\S]*))?$/.exec(line)
  if (!first) return null
  const word = first[1].toLowerCase()
  const query = (first[2] || '').trim()
  for (const source of SOURCES) {
    const own = settings.sources[source.id]
    if (own?.on && own.keyword === word) return { source: source.id, query }
  }
  // An app opens on its word alone.
  const app = Object.entries(settings.apps || {}).find(([, own]) => own.keyword === word)
  if (app) return query ? null : { keyword: { id: `app:${app[0]}`, keyword: word, label: app[0], app: app[0] }, query: '' }
  // A quick link with {query} wants words to search for; one without opens on its word alone.
  const link = (settings.links || []).find((item) => item.on !== false && item.keyword === word)
  if (link) return link.url.includes('{query}') !== Boolean(query) ? null : { keyword: { id: link.id, keyword: word, label: link.name, url: link.url }, query }
  // Your own word for something in the bar (the bar only; the desk's line keeps to apps and links).
  const entry = rows && !query ? (settings.custom || []).find((item) => item.keyword === word) : null
  return entry ? { keyword: { id: `row:${entry.key}`, keyword: word, label: entry.title, row: entry }, query: '' } : null
}

export const keywordAddress = (keyword, query = '') => keyword.url.replace('{query}', encodeURIComponent(query))

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

/* ---------- Favorites, keys and words from the bar (Oct 2026) ---------- */

/* What can be a favorite, or have a key or a word of its own, from ⌘K in the bar: rooms and commands, notes, topics,
   the Mac's commands, apps, Emoji & symbols and window layouts. Files keep their pins, copies theirs. */
export const CUSTOM_KINDS = ['room', 'note', 'node', 'system', 'app', 'emoji', 'layout']
export const customizable = (row) => Boolean(row && CUSTOM_KINDS.includes(row.kind) && typeof row.key === 'string' && !/^(do|more|kw):/.test(row.key))

/* A row kept as it was shown: its key, kind, words and what doing it needs (small, plain data only). */
function cleanRow(value) {
  if (!value || typeof value !== 'object' || typeof value.key !== 'string' || !value.key || value.key.length > 200 || !CUSTOM_KINDS.includes(value.kind)) return null
  const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : {}
  let text
  try { text = JSON.stringify(data) } catch { return null }
  if (text.length > 1000) return null
  return { key: value.key, kind: value.kind, title: String(value.title || '').trim().slice(0, 80) || 'Untitled', subtitle: String(value.subtitle || '').slice(0, 120), data: JSON.parse(text) }
}

export const customOf = (settings, key) => (settings.custom || []).find((entry) => entry.key === key) || null

/* The patch that gives `row` a favorite, a key or a word (`change` is { favorite } | { hotkey } | { keyword }; null
   takes one away). An app keeps its key and word with the apps; the rest, and every favorite, are kept in `custom`
   with the row they came from (a layout's own key too, so giving one a key never turns on all the window keys). */
export function customize(settings, row, change) {
  if (row.kind === 'app' && !('favorite' in change)) return { apps: { [row.title]: change } }
  const list = settings.custom || []
  const before = list.find((entry) => entry.key === row.key)
  const entry = { favorite: false, hotkey: null, keyword: null, ...(before || cleanRow(row) || {}), ...change }
  const rest = list.filter((item) => item.key !== row.key)
  return { custom: entry.favorite || entry.hotkey || entry.keyword ? [...rest, entry] : rest }
}

/* The key or word a row has now, wherever it is kept (null when none). */
export function ownKeyOf(settings, row) {
  if (row.kind === 'app') return settings.apps?.[row.title]?.hotkey || null
  return customOf(settings, row.key)?.hotkey || null
}
export function ownWordOf(settings, row) {
  if (row.kind === 'app') return settings.apps?.[row.title]?.keyword || null
  return customOf(settings, row.key)?.keyword || null
}
export const idOf = (row) => (row.kind === 'app' ? `app:${row.title}` : `row:${row.key}`)

/* The favorites, as rows for the top of the bar. */
const SOURCE_OF = { app: 'apps', system: 'system', layout: 'windows', emoji: 'tools' }
export const favoriteRows = (settings) => (settings.custom || []).filter((entry) => entry.favorite)
  .map((entry) => ({ key: entry.key, source: SOURCE_OF[entry.kind] || 'notes', kind: entry.kind, title: entry.title, subtitle: entry.subtitle, section: 'Favorites', data: entry.data, favorite: true }))
