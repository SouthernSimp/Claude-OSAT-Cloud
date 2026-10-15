/* What a sticky is (Phase 67): an idea, a question, a problem, a to-do, a date, something to buy
   or a note. The kind says where else a sticky shows up (Questions, To buy, Coming up, the
   calendar) and, from Phase 68, which column it sits in on its board.

   Code reads the plain cases at once and offline (`guessWhat`); the AI settles what code isn't
   sure of during the filing run (`whatMessages` in ai-tasks.mjs); Nate's own pick always wins.
   Only the AI's or Nate's pick is kept on the sticky (`note.what`). Code's guess is worked out
   each time it is needed, so a sticky that is edited is read again. A day a sticky names
   (`whenOf`) is read from the day it was written, never from today. Pure. */

import { dayOf } from './calc.mjs'

export const WHATS = ['idea', 'question', 'problem', 'todo', 'date', 'buy', 'note']
export const WHAT_LABEL = { idea: 'Idea', question: 'Question', problem: 'Problem', todo: 'To-do', date: 'Date', buy: 'To buy', note: 'Note' }
// The paper each kind is drawn on (note-core's PAPERS).
export const WHAT_PAPER = { idea: 'canary', question: 'sky', problem: 'rose', todo: 'mint', date: 'lilac', buy: 'apricot', note: 'bone' }
export const isWhat = (value) => WHATS.includes(value)

/* The words of a sticky, its title once (a captured sticky's title is its first line). */
export function wordsOf(note) {
  const title = String(note?.title || '').trim()
  const body = String(note?.markdown || '').trim()
  return !title || body.toLowerCase().startsWith(title.toLowerCase()) ? body || title : `${title}\n${body}`
}

// Web addresses carry ? and / and numbers that aren't questions or dates.
const plain = (text) => String(text || '').replace(/\bhttps?:\/\/\S+/gi, ' ').replace(/\bwww\.\S+/gi, ' ')

/* ---------- things to buy ---------- */

// Food and the things bought with it: one word each, and the two-word ones in PHRASES.
const STOCK = new Set(`milk eggs egg bread butter cheese swiss cheddar mozzarella parmesan provolone feta brie yogurt yoghurt
cream creamer turkey ham chicken beef pork bacon sausage steak salami pepperoni salmon tuna shrimp fish tilapia cod mayo
mayonnaise mustard ketchup relish pickles lettuce romaine tomato onion garlic potato carrot celery cucumber jalapeno
spinach kale broccoli cauliflower zucchini squash corn peas mushroom avocado lemon lime banana apple orange grape berry
strawberry blueberry raspberry blackberry peach pear plum cherry watermelon cantaloupe pineapple mango rice pasta spaghetti
penne noodles ramen flour sugar salt vinegar cereal oats oatmeal granola coffee tea juice soda seltzer beer wine chips
crackers cookies pretzels popcorn nuts almonds peanuts cashews jelly jam honey syrup tortillas bagels buns rolls sourdough
baguette croissant muffin waffles pizza hummus salsa guacamole beans chickpeas lentils soup broth spices cinnamon paprika
oregano basil parsley cilantro ginger thyme rosemary vanilla yeast chocolate candy gum snacks tofu tempeh napkins tissues
detergent bleach soap shampoo conditioner toothpaste toothbrush floss mouthwash deodorant razors lotion sunscreen sponges
foil batteries diapers wipes formula vitamins ibuprofen tylenol advil bandaids`.split(/\s+/))
const PHRASES = ['sour cream', 'cream cheese', 'half and half', 'ground beef', 'hot dog', 'sweet potato', 'bell pepper', 'green bean',
  'brown sugar', 'olive oil', 'vegetable oil', 'coffee beans', 'sparkling water', 'bottled water', 'peanut butter', 'almond butter',
  'maple syrup', 'english muffin', 'pancake mix', 'ice cream', 'tomato sauce', 'pasta sauce', 'baking soda', 'baking powder',
  'protein bar', 'granola bar', 'oat milk', 'almond milk', 'soy milk', 'paper towel', 'toilet paper', 'paper plate', 'trash bag',
  'garbage bag', 'dish soap', 'dishwasher pod', 'fabric softener', 'dryer sheet', 'body wash', 'shaving cream', 'plastic wrap',
  'ziploc bag', 'sandwich bag', 'light bulb', 'dog food', 'cat food', 'cat litter', 'dog treat', 'band aid', 'cotton ball', 'q tip']

const singular = (word) => [word, word.replace(/ies$/, 'y'), word.replace(/(?<=[sxz]|ch|sh|o)es$/, ''), word.replace(/s$/, '')]
const isStock = (item) => {
  const text = item.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return false
  if (PHRASES.some((phrase) => text.includes(phrase))) return true
  return text.split(' ').some((word) => singular(word).some((form) => STOCK.has(form)))
}
// "2 lbs", "a dozen", "x2", "1 gallon of": amounts in front of or behind an item.
const AMOUNT = /\b(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|dozen|half|some|more)\s*(?:lbs?|pounds?|oz|ounces?|kg|g|grams?|gallons?|gal|liters?|l|packs?|pkgs?|bags?|boxes?|cans?|jars?|bottles?|cartons?|loaf|loaves|dozen|bunch(?:es)?|heads?|x)?\b(?:\s+of\b)?|\bx\s*\d+\b/gi

/* The items of a list written on one line or many: "milk, bread, turkey" or "- milk\n- bread". */
export function listItems(text) {
  return String(text || '')
    .split(/[\n,;]+|\s+and\s+|\s+&\s+/i)
    .map((item) => item.replace(/^\s*(?:[-*•·]|\d+[.)]|\[[ x]?\])\s*/i, '').replace(AMOUNT, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/* Mostly food or household things, two or more of them, each a few words: a shopping list. */
function looksLikeShopping(text) {
  const items = listItems(text).filter((item) => !/^(?:groceries|grocery list|shopping|shopping list|to buy|buy|get)$/i.test(item))
  if (items.length < 2 || items.some((item) => item.split(' ').length > 4)) return false
  return items.filter(isStock).length / items.length >= 0.6
}

// Said outright: buying something, whatever it is.
const BUY = /\b(?:buy|purchase|grocer(?:y|ies)|shopping\s+list|restock|re-?order|order\s+more)\b/i
// Errand words that mean buying only when what follows is a few words of food or household things
// ("get milk", not "get the oil changed" or "need more time").
const ERRAND = /\b(?:pick\s+up|grab|get(?:\s+(?:some|more))?|need(?:\s+(?:some|more))?|out\s+of|low\s+on)\s+([^.!?\n]{2,80})/i
function errandForStock(text) {
  const match = ERRAND.exec(text)
  if (!match) return false
  const thing = match[1].split(/\b(?:for|from|at|before|after|so|to|tomorrow|today|tonight|on)\b/i)[0].replace(/^\s*(?:the|a|an|some|more)\s+/i, '').trim()
  const words = thing.split(/\s+/)
  return words.length <= 4 && !/ed$/i.test(words.at(-1) || '') && isStock(thing)
}

/* ---------- a day it names ---------- */

const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DAYNAME = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday)'
const SHORTDAY = '(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)'
const CLOCK = '\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)'
const DAY_MS = 86400000

// Each finds a day in words and says which words dayOf reads ("nov 1", "friday", "tomorrow").
const DAYS = [
  { re: new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'), words: (m) => `${m[1]} ${m[2]}${m[3] ? ` ${m[3]}` : ''}`, year: (m) => Boolean(m[3]) },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(\\d{4}))?\\b`, 'i'), words: (m) => `${m[2]} ${m[1]}${m[3] ? ` ${m[3]}` : ''}`, year: (m) => Boolean(m[3]) },
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, words: (m) => m[0], year: () => true },
  { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/, words: (m) => m[0], year: () => true },
  // "1/2" alone is as often half a cup as January 2nd: only after on, by, due, until, before or for.
  { re: /\b(?:on|by|due|until|before|for)\s+(\d{1,2}\/\d{1,2})\b(?!\/)/i, words: (m) => m[1] },
  { re: /\b(today|tonight|tomorrow|tmrw|tmr)\b/i, words: (m) => (/^t(?:mr|mrw|omorrow)$/i.test(m[1]) ? 'tomorrow' : 'today') },
  { re: /\b(christmas eve|christmas|xmas|new year['’]?s eve|new year['’]?s|halloween|thanksgiving|valentine['’]?s day|july 4th|independence day)\b/i, words: (m) => m[1].toLowerCase().replace(/['’]/g, "'").replace(/new year'?s/, "new year's").replace(/valentine'?s/, "valentine's"), holiday: true },
  { re: new RegExp(`\\b(?:(?:this|next|on)\\s+)?${DAYNAME}\\b(?!s\\b)`, 'i'), words: (m) => m[1], weekday: true },
  // "Fri" and "Sat" are words too ("sat down"): only with on/this/next before, or a time or day after.
  { re: new RegExp(`\\b(?:this|next|on)\\s+${SHORTDAY}\\b\\.?`, 'i'), words: (m) => m[1], weekday: true },
  { re: new RegExp(`\\b${SHORTDAY}\\.?\\s+(?=${CLOCK}|\\d{1,2}\\/\\d{1,2}|at\\s+\\d)`, 'i'), words: (m) => m[1], weekday: true },
  { re: /\bin\s+(\d{1,2})\s+(days?|weeks?)\b/i, ahead: (m) => Number(m[1]) * (/^w/i.test(m[2]) ? 7 : 1) },
]
const TIMES = [
  { re: /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![\p{L}])/iu, read: (m) => clock(Number(m[1]), Number(m[2] || 0), /^p/i.test(m[3]) ? 'pm' : 'am') },
  { re: /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i, read: (m) => clock(Number(m[1]), Number(m[2]), null) },
  { re: /\b(noon|midday)\b/i, read: () => '12:00' },
  // "at 3": an hour alone. Seven and before is the afternoon, eight to eleven the morning.
  { re: /\bat\s+(\d{1,2})\b(?![:/\d%.])(?!\s*(?:people|percent|dollars|bucks|items|times|%))/i, read: (m) => clock(Number(m[1]), 0, null) },
]
const pad = (n) => String(n).padStart(2, '0')
function clock(hour, minute, half) {
  if (hour > 23 || minute > 59) return ''
  let h = hour
  if (half === 'pm' && h < 12) h += 12
  else if (half === 'am' && h === 12) h = 0
  else if (!half && h >= 1 && h <= 7) h += 12
  return `${pad(h)}:${pad(minute)}`
}
// Words that say it already happened: no day to put on a calendar.
const PAST = /\b(?:yesterday|ago|last\s+(?:night|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|earlier\s+today)\b/i
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
// dayOf adds whole days in milliseconds, so across a clock change it can land an hour early.
const nearestDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + (date.getHours() >= 12 ? 1 : 0))

/* The day (and time) a text names, read from `now` (when it was written):
   { date: 'YYYY-MM-DD', time: 'HH:MM' | '', title } or null. `title` is the line it was in, without
   the day and time ("Dentist" from "Dentist Thursday 2pm"). A day more than 200 days off with no
   year written is a past one ("Oct 3" written Oct 10), so it is none. */
export function findWhen(text, now = new Date()) {
  const source = plain(text)
  if (!source.trim() || PAST.test(source)) return null
  let best = null
  for (const pattern of DAYS) {
    const match = pattern.re.exec(source)
    if (match && (!best || match.index < best.match.index)) best = { pattern, match }
  }
  if (!best) return null
  const { pattern, match } = best
  const today = startOf(now)
  let day = pattern.ahead ? new Date(today.getFullYear(), today.getMonth(), today.getDate() + pattern.ahead(match)) : dayOf(pattern.words(match), today, true)
  if (!day || Number.isNaN(day.getTime())) return null
  day = nearestDay(day)
  let time = ''
  let timeMatch = null
  for (const candidate of TIMES) {
    const found = candidate.re.exec(source)
    if (found && found.index !== match.index) { time = candidate.read(found); timeMatch = found; break }
  }
  if (!time && /^tonight$/i.test(match[1] || '')) time = '19:00'
  // "Thursday 2pm" written on a Thursday morning is today, not a week away.
  if (pattern.weekday && time) {
    const sameDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const [h, m] = time.split(':').map(Number)
    if (sameDay.getDay() === day.getDay() && (day - today) / DAY_MS >= 6.5 && new Date(sameDay.getFullYear(), sameDay.getMonth(), sameDay.getDate(), h, m) > now) day = sameDay
  }
  const ahead = Math.round((day - today) / DAY_MS)
  if (ahead < 0 || (!pattern.year?.(match) && !pattern.holiday && ahead > 200)) return null
  return { date: dateKey(day), time, title: titleAround(source, pattern.holiday ? null : match, timeMatch, match.index) }
}

// The line the day was named in, without the day (a holiday keeps its name: "Christmas party") and the time.
function titleAround(source, match, timeMatch, at) {
  const start = source.lastIndexOf('\n', at) + 1
  const end = source.indexOf('\n', at)
  let line = source.slice(start, end < 0 ? source.length : end)
  // The later one first, so the earlier one's place in the line still holds.
  for (const found of [match, timeMatch].filter(Boolean).sort((a, b) => b.index - a.index)) {
    const at = found.index - start
    if (at >= 0 && at < line.length) line = `${line.slice(0, at)} ${line.slice(at + found[0].length)}`
  }
  return line
    .replace(/#a2c\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:—–@-]+|[\s,;:—–@-]+$/g, '')
    .replace(/\s+(?:on|at|by|this|next|from|for|until|the)$/i, '')
    .replace(/^(?:on|at)\s+/i, '')
    .replace(/^[\s,;:—–@-]+|[\s,;:—–@-]+$/g, '')
    .replace(/\s+([?!.,])/g, '$1')
    .replace(/^\p{Ll}/u, (letter) => letter.toUpperCase())
    .slice(0, 120)
}

/* When a sticky's day is: a scan's (`ask`) first, else the day its words name, read from the day
   it was written. { date, time, title, start: Date } or null. */
const days = new WeakMap()
export function whenOf(note) {
  if (!note || note.kind === 'day') return null
  if (typeof note === 'object' && days.has(note)) return days.get(note)
  const when = readWhen(note)
  if (typeof note === 'object') days.set(note, when)
  return when
}

function readWhen(note) {
  const asked = note.ask?.event
  const found = asked?.date ? { date: asked.date, time: asked.time || '', title: asked.title } : findWhen(wordsOf(note), new Date(Date.parse(note.createdAt) || Date.now()))
  if (!found) return null
  const [y, mo, d] = found.date.split('-').map(Number)
  const [h, mi] = (found.time || '09:00').split(':').map(Number)
  return { ...found, title: found.title || note.title || 'A sticky', start: new Date(y, mo - 1, d, h, mi) }
}

/* ---------- the rest ---------- */

// Nate's own tags (Phase 28's plan): #n2b / #w2b need / want to buy, #n2d / #w2d to do, #a2c add to calendar.
const TAGGED = {
  n2b: 'buy', w2b: 'buy', buy: 'buy', groceries: 'buy', grocery: 'buy', shopping: 'buy',
  n2d: 'todo', w2d: 'todo', todo: 'todo', task: 'todo', a2c: 'date',
  idea: 'idea', ideas: 'idea', bs: 'idea', brainstorm: 'idea', question: 'question', q: 'question', ask: 'question',
  bug: 'problem', problem: 'problem', issue: 'problem',
}
const QUESTION_START = /^(?:who|whom|whose|what(?!\s+if\b)|when|where|why(?!\s+not\b)|how(?!\s+about\b)|which|is|are|am|was|were|isn['’]?t|aren['’]?t|can(?!['’]?t\b)|could|should(?!\s*n['’]?t\b|\s+not\b)|would|does|did|doesn['’]?t|didn['’]?t|shall|do\s+(?:i|we|you|they|people)|i\s+wonder)\b/i
// "can't" and "won't" alone are too common ("something I can't place") to mean something is wrong: the AI decides those.
const PROBLEM = /\b(?:bugs?|broken|breaks|doesn['’]?t\s+work|does\s+not\s+work|isn['’]?t\s+working|not\s+working|crash(?:es|ed|ing)?|errors?|fails?|failing|glitch(?:y|es)?|issues?|problems?|wrong|laggy|lags|freez(?:es|ing)|stuck|annoying|confusing|hard\s+to|too\s+(?:slow|small|big|hard|many|much)|should\s*n['’]?t|should\s+not|doesnt|isnt|shouldnt|keeps?\s+\w+ing|no\s+way\s+to)\b/i
const TODO_START = /^(?:call|text|email|e-mail|message|reply|respond|send|pay|book|schedule|renew|cancel|return|finish|fix|update|clean|wash|mow|file|submit|sign|print|order|ship|write|draft|review|check|ask|tell|remind|set\s+up|setup|install|upgrade|back\s+up|move|sell|post|publish|deploy|merge|test|prepare|plan|research|read|watch|learn|register|apply|refill|bring|drop\s+off|follow\s+up|connect|hook\s+up|start|stop|make|get|go|take|clear|organize|change|add|remove|delete|try|look\s+into|figure\s+out|finish|complete|do(?!\s+(?:i|we|you|they|people)\b))\b/i
const TODO = /\b(?:need\s+to|needs\s+to|have\s+to|has\s+to|must|remember\s+to|don['’]?t\s+forget|dont\s+forget|to-?do|to\s+do\b|reminder)\b|^\s*-\s*\[\s?\]/im
const IDEA = /\b(?:what\s+if|ideas?|we\s+could|could\s+we|you\s+could|maybe|it\s+would\s+be|would\s+be\s+(?:cool|nice|great|neat|awesome|fun)|imagine|how\s+about|why\s+not|let['’]?s|i\s+want|i['’]?d\s+like|i\s+wish|i\s+believe|i\s+think|should\s+we|an?\s+app\s+(?:that|for|to)|a\s+tool|feature|integrate|concept|could\s+be\s+done)\b/i

/* What code can tell a sticky is, at once and offline: { what, sure, when }. `sure` is false when
   it only fell through to a default; the AI settles those. A long note is a note. A sticky is a new
   object whenever it changes, so each one is read once (lists and counts ask on every keystroke). */
const read = new WeakMap()
export function guessWhat(note) {
  if (note && typeof note === 'object') {
    if (!read.has(note)) read.set(note, readWhat(note))
    return read.get(note)
  }
  return readWhat(note)
}

function readWhat(note) {
  const text = plain(wordsOf(note))
  const flat = text.replace(/\s+/g, ' ').trim()
  const when = whenOf(note)
  if (!flat) return { what: 'note', sure: false, when: null }
  if (flat.length > 600 || /^#{1,3}\s/m.test(text)) return { what: 'note', sure: false, when }
  for (const tag of note?.tags || []) if (TAGGED[tag]) return { what: TAGGED[tag] === 'date' && !when ? 'todo' : TAGGED[tag], sure: true, when }
  const first = flat.split(/(?<=[.!?])\s/)[0]
  if (/\?/.test(flat.slice(0, 300)) || /^(?:q|question)\s*[:\-]/i.test(flat)) return { what: 'question', sure: true, when }
  // Buying said near the start ("Buy a monitor", "I need to buy…"), not in passing at the end of a long thought.
  if (BUY.test(flat.slice(0, 60)) || looksLikeShopping(text)) return { what: 'buy', sure: true, when }
  if (errandForStock(flat)) return { what: 'buy', sure: true, when }
  if (when) return { what: 'date', sure: true, when }
  if (PROBLEM.test(flat)) return { what: 'problem', sure: true, when }
  if (TODO.test(text) || TODO_START.test(flat)) return { what: 'todo', sure: true, when }
  if (QUESTION_START.test(first) && first.length <= 160) return { what: 'question', sure: true, when }
  if (IDEA.test(flat)) return { what: 'idea', sure: true, when }
  return { what: flat.length <= 280 ? 'idea' : 'note', sure: false, when }
}

/* What a sticky is: Nate's or the AI's pick, else code's guess. A day page is none. */
export function whatOf(note) {
  if (!note || note.kind === 'day') return null
  return isWhat(note.what) ? note.what : guessWhat(note).what
}
