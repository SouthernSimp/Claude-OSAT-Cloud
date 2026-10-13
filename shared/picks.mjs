/* The quick bar learns what you pick (Phase 50, Raycast-style): each time a row is opened, pasted or run from the bar,
   its key is remembered with how often, when last, and the words that were typed. Next time, a row you picked for
   those words (or words that start the same way: "s" after "sl" or "slack") comes first as the Top hit, and apps you
   use often sort ahead of others that match as well. Kept only on this Mac, in `picks.json` in the data folder.
   picks: { [rowKey]: { n, at, q: { [typed]: n } } } */

const DAY = 24 * 60 * 60 * 1000
const MAX_KEYS = 400
const MAX_WORDS = 12

// ponytail: Firefox-style recency buckets; a decay curve only if the buckets feel wrong.
const recency = (at, now) => {
  const days = (now - at) / DAY
  return days < 1 ? 1 : days < 7 ? 0.7 : days < 30 ? 0.4 : days < 90 ? 0.2 : 0.1
}

const words = (typed) => String(typed || '').trim().toLowerCase().slice(0, 60)

export function remember(picks, key, typed, now = Date.now()) {
  if (typeof key !== 'string' || !key || key.length > 2000) return picks
  const was = picks[key] || { n: 0, at: now, q: {} }
  const q = { ...was.q }
  const said = words(typed)
  if (said) q[said] = (q[said] || 0) + 1
  const kept = Object.entries(q).sort((a, b) => b[1] - a[1]).slice(0, MAX_WORDS)
  const next = { ...picks, [key]: { n: Math.min(was.n + 1, 1000), at: now, q: Object.fromEntries(kept) } }
  const keys = Object.keys(next)
  if (keys.length <= MAX_KEYS) return next
  // The ones not picked for the longest time go first.
  const drop = new Set(keys.sort((a, b) => next[a].at - next[b].at).slice(0, keys.length - MAX_KEYS))
  return Object.fromEntries(Object.entries(next).filter(([k]) => !drop.has(k)))
}

/* How much a row is wanted for these words: picked for them (or words that start the same) counts most, then how
   often and how lately it was picked at all. 0 means never picked. */
export function scoreOf(picks, key, typed, now = Date.now()) {
  const entry = picks?.[key]
  if (!entry) return 0
  const used = entry.n * recency(entry.at, now)
  const said = words(typed)
  if (!said) return used
  let matched = 0
  for (const [q, n] of Object.entries(entry.q || {})) if (q.startsWith(said) || said.startsWith(q)) matched += n
  return matched ? 100 + matched * 10 * recency(entry.at, now) + used : used
}

/* The row picked before for these words, if any, so the bar can put it first. Ask, a sum and your own word are
   never displaced. */
export function topHit(rows, picks, typed, now = Date.now()) {
  let best = null
  let bestScore = 100
  for (const row of rows) {
    if (['do', 'more', 'calc', 'keyword'].includes(row.source)) continue
    const score = scoreOf(picks, row.key, typed, now)
    if (score > bestScore) { best = row; bestScore = score }
  }
  return best
}

export function cleanPicks(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  const out = {}
  for (const [key, entry] of Object.entries(saved)) {
    if (!entry || !Number.isFinite(entry.n) || !Number.isFinite(entry.at)) continue
    const q = {}
    for (const [word, n] of Object.entries(entry.q || {})) if (Number.isFinite(n)) q[word] = n
    out[key] = { n: entry.n, at: entry.at, q }
  }
  return out
}
