/* Snippets (Oct 2026, Raycast's): text you paste often, with a short word. Typed in the quick bar, the word finds it and
   Return pastes it into the app you were in; typed in any app (once turned on), the word turns into the text. A
   snippet can hold {date}, {time}, {day} and {clipboard}, filled in when it is pasted. The helper that watches the keys
   (desktop/launcher/snippets.cjs) keeps only the last few letters typed, in its own memory, and says only "this word
   was typed" (`hit <n>`); these are the rules it and the bar share. Pure. */

/* A snippet's word: one to twelve letters or numbers, after one sign if you like (";addr", "!sig"), so a word you also
   type in sentences never turns into text by accident. */
export const SNIPPET_WORD = /^[;:!@#/.,=~-]?[a-z0-9]{1,12}$/
export const validSnippetWord = (value) => SNIPPET_WORD.test(String(value ?? '').trim().toLowerCase())

/* What a saved list may hold: { id, name, keyword, text }, a word only once (and never one the bar already uses). */
export function cleanSnippets(list, used = new Set()) {
  const out = []
  for (const item of (Array.isArray(list) ? list : []).slice(0, 100)) {
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

/* One line from the helper: `ready`, or `hit <n>` (the n-th trigger was just typed). → { kind } | null. */
export function readSnippetLine(line) {
  const words = String(line || '').trim().split(/\s+/)
  if (words.length === 1 && words[0] === 'ready') return { kind: 'ready' }
  if (words.length === 2 && words[0] === 'hit' && /^\d{1,3}$/.test(words[1])) return { kind: 'hit', index: Number(words[1]) }
  return null
}

/* What the helper does with each key, as a pure step (the same rules run inside it, written out in its script):
   a letter, number or sign is added to the end (only the last 16 are kept); ⌫ takes one off; anything else (Return,
   Tab, the arrows, a ⌘ or ⌃ shortcut, a click elsewhere) starts again. → { buffer, hit } (`hit` is the trigger's
   index, the buffer then starts again). A word counts only after a space, a line or nothing. */
export function typedStep(buffer, key, triggers) {
  let next
  if (key === 'backspace') next = buffer.slice(0, -1)
  else if (typeof key === 'string' && key.length === 1 && !/[\n\r\t]/.test(key)) next = (buffer + key.toLowerCase()).slice(-16)
  else return { buffer: '', hit: -1 }
  const hit = triggers.findIndex(({ keyword }) => next.endsWith(keyword) && (next.length === keyword.length || /\s/.test(next[next.length - keyword.length - 1])))
  return hit >= 0 ? { buffer: '', hit } : { buffer: next, hit: -1 }
}
