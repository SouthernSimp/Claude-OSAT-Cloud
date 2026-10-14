/* Snippets (Oct 2026, Raycast's): text you paste often, with a short word. Typed in the quick bar, the word finds it and
   Return pastes it into the app you were in; typed in any app (once turned on), the word turns into the text. A
   snippet can hold {date}, {time}, {day} and {clipboard}, filled in when it is pasted. The helper that watches the keys
   (desktop/launcher/snippets.cjs) keeps only the last few letters typed, in its own memory, and says only "this word
   was typed" (`hit <n>`); these are the rules it and the bar share. Pure. */

/* A snippet's word: up to 24 letters, numbers and - / + _, after one or two signs if you like (";addr", "..pp", Raycast's
   "!1/2" or "!horizontal-ellipsis"), so a word you also type in sentences never turns into text by accident. It needs a
   letter or number, unless it starts with ! ("!+-"): a bare "--" or "..." is typed in sentences. */
export const SNIPPET_WORD = /^[;:!@#/.,=~-]{0,2}[a-z0-9/+_-]{1,24}$/
export const SNIPPET_WORD_HELP = 'A word is up to 24 letters or numbers, after one or two signs if you like: ;addr, ..pp or !1/2'
export const validSnippetWord = (value) => {
  const word = String(value ?? '').trim().toLowerCase()
  return SNIPPET_WORD.test(word) && (/[a-z0-9]/.test(word) || (word.startsWith('!') && word.length > 2))
}

/* What a saved list may hold: { id, name, keyword, text }, a word only once (and never one the bar already uses). */
export function cleanSnippets(list, used = new Set()) {
  const out = []
  for (const item of (Array.isArray(list) ? list : []).slice(0, 500)) {
    const text = typeof item?.text === 'string' ? item.text.slice(0, 5000) : ''
    if (!text.trim()) continue
    const id = String(item.id || `snip-${out.length + 1}`).replace(/[^\w-]/g, '').slice(0, 40)
    if (!id || out.some((other) => other.id === id)) continue
    let keyword = typeof item.keyword === 'string' ? item.keyword.trim().toLowerCase() : null
    if (keyword && (!validSnippetWord(keyword) || used.has(keyword))) keyword = null
    if (keyword) used.add(keyword)
    const name = String(item.name || '').trim().slice(0, 60) || text.trim().split('\n')[0].slice(0, 40)
    out.push({ id, name, keyword: keyword || null, text })
  }
  return out
}

/* The text with its placeholders filled in. */
export function fillSnippet(text, { now = new Date(), clipboard = '' } = {}) {
  return String(text || '')
    .replaceAll('{datetime}', `${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`)
    .replaceAll('{date}', now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))
    .replaceAll('{time}', now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
    .replaceAll('{day}', now.toLocaleDateString('en-US', { weekday: 'long' }))
    .replaceAll('{clipboard}', String(clipboard || '').slice(0, 5000))
}

/* The snippets every word of the query is in (its name, word or text), best first: the word, then the name. */
export function findSnippets(snippets, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const rank = (snippet) => (snippet.keyword === words.join(' ') ? 0 : words.every((word) => snippet.name.toLowerCase().includes(word)) ? 1 : 2)
  return (snippets || []).filter((snippet) => words.every((word) => `${snippet.name} ${snippet.keyword || ''} ${snippet.text}`.toLowerCase().includes(word)))
    .sort((a, b) => rank(a) - rank(b))
}

export const snippetRow = (snippet, section = 'Snippets') => ({
  key: `snip:${snippet.id}`, source: 'snippets', kind: 'snippet', title: snippet.name, subtitle: snippet.keyword ? `${snippet.keyword} · snippet` : 'Snippet', section,
  data: { id: snippet.id, text: snippet.text, keyword: snippet.keyword },
})

/* The words the helper watches for, in order (its `hit <n>` is an index into this list). */
export const triggersOf = (snippets) => (snippets || []).filter((snippet) => snippet.keyword).map((snippet) => ({ id: snippet.id, keyword: snippet.keyword }))

/* One line from the helper: `ready`, or `hit <n> [extra]` (the n-th trigger was just typed, and `extra` keys after it: a
   space that ended a word that is also the start of a longer one). → { kind, index, extra } | null. */
export function readSnippetLine(line) {
  const words = String(line || '').trim().split(/\s+/)
  if (words.length === 1 && words[0] === 'ready') return { kind: 'ready' }
  if ((words.length === 2 || (words.length === 3 && /^[01]$/.test(words[2]))) && words[0] === 'hit' && /^\d{1,3}$/.test(words[1])) {
    return { kind: 'hit', index: Number(words[1]), extra: Number(words[2] || 0) }
  }
  return null
}

/* What the helper does with each key, as a pure step (the same rules run inside it, written out in its script):
   a letter, number or sign is added to the end (only the last 32 are kept); ⌫ takes one off; anything else (Return,
   Tab, the arrows, a ⌘ or ⌃ shortcut, a click elsewhere) starts again. The word being typed is what follows the last
   space. It turns into text the moment it is a snippet's word, unless it is also the start of a longer word ("!date",
   "!datetime"): then it waits, and a space turns it into text (`extra: 1`, the space is kept after the text) while
   more letters go on toward the longer one. → { buffer, hit, extra } (`hit` is the trigger's index, or -1). */
export const BUFFER = 32
export function typedStep(buffer, key, triggers) {
  const wordOf = (text) => text.slice(text.search(/\S*$/))
  if (key === ' ') {
    const waiting = triggers.findIndex(({ keyword }) => keyword === wordOf(buffer))
    if (waiting >= 0) return { buffer: '', hit: waiting, extra: 1 }
  }
  let next
  if (key === 'backspace') next = buffer.slice(0, -1)
  else if (typeof key === 'string' && key.length === 1 && !/[\n\r\t]/.test(key)) next = (buffer + key.toLowerCase()).slice(-BUFFER)
  else return { buffer: '', hit: -1, extra: 0 }
  const word = wordOf(next)
  const hit = triggers.findIndex(({ keyword }) => keyword === word)
  const longer = triggers.some(({ keyword }) => keyword.length > word.length && keyword.startsWith(word))
  return hit >= 0 && !longer ? { buffer: '', hit, extra: 0 } : { buffer: next, hit: -1, extra: 0 }
}
