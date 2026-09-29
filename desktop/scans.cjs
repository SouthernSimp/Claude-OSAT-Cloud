/* Scans from the printer. Nate's scanner saves each scan to a folder (his Brother puts
   them in Google Drive's From_BrotherDevice, which Google Drive for desktop keeps on this
   Mac). OSAT watches the folder Nate chose: each new scan is read on this Mac (mac-files'
   text recognition), the AI sorts what it says into one node (a name, branches, stickies,
   and a date on a sticky becomes a question: add it to the Calendar?), and the desk
   imports it. A node file (.json, as the old agent made them) goes straight in.
   A scan counts as done only once the desk has it, so a quit never loses one. Scans that
   were already in the folder when it was chosen are left alone, and nothing in the folder
   is ever moved or changed. The file system, the reader and the AI are passed in. */
const path = require('node:path')
const nodeFs = require('node:fs/promises')

const KINDS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff', '.json'])
const SETTLE_MS = 5000
const MAX_BYTES = 80 * 1024 * 1024
const TRIES = 3

/* ---- what the AI is asked, and the shape its answer must have ---- */

const EVENT = {
  oneOf: [
    { type: 'null' },
    { type: 'object', properties: { title: { type: 'string', maxLength: 120 }, date: { type: 'string', format: 'date' }, time: { type: 'string', maxLength: 5 } } },
  ],
}
const STICKIES = { type: 'array', maxItems: 40, items: { type: 'object', properties: { text: { type: 'string', maxLength: 600 }, event: EVENT } } }
const SUB_BRANCH = { type: 'object', properties: { name: { type: 'string', maxLength: 60 }, stickies: STICKIES } }
const BRANCH = { type: 'object', properties: { name: { type: 'string', maxLength: 60 }, stickies: STICKIES, branches: { type: 'array', maxItems: 8, items: SUB_BRANCH } } }
const SCAN_SCHEMA = { type: 'object', properties: { name: { type: 'string', maxLength: 60 }, branches: { type: 'array', maxItems: 12, items: BRANCH }, stickies: STICKIES } }

function scanMessages({ text, names = [], now = new Date() }) {
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now)
  const nodes = names.filter(Boolean).slice(0, 40)
  const system = `You sort scanned notes into one node for OSAT, a private notes app. Today is ${weekday}, ${today}.
The text was read from a scan of handwritten sticky notes or a page of notes, so a few words may be misread.
- name: a short name for the whole scan, 2 to 5 words.
- Split the text into stickies: one idea, task or fact each, in the writer's own words. Fix only obvious misreadings.
- Put stickies that belong together in a branch with a short name. Give a branch its own branches only when it clearly has parts. A sticky that fits no branch goes in the top-level stickies.
- When two stickies say the same thing, keep one sticky that holds both.
- When a sticky names a day (an event, appointment or deadline), give it an event: a short title, the date as YYYY-MM-DD and the time as HH:MM in 24 hours, or "" when no time is written. Dates like 10/5/26 are month/day/year. A date with no year is the next one after today. Otherwise event is null.
${nodes.length ? `- The person already has these nodes: ${nodes.join(', ')}. When a sticky clearly belongs with one, add @ and its exact name to the sticky's text.\n` : ''}Keep every piece of information and never invent any.`
  return [{ role: 'system', content: system }, { role: 'user', content: String(text).slice(0, 12000) }]
}

/* ---- the node file the desk imports (nodes-model's importNode) ---- */

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const wordsOf = (text) => String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []

/* A day more than a year gone is a misread year (a scan has no reason to plan 2006):
   it moves to the next time that month and day come round. */
function eventOf(raw, now) {
  let date = clean(raw?.date, 10)
  const [y, m, d] = date.split('-').map(Number)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(y, m - 1, d)
  if (!day || day.getMonth() !== m - 1 || day.getDate() !== d) return null
  if (now - day > 366 * 86400000) {
    let year = now.getFullYear()
    if (new Date(year, m - 1, d) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year += 1
    date = `${year}${date.slice(4)}`
  }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(clean(raw?.time, 5)) ? raw.time.trim() : ''
  return { title: clean(raw?.title, 120) || 'An event', date, time }
}

/* The AI's answer as a node file: empty stickies and branches dropped, events only with a
   real date, and a sticky whose words an earlier one already holds ("Call florist re:
   roses!!" after "Call the florist about roses") folded into it. When the answer left out
   much of what the scan said (small models do), it's not trusted: null. */
function toNode(answer, text, now = new Date()) {
  const seen = new Set()
  const kept = []
  const leaves = (list) => (Array.isArray(list) ? list : []).flatMap((item) => {
    const value = clean(item?.text, 600)
    const words = new Set(wordsOf(value))
    if (!value || (words.size && kept.some((earlier) => [...words].every((word) => earlier.has(word))))) return []
    kept.push(words)
    for (const word of words) seen.add(word)
    const event = eventOf(item?.event, now)
    return [event ? { text: value, event } : { text: value }]
  })
  const branch = (raw, depth) => {
    const name = clean(raw?.name, 60)
    const made = { title: name, leaves: leaves(raw?.stickies), sub_branches: depth ? [] : (Array.isArray(raw?.branches) ? raw.branches : []).map((item) => branch(item, 1)).filter(Boolean) }
    return name && (made.leaves.length || made.sub_branches.length) ? made : null
  }
  const node = {
    title: clean(answer?.name, 60),
    branches: (Array.isArray(answer?.branches) ? answer.branches : []).map((item) => branch(item, 0)).filter(Boolean),
    leaves: leaves(answer?.stickies),
  }
  // ponytail: word overlap is a rough "did it keep everything"; a paraphrasing model trips it and gets the plain node.
  const source = wordsOf(text)
  if (!kept.length || (source.length && source.filter((word) => seen.has(word)).length / source.length < 0.5)) return null
  return node
}

/* Without the AI (not set up yet, or its answer not trusted): one sticky per paragraph,
   or per line when the scan has no blank lines. */
function plainNode(text, title) {
  const paragraphs = String(text).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  const parts = paragraphs.length > 1 ? paragraphs : String(text).split('\n').map((line) => line.trim()).filter(Boolean)
  return { title, leaves: parts.slice(0, 80).map((part) => ({ text: part.slice(0, 8000) })) }
}

/* A scan's own name when it has words in it ("Wedding plans.pdf"), else "Scan Sep 28". */
function nameFor(file, now) {
  const stem = path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ').trim()
  return /\p{L}{3,}/u.test(stem) && !/^(scan|img|image|doc)\b/i.test(stem)
    ? stem.slice(0, 60)
    : `Scan ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(now)}`
}

/* ---- the watcher ---- */

// A scan is known by its size and when it was made, so a rename (or reading a folder that
// Google Drive only streams) never needs the whole file.
const keyOf = (stat) => `${stat.size}-${Math.round(stat.mtimeMs)}`

function createScans({ seenPath, read, organize, fs = nodeFs, now = () => Date.now(), onChange = () => {} }) {
  let saved = null // { dir, files: { key: { name, at } } }
  const waiting = new Map() // key → { id, name, node }
  const tries = new Map()
  let scanning = null
  let error = ''

  async function load() {
    if (saved) return saved
    try {
      const raw = JSON.parse(await fs.readFile(seenPath, 'utf8'))
      saved = { dir: typeof raw.dir === 'string' ? raw.dir : null, files: raw.files && typeof raw.files === 'object' ? raw.files : {} }
    } catch {
      saved = { dir: null, files: {} }
    }
    return saved
  }
  const save = () => fs.writeFile(seenPath, `${JSON.stringify(saved, null, 1)}\n`)

  const status = () => ({ dir: saved?.dir || null, waiting: waiting.size, last: saved && Object.values(saved.files).map((file) => file.at).filter(Boolean).sort().at(-1) || null, error })

  /* The settled scans in the folder, oldest first. */
  async function listing(dir) {
    const found = []
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.') || !KINDS.has(path.extname(entry.name).toLowerCase())) continue
      const file = path.join(dir, entry.name)
      try {
        const stat = await fs.stat(file)
        if (now() - stat.mtimeMs >= SETTLE_MS && stat.size > 0 && stat.size <= MAX_BYTES) found.push({ file, name: entry.name, key: keyOf(stat), at: stat.mtimeMs })
      } catch {
        // Gone or busy: the next look finds it.
      }
    }
    return found.sort((a, b) => a.at - b.at)
  }

  /* Watch this folder from now on; what's in it already stays as it is. */
  async function use(dir) {
    await load()
    saved = { dir, files: Object.fromEntries((await listing(dir)).map((item) => [item.key, { name: item.name, at: null }])) }
    waiting.clear()
    error = ''
    await save()
    onChange()
  }

  async function stop() {
    await load()
    saved = { dir: null, files: {} }
    waiting.clear()
    await save()
    onChange()
  }

  async function nodeFor(item) {
    if (path.extname(item.file).toLowerCase() === '.json') {
      const data = JSON.parse(await fs.readFile(item.file, 'utf8'))
      if (!clean(data?.title, 200) && !clean(data?.name, 200)) throw new Error('NOT_A_NODE')
      return data
    }
    const title = nameFor(item.name, now())
    let text
    try {
      text = await read(item.file)
    } catch (failure) {
      if (failure?.message !== 'EMPTY') throw failure
      return { title, leaves: [{ text: `OSAT couldn’t find any words on this scan. It’s still in the scans folder as “${item.name}”.` }] }
    }
    let node = null
    try { node = toNode(await organize(text), text, new Date(now())) } catch { node = null }
    return node ? { ...node, title: node.title || title } : plainNode(text, title)
  }

  async function scanOnce() {
    const { dir, files } = await load()
    if (!dir) return 0
    let list
    try {
      list = await listing(dir)
      error = ''
    } catch (failure) {
      error = failure.code === 'ENOENT'
        ? 'The scans folder isn’t there anymore. Choose it again in Settings → Data.'
        : `OSAT couldn’t look in the scans folder (${failure.code || failure.message}).`
      onChange()
      return 0
    }
    let count = 0
    for (const item of list) {
      if (files[item.key] || waiting.has(item.key)) continue
      let node
      try {
        node = await nodeFor(item)
      } catch {
        // Not downloaded yet, or unreadable: a few more tries, then it's left alone.
        const tried = (tries.get(item.key) || 0) + 1
        tries.set(item.key, tried)
        if (tried >= TRIES) {
          files[item.key] = { name: item.name, at: null, skipped: true }
          await save()
        }
        continue
      }
      if (saved.dir !== dir) return count
      waiting.set(item.key, { id: item.key, name: item.name, node })
      count += 1
      onChange()
    }
    return count
  }

  function scan() {
    scanning ??= scanOnce().finally(() => { scanning = null })
    return scanning
  }

  /* The desk takes what's waiting, imports it, then says done for each. */
  const take = () => [...waiting.values()]
  async function done(id) {
    const item = waiting.get(id)
    if (!item) return
    waiting.delete(id)
    saved.files[id] = { name: item.name, at: new Date(now()).toISOString() }
    await save()
    onChange()
  }

  return { load, use, stop, scan, take, done, status }
}

module.exports = { createScans, scanMessages, toNode, plainNode, nameFor, SCAN_SCHEMA }
