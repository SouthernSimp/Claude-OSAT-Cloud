import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { phaseAnchor, roadmapPhases, stateOf, timelineSummary } from '../src/lib/roadmap.js'

const ROADMAP = `# A roadmap

Some words first.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Foundation | Merged (PR #1) |
| 12b | Offline mode, with a \`switch\` | In review |
| 13 | Mac powers | Planned |
| 14 | Connectors | Merged (PR #20, Oct 3) |
| 99 | Someday | Later (parked) |

**Paused:** not a row.

## Context
| 1 | Not a phase | Merged |
`

test('the Status table as phases, in order: done, in progress or planned; no dates needed', () => {
  const phases = roadmapPhases(ROADMAP)
  assert.deepEqual(phases.map((phase) => [phase.id, phase.state, phase.pr, phase.date]), [
    ['0', 'done', 1, null],
    ['12b', 'now', null, null],
    ['13', 'planned', null, null],
    ['14', 'done', 20, 'Oct 3'],
    ['99', 'planned', null, null],
  ])
  assert.equal(phases[1].what, 'Offline mode, with a switch', 'Markdown code marks go')
  assert.equal(timelineSummary(phases), '2 done · 1 in progress · 2 planned')
  assert.deepEqual(roadmapPhases('# No status here\n| 1 | x | y |'), [])
  assert.deepEqual(roadmapPhases(''), [])
})

test('states in plain words', () => {
  assert.deepEqual(['Merged (PR #14)', 'Done', 'In review', 'In progress', 'Planned', 'Later (parked)', ''].map(stateOf), ['done', 'done', 'now', 'now', 'planned', 'planned', 'planned'])
})

test('the real roadmap: every row shows, in order, and a phase finds its own part of the Roadmap', async () => {
  const text = await readFile(new URL('../docs/ROADMAP.md', import.meta.url), 'utf8')
  const phases = roadmapPhases(text)
  assert.ok(phases.length >= 20, `${phases.length} phases`)
  assert.equal(phases[0].id, '0')
  assert.ok(phases.some((phase) => phase.id === '16'))
  assert.ok(phases.every((phase) => phase.what && phase.label && ['done', 'now', 'planned'].includes(phase.state)))
  // The Markdown room gives a heading the id md-<slug>-<line>; the anchor is its start, and
  // Phase 12 never lands on Phase 12b.
  const slug = (words) => words.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
  const ids = text.split('\n').map((line, index) => /^###\s+(.*)$/.exec(line)).filter(Boolean).map((match, index) => `md-${slug(match[1])}-${index}`)
  assert.ok(ids.some((id) => id.startsWith(phaseAnchor('12b'))))
  assert.equal(ids.filter((id) => id.startsWith(phaseAnchor('12'))).length, 1)
})
