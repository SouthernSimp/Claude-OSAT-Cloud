import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { cleanSettings } from '../shared/launcher-model.mjs'
import { cleanPicks, remember, scoreOf } from '../shared/picks.mjs'
import { buildRows, rankApps, readTyped, startRow } from '../shared/quick-search-model.mjs'

const { validHotkey } = createRequire(import.meta.url)('../desktop/desk.cjs')
const settings = cleanSettings(undefined, { validHotkey })
const now = new Date(2026, 9, 12, 21, 0)
const apps = ['Safari', 'Screenshot', 'Slack', 'Spotify', 'System Settings'].map((name) => ({ name, path: `/Applications/${name}.app` }))

test('the bar learns: what you picked for the words comes first', () => {
  const fresh = buildRows(readTyped('s', settings), { apps }, settings, { now })
  assert.equal(fresh.find((row) => row.kind === 'app').title, 'Safari', 'nothing learned: alphabetical')

  let picks = {}
  picks = remember(picks, 'app:/Applications/Slack.app', 'sl', +now - 1000)
  picks = remember(picks, 'app:/Applications/Slack.app', 'slack', +now - 500)
  const rows = buildRows(readTyped('s', settings), { apps }, settings, { now, picks })
  assert.equal(rows[0].title, 'Slack')
  assert.equal(rows[0].section, 'Top hit')
  assert.equal(rows[startRow(rows, readTyped('s', settings))].title, 'Slack', 'the highlight starts on it')
  assert.equal(rows.filter((row) => row.title === 'Slack').length, 1, 'moved, not copied')

  // A question still puts Ask first, ahead of it.
  const ready = { state: 'ready', label: 'AI' }
  const asked = buildRows(readTyped('s', settings), { apps }, settings, { now, picks, ai: ready })
  assert.equal(asked[0].title, 'Slack')
  assert.equal(asked.at(-2).kind, 'ask', 'Ask AI waits under what was found')
})

test('apps used often sort ahead of others that match as well', () => {
  let picks = {}
  for (let i = 0; i < 3; i++) picks = remember(picks, 'app:/Applications/Spotify.app', '', +now)
  assert.deepEqual(rankApps(apps, 's', picks, +now).slice(0, 2).map((app) => app.name), ['Spotify', 'Safari'])
  assert.deepEqual(rankApps(apps, 's').slice(0, 2).map((app) => app.name), ['Safari', 'Screenshot'])
})

test('old picks fade and the list stays small', () => {
  const day = 24 * 60 * 60 * 1000
  const picks = remember({}, 'k', 'x', +now - 60 * day)
  assert.ok(scoreOf(picks, 'k', '', +now) < scoreOf(remember({}, 'k', 'x', +now), 'k', '', +now))
  let many = {}
  for (let i = 0; i < 450; i++) many = remember(many, `k${i}`, 'w', i)
  assert.equal(Object.keys(many).length, 400)
  assert.equal(many.k0, undefined, 'the oldest go first')
  assert.deepEqual(cleanPicks('nonsense'), {})
  assert.deepEqual(cleanPicks({ a: { n: 1, at: 2, q: { x: 1, y: 'bad' } }, b: { n: 'x' } }), { a: { n: 1, at: 2, q: { x: 1 } } })
})
