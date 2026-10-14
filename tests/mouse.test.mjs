import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { applyPatch, cleanSettings } from '../shared/launcher-model.mjs'
import * as model from '../shared/mouse-model.mjs'

const { BUTTON_KEYS, buttonAction, cleanMouse, configLine, deviceOf, mergeMouse, readHelperLine, scrollAxis, scrollEvent, wantsHelper } = model
const require = createRequire(import.meta.url)
const { createMouse, helperPath } = require('../desktop/launcher/mouse.cjs')
const root = fileURLToPath(new URL('..', import.meta.url))

/* Mouse (Phase 64): the pure rules (reverse per axis per device, speed, the side buttons), how they sit in launcher.json,
   the helper's lifecycle (with a pretend process: no helper is ever started here) and what the helper's source may say. */

const axis = (line, fixed = line, point = line * 10) => ({ line, fixed, point })
const wheel = (vertical, horizontal = 0, extra = {}) => ({ phase: 0, momentum: 0, vertical: axis(vertical), horizontal: axis(horizontal), ...extra })
const finger = (vertical, horizontal = 0) => wheel(vertical, horizontal, { phase: 4 })
const reversed = (patch = {}) => mergeMouse(undefined, { on: true, reverse: { mouse: { vertical: true, horizontal: true } }, ...patch })

test('a wheel with notches is a mouse; any scroll phase or momentum is a trackpad', () => {
  assert.equal(deviceOf({ phase: 0, momentum: 0 }), 'mouse')
  assert.equal(deviceOf(), 'mouse')
  assert.equal(deviceOf({ phase: 4, momentum: 0 }), 'trackpad', 'fingers moving')
  assert.equal(deviceOf({ phase: 128, momentum: 0 }), 'trackpad', 'fingers just down')
  assert.equal(deviceOf({ phase: 0, momentum: 2 }), 'trackpad', 'gliding on after the fingers lifted')
})

test('reversing the mouse wheel leaves the trackpad as it is', () => {
  const rules = reversed()
  const mouse = scrollEvent(wheel(3, -2), rules)
  assert.deepEqual([mouse.device, mouse.vertical.line, mouse.vertical.fixed, mouse.vertical.point, mouse.horizontal.line], ['mouse', -3, -3, -30, 2])
  const trackpad = scrollEvent(finger(3, -2), rules)
  assert.deepEqual([trackpad.device, trackpad.vertical.line, trackpad.vertical.point, trackpad.horizontal.line], ['trackpad', 3, 30, -2])
  assert.equal(scrollEvent({ ...wheel(3), momentum: 1, vertical: axis(3) }, rules).vertical.line, 3, 'momentum after a trackpad scroll is still the trackpad')
})

test('each axis is chosen on its own, for each device', () => {
  const upDown = reversed({ reverse: { mouse: { vertical: true, horizontal: false } } })
  const event = scrollEvent(wheel(2, 2), upDown)
  assert.deepEqual([event.vertical.line, event.horizontal.line], [-2, 2])
  const leftRight = scrollEvent(wheel(2, 2), mergeMouse(upDown, { reverse: { mouse: { vertical: false, horizontal: true } } }))
  assert.deepEqual([leftRight.vertical.line, leftRight.horizontal.line], [2, -2])
  // The trackpad can be asked to reverse too, by itself.
  const both = mergeMouse(undefined, { on: true, reverse: { trackpad: { vertical: true } } })
  assert.deepEqual([scrollEvent(finger(5, 5), both).vertical.line, scrollEvent(finger(5, 5), both).horizontal.line], [-5, 5])
  assert.equal(scrollEvent(wheel(5), both).vertical.line, 5, 'and the mouse stays')
})

test('reversing twice is the original, and zero stays zero', () => {
  const once = scrollAxis(axis(4), { reverse: true })
  assert.deepEqual(scrollAxis(once, { reverse: true }), { ...axis(4), residual: 0 })
  const none = scrollAxis(axis(0), { reverse: true })
  assert.ok(Object.is(none.line, 0) && Object.is(none.fixed, 0) && Object.is(none.point, 0), 'no -0')
})

test('speed scales the wheel exactly where it can, and carries the part a whole line can’t show', () => {
  assert.deepEqual(scrollAxis(axis(1), { factor: 2 }), { line: 2, fixed: 2, point: 20, residual: 0 })
  // Half speed: every second notch moves a line, and the finer measures are always half.
  let residual = 0
  const lines = []
  for (let notch = 0; notch < 4; notch += 1) {
    const step = scrollAxis(axis(1), { factor: 0.5 }, residual)
    residual = step.residual
    lines.push(step.line)
    assert.equal(step.point, 5)
  }
  assert.deepEqual(lines, [0, 1, 0, 1])
  // 1.5 on single notches: 1, 2, 1, 2 … = 1.5 on average, and reversing adds the sign.
  residual = 0
  const faster = []
  for (let notch = 0; notch < 4; notch += 1) {
    const step = scrollAxis(axis(1), { factor: 1.5, reverse: true }, residual)
    residual = step.residual
    faster.push(step.line)
  }
  assert.deepEqual(faster, [-1, -2, -1, -2])
  // Turning the wheel the other way drops what was carried.
  assert.equal(scrollAxis(axis(-1), { factor: 0.5 }, 0.5).line, 0)
})

test('speed is for the wheel only, never the trackpad', () => {
  const fast = mergeMouse(undefined, { on: true, speed: 3 })
  assert.equal(scrollEvent(wheel(2), fast).vertical.line, 6)
  assert.equal(scrollEvent(finger(2), fast).vertical.line, 2)
  assert.equal(scrollEvent(finger(2), fast).vertical.point, 20)
})

test('what is saved is cleaned, and an old launcher.json (no mouse) still loads', () => {
  const old = cleanSettings({ version: 2, view: 'bar' })
  assert.deepEqual(old.mouse, { on: false, reverse: { mouse: { vertical: false, horizontal: false }, trackpad: { vertical: false, horizontal: false } }, speed: 1, buttons: {} })
  const dirty = cleanMouse({ on: 'yes', reverse: { mouse: { vertical: 1, horizontal: true }, trackpad: 'x' }, speed: 99, buttons: { 0: 'back', 2: 'back', 3: 'back', 4: 'explode', 5: 'forward' } })
  assert.equal(dirty.on, false, 'only true turns it on')
  assert.deepEqual(dirty.reverse, { mouse: { vertical: false, horizontal: true }, trackpad: { vertical: false, horizontal: false } })
  assert.equal(dirty.speed, 4, 'speed stays between 0.5 and 4')
  assert.deepEqual(dirty.buttons, { 3: 'back' }, 'only the side buttons, only real actions')
  assert.equal(cleanMouse({ speed: 'fast' }).speed, 1)
  assert.equal(cleanMouse({ speed: 1.3 }).speed, 1.25, 'steps of a quarter')
  assert.equal(cleanMouse({ speed: 0 }).speed, 0.5)
  assert.deepEqual(cleanSettings({ mouse: { on: true, speed: 2 } }).mouse.speed, 2)
})

test('a patch from Settings changes only what it names', () => {
  const start = reversed({ speed: 2, buttons: { 3: 'forward' } })
  const next = mergeMouse(start, { reverse: { trackpad: { vertical: true } } })
  assert.deepEqual(next.reverse, { mouse: { vertical: true, horizontal: true }, trackpad: { vertical: true, horizontal: false } })
  assert.equal(next.speed, 2)
  assert.deepEqual(mergeMouse(next, { buttons: { 3: 'default', 4: 'back' } }).buttons, { 4: 'back' }, 'As it is takes a button away')
  const settings = applyPatch(cleanSettings({ mouse: start }), { mouse: { on: false } })
  assert.equal(settings.mouse.on, false)
  assert.equal(settings.mouse.speed, 2, 'the rest of Mouse is kept when it is switched off')
  assert.equal(applyPatch(cleanSettings(undefined), { view: 'full' }).mouse.on, false, 'a patch about something else leaves Mouse alone')
})

test('the helper is wanted only when Mouse is on and has something to change', () => {
  assert.equal(wantsHelper(cleanMouse()), false)
  assert.equal(wantsHelper(mergeMouse(undefined, { reverse: { mouse: { vertical: true } } })), false, 'set but switched off')
  assert.equal(wantsHelper(mergeMouse(undefined, { on: true })), false, 'on with nothing to change')
  assert.equal(wantsHelper(reversed()), true)
  assert.equal(wantsHelper(mergeMouse(undefined, { on: true, speed: 1.5 })), true)
  assert.equal(wantsHelper(mergeMouse(undefined, { on: true, buttons: { 4: 'nothing' } })), true)
  assert.equal(wantsHelper(mergeMouse(undefined, { on: true, reverse: { trackpad: { horizontal: true } } })), true)
})

test('the helper is told the settings as one JSON line, and its words are three', () => {
  const line = configLine(reversed({ speed: 1.5, buttons: { 3: 'back' } }))
  assert.ok(line.endsWith('\n') && line.indexOf('\n') === line.length - 1, 'exactly one line')
  assert.deepEqual(JSON.parse(line), { reverse: { mouse: { vertical: true, horizontal: true }, trackpad: { vertical: false, horizontal: false } }, speed: 1.5, buttons: { 3: 'back' } })
  assert.equal(JSON.parse(configLine({ on: true, speed: 'x', evil: 1 })).evil, undefined, 'only what is known goes')
  assert.deepEqual(['ready', ' denied \r', 'stopped'].map(readHelperLine), [{ kind: 'ready' }, { kind: 'denied' }, { kind: 'stopped' }])
  for (const word of ['', null, 'ready now', 'Ready', 'click 2 0', 'scrolled -3']) assert.equal(readHelperLine(word), null, String(word))
})

test('a side button does what it was told, and the middle one is never taken', () => {
  const rules = mergeMouse(undefined, { on: true, buttons: { 3: 'back', 4: 'nothing', 2: 'back', 0: 'nothing' } })
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((button) => buttonAction(rules, button)), ['default', 'default', 'default', 'back', 'nothing', 'default'])
  assert.deepEqual(BUTTON_KEYS, { back: { code: 33, command: true }, forward: { code: 30, command: true } }, '⌘[ and ⌘]')
})

/* ---- the helper, as a process the tests control ---- */

function fakeSpawn() {
  const made = []
  const spawn = (command, args, options) => {
    const child = new EventEmitter()
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
    child.stderr = new EventEmitter()
    child.stdin = Object.assign(new EventEmitter(), { written: [], ended: false, write(text) { this.written.push(text) }, end() { this.ended = true } })
    child.kill = () => { child.killed = true }
    child.command = command
    child.args = args
    child.options = options
    made.push(child)
    return child
  }
  return { spawn, made }
}

function setup({ start = {}, trusted = true, exists = true } = {}) {
  const { spawn, made } = fakeSpawn()
  const state = { mouse: mergeMouse(undefined, start), trusted, exists }
  const logged = []
  const mouse = createMouse({ spawn, platform: 'darwin', model, helper: '/app/helpers/osat-mouse', mouse: () => state.mouse, trusted: () => state.trusted, exists: () => state.exists, log: (text) => logged.push(text), retryMs: 5 })
  return { mouse, made, state, logged }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('nothing starts until Mouse is on, has something to change, and OSAT is allowed in Accessibility', () => {
  const t = setup()
  assert.equal(t.mouse.state(), 'off')
  t.mouse.sync()
  assert.equal(t.made.length, 0, 'off: no process')
  t.state.mouse = mergeMouse(t.state.mouse, { on: true })
  t.mouse.sync()
  assert.equal(t.made.length, 0, 'on with nothing to change: no process')
  t.state.trusted = false
  t.state.mouse = mergeMouse(t.state.mouse, { reverse: { mouse: { vertical: true, horizontal: true } } })
  t.mouse.sync()
  assert.equal(t.made.length, 0, 'not allowed yet: no process')
  assert.equal(t.mouse.state(), 'access')
  t.state.trusted = true
  t.mouse.sync()
  assert.equal(t.made.length, 1, 'allowed: it starts')
  assert.equal(t.made[0].command, '/app/helpers/osat-mouse')
  assert.deepEqual(t.made[0].args, [])
  assert.equal(t.mouse.state(), 'starting')
  t.made[0].stdout.emit('data', 'ready\n')
  assert.equal(t.mouse.state(), 'listening')
})

test('the helper is told the settings at the start and again whenever they change, and not when they don’t', () => {
  const t = setup({ start: { on: true, reverse: { mouse: { vertical: true, horizontal: true } } } })
  t.mouse.sync()
  assert.equal(t.made[0].stdin.written.length, 1)
  assert.equal(JSON.parse(t.made[0].stdin.written[0]).reverse.mouse.vertical, true)
  t.mouse.sync()
  assert.equal(t.made[0].stdin.written.length, 1, 'same settings: nothing new is sent')
  t.state.mouse = mergeMouse(t.state.mouse, { speed: 2 })
  t.mouse.sync()
  assert.equal(t.made.length, 1, 'no new process for a new setting')
  assert.equal(JSON.parse(t.made[0].stdin.written[1]).speed, 2)
})

test('switching it off, losing Accessibility and quitting all stop the helper', () => {
  const t = setup({ start: { on: true, reverse: { mouse: { vertical: true } } } })
  t.mouse.sync()
  t.made[0].stdout.emit('data', 'ready\n')
  t.state.mouse = mergeMouse(t.state.mouse, { on: false })
  t.mouse.sync()
  assert.equal(t.made[0].killed, true)
  assert.equal(t.made[0].stdin.ended, true, 'its input is closed too, which also ends it')
  assert.equal(t.mouse.state(), 'off')
  t.state.mouse = mergeMouse(t.state.mouse, { on: true })
  t.mouse.sync()
  assert.equal(t.made.length, 2)
  t.made[1].stdout.emit('data', 'ready\n')
  t.state.trusted = false
  t.mouse.sync()
  assert.equal(t.made[1].killed, true)
  assert.equal(t.mouse.state(), 'access')
  t.state.trusted = true
  t.mouse.sync()
  assert.equal(t.made.length, 3, 'allowed again: it comes back')
  t.mouse.stop()
  assert.equal(t.made[2].killed, true, 'OSAT quitting stops it')
  assert.equal(t.mouse.state(), 'off')
  t.mouse.sync()
  assert.equal(t.made.length, 4, 'and a later sync, with it wanted, starts one again')
})

test('denied is said calmly and not tried again until Mouse is turned off and on', () => {
  const t = setup({ start: { on: true, reverse: { mouse: { vertical: true } } } })
  t.mouse.sync()
  t.made[0].stdout.emit('data', 'denied\n')
  t.made[0].emit('exit', 0, null)
  assert.equal(t.mouse.state(), 'denied')
  t.mouse.sync()
  t.mouse.sync()
  assert.equal(t.made.length, 1, 'no loop of starts')
  t.state.mouse = mergeMouse(t.state.mouse, { on: false })
  t.mouse.sync()
  t.state.mouse = mergeMouse(t.state.mouse, { on: true })
  t.mouse.sync()
  assert.equal(t.made.length, 2, 'off and on is the way to try again')
})

test('a build with no helper says so, and a helper that dies is started again a few times, then left', async () => {
  const none = setup({ start: { on: true, reverse: { mouse: { vertical: true } } }, exists: false })
  none.mouse.sync()
  assert.equal(none.mouse.state(), 'missing')
  assert.equal(none.made.length, 0)

  const t = setup({ start: { on: true, reverse: { mouse: { vertical: true } } } })
  t.mouse.sync()
  t.made[0].stdout.emit('data', 'ready\n')
  t.made[0].emit('exit', 1, null)
  assert.equal(t.mouse.state(), 'starting')
  await wait(30)
  assert.equal(t.made.length, 2, 'once it had worked, it is started again')
  t.made[1].emit('exit', 1, null)
  assert.equal(t.mouse.state(), 'failed', 'one that never said ready is not started again')
  t.mouse.sync()
  assert.equal(t.made.length, 2)

  const broken = setup({ start: { on: true, reverse: { mouse: { vertical: true } } } })
  broken.mouse.sync()
  broken.made[0].emit('error', new Error('spawn EACCES'))
  assert.equal(broken.mouse.state(), 'failed')
  assert.deepEqual(broken.logged, ['spawn EACCES'])
})

test('off the Mac, or with nothing to start it with, it is unavailable and nothing runs', () => {
  const { spawn, made } = fakeSpawn()
  const linux = createMouse({ spawn, platform: 'linux', model, helper: 'x', mouse: () => reversed(), trusted: () => true, exists: () => true })
  linux.sync()
  assert.equal(linux.state(), 'unavailable')
  const none = createMouse({ platform: 'darwin', model, helper: 'x', mouse: () => reversed(), trusted: () => true, exists: () => true })
  none.sync()
  assert.equal(none.state(), 'unavailable')
  assert.equal(made.length, 0)
})

test('the helper is found in the app’s resources, or in build/helpers from source', () => {
  assert.equal(helperPath({ packaged: true, resources: '/Applications/OSAT.app/Contents/Resources' }), '/Applications/OSAT.app/Contents/Resources/helpers/osat-mouse')
  assert.equal(helperPath({ packaged: false, root: '/repo' }), '/repo/build/helpers/osat-mouse')
})

/* ---- what the helper's source may and may not do (it is never run in tests) ---- */

const source = await readFile(path.join(root, 'desktop', 'helpers', 'osat-mouse.swift'), 'utf8')
const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')

test('the helper says only ready, denied and stopped, and records nothing', () => {
  const said = [...code.matchAll(/\bsay\(\s*"([^"]*)"\s*\)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(said)].sort(), ['denied', 'ready', 'stopped'])
  assert.ok(said.every((word) => readHelperLine(word)), 'every word it says is one the model reads')
  assert.match(code, /func say\(_ word: String\)/, 'one way to speak')
  for (const forbidden of [/\bprint\(/, /\bNSLog\b/, /os_log|\bLogger\b/, /standardError/, /URLSession|URLRequest|CFSocket|NWConnection|Network\b/, /FileManager|fopen|write\(to|FileHandle\(forWriting|UserDefaults|NSKeyedArchiver/, /Process\(\)|posix_spawn|system\(/, /fputs|fwrite|dump\(/]) {
    assert.doesNotMatch(code, forbidden, String(forbidden))
  }
  assert.equal([...code.matchAll(/FileHandle\.standardOutput\.write/g)].length, 1, 'standard output is written in one place')
})

test('the helper switches its tap back on, leaves when OSAT does, and touches only scroll and side buttons', () => {
  assert.match(code, /\.tapDisabledByTimeout, \.tapDisabledByUserInput/, 'it re-enables the tap when macOS turns it off')
  assert.match(code, /tapIsEnabled/, 'and checks on a timer')
  assert.match(code, /getppid\(\) != owner/, 'it leaves when its parent does')
  assert.match(code, /chunk\.isEmpty[\s\S]{0,80}finish\(\)/, 'and when its input closes')
  assert.match(code, /signal\(SIGTERM, SIG_IGN\)/, 'SIGTERM is handled, not fatal')
  assert.match(code, /say\("denied"\)/, 'no permission is said, not worked around')
  assert.match(code, /button >= 3/, 'left, right and middle are never remapped')
  // The same rules as the model: a phase means a trackpad, whole lines carry a residual, the three deltas change together.
  assert.match(code, /phase != 0 \|\| momentum != 0/)
  for (const field of ['DeltaAxis1', 'FixedPtDeltaAxis1', 'PointDeltaAxis1', 'DeltaAxis2', 'FixedPtDeltaAxis2', 'PointDeltaAxis2']) assert.match(code, new RegExp(`scrollWheelEvent${field}`), field)
  assert.match(code, /press\(code: 33\)[\s\S]*press\(code: 30\)/, 'back is ⌘[ (33) and forward is ⌘] (30)')
  for (const [name, key] of Object.entries(BUTTON_KEYS)) assert.match(code, new RegExp(`action == "${name}" \\{ press\\(code: ${key.code}\\)`), name)
})
