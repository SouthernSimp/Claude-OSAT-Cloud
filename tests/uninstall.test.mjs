import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import * as model from '../shared/uninstall-model.mjs'
import { actionsFor } from '../shared/quick-search-model.mjs'

const { createUninstall } = createRequire(import.meta.url)('../desktop/launcher/uninstall.cjs')
const HOME = '/Users/nate'

test('only an app of his own may go: never the Mac’s, never OSAT, never one outside the Applications folders', () => {
  for (const ok of ['/Applications/Spotify.app', '/Applications/Adobe/Photoshop.app', `${HOME}/Applications/Tool.app`]) assert.equal(model.canUninstall(ok, { home: HOME }), true, ok)
  for (const no of ['/System/Applications/Notes.app', '/Applications/Utilities/Terminal.app', '/Applications/OSAT.app', '/Users/nate/Desktop/Thing.app', '/Applications/../System/x.app', '/Applications/Spotify', '/Library/Thing.app']) {
    assert.equal(model.canUninstall(no, { home: HOME }), false, no)
  }
  assert.equal(model.canUninstall('/Applications/Renamed.app', { home: HOME, id: 'ai.mccreery.osat' }), false, 'OSAT by its id, whatever it is called')
})

test('leftovers are matched only by the exact id or name, never a folder many apps share', () => {
  const places = model.leftoverPlaces(HOME, { id: 'com.spotify.client', name: 'Spotify' }).map((place) => place.path)
  assert.ok(places.includes(`${HOME}/Library/Caches/com.spotify.client`))
  assert.ok(places.includes(`${HOME}/Library/Application Support/Spotify`))
  assert.ok(places.includes(`${HOME}/Library/Preferences/com.spotify.client.plist`))
  assert.ok(places.every((place) => place.startsWith(`${HOME}/Library/`)))
  assert.ok(!places.some((place) => place.includes('Group Containers')))
  assert.deepEqual(model.leftoverPlaces(HOME, { id: 'com.apple.Notes', name: 'Google' }), [], 'Apple’s ids and shared names match nothing')
  assert.deepEqual(model.leftoverPlaces(HOME, { id: 'nodots', name: 'ab' }), [])
  assert.equal(model.leftoverPlaces(HOME, { id: '../../etc', name: 'x/y' }).length, 0)
  assert.deepEqual([model.sizeLabel(12), model.sizeLabel(4096), model.sizeLabel(3 * 1024 * 1024)], ['12 KB', '4 MB', '3.0 GB'])
})

test('an app row offers Uninstall…, except one of the Mac’s own', () => {
  const ids = (path) => actionsFor({ kind: 'app', title: 'X', data: { path } }).map((action) => action.id)
  assert.ok(ids('/Applications/Spotify.app').includes('uninstall'))
  assert.ok(!ids('/System/Applications/Notes.app').includes('uninstall'))
})

function fakeMac({ running = false, refuseApp = false, quits = true } = {}) {
  const on = new Set(['/Applications/Spotify.app', `${HOME}/Library/Caches/com.spotify.client`, `${HOME}/Library/Application Support/Spotify`])
  const bin = []
  let alive = running
  const calls = []
  const uninstall = createUninstall({
    model, platform: 'darwin', home: HOME,
    apps: { has: async (path) => path === '/Applications/Spotify.app' || path === '/System/Applications/Notes.app' },
    processes: { list: async () => (alive ? [{ path: '/Applications/Spotify.app' }] : []), end: async () => { calls.push('quit'); if (quits) alive = false; return 1 } },
    exec: async (command, args) => {
      if (command.endsWith('plutil')) return 'com.spotify.client\n'
      if (command.endsWith('du')) return `${args[1].endsWith('.app') ? 200000 : 1024}\t${args[1]}\n`
      throw new Error(`unexpected ${command}`)
    },
    exists: (path) => on.has(path),
    trash: async (path) => { if (refuseApp && path.endsWith('.app')) throw new Error('NOT_TRASHED'); on.delete(path); bin.push(path); return `${HOME}/.Trash/${path.split('/').pop()}` },
    restore: async (from, to) => { calls.push(['restore', from, to]); on.add(to) },
  })
  return { uninstall, on, bin, calls }
}

test('the plan says what would go and how big, and changes nothing', async () => {
  const mac = fakeMac({ running: true })
  const plan = await mac.uninstall.plan('/Applications/Spotify.app')
  assert.equal(plan.name, 'Spotify')
  assert.equal(plan.running, true)
  assert.deepEqual(plan.leftovers.map((place) => place.path).sort(), [`${HOME}/Library/Application Support/Spotify`, `${HOME}/Library/Caches/com.spotify.client`])
  assert.equal(plan.size, 200000 + 2048)
  assert.match(model.describePlan(plan), /^Return again moves Spotify and 2 things it left behind \(197 MB\) to the Bin\. Spotify is open/)
  assert.equal(mac.bin.length, 0)
  assert.match((await mac.uninstall.plan('/Applications/NotListed.app')).refused, /isn’t on the list/)
  assert.match((await mac.uninstall.plan('/System/Applications/Notes.app')).refused, /part of the Mac/)
})

test('run: an open app is asked to quit, then it and its leftovers go to the Bin; Undo puts all of it back', async () => {
  const mac = fakeMac({ running: true })
  const done = await mac.uninstall.run('/Applications/Spotify.app')
  assert.equal(done.ok, true)
  assert.equal(done.moved, 3)
  assert.equal(mac.calls[0], 'quit')
  assert.equal(mac.on.size, 0)
  assert.equal(await mac.uninstall.undo(done.token), 3)
  assert.equal(mac.on.size, 3)
  await assert.rejects(mac.uninstall.undo(done.token), /can’t be undone/)
})

test('an app that won’t quit, or one macOS won’t let go without a password, leaves everything where it was', async () => {
  const stuck = fakeMac({ running: true, quits: false })
  const notQuit = await stuck.uninstall.run('/Applications/Spotify.app')
  assert.equal(notQuit.ok, false)
  assert.match(notQuit.reason, /didn’t quit/)
  assert.equal(stuck.bin.length, 0)
  const locked = fakeMac({ refuseApp: true })
  const refused = await locked.uninstall.run('/Applications/Spotify.app')
  assert.equal(refused.ok, false)
  assert.equal(refused.reveal, true)
  assert.equal(locked.bin.length, 0, 'no leftovers go when the app itself stays')
})
