import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { actionsFor, buildRows, readTyped, wants } from '../shared/quick-search-model.mjs'
import { DEFAULT_SETTINGS } from '../shared/launcher-model.mjs'
import { groupApps, matchApps, processRow, sizeOf, wantsKill } from '../shared/process-model.mjs'

const require = createRequire(import.meta.url)
const { createProcesses } = require('../desktop/launcher/processes.cjs')

const PS = `
  101 501 1048576 1.5 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  102 501 2097152 0.2 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper
  103 501 51200 0.0 /Applications/Spotify.app/Contents/MacOS/Spotify
  104 501 99999 0.0 /Applications/OSAT.app/Contents/MacOS/OSAT
  105 501 4000 0.0 /Applications/OSAT.app/Contents/Frameworks/OSAT Helper.app/Contents/MacOS/OSAT Helper
  106 0 90000 0.0 /Applications/Rooty.app/Contents/MacOS/Rooty
  107 501 30000 0.0 /System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow
  108 501 20000 0.0 /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder
  109 501 10000 0.0 /usr/libexec/launchd_helper
  110 501 40000 0.0 /System/Applications/Notes.app/Contents/MacOS/Notes
`

test('running apps are grouped by .app, biggest memory first, and only Nate’s own apps that are safe to end', () => {
  const list = groupApps(PS, { uid: 501, selfPid: 104 })
  assert.deepEqual(list.map((item) => [item.name, item.count, item.kb]), [['Google Chrome', 2, 3145728], ['Spotify', 1, 51200], ['Notes', 1, 40000], ['Finder', 1, 20000]])
  assert.equal(list.some((item) => item.name === 'OSAT'), false, 'never OSAT itself')
  assert.equal(list.some((item) => item.name === 'Rooty'), false, 'never another user’s')
  assert.equal(list.some((item) => item.name === 'loginwindow'), false, 'never what would log Nate out')
  assert.deepEqual(groupApps('garbage\n\n', { uid: 501, selfPid: 1 }), [])
})

test('the list is filtered by words, and its rows say what they are', () => {
  const list = groupApps(PS, { uid: 501, selfPid: 104 })
  assert.deepEqual(matchApps(list, 'chrome').map((item) => item.name), ['Google Chrome'])
  assert.deepEqual(matchApps(list, 'goo chr').length, 1)
  assert.equal(sizeOf(5.55 * 1024 * 1024), '5.55 GiB')
  assert.equal(sizeOf(51200), '50 MiB')
  const row = processRow(list[0])
  assert.deepEqual([row.title, row.subtitle, row.kind], ['Google Chrome', '2 processes · 3.00 GiB', 'process'])
  assert.deepEqual(actionsFor(row).map((action) => [action.id, action.keys]), [['kill', '↵'], ['force-kill', '⌘↵']])
})

test('typing kill offers Kill Process, which opens the list of running apps', () => {
  assert.equal(wantsKill('kill'), true)
  assert.equal(wantsKill('Force quit'), true)
  assert.equal(wantsKill('killer whale notes'), true, 'only offered: a row among the others, never a takeover')
  assert.equal(wantsKill('budget'), false)
  const read = readTyped('kill', DEFAULT_SETTINGS, 'all')
  const row = buildRows(read, {}, DEFAULT_SETTINGS, { now: Date.now() }).find((item) => item.key === 'kill')
  assert.deepEqual([row.title, row.data.scope, actionsFor(row)[0].label], ['Kill Process', 'kill', 'Open'])
  const inside = readTyped('chrome', DEFAULT_SETTINGS, 'kill')
  assert.equal(wants(inside, DEFAULT_SETTINGS).processes, true)
  assert.equal(wants(readTyped('chrome', DEFAULT_SETTINGS, 'all'), DEFAULT_SETTINGS).processes, false, 'asked only inside Kill Process')
  const rows = buildRows(inside, { processes: groupApps(PS, { uid: 501, selfPid: 104 }) }, DEFAULT_SETTINGS, { now: Date.now() })
  assert.deepEqual(rows.map((item) => item.title), ['Google Chrome'])
})

test('ending an app signals only the processes a fresh list finds for that path', async () => {
  const model = await import('../shared/process-model.mjs')
  const sent = []
  const make = (platform = 'darwin') => createProcesses({ exec: async () => PS, model, platform, uid: 501, selfPid: 104, kill: (pid, signal) => sent.push([pid, signal]) })
  assert.equal(await make().end('/Applications/Google Chrome.app'), 2)
  assert.deepEqual(sent, [[101, 'SIGTERM'], [102, 'SIGTERM']])
  sent.length = 0
  assert.equal(await make().end('/Applications/Spotify.app', { force: true }), 1)
  assert.deepEqual(sent, [[103, 'SIGKILL']])
  sent.length = 0
  for (const path of ['/Applications/OSAT.app', '/Applications/Rooty.app', '/System/Library/CoreServices/loginwindow.app', '/bin/sh', '../../etc', '']) assert.equal(await make().end(path), 0, path)
  assert.equal(sent.length, 0, 'nothing else was touched')
  assert.deepEqual(await make('linux').list(), [])
})
