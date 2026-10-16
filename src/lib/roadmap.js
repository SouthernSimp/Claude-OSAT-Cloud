/* The roadmap's Status table, as phases for the Roadmap room's Timeline. It reads the same
   text the room shows (docs/ROADMAP.md, built into the app), so the two can never disagree,
   and nothing is kept anywhere else. Read-only: no dates to keep up; a phase with none
   simply shows in its place in the order. Pure. */

/* done (merged, shipped), dropped (dropped, replaced: it won't be built), now (in review, in progress) or
   planned (planned, later, parked). */
export function stateOf(label) {
  const text = String(label || '').toLowerCase()
  if (/^(merged|done|shipped|finished|completed)\b/.test(text)) return 'done'
  if (/^(dropped|replaced)\b/.test(text)) return 'dropped'
  if (/review|progress|building|\bnow\b|started/.test(text)) return 'now'
  return 'planned'
}

const MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/

/* Every row of the "## Status" table: { id, what, label, state, pr, date }. `date` is only
   there when the State cell names one ("Merged (PR #20, Oct 3)"). */
export function roadmapPhases(markdown) {
  const lines = String(markdown || '').split('\n')
  const start = lines.findIndex((line) => /^##\s+Status\b/i.test(line.trim()))
  if (start < 0) return []
  const phases = []
  for (const line of lines.slice(start + 1)) {
    const row = line.trim()
    if (/^#{1,3}\s/.test(row)) break
    if (!row.startsWith('|')) {
      if (phases.length) break
      continue
    }
    // A `\|` inside a cell is a pipe in its words, not the next cell.
    const cells = row.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
    if (cells.length < 3 || /^:?-{2,}:?$/.test(cells[0]) || /^phase$/i.test(cells[0]) || !cells[0]) continue
    const [id, what, label] = cells
    phases.push({
      id,
      what: what.replace(/`/g, ''),
      label,
      state: stateOf(label),
      pr: Number(/#(\d+)/.exec(label)?.[1]) || null,
      date: MONTH.exec(label)?.[0] || null,
    })
  }
  return phases
}

/* "16 done · 2 in progress · 6 planned" */
export function timelineSummary(phases) {
  const count = (state) => phases.filter((phase) => phase.state === state).length
  return [[count('done'), 'done'], [count('now'), 'in progress'], [count('planned'), 'planned'], [count('dropped'), 'dropped']]
    .filter(([n]) => n)
    .map(([n, word]) => `${n} ${word}`)
    .join(' · ')
}

/* The start of the id the Roadmap's heading for a phase gets ("### Phase 12b: …"). */
export const phaseAnchor = (id) => `md-phase-${String(id).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}-`
