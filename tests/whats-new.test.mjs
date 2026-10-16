import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildOf, changelogBuilds, isYours, itemOf } from '../src/lib/changelog.js'
import { roadmapPhases, stateOf } from '../src/lib/roadmap.js'
import { comingPhases, planBoard, setUpPlan, syncPlan, PLAN_NAME } from '../src/boards/plan.js'
import { stageOf, stickiesOn } from '../src/boards/boards-model.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

const CHANGELOG = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

test('the real CHANGELOG reads as builds: each with a date, a name or items, and the pull requests behind each line', () => {
  const builds = changelogBuilds(CHANGELOG)
  assert.ok(builds.length > 20)
  const numbered = builds.filter((build) => build.from)
  // Newest first, ranges in order, nothing out of place.
  numbered.forEach((build, index) => {
    assert.ok(build.to >= build.from, build.key)
    if (index) assert.ok(build.to < numbered[index - 1].from, `${build.key} is out of order`)
  })
  for (const build of builds) {
    assert.ok(build.date, `${build.key} has no date`)
    assert.ok(build.items.length, `${build.key} has no changes`)
    for (const item of build.items) {
      assert.ok(item.text && !/\(#\d/.test(item.text), `${build.key}: “${item.text}” kept its pull requests in its words`)
      assert.ok(item.pulls.every((pull) => pull.number > 0), `${build.key}: a pull request without a number`)
    }
  }
  const before = builds.at(-1)
  assert.equal(before.from, null)
  assert.match(before.intro, /DMG/)
  assert.ok(builds.find((build) => build.key === 'Builds 270–271'))
})

test('a line keeps its words; one, several or a range of pull requests become chips', () => {
  assert.deepEqual(itemOf('**Mail** is fast. (#99)'), { text: '**Mail** is fast.', pulls: [{ label: '#99', number: 99 }] })
  assert.deepEqual(itemOf('A Hyper key and Mouse settings. (#91, #92)').pulls.map((pull) => pull.number), [91, 92])
  assert.deepEqual(itemOf('The first days (#1–#3)'), { text: 'The first days.', pulls: [{ label: '#1–#3', number: 1 }] })
  assert.deepEqual(itemOf('No pull request here'), { text: 'No pull request here', pulls: [] })
})

test('the build you have: its number from the version, a range holds it, and Next build is always this build', () => {
  assert.equal(buildOf('0.1.280'), 280)
  assert.equal(buildOf('0.1.0'), null)
  assert.equal(buildOf(undefined), null)
  const [next, range] = changelogBuilds('## Next build · Oct 16 — Soon\n\n- New. (#103)\n\n## Builds 270–271 · Oct 15\n\n- Polish. (#96)\n')
  assert.equal(next.next, true)
  assert.ok(isYours(next, null))
  assert.ok(isYours(range, 271) && !isYours(range, 280) && !isYours(range, null))
})

test('the Roadmap reads dropped and completed rows, and a pipe inside a row’s words', () => {
  assert.equal(stateOf('Dropped: the Sky became boards'), 'dropped')
  assert.equal(stateOf('Replaced by Phases 69 and 70'), 'dropped')
  assert.equal(stateOf('Completed in continuation'), 'done')
  const [phase] = roadmapPhases('## Status\n\n| Phase | What | State |\n|---|---|---|\n| 38 | List \\| Canvas per topic | Merged (PR #68) |\n')
  assert.deepEqual([phase.what, phase.state, phase.pr], ['List | Canvas per topic', 'done', 68])
})

const ROADMAP = (rows) => `## Status\n\n| Phase | What | State |\n|---|---|---|\n${rows.map(([id, state]) => `| ${id} | Phase ${id}'s work | ${state} |`).join('\n')}\n`
const fresh = () => normalizeWorkspace({ ...createDefaultWorkspace(), notes: [], folders: [] })

test('the plan board: what is coming, in review → Doing, the current plan → Next, older plans → Later, in order', () => {
  const phases = roadmapPhases(ROADMAP([['13d', 'Planned'], ['31', 'In review'], ['67', 'Merged (PR #98)'], ['68', 'Merged (PR #102)'], ['69', 'Planned'], ['70', 'Planned']]))
  assert.deepEqual(comingPhases(phases).map((phase) => phase.id), ['13d', '31', '69', '70'])
  const { state, folder } = setUpPlan(fresh(), phases)
  assert.equal(folder.name, PLAN_NAME)
  assert.equal(planBoard(state).id, folder.id)
  const on = stickiesOn(state, folder.id)
  const stage = (id) => stageOf(on.find((note) => note.id === state.settings.plan.notes[id]))
  assert.deepEqual(['13d', '31', '69', '70'].map(stage), ['later', 'doing', 'next', 'next'])
  const ranked = [...on].sort((a, b) => a.rank - b.rank).map((note) => note.title)
  assert.deepEqual(ranked, ['Phase 13d · Phase 13d\'s work', 'Phase 31 · Phase 31\'s work', 'Phase 69 · Phase 69\'s work', 'Phase 70 · Phase 70\'s work'])
  assert.ok(on.every((note) => note.source === 'Roadmap' && !note.unsorted))
})

test('the plan board keeps up: new plans join Later, merged ones are ticked off, a deleted one stays gone, nothing else moves', () => {
  const first = roadmapPhases(ROADMAP([['31', 'In review'], ['69', 'Planned'], ['70', 'Planned']]))
  const made = setUpPlan(fresh(), first).state
  const ids = made.settings.plan.notes
  // Nate deletes 70 and moves 69 to Doing.
  const touched = { ...made, notes: made.notes.map((note) => (note.id === ids['70'] ? { ...note, trashedAt: '2026-10-16T00:00:00Z' } : note.id === ids['69'] ? { ...note, stage: 'doing' } : note)) }
  const later = roadmapPhases(ROADMAP([['31', 'Merged (PR #103)'], ['69', 'Planned'], ['70', 'Planned'], ['72', 'Planned']]))
  const { state, added, finished } = syncPlan(touched, later, '2026-10-17T00:00:00Z')
  assert.deepEqual([added, finished], [['72'], ['31']])
  const note = (id) => state.notes.find((item) => item.id === state.settings.plan.notes[id])
  assert.equal(note('31').doneAt, '2026-10-17T00:00:00Z')
  assert.equal(stageOf(note('72')), 'later')
  assert.equal(stageOf(note('69')), 'doing')
  assert.ok(note('70').trashedAt, 'a deleted phase came back')
  assert.equal(syncPlan(state, later).state, state, 'a second look changed something')
  assert.equal(syncPlan(fresh(), later).state.notes.length, 0, 'a workspace without the board got one')
})
