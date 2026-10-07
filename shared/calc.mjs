/* The calculator in the line and the quick search (Phase 13): `2*49` answers in place. A small
   reader for sums, never eval: numbers, + - * / ^ %, brackets, a few functions (sqrt, abs, round,
   floor, ceil, min, max, sin, cos, tan, ln, log) and pi / e. "12% of 80" is 9.6 and "100 + 10%" is
   110. Only something that is a sum answers: a bare number or a word is not math. Pure. */

const FUNCTIONS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  ln: Math.log, log: Math.log10, min: Math.min, max: Math.max, pow: Math.pow,
}
const CONSTANTS = { pi: Math.PI, e: Math.E }
const MAX_LENGTH = 120

function tokenize(text) {
  const tokens = []
  const source = text.replace(/[×∙·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\$/g, '')
  const pattern = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([a-z]+)|(.))/giy
  let match
  while ((match = pattern.exec(source)) && match[0] !== '') {
    if (match[1] !== undefined) tokens.push({ t: 'num', v: Number(match[1]) })
    else if (match[2] !== undefined) tokens.push(match[2].toLowerCase() === 'x' ? { t: 'op', v: '*' } : { t: 'word', v: match[2].toLowerCase() })
    else if (match[3].trim()) tokens.push({ t: 'op', v: match[3] })
  }
  return tokens
}

/* A recursive reader; throws on anything it doesn't understand. `calls` says a function was used. */
function parse(tokens) {
  let at = 0
  let depth = 0
  let signs = 0
  const peek = () => tokens[at]
  const take = (value) => (peek()?.t === 'op' && peek().v === value ? tokens[at++] : null)
  const must = (value) => { if (!take(value)) throw new Error('expected') }

  function expression() {
    if (++depth > 30) throw new Error('deep')
    let left = term()
    for (;;) {
      const op = take('+') ? '+' : take('-') ? '-' : null
      if (!op) break
      left = { t: 'bin', op, a: left, b: term() }
      signs += 1
    }
    depth -= 1
    return left
  }
  function term() {
    let left = unary()
    for (;;) {
      const op = take('*') ? '*' : take('/') ? '/' : null
      if (op) { left = { t: 'bin', op, a: left, b: unary() }; signs += 1; continue }
      // "12% of 80"
      if (left.t === 'pct' && peek()?.t === 'word' && peek().v === 'of') { at += 1; left = { t: 'bin', op: '*', a: left, b: unary() }; signs += 1; continue }
      break
    }
    return left
  }
  function unary() {
    if (take('-')) return { t: 'neg', a: unary() }
    if (take('+')) return unary()
    return power()
  }
  function power() {
    const base = postfix()
    if (take('^')) { signs += 1; return { t: 'bin', op: '^', a: base, b: unary() } }
    return base
  }
  function postfix() {
    let node = primary()
    while (take('%')) node = { t: 'pct', a: node }
    return node
  }
  function primary() {
    const token = tokens[at++]
    if (!token) throw new Error('short')
    if (token.t === 'num') return { t: 'num', v: token.v }
    if (token.t === 'op' && token.v === '(') { const inner = expression(); must(')'); return inner }
    if (token.t === 'word') {
      if (token.v in CONSTANTS) return { t: 'num', v: CONSTANTS[token.v] }
      if (token.v in FUNCTIONS && take('(')) {
        const args = [expression()]
        while (take(',')) args.push(expression())
        must(')')
        signs += 1
        return { t: 'fn', name: token.v, args }
      }
    }
    throw new Error('unknown')
  }

  const tree = expression()
  if (at !== tokens.length) throw new Error('left over')
  return { tree, hasOperator: signs > 0 }
}

function run(node) {
  switch (node.t) {
    case 'num': return node.v
    case 'neg': return -run(node.a)
    case 'pct': return run(node.a) / 100
    case 'fn': return FUNCTIONS[node.name](...node.args.map(run))
    default: {
      // 100 + 10% is 110: a percentage after + or - is a share of the left side.
      if ((node.op === '+' || node.op === '-') && node.b.t === 'pct') {
        const left = run(node.a)
        return node.op === '+' ? left + left * run(node.b) : left - left * run(node.b)
      }
      const [a, b] = [run(node.a), run(node.b)]
      return { '+': a + b, '-': a - b, '*': a * b, '/': a / b, '^': a ** b }[node.op]
    }
  }
}

/* 98 → "98", 1/3 → "0.3333333333", 1234567.5 → "1,234,567.5" (`plain` has no commas, for copying). */
export function formatNumber(value) {
  if (Math.abs(value) >= 1e15 || (value !== 0 && Math.abs(value) < 1e-9)) {
    const exponent = value.toExponential(9).replace(/\.?0+e/, 'e')
    return { text: exponent, plain: exponent }
  }
  const rounded = Number(value.toPrecision(12))
  const plain = String(rounded)
  return { text: rounded.toLocaleString('en-US', { maximumFractionDigits: 10 }), plain }
}

/* "2*49" → { value: 98, text: '98', plain: '98' }; "5 km in miles" and "days until christmas" answer too (Oct 2026:
   units and dates, worked out here, offline). null when it isn't a sum (or can't be worked out). `now` is for tests. */
export function calculate(input, { now = new Date() } = {}) {
  return sum(input) || convert(input) || dates(input, now)
}

function sum(input) {
  const raw = String(input ?? '').trim()
  if (!raw || raw.length > MAX_LENGTH || !/\d|pi|\be\b/i.test(raw)) return null
  // A date or a phone number written with dashes is not a subtraction.
  if (/^\d+(-\d+)+$/.test(raw)) return null
  try {
    const { tree, hasOperator } = parse(tokenize(raw))
    if (!hasOperator) return null
    const value = run(tree)
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return { value, ...formatNumber(value) }
  } catch {
    return null
  }
}

/* ---------- units: "5 km in miles", "72 f to c", "3 cups in ml" ---------- */

// Each unit: its words, its kind and how many of the kind's base unit one is (metre, gram, millilitre, second, byte, m/s).
const UNITS = [
  ['length', 0.001, 'mm', 'millimeter millimeters millimetre millimetres'], ['length', 0.01, 'cm', 'centimeter centimeters centimetre centimetres'],
  ['length', 1, 'm', 'meter meters metre metres'], ['length', 1000, 'km', 'kilometer kilometers kilometre kilometres kms'],
  ['length', 0.0254, 'in', 'inch inches'], ['length', 0.3048, 'ft', 'foot feet'], ['length', 0.9144, 'yd', 'yard yards'], ['length', 1609.344, 'mi', 'mile miles'],
  ['mass', 0.001, 'mg', 'milligram milligrams'], ['mass', 1, 'g', 'gram grams'], ['mass', 1000, 'kg', 'kilogram kilograms kilo kilos'],
  ['mass', 28.349523125, 'oz', 'ounce ounces'], ['mass', 453.59237, 'lb', 'lbs pound pounds'], ['mass', 6350.29318, 'st', 'stone stones'],
  ['volume', 1, 'ml', 'milliliter milliliters millilitre millilitres'], ['volume', 1000, 'l', 'liter liters litre litres'],
  ['volume', 4.92892159375, 'tsp', 'teaspoon teaspoons'], ['volume', 14.78676478125, 'tbsp', 'tablespoon tablespoons'],
  ['volume', 29.5735295625, 'fl oz', 'floz'], ['volume', 236.5882365, 'cups', 'cup'], ['volume', 473.176473, 'pints', 'pint pt'],
  ['volume', 946.352946, 'quarts', 'quart qt'], ['volume', 3785.411784, 'gal', 'gallon gallons'],
  ['time', 1, 's', 'sec secs second seconds'], ['time', 60, 'min', 'mins minute minutes'], ['time', 3600, 'h', 'hr hrs hour hours'],
  ['time', 86400, 'days', 'day d'], ['time', 604800, 'weeks', 'week wk wks'],
  ['data', 1, 'B', 'b byte bytes'], ['data', 1e3, 'KB', 'kb kilobyte kilobytes'], ['data', 1e6, 'MB', 'mb megabyte megabytes'],
  ['data', 1e9, 'GB', 'gb gigabyte gigabytes'], ['data', 1e12, 'TB', 'tb terabyte terabytes'],
  ['speed', 1, 'm/s', 'mps'], ['speed', 1000 / 3600, 'km/h', 'kph kmh'], ['speed', 1609.344 / 3600, 'mph', 'mph'],
  ['temperature', null, '°C', 'c celsius centigrade °c'], ['temperature', null, '°F', 'f fahrenheit °f'], ['temperature', null, 'K', 'k kelvin'],
].map(([kind, size, name, words]) => ({ kind, size, name, words: new Set([name.toLowerCase(), ...words.split(' ')]) }))

const unitNamed = (word) => {
  const plain = String(word || '').toLowerCase().replace(/\.$/, '').trim()
  return UNITS.find((unit) => unit.words.has(plain)) || null
}
const toKelvin = { '°C': (v) => v + 273.15, '°F': (v) => (v - 32) * 5 / 9 + 273.15, K: (v) => v }
const fromKelvin = { '°C': (v) => v - 273.15, '°F': (v) => (v - 273.15) * 9 / 5 + 32, K: (v) => v }

/* "5 km in miles" → { value: 3.10686, text: '3.107 mi', plain: '3.107 mi' }. The amount can be a sum ("2*3 ft in cm"). */
function convert(input) {
  const raw = String(input ?? '').trim()
  if (raw.length > MAX_LENGTH) return null
  const match = /^(.+?)\s*([a-z°/]+(?:\s+oz)?)\s+(?:to|in|into|as|=|→|->)\s+([a-z°/]+(?:\s+oz)?)\s*\??$/i.exec(raw)
  if (!match) return null
  const [from, to] = [unitNamed(match[2]), unitNamed(match[3])]
  if (!from || !to || from.kind !== to.kind || from === to) return null
  const amount = /^-?\d+(?:\.\d+)?$/.test(match[1].trim()) ? Number(match[1]) : sum(match[1])?.value
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  const value = from.kind === 'temperature' ? fromKelvin[to.name](toKelvin[from.name](amount)) : (amount * from.size) / to.size
  const shown = Number(value.toPrecision(Math.abs(value) >= 1000 ? 7 : 4))
  const text = `${shown.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${to.name}`
  return { value, text, plain: text }
}

/* ---------- dates: "days until christmas", "today + 30 days", "days since march 3" ---------- */

const DAY = 86400000
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const longDate = (date) => date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const month = (word) => MONTHS.findIndex((name) => name.startsWith(String(word).toLowerCase()) && String(word).length >= 3)

// The fourth Thursday of November.
const thanksgiving = (year) => { const first = new Date(year, 10, 1); return new Date(year, 10, 1 + ((11 - first.getDay()) % 7) + 21) }
const HOLIDAYS = {
  christmas: (year) => new Date(year, 11, 25), xmas: (year) => new Date(year, 11, 25), 'christmas eve': (year) => new Date(year, 11, 24),
  'new year': (year) => new Date(year, 0, 1), "new year's": (year) => new Date(year, 0, 1), "new year's eve": (year) => new Date(year, 11, 31),
  halloween: (year) => new Date(year, 9, 31), "valentine's day": (year) => new Date(year, 1, 14), valentines: (year) => new Date(year, 1, 14),
  'valentine’s day': (year) => new Date(year, 1, 14), thanksgiving, 'july 4th': (year) => new Date(year, 6, 4), 'independence day': (year) => new Date(year, 6, 4),
}

/* A day written in words: a holiday, "dec 25", "25 december", "12/25", "2026-12-25", "friday", "tomorrow". Without a
   year, the next one from `today` (`ahead`) or the last one (`!ahead`). */
function dayOf(words, today, ahead = true) {
  const text = String(words || '').toLowerCase().replace(/[.,]/g, '').replace(/^(the|next)\s+/, '').trim()
  const pick = (make) => {
    const year = today.getFullYear()
    const here = make(year)
    if (ahead) return here >= today ? here : make(year + 1)
    return here <= today ? here : make(year - 1)
  }
  if (text === 'today') return today
  if (text === 'tomorrow') return new Date(today.getTime() + DAY)
  if (text === 'yesterday') return new Date(today.getTime() - DAY)
  if (HOLIDAYS[text]) return pick(HOLIDAYS[text])
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(text)
  if (match) {
    const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : null
    return year ? new Date(year, Number(match[1]) - 1, Number(match[2])) : pick((y) => new Date(y, Number(match[1]) - 1, Number(match[2])))
  }
  match = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/.exec(text) || /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/.exec(text)
  if (match) {
    const [name, day] = /^\d/.test(match[1]) ? [match[2], match[1]] : [match[1], match[2]]
    const index = month(name)
    if (index < 0 || Number(day) < 1 || Number(day) > 31) return null
    return match[3] ? new Date(Number(match[3]), index, Number(day)) : pick((y) => new Date(y, index, Number(day)))
  }
  const weekday = WEEKDAYS.findIndex((name) => name === text || (text.length >= 3 && name.startsWith(text)))
  if (weekday >= 0) {
    const shift = ahead ? ((weekday - today.getDay() + 7) % 7) || 7 : -(((today.getDay() - weekday + 7) % 7) || 7)
    return new Date(today.getTime() + shift * DAY)
  }
  return null
}

const days = (count) => `${count.toLocaleString('en-US')} ${Math.abs(count) === 1 ? 'day' : 'days'}`
const between = (a, b) => Math.round((startOf(b) - startOf(a)) / DAY)

function dates(input, now) {
  const text = String(input ?? '').trim().toLowerCase().replace(/\?$/, '').replace(/^how many\s+/, '')
  if (!text || text.length > MAX_LENGTH) return null
  const today = startOf(now)
  let match = /^(?:days?|weeks?)\s+(?:until|till|til|to|before)\s+(.+)$/.exec(text)
  if (match) {
    const day = dayOf(match[1], today, true)
    if (!day) return null
    const count = between(today, day)
    const answer = text.startsWith('week') ? `${Number((count / 7).toFixed(1))} weeks` : days(count)
    return { value: count, text: answer, plain: answer, note: `Until ${longDate(day)}` }
  }
  match = /^days?\s+(?:since|from|after)\s+(.+)$/.exec(text)
  if (match) {
    const day = dayOf(match[1], today, false)
    if (!day) return null
    const count = between(day, today)
    return { value: count, text: days(count), plain: days(count), note: `Since ${longDate(day)}` }
  }
  match = /^days?\s+between\s+(.+?)\s+and\s+(.+)$/.exec(text)
  if (match) {
    const [a, b] = [dayOf(match[1], today, true), dayOf(match[2], today, true)]
    if (!a || !b) return null
    const count = Math.abs(between(a, b))
    return { value: count, text: days(count), plain: days(count), note: `${longDate(a)} to ${longDate(b)}` }
  }
  // "today + 30 days", "tomorrow - 2 weeks", "dec 1 + 3 months"
  match = /^(.+?)\s*([+-])\s*(\d+)\s*(days?|weeks?|months?|years?)$/.exec(text)
  if (match) {
    const start = dayOf(match[1], today, true)
    if (!start) return null
    const amount = Number(match[3]) * (match[2] === '-' ? -1 : 1)
    const unit = match[4].replace(/s$/, '')
    const day = unit === 'day' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + amount)
      : unit === 'week' ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + amount * 7)
        : unit === 'month' ? new Date(start.getFullYear(), start.getMonth() + amount, start.getDate())
          : new Date(start.getFullYear() + amount, start.getMonth(), start.getDate())
    const answer = longDate(day)
    return { value: day.getTime(), text: answer, plain: answer, note: between(today, day) >= 0 ? `In ${days(between(today, day))}` : `${days(-between(today, day))} ago` }
  }
  return null
}
