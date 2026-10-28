/* Passwords (Phase 58): the pure rules. No secrets are kept here and nothing here touches the disk or the
   network, so the window can import it too (the strength hint, the words). The sealed file and the crypto are
   shared/vault-format.mjs; main alone uses that, through desktop/passwords.cjs.
   What a window may ever see of an entry: `listing()` — id, title, username, web address, when it changed.
   A password crosses to the window only when asked (Reveal, or Copy, which is done in main). Filling one in the Web room
   (Phase 102) goes from main straight to the page, never through the window. */

export const MIN_MASTER = 10
export const MAX_MASTER = 512
export const MAX_PASSWORD = 1024
export const AUTO_LOCK_CHOICES = [1, 2, 5, 10, 15, 30]
export const DEFAULT_AUTO_LOCK = 5
export const REVEAL_MS = 10000
export const COPY_CLEAR_MS = 30000
export const MIN_LENGTH = 12
export const MAX_LENGTH = 64

export const COULDNT_UNLOCK = 'That didn’t unlock your passwords. Check the master password and try again.'
export const CANT_RECOVER = 'If you forget your master password it can’t be recovered: nobody, including OSAT, can open your passwords without it.'

/* ---- The master password's hint (length, not magic; nothing leaves the Mac) ---- */

export function strengthOf(password) {
  const text = String(password ?? '')
  const length = [...text].length
  const distinct = new Set(text).size
  if (length < MIN_MASTER) return { level: 0, ok: false, label: `Too short. Use at least ${MIN_MASTER} characters.` }
  // "aaaaaaaaaaaa" is long but guessable.
  const repetitive = distinct < Math.max(5, length / 4)
  const words = text.trim().split(/\s+/).length
  if (repetitive || length < 14) return { level: 1, ok: true, label: 'Okay. Longer is stronger.' }
  if (length < 20 && words < 4) return { level: 2, ok: true, label: 'Good. A few more characters would make it strong.' }
  return { level: 3, ok: true, label: 'Strong.' }
}

/* ---- Entries ---- */

const control = /[\u0000-\u001f\u007f]/g
const line = (value, max) => (typeof value === 'string' ? value.replace(control, ' ').trim().slice(0, max) : '')

/* What a window sends or what was read back, made into one entry (or null). `previous` is the entry being edited:
   a blank password keeps the old one. `newId` and `now` come from main. */
export function cleanEntry(raw, { previous = null, newId = () => '', now = () => new Date().toISOString() } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const title = line(raw.title, 120)
  if (!title) return null
  const typed = typeof raw.password === 'string' ? raw.password : ''
  if (typed.length > MAX_PASSWORD) return null
  const password = typed || previous?.password || ''
  if (!password) return null
  const id = previous?.id || newId()
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return null
  const stamp = now()
  return {
    id,
    title,
    username: line(raw.username, 200),
    url: line(raw.url, 500),
    password,
    createdAt: previous?.createdAt || stamp,
    updatedAt: stamp,
  }
}

/* The only part of an entry a window gets in a list. */
export const listing = (entry) => ({ id: entry.id, title: entry.title, username: entry.username, url: entry.url, updatedAt: entry.updatedAt })

export const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || String(a.id).localeCompare(String(b.id))

export function findEntries(list, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return list
  return list.filter((item) => {
    const hay = `${item.title} ${item.username} ${item.url}`.toLowerCase()
    return words.every((word) => hay.includes(word))
  })
}

export const cleanSettings = (raw) => ({ autoLockMinutes: AUTO_LOCK_CHOICES.includes(raw?.autoLockMinutes) ? raw.autoLockMinutes : DEFAULT_AUTO_LOCK })

/* ---- Sites (Phase 102): which logins belong on the page in front of the Web room ---- */

/* The host of a web address, lower case; '' when there is none. An address saved without https:// still has one. */
export function hostOf(url) {
  const text = String(url ?? '').trim()
  try { return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase() } catch { return '' }
}

/* A login fills only on an https page whose host is the login's own, or one under it split at a dot: github.com fills on
   gist.github.com, never on evilgithub.com or github.com.evil.com.
   ponytail: no public-suffix list, so a login saved for a shared host (vercel.app) fills on every site under it; add one if that bites. */
export function forSite(entryUrl, pageUrl) {
  let page
  try { page = new URL(pageUrl) } catch { return false }
  const host = hostOf(entryUrl)
  if (page.protocol !== 'https:' || !host) return false
  return page.hostname === host || page.hostname.endsWith(`.${host}`)
}

/* The same login: same host, username and password (an import skips one that is already here). */
export const loginKey = (entry) => JSON.stringify([hostOf(entry.url), entry.username, entry.password])

/* ---- Passwords exported from Chrome, Safari / Apple Passwords, Firefox or Bitwarden (Phase 102) ---- */

/* A CSV file as rows of fields: quoted fields, "" for a quote, line breaks inside quotes, CRLF and a BOM. */
export function csvRows(text) {
  const source = String(text ?? '').replace(/^﻿/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let at = 0; at < source.length; at += 1) {
    const c = source[at]
    if (quoted) {
      if (c !== '"') field += c
      else if (source[at + 1] === '"') { field += '"'; at += 1 }
      else quoted = false
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[at + 1] === '\n') at += 1
      rows.push([...row, field])
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  return rows.filter((cells) => cells.some(Boolean))
}

// Each export names its columns on its first line (Chrome: name,url,username,password,note; Apple: Title,URL,Username,
// Password,Notes,OTPAuth; Firefox: url,username,password,…; Bitwarden: …,name,…,login_uri,login_username,login_password,…).
const COLUMNS = { title: ['name', 'title'], url: ['url', 'login_uri'], username: ['username', 'login_username'], password: ['password', 'login_password'] }

/* An export's logins as entries for cleanEntry, or null when no column holds passwords. A row without a password
   (Bitwarden's notes and cards) and an Android app's login (android://) are left out. Firefox has no name column, so a
   login is named for its site. Notes, folders and one-time codes stay behind. */
export function fromCsv(text) {
  const [head = [], ...rows] = csvRows(text)
  const names = head.map((name) => name.trim().toLowerCase())
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([key, words]) => [key, names.findIndex((name) => words.includes(name))]))
  if (at.password < 0) return null
  const cell = (row, key) => (at[key] >= 0 ? row[at[key]] ?? '' : '')
  return rows.flatMap((row) => {
    const url = cell(row, 'url').trim()
    const password = cell(row, 'password')
    if (!password || /^android(app)?:/i.test(url)) return []
    const username = cell(row, 'username')
    return [{ title: cell(row, 'title').trim() || hostOf(url) || username, url, username, password }]
  })
}

/* What is sealed in the file, read back into shape. A mangled entry is dropped; a sealed file is never half-trusted:
   it only gets here after its tag has checked out. */
export function cleanVault(raw, { newId } = {}) {
  const entries = []
  const seen = new Set()
  for (const item of Array.isArray(raw?.entries) ? raw.entries : []) {
    const clean = cleanEntry(item, { previous: item && typeof item === 'object' ? { id: item.id, createdAt: item.createdAt, password: item.password } : null, newId, now: () => (typeof item?.updatedAt === 'string' ? item.updatedAt : new Date().toISOString()) })
    if (clean && !seen.has(clean.id)) { seen.add(clean.id); entries.push(clean) }
  }
  return { entries, settings: cleanSettings(raw?.settings) }
}

/* A backup's entries joined to what is here: new ones are added; one that is in both keeps whichever changed last. */
export function mergeEntries(have, incoming) {
  const out = new Map(have.map((entry) => [entry.id, entry]))
  let added = 0
  let updated = 0
  for (const entry of incoming) {
    const mine = out.get(entry.id)
    if (!mine) { out.set(entry.id, entry); added += 1 }
    else if (String(entry.updatedAt) > String(mine.updatedAt)) { out.set(entry.id, entry); updated += 1 }
  }
  return { entries: [...out.values()], added, updated }
}

/* ---- Wrong guesses slow down (after five, 30 seconds, then doubling, up to an hour) ---- */

export const FREE_TRIES = 5
export function waitFor(failed, lastAt, now) {
  if (!(failed >= FREE_TRIES) || !Number.isFinite(lastAt)) return 0
  const delay = Math.min(30000 * 2 ** Math.min(failed - FREE_TRIES, 20), 3600000)
  return Math.max(0, Math.min(delay, lastAt + delay - now))
}

export function waitWords(ms) {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `Too many tries. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
  const minutes = Math.ceil(seconds / 60)
  return `Too many tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

/* ---- The generator. `randomInt(n)` is crypto.randomInt in main: an even pick from 0..n-1. ---- */

export const LOWER = 'abcdefghijklmnopqrstuvwxyz'
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const DIGITS = '0123456789'
export const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?'

const pick = (set, randomInt) => set[randomInt(set.length)]
function shuffle(list, randomInt) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/* Every kind asked for is in it by construction (one of each, then the rest from all of them, then shuffled), so
   nothing is ever thrown away and drawn again. */
export function generatePassword({ length = 20, symbols = true } = {}, randomInt) {
  const size = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.trunc(Number(length)) || 20))
  const sets = symbols ? [LOWER, UPPER, DIGITS, SYMBOLS] : [LOWER, UPPER, DIGITS]
  const all = sets.join('')
  const chars = sets.map((set) => pick(set, randomInt))
  while (chars.length < size) chars.push(pick(all, randomInt))
  return shuffle(chars, randomInt).join('')
}

export function generatePassphrase({ words = 6 } = {}, randomInt) {
  const count = Math.min(12, Math.max(4, Math.trunc(Number(words)) || 6))
  return Array.from({ length: count }, () => pick(WORDS, randomInt)).join('-')
}

export function generate(options, randomInt) {
  return options?.words ? generatePassphrase({ words: options.words }, randomInt) : generatePassword(options, randomInt)
}

export const WORDS = (
  'able acid acorn actor adapt agile alarm album alert algae alley amber anchor angle ankle apple april apron arbor arena argue armor arrow aspen atlas attic audio autumn avoid award badge bagel baker balsa banjo barn basil basin beach beacon beard bench berry bike birch bison blade blank blaze blend bloom boat bonus boost bottle bowl brave bread brick bridge brisk broom brush bucket buddy bugle cabin cable cactus camel candle canoe canyon cargo carpet carrot castle cedar chalk charm cherry chess chime cider cinder circle civic clay clever cliff clock cloud clover coast cobalt cocoa comet coral cotton cousin craft crane crater creek crisp crown crumb crystal cubic curve daisy dance dawn delta denim desert dial diner dock dolphin donut dragon drift drum dune eagle earth easel echo edge elbow elder elm ember emerald engine entry envoy equal ethic fabric falcon fancy farm feast fence fern ferry fiddle field figure finch flame flint float flute focus forest fossil fox frame frost fruit gadget galaxy garden garlic gate gentle ginger glacier glass globe glove goat golden grain grape gravel green grove guitar gum habit hammer harbor harvest hazel heart hedge helmet herb heron hill honey horizon hotel humble hunter igloo inch indigo iron island ivory jacket jade jelly jewel jigsaw jolly journal jungle junior kayak kettle kernel kettle kiwi kite knight label ladder lake lamp lantern lapel laser lemon lens lilac linen lion lizard lobby locket lotus lucky lumber lunar magnet maple marble marsh meadow melody melon mesa metal meteor mint mirror mist mitten mocha moose moss motor mountain muffin mural mushroom nectar needle nest noble north notch novel nutmeg oak oasis ocean olive onion opal orbit orchard otter oven owl oyster paddle paint palace panda paper parcel parrot pasta pearl pebble pencil pepper piano picnic pillow pilot pine pixel planet plaza plum pocket poem polar pond poppy portal potato prairie prism puddle pumpkin puzzle quail quartz quest quill quilt rabbit radar radish rafter rain raven reed relay ribbon ridge river robin rocket rose ruby saddle safari sage sailor salad salmon sand sapphire satin scarf season shadow shell shore signal silver sketch slate sled smile snow solar sonnet sparrow spice spider spiral spoon spring spruce square squid stable star steam stone storm stream summit sunset swan swift table tablet talon tango teapot temple tender thistle thunder ticket tiger timber toast tomato torch tower trail train tulip tunnel turtle umbrella unity urban valley vapor velvet venture vessel village violet violin vivid voyage waffle walnut water wave wheat willow window winter wizard wolf wonder yacht yarn yellow yogurt zebra zenith zephyr zigzag zinc'
).split(' ').filter((word, at, all) => all.indexOf(word) === at)
