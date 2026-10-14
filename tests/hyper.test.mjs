import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { listHelpers } from '../scripts/build-helpers.mjs'
import { comboFrom } from '../src/lib/hotkey.js'
import { applyPatch, cleanSettings } from '../shared/launcher-model.mjs'
import * as model from '../shared/hyper-model.mjs'

const require = createRequire(import.meta.url)
const { createCapsMapping, createHyper } = require('../desktop/launcher/hyper.cjs')
const repo = fileURLToPath(new URL('..', import.meta.url))

const OURS = { src: model.CAPS_LOCK, dst: model.F20 }
const FOREIGN = { src: 0x700000064, dst: 0x700000035 }

/* A pretend hidutil: `keyboards` is what the Mac holds; `calls` is every command it was given. It prints as hidutil does. */
function fakeHidutil(list = [], { garbage = false, failSet = false } = {}) {
  const calls = []
  const box = { list }
  const run = (args) => {
    calls.push(args)
    if (args[1] === '--get') {
      if (garbage) return 'hidutil: no matching services'
      const blocks = box.list.map((entry) => `        {\n        HIDKeyboardModifierMappingDst = ${entry.dst};\n        HIDKeyboardModifierMappingSrc = ${entry.src};\n    }`).join(',\n')
      return `100000d7e   UserKeyMapping   (null)\n1000105b6   UserKeyMapping   ${box.list.length ? `(\n${blocks}\n)` : '(null)'}\n`
    }
    if (failSet) throw new Error('hidutil failed')
    const argument = JSON.parse(args[2])
    box.list = argument.UserKeyMapping.map((entry) => ({ src: entry.HIDKeyboardModifierMappingSrc, dst: entry.HIDKeyboardModifierMappingDst }))
    return ''
  }
  return { run, calls, box, sets: () => calls.filter((call) => call[1] === '--set') }
}

async function mapped(hid, platform = 'darwin') {
  const dir = await mkdtemp(path.join(tmpdir(), 'osat-hyper-'))
  const file = path.join(dir, 'hyper.json')
  return { file, mapping: createCapsMapping({ run: hid.run, file, model, platform }) }
}

test('Caps Lock → F20 is added after the mappings already there, and only ours comes out again', async () => {
  const hid = fakeHidutil([FOREIGN])
  const { mapping, file } = await mapped(hid)
  assert.deepEqual(mapping.add(), { ok: true, added: true })
  assert.deepEqual(hid.box.list, [FOREIGN, OURS], 'the other mapping stays')
  assert.equal(mapping.ours(), true)
  assert.equal(existsSync(file), true)
  assert.deepEqual(mapping.remove(), { ok: true })
  assert.deepEqual(hid.box.list, [FOREIGN], 'only ours went')
  assert.equal(existsSync(file), false)
  assert.equal(mapping.ours(), false)
})

test('on a keyboard with no mappings, off leaves none', async () => {
  const hid = fakeHidutil([])
  const { mapping } = await mapped(hid)
  mapping.add()
  assert.deepEqual(hid.box.list, [OURS])
  mapping.remove()
  assert.deepEqual(hid.box.list, [])
  assert.deepEqual(hid.sets().at(-1), ['property', '--set', '{"UserKeyMapping":[]}'])
})

test('a Caps Lock → F20 left by another app is used as it is and never removed', async () => {
  const hid = fakeHidutil([OURS, FOREIGN])
  const { mapping, file } = await mapped(hid)
  assert.deepEqual(mapping.add(), { ok: true, added: false })
  assert.equal(hid.sets().length, 0, 'nothing was written')
  assert.equal(existsSync(file), false)
  assert.deepEqual(mapping.remove(), { ok: true })
  assert.equal(hid.sets().length, 0, 'it is not ours to take out')
  assert.deepEqual(hid.box.list, [OURS, FOREIGN])
})

test('adding twice does not duplicate ours', async () => {
  const hid = fakeHidutil([FOREIGN])
  const { mapping } = await mapped(hid)
  mapping.add()
  assert.deepEqual(mapping.add(), { ok: true, added: false })
  assert.deepEqual(hid.box.list, [FOREIGN, OURS])
  assert.equal(hid.sets().length, 1)
})

test('after a crash, the note still says the entry is ours, so it is cleaned up', async () => {
  const hid = fakeHidutil([FOREIGN])
  const { mapping, file } = await mapped(hid)
  mapping.add()
  // A new OSAT, the same data folder, the entry still on the Mac.
  const later = createCapsMapping({ run: hid.run, file, model })
  assert.equal(later.ours(), true)
  later.remove()
  assert.deepEqual(hid.box.list, [FOREIGN])
})

test('a restart (the Mac rebooted, the entry is gone) just forgets the note', async () => {
  const hid = fakeHidutil([FOREIGN])
  const { mapping, file } = await mapped(hid)
  mapping.add()
  hid.box.list = []
  assert.deepEqual(mapping.remove(), { ok: true })
  assert.deepEqual(hid.box.list, [], 'nothing was put back that was not there')
  assert.equal(existsSync(file), false)
})

test('hidutil text OSAT does not understand leaves the keyboard alone', async () => {
  const hid = fakeHidutil([FOREIGN], { garbage: true })
  const { mapping } = await mapped(hid)
  const said = []
  assert.deepEqual(mapping.add(), { ok: false })
  assert.equal(hid.sets().length, 0, 'it would have overwritten mappings it could not see')
  assert.deepEqual(mapping.remove(), { ok: true }, 'nothing was ours')
  // A note that says it is ours, but now hidutil makes no sense: it asks nothing and keeps the note.
  const dir = await mkdtemp(path.join(tmpdir(), 'osat-hyper-'))
  const file = path.join(dir, 'hyper.json')
  const good = createCapsMapping({ run: fakeHidutil([FOREIGN]).run, file, model })
  good.add()
  const bad = createCapsMapping({ run: hid.run, file, model, log: (text) => said.push(text) })
  assert.deepEqual(bad.remove(), { ok: false })
  assert.equal(bad.ours(), true, 'tried again later')
  assert.equal(said.length, 1)
})

test('hidutil failing, or missing, is a calm no', async () => {
  const failing = fakeHidutil([], { failSet: true })
  assert.deepEqual((await mapped(failing)).mapping.add(), { ok: false })
  const missing = createCapsMapping({ run: () => { throw new Error('ENOENT') }, file: path.join(await mkdtemp(path.join(tmpdir(), 'osat-hyper-')), 'hyper.json'), model })
  assert.deepEqual(missing.add(), { ok: false })
  assert.deepEqual(missing.remove(), { ok: true })
})

test('off the Mac it never calls hidutil', async () => {
  const hid = fakeHidutil([])
  const { mapping } = await mapped(hid, 'linux')
  assert.deepEqual(mapping.add(), { ok: false })
  assert.deepEqual(mapping.remove(), { ok: true })
  assert.equal(hid.calls.length, 0)
})

/* ---- the controller ---- */

function fakeProcess() {
  const proc = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stdout.setEncoding = () => {}
  proc.stderr = new EventEmitter()
  proc.killed = false
  proc.kill = () => { proc.killed = true }
  return proc
}

async function controller({ trusted = true, platform = 'darwin', hid = fakeHidutil([FOREIGN]), noSpawn = false } = {}) {
  const procs = []
  const calls = []
  const { mapping } = await mapped(hid)
  const hyper = createHyper({
    spawn: noSpawn ? null : (file, args) => { calls.push([file, args]); const proc = fakeProcess(); procs.push(proc); return proc },
    platform, owner: 4242, helperPath: '/App/Resources/osat-hyper', model, mapping, trusted: () => trusted, retryMs: 5,
  })
  return { hyper, procs, calls, hid }
}
const say = (proc, line) => proc.stdout.emit('data', `${line}\n`)
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

test('off until asked: nothing starts, and a Mac without the app says so', async () => {
  const { hyper, procs, hid } = await controller()
  assert.equal(hyper.state(), 'off')
  hyper.sync(false)
  assert.equal(procs.length, 0)
  assert.equal(hid.calls.filter((call) => call[1] === '--set').length, 0)
  assert.equal((await controller({ platform: 'linux' })).hyper.state(), 'unavailable')
  assert.equal((await controller({ noSpawn: true })).hyper.state(), 'unavailable')
})

test('turned on: the helper starts with its owner; the keyboard changes only once it says ready', async () => {
  const { hyper, procs, calls, hid } = await controller()
  hyper.sync(true)
  assert.deepEqual(calls, [['/App/Resources/osat-hyper', ['--owner', '4242']]])
  assert.equal(hyper.state(), 'starting')
  assert.deepEqual(hid.box.list, [FOREIGN], 'not yet')
  say(procs[0], 'ready')
  assert.equal(hyper.state(), 'working')
  assert.deepEqual(hid.box.list, [FOREIGN, OURS])
  hyper.sync(true)
  assert.equal(procs.length, 1, 'a second save starts nothing new')
})

test('turned off: the helper ends and Caps Lock is given back', async () => {
  const { hyper, procs, hid } = await controller()
  hyper.sync(true)
  say(procs[0], 'ready')
  hyper.sync(false)
  assert.equal(procs[0].killed, true)
  assert.equal(hyper.state(), 'off')
  assert.deepEqual(hid.box.list, [FOREIGN])
})

test('quitting gives Caps Lock back at once', async () => {
  const { hyper, procs, hid } = await controller()
  hyper.sync(true)
  say(procs[0], 'ready')
  hyper.stop()
  assert.equal(procs[0].killed, true)
  assert.deepEqual(hid.box.list, [FOREIGN])
  assert.equal(hyper.state(), 'off')
})

test('without Accessibility nothing starts and the keyboard is untouched; allowing it starts it', async () => {
  let allowed = false
  const { hyper, procs, hid } = await controller({ trusted: false })
  hyper.sync(true)
  assert.equal(hyper.state(), 'access')
  assert.equal(procs.length, 0)
  assert.equal(hid.calls.length, 0)
  // The same controller with permission given (Settings looks again when the window comes back).
  const again = createHyper({ spawn: () => { const proc = fakeProcess(); procs.push(proc); return proc }, platform: 'darwin', helperPath: 'h', model, mapping: createCapsMapping({ run: hid.run, file: path.join(await mkdtemp(path.join(tmpdir(), 'osat-hyper-')), 'hyper.json'), model }), trusted: () => allowed })
  again.sync(true)
  assert.equal(again.state(), 'access')
  allowed = true
  again.sync(true)
  assert.equal(again.state(), 'starting')
})

test('macOS refusing the helper is said calmly, and the keyboard is never changed', async () => {
  const { hyper, procs, hid } = await controller()
  hyper.sync(true)
  say(procs[0], 'denied')
  procs[0].emit('exit', 0)
  assert.equal(hyper.state(), 'denied')
  assert.deepEqual(hid.box.list, [FOREIGN])
  hyper.sync(true)
  assert.equal(procs.length, 1, 'not started again by every save')
  hyper.sync(false)
  hyper.sync(true)
  assert.equal(procs.length, 2, 'off and on tries again')
})

test('a helper that ends gives Caps Lock back at once, and one that was working is started again a few times', async () => {
  const { hyper, procs, hid } = await controller()
  hyper.sync(true)
  say(procs[0], 'ready')
  assert.deepEqual(hid.box.list, [FOREIGN, OURS])
  procs[0].emit('exit', 1)
  assert.deepEqual(hid.box.list, [FOREIGN], 'a crash cannot leave Caps Lock sending F20 to no one')
  await settle()
  assert.equal(procs.length, 2)
  say(procs[1], 'ready')
  assert.equal(hyper.state(), 'working')
  assert.deepEqual(hid.box.list, [FOREIGN, OURS])
  for (let i = 2; i < 6; i += 1) {
    procs.at(-1).emit('exit', 1)
    await settle()
    if (procs.length > i) say(procs.at(-1), 'ready')
  }
  assert.equal(hyper.state(), 'failed', 'it gave up rather than loop')
  assert.deepEqual(hid.box.list, [FOREIGN])
})

test('a helper that never worked is not started again', async () => {
  const { hyper, procs } = await controller()
  hyper.sync(true)
  procs[0].emit('error', new Error('ENOENT'))
  assert.equal(hyper.state(), 'failed')
  await settle()
  assert.equal(procs.length, 1)
  hyper.sync(true)
  assert.equal(procs.length, 1, 'a save does not try again either')
  hyper.sync(false)
  hyper.sync(true)
  assert.equal(procs.length, 2)
})

test('if the keyboard cannot be changed the helper is stopped and Settings says so', async () => {
  const { hyper, procs } = await controller({ hid: fakeHidutil([], { garbage: true }) })
  hyper.sync(true)
  say(procs[0], 'ready')
  assert.equal(hyper.state(), 'failed')
  assert.equal(procs[0].killed, true)
})

test('"a tap is Esc" restarts the helper with it', async () => {
  const { hyper, procs, calls } = await controller()
  hyper.sync(true, { tap: false })
  say(procs[0], 'ready')
  hyper.sync(true, { tap: true })
  assert.equal(procs[0].killed, true)
  assert.deepEqual(calls.at(-1)[1], ['--owner', '4242', '--tap-escape'])
})

test('a line of noise from the helper changes nothing', async () => {
  const { hyper, procs } = await controller()
  hyper.sync(true)
  procs[0].stdout.emit('data', 'wat\nrea')
  assert.equal(hyper.state(), 'starting')
  procs[0].stdout.emit('data', 'dy\n')
  assert.equal(hyper.state(), 'working', 'a line split across two chunks still reads')
})

/* ---- the helper, built and shipped ---- */

test('the build script lists every Swift file in desktop/helpers', () => {
  const helpers = listHelpers(repo)
  assert.deepEqual(helpers.map((helper) => helper.name), ['osat-hyper'])
  assert.equal(helpers[0].out, path.join(repo, 'build', 'helpers', 'osat-hyper'))
  assert.equal(existsSync(helpers[0].source), true)
})

test('the helper is built before the app runs or is packaged, shipped in Resources, and checked in CI', async () => {
  const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'))
  assert.match(pkg.scripts['dist:mac'], /scripts\/build-helpers\.mjs/)
  assert.match(pkg.scripts['start:mac'], /scripts\/build-helpers\.mjs/)
  assert.ok(pkg.build.extraResources.some((item) => item.from === 'build/helpers/osat-hyper' && item.to === 'osat-hyper'))
  const ci = await readFile(path.join(repo, '.github', 'workflows', 'ci.yml'), 'utf8')
  assert.match(ci, /node scripts\/build-helpers\.mjs/)
  assert.match(ci, /Resources\/osat-hyper/)
  assert.match(await readFile(path.join(repo, '.gitignore'), 'utf8'), /^build\/helpers\/$/m)
})

test('the helper only reads key codes and flags: no network, no files, nothing typed is written', async () => {
  const swift = await readFile(path.join(repo, 'desktop', 'helpers', 'osat-hyper.swift'), 'utf8')
  const code = swift.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /URLSession|NWConnection|CFNetwork|import Network|socket\(|URL\(|FileManager|fopen|write\(|NSLog|os_log|Logger|\.characters|keyboardGetUnicodeString|stderr/)
  // Every word it says is one of three.
  const said = [...code.matchAll(/say\("([^"]*)"\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(said)].sort(), ['denied', 'ready', 'stopped'])
  assert.match(code, /print\(line\)/)
})

test('the Swift rules are the JS rules: the same codes, time and flags', async () => {
  const swift = await readFile(path.join(repo, 'desktop', 'helpers', 'osat-hyper.swift'), 'utf8')
  assert.equal(Number(/let triggerCode: Int64 = (\d+)/.exec(swift)[1]), model.TRIGGER_CODE)
  assert.equal(Number(/let escapeCode: CGKeyCode = (\d+)/.exec(swift)[1]), model.ESCAPE_CODE)
  assert.equal(Number(/let tapWindow: Double = ([\d.]+)/.exec(swift)[1]) * 1000, model.TAP_MS)
  const flags = /let hyperFlags: CGEventFlags = \[([^\]]+)\]/.exec(swift)[1].split(',').map((word) => word.trim()).sort()
  assert.deepEqual(flags, ['.maskAlternate', '.maskCommand', '.maskControl', '.maskShift'])
  // It restarts what it holds on each thing the JS model calls a reset, and swallows the trigger by returning nil.
  for (const needle of ['tapDisabledByTimeout', 'tapDisabledByUserInput', 'willSleepNotification', 'didWakeNotification', 'return nil', '.headInsertEventTap', '.cgSessionEventTap']) assert.ok(swift.includes(needle), needle)
  assert.match(swift, /case \.leftMouseDown[^\n]*\.otherMouseUp:/)
  assert.match(swift, /default:\n\s*break \/\/ flagsChanged/)
})

/* ---- Settings ---- */

test('the switch is off until turned on; ours always sends all four; a tap is Esc is off', () => {
  const fresh = cleanSettings(undefined)
  assert.deepEqual(fresh.hyper, { sends: 'four', own: false, tap: false })
  const other = cleanSettings({ hyper: { sends: 'three' } })
  assert.deepEqual(other.hyper, { sends: 'three', own: false, tap: false })
  const ours = applyPatch(other, { hyper: { own: true } })
  assert.deepEqual(cleanSettings(ours).hyper, { sends: 'four', own: true, tap: false }, 'Raycast’s ⌃⌥⌘ does not apply to OSAT’s own')
  assert.equal(cleanSettings({ hyper: { own: 'yes', tap: 1 } }).hyper.own, false)
  assert.deepEqual(cleanSettings(applyPatch(ours, { hyper: { tap: true } })).hyper, { sends: 'four', own: true, tap: true })
})

test('recording a key with Hyper held reads as Hyper + the key; a bare F20 says how to fix it', () => {
  const held = { code: 'KeyV', metaKey: true, ctrlKey: true, altKey: true, shiftKey: true }
  assert.deepEqual(comboFrom(held), { combo: 'Control+Alt+Shift+Command+V' })
  assert.match(comboFrom({ code: 'F20' }).error, /Make Caps Lock a Hyper key/)
  assert.match(comboFrom({ code: 'KeyV' }).error, /Hold ⌘/)
})
