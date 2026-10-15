/* CHANGELOG.md, built into the app, as builds for the Roadmap room's What's new. Each entry is
   `## Build 280 · October 15, 2026 — A name` (or `Builds 270–271`, or `Next build`: written before the merge, so
   the build it describes carries its own notes; it is the build you have). Lines are `- ` items that end with
   their pull requests, "(#98)", "(#91, #92)" or "(#1–#3)". Pure. */

// Where OSAT's code and its pull requests live (the GitHub room shows it first; a #number opens its pull request).
export const OSAT_REPO = 'SouthernSimp/Claude-OSAT-Cloud'
export const pullUrl = (number) => `https://github.com/${OSAT_REPO}/pull/${number}`

const PULLS = /\s*\((#\d+(?:–#\d+)?(?:,\s*#\d+(?:–#\d+)?)*)\)\.?\s*$/

/* "0.1.280" → 280; a build from source (0.1.0) or nothing → null. */
export function buildOf(version) {
  const n = Number(/^\d+\.\d+\.(\d+)$/.exec(String(version || '').trim())?.[1])
  return n > 0 ? n : null
}

/* An item's words without its pull requests, and those as { label, number } (a range links its first). */
export function itemOf(text) {
  const match = PULLS.exec(text)
  if (!match) return { text: text.trim(), pulls: [] }
  const pulls = match[1].split(/,\s*/).map((label) => ({ label, number: Number(/#(\d+)/.exec(label)[1]) }))
  return { text: `${text.slice(0, match.index).trim()}${/[.!?]$/.test(text.slice(0, match.index).trim()) ? '' : '.'}`, pulls }
}

/* [{ key, from, to, next, date, name, intro, items: [{ text, pulls }] }], newest first as written. */
export function changelogBuilds(markdown) {
  const builds = []
  let current = null
  let item = null
  for (const raw of String(markdown || '').split('\n')) {
    const line = raw.trimEnd()
    const head = /^##\s+(.+)$/.exec(line)
    if (head) {
      const [left, rest = ''] = head[1].split(' · ')
      const [date, name = ''] = rest.split(' — ')
      const range = /^Builds?\s+(\d+)(?:\s*[–-]\s*(\d+))?$/.exec(left.trim())
      current = {
        key: left.trim(),
        from: range ? Number(range[1]) : null,
        to: range ? Number(range[2] || range[1]) : null,
        next: /^next build$/i.test(left.trim()),
        date: date.trim(),
        name: name.trim(),
        intro: '',
        items: [],
      }
      builds.push(current)
      item = null
      continue
    }
    if (!current) continue
    const bullet = /^-\s+(.*)$/.exec(line)
    if (bullet) { item = { raw: bullet[1] }; current.items.push(item); continue }
    if (item && /^\s{2,}\S/.test(line)) { item.raw += ` ${line.trim()}`; continue }
    if (line.trim()) { item = null; current.intro = `${current.intro} ${line.trim()}`.trim() }
  }
  return builds.map((build) => ({ ...build, items: build.items.map((entry) => itemOf(entry.raw)) }))
}

/* The entry for the build on this Mac: a Next build entry is the build itself (a build only carries the
   changelog up to itself, so nothing newer is ever listed); otherwise the one whose numbers hold `have`. */
export const isYours = (build, have) => build.next || Boolean(have && build.from && have >= build.from && have <= build.to)
