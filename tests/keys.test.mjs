import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { INSIDE_OSAT, comboOfSymbolic, fromSymbolic, holdersOf, keyGroups, normalizeCombo } from '../shared/keys-model.mjs'

const require = createRequire(import.meta.url)
const { createMacKeys } = require('../desktop/mac-keys.cjs')

// The real shape of this Mac's com.apple.symbolichotkeys: [ascii, key code, modifier flags].
const SYMBOLIC = { AppleSymbolicHotKeys: {
  64: { enabled: true, value: { parameters: [32, 49, 1048576] } },
  65: { enabled: true, value: { parameters: [32, 49, 1572864] } },
  176: { enabled: true, value: { parameters: [32, 54, 1048592] } },
  79: { enabled: false, value: { parameters: [65535, 123, 8650752] } },
  98: { enabled: true },
} }

test('system hotkeys become OSAT’s key names, only when on and nameable', () => {
  assert.equal(comboOfSymbolic([32, 49, 1048576]), 'Command+Space')
  assert.equal(comboOfSymbolic([32, 49, 1179648]), 'Command+Shift+Space')
  assert.equal(comboOfSymbolic([65535, 53, 1048576]), 'Command+Esc')
  assert.equal(comboOfSymbolic([32, 54, 1048592]), null, 'a bare modifier has no name')
  assert.equal(comboOfSymbolic([113, 12, 8388608]), null, 'Fn keys are left out')
  assert.equal(comboOfSymbolic(null), null)
  assert.deepEqual(fromSymbolic(SYMBOLIC), [{ name: 'Finder search', combo: 'Command+Alt+Space' }, { name: 'Spotlight', combo: 'Command+Space' }])
  assert.deepEqual(fromSymbolic(null), [])
})

test('a key is the same whatever order it was written in, and who holds it is named', () => {
  assert.equal(normalizeCombo('Shift+Command+Space'), 'Command+Shift+Space')
  assert.equal(normalizeCombo('Alt+k'), 'Alt+K')
  const groups = keyGroups({ desk: [{ name: 'Search or Ask', combo: 'Command+Shift+Space' }], launcher: [], mac: fromSymbolic(SYMBOLIC) })
  assert.deepEqual(groups.map((group) => group.id), ['desk', 'inside', 'mac'], 'an empty group is left out')
  assert.deepEqual(holdersOf(groups, 'Shift+Command+Space'), [{ name: 'Search or Ask', group: 'desk' }])
  assert.deepEqual(holdersOf(groups, 'Command+Space'), [{ name: 'Spotlight', group: 'mac' }])
  assert.deepEqual(holdersOf(groups, 'Control+Alt+J'), [])
  assert.ok(holdersOf(groups, INSIDE_OSAT[0].combo).length)
})

test('the Mac’s list is read through plutil, and is empty off the Mac or when it can’t be read', async () => {
  const sharedModule = (name) => import(`../shared/${name}`)
  let asked
  const run = (file, args, options, done) => { asked = [file, ...args]; done(null, JSON.stringify(SYMBOLIC)) }
  const rows = await createMacKeys({ sharedModule, platform: 'darwin', run, file: '/x.plist' }).read()
  assert.deepEqual(asked, ['/usr/bin/plutil', '-convert', 'json', '-o', '-', '/x.plist'])
  assert.equal(rows.length, 2)
  assert.deepEqual(await createMacKeys({ sharedModule, platform: 'linux', run }).read(), [])
  assert.deepEqual(await createMacKeys({ sharedModule, platform: 'darwin', run: (f, a, o, done) => done(new Error('no')) }).read(), [])
  assert.deepEqual(await createMacKeys({ sharedModule, platform: 'darwin', run: (f, a, o, done) => done(null, 'not json') }).read(), [])
})
