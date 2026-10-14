/* Bring in from Raycast (Oct 14 2026): Raycast's own exports of Snippets and Quicklinks (Settings → Extensions → Snippets /
   Quicklinks → Export, plain JSON) become OSAT snippets and quick links, and Nate's Raycast keys become OSAT's. Raycast's
   full `.rayconfig` export is encrypted with a password and holds no readable keys, so the keys below were read off
   Raycast's Settings → Shortcuts page on Nate's Mac (Raycast 2.7.3) and are kept here as one list. Pure. */

const HYPER = 'Control+Alt+Shift+Command'
const hyper = (key) => `${HYPER}+${key}`

/* Nate's Raycast keys, in OSAT's terms (a launcher.json patch). What OSAT can't do yet, and why, is in `RAYCAST_LEFT_OUT`.
   Choices Nate made: Hyper T stays CleanShot's Capture Text, AI on selected text moves to Hyper E, and Hyper N is a
   quick sticky (not Apple Notes, not OSAT's notes list). */
export const RAYCAST_KEYS = {
  apps: {
    Claude: { hotkey: hyper('A') },
    Finder: { hotkey: hyper('F') },
    'Google Chrome': { hotkey: hyper('C') },
    Granola: { hotkey: hyper('G') },
    Messages: { hotkey: hyper('M'), keyword: 'mm' },
    Obsidian: { hotkey: hyper('O') },
    Spotify: { hotkey: 'Control+Shift+\\', keyword: 'ss' },
    Terminal: { hotkey: hyper('P') },
  },
  sources: { files: { hotkey: hyper('S') }, notes: { hotkey: null }, apps: { hotkey: null } },
  selection: { hotkey: hyper('E') },
  captures: { hotkeys: { text: hyper('T'), history: hyper('H'), 'from-clipboard': hyper('B') } },
  windows: {
    on: true,
    hotkeys: {
      'left-half': hyper('1'),
      'right-half': hyper('2'),
      'next-display': hyper('3'),
      'reasonable-size': hyper('4'),
      maximize: hyper('5'),
      'left-two-thirds': hyper('6'),
      'top-half': hyper('Up'),
      'bottom-half': hyper('Down'),
      larger: hyper('='),
      smaller: hyper('-'),
      'left-third': 'Control+Command+1',
      'center-third': 'Control+Command+2',
      'right-third': 'Control+Command+3',
    },
    aliases: { 'left-half': 'lh', 'right-half': 'rh', 'reasonable-size': 'rs' },
  },
  custom: [
    { key: 'act:sticky', kind: 'room', title: 'Write a sticky', subtitle: 'Straight to Unsorted', data: { go: ['Capture'] }, hotkey: hyper('N') },
    { key: 'kill', kind: 'more', title: 'Kill Process', subtitle: 'Quit or force quit a running app', data: { scope: 'kill' }, hotkey: hyper('K') },
  ],
}

/* What was in Raycast and isn't brought in, in plain words (Settings shows this list). */
export const RAYCAST_LEFT_OUT = [
  'Apple Notes on Hyper N: Hyper N is now a quick sticky.',
  'Clipboard History on ⌃⌘ (its key didn’t show in Raycast): OSAT’s clipboard is Hyper V.',
  'Paste Sequentially on Hyper P: Hyper P opens Terminal, as it did in Raycast.',
  'Search Image with Google Lens on ⌘G: ⌘G is Find Next in every app.',
  'Spotify Skip on Hyper ← and → (Raycast had them clashing with Move to Space).',
  'Lock Screen on right ⌃ twice and Send Focused Window to AI on right ⌘ twice: OSAT can’t hear a key tapped twice yet.',
  'The browser Script Commands on Hyper [ ] \\ and ⌃⌥M: they are Raycast scripts.',
]

const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item'

/* Raycast's snippets ([{ name, keyword, text }]) → OSAT's ({ id, name, keyword, text }). Placeholders OSAT fills stay;
   {cursor} goes (OSAT pastes and leaves the cursor at the end); Raycast's {date format="…"} becomes {date}. */
export function fromRaycastSnippets(list) {
  return (Array.isArray(list) ? list : []).filter((item) => typeof item?.text === 'string' && item.text.trim()).map((item, index) => ({
    id: `ray-${slug(item.name)}-${index + 1}`,
    name: String(item.name || '').trim().slice(0, 60),
    keyword: typeof item.keyword === 'string' && item.keyword.trim() ? item.keyword.trim().toLowerCase() : null,
    text: item.text.replaceAll('{cursor}', '').replace(/\{(date|time)\s[^}]*\}/g, '{$1}'),
  }))
}

/* Raycast's quicklinks ([{ name, link }]) → OSAT's quick links; Raycast's {argument} / {query} is OSAT's {query}. */
export function fromRaycastQuicklinks(list) {
  return (Array.isArray(list) ? list : []).filter((item) => typeof item?.link === 'string' && item.link.trim()).map((item, index) => ({
    id: `ray-${slug(item.name)}-${index + 1}`,
    name: String(item.name || '').trim().slice(0, 40),
    url: item.link.trim().replace(/\{(argument|query|clipboard)[^}]*\}/, '{query}'),
    keyword: null,
    hotkey: null,
    on: true,
  }))
}

/* Which export a parsed file is: 'snippets' ([{ text }]), 'quicklinks' ([{ link }]) or null. */
export function exportKind(parsed) {
  if (!Array.isArray(parsed) || !parsed.length) return null
  if (parsed.every((item) => typeof item?.text === 'string')) return 'snippets'
  if (parsed.every((item) => typeof item?.link === 'string')) return 'quicklinks'
  return null
}

/* What to add to what is there: anything with the same word, or the same text or address, is already there and stays
   as it is. → { snippets, links, skipped } (the lists to save, and how many were left out as already there). */
export function mergeImport(settings, { snippets = [], links = [] } = {}) {
  const have = settings.snippets || []
  const words = new Set(have.map((item) => item.keyword).filter(Boolean))
  const texts = new Set(have.map((item) => item.text))
  let skipped = 0
  const newSnippets = []
  for (const item of snippets) {
    if ((item.keyword && words.has(item.keyword)) || texts.has(item.text)) { skipped += 1; continue }
    if (item.keyword) words.add(item.keyword)
    texts.add(item.text)
    newSnippets.push(item)
  }
  const haveLinks = settings.links || []
  const urls = new Set(haveLinks.map((item) => item.url))
  const newLinks = []
  for (const item of links) {
    if (urls.has(item.url)) { skipped += 1; continue }
    urls.add(item.url)
    newLinks.push(item)
  }
  return { snippets: [...have, ...newSnippets], links: [...haveLinks, ...newLinks], added: { snippets: newSnippets.length, links: newLinks.length }, skipped }
}

/* The keys patch over what is there, keeping a custom row's favorite and word when it already has one. */
export function keysPatch(settings) {
  const custom = [...(settings.custom || [])]
  for (const row of RAYCAST_KEYS.custom) {
    const at = custom.findIndex((entry) => entry.key === row.key)
    if (at >= 0) custom[at] = { ...custom[at], hotkey: row.hotkey }
    else custom.push({ ...row, favorite: false, keyword: null })
  }
  return { ...RAYCAST_KEYS, custom }
}
