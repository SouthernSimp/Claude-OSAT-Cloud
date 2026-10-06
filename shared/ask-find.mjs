/* What Ask may read from copies and files (Ask across everything, step two). Pure: main hands in what the
   clipboard history and the approved places hold; this picks the few that match a question, cuts each to a short
   passage, leaves out anything that looks like a secret, and writes the numbered block the model reads.
   Nothing here touches a disk or the network. */

import { parseFileQuery } from './file-query.mjs'

/* ---- secrets: a copy that looks like one never goes; a file has those lines left out ---- */

const PATTERNS = [
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/, // API keys (OpenAI-style, Stripe-style)
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key ids
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/, // JWTs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b\d{3}-\d{2}-\d{4}\b/, // US social security numbers
  /\b(?:pass(?:word|code)?|passwd|pwd|secret|token|api[ _-]?key|private key|cvv|pin)\b\s*(?:is\s*)?[:=]/i, // "password: …"
]

function luhn(digits) {
  let sum = 0
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index])
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9 }
    sum += digit
  }
  return sum % 10 === 0
}

const entropy = (token) => {
  const counts = new Map()
  for (const char of token) counts.set(char, (counts.get(char) || 0) + 1)
  return [...counts.values()].reduce((sum, count) => sum - (count / token.length) * Math.log2(count / token.length), 0)
}

/* A single long, random-looking word (mixed case and digits, no spaces) is a key or a token, not a word. */
const randomLooking = (token) => token.length >= 28 && /^[A-Za-z0-9+/_=-]+$/.test(token)
  && /[a-z]/.test(token) && /[A-Z]/.test(token) && /\d/.test(token) && entropy(token) >= 3.8

export function looksSecret(text) {
  const words = String(text || '')
  if (PATTERNS.some((pattern) => pattern.test(words))) return true
  for (const run of words.match(/\b\d(?:[ -]?\d){12,18}\b/g) || []) if (luhn(run.replace(/\D/g, ''))) return true
  return words.split(/\s+/).some(randomLooking)
}

/* A file's text with the lines that look like secrets taken out. → { text, left } (how many lines went). */
export function redactSecrets(text) {
  let left = 0
  const lines = String(text || '').split('\n').map((line) => {
    if (!looksSecret(line)) return line
    left += 1
    return '[a line that looked private was left out]'
  })
  return { text: lines.join('\n'), left }
}

/* ---- finding ---- */

const GLUE = new Set(('a an and any are as at be by can did do does for from got had has have how i if in is it its me my of on or our ' +
  'that the there these this to was we were what when where which who why with you your about around anything something someone ' +
  'copied copy copies clipboard file files document documents scan scans sticky stickies note notes wrote write written saved save ' +
  'find tell show look remember mention mentioned').split(' '))

/* The words of a question that can find something, and the time it names ("last week"). */
export function questionTerms(question, now = new Date()) {
  const text = String(question || '')
  const asked = parseFileQuery(text.length > 100 ? text.slice(0, 100) : text, now)
  const raw = (asked.words.length ? asked.words : text.toLowerCase().split(/[^\p{L}\p{N}]+/u))
  const words = [...new Set(raw.map((word) => String(word).toLowerCase()).filter((word) => word.length >= 3 && !GLUE.has(word)))].slice(0, 8)
  return { words, since: asked.since }
}

/* A short passage around the first word that matches (or the start), whole words, ellipsis at cut ends. */
export function passage(text, words, max = 600) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const lower = flat.toLowerCase()
  const at = words.map((word) => lower.indexOf(word)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, Math.min(at - Math.floor(max / 4), flat.length - max))
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + max).trim()}${start + max < flat.length ? '…' : ''}`
}

const score = (text, words) => {
  const lower = String(text || '').toLowerCase()
  return words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0)
}

/* The copies a question is about: newest first among those sharing its words, inside the time it names, never one
   that looks like a secret, never a picture. A question with only a time ("what did I copy last week?") gets the
   newest few. `items` are the history's { id, kind, at, text, app? }. → at most `limit` of them. */
export function pickCopies(items, question, now = new Date(), limit = 3) {
  const { words, since } = questionTerms(question, now)
  const inTime = (item) => !since || Date.parse(item.at) >= since.getTime()
  const usable = (items || []).filter((item) => item.kind !== 'image' && typeof item.text === 'string' && item.text.trim() && inTime(item) && !looksSecret(item.text))
  if (!words.length) return since ? usable.slice(0, limit) : []
  return usable
    .map((item) => ({ item, hit: score(item.text, words) }))
    .filter(({ hit }) => hit > 0 && hit >= Math.min(words.length, 2))
    .sort((a, b) => b.hit - a.hit || String(b.item.at).localeCompare(String(a.item.at)))
    .slice(0, limit).map(({ item }) => item)
}

/* The words a file search is given: the question without the glue ("lease last month" keeps its time for the
   search to read). */
export const fileQuestion = (question) => {
  const { words } = questionTerms(question)
  const time = String(question || '').match(/\b(?:today|yesterday|this week|last week|this month|last month|this year|last year)\b/i)?.[0] || ''
  return [...words, time].filter(Boolean).join(' ')
}

/* ---- what the model reads ---- */

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const when = (at) => (Number.isNaN(Date.parse(at)) ? '' : DAY.format(new Date(at)))

/* One numbered block: COPIED ITEM 1 (from Safari, Oct 5, 2026) … FILE 1: lease.pdf (in Documents › Home) …
   `copies` { id, at, text, app? }, `files` { name, where, text }; `room` is the most characters in all. */
export function evidenceBlock({ copies = [], files = [] }, { room = 3000, words = [] } = {}) {
  const parts = []
  copies.forEach((copy, index) => {
    const detail = [copy.app && `from ${copy.app}`, when(copy.at) && `copied ${when(copy.at)}`].filter(Boolean).join(', ')
    parts.push({ head: `COPIED ITEM ${index + 1}${detail ? ` (${detail})` : ''}`, text: copy.text })
  })
  files.forEach((file, index) => {
    const { text } = redactSecrets(file.text)
    parts.push({ head: `FILE ${index + 1}: ${file.name}${file.where ? ` (${file.where})` : ''}`, text })
  })
  if (!parts.length) return ''
  const each = Math.floor(room / parts.length)
  return parts.map(({ head, text }) => `${head}\n${passage(text, words, Math.max(each - head.length - 2, 200))}`).join('\n\n')
}
