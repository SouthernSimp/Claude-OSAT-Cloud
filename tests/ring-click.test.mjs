import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

import * as model from '../shared/ring-click.mjs'

const { isHyperClick, readHelperLine } = model
const require = createRequire(import.meta.url)
const { createMiddleClick, script } = require('../desktop/launcher/middle-click.cjs')

// NSEvent's modifier bits: ⇧ 17, ⌃ 18, ⌥ 19, ⌘ 20 (plus Caps Lock 16, fn 23 and a device bit or two).
const SHIFT = 1 << 17
const CONTROL = 1 << 18
const OPTION = 1 << 19
const COMMAND = 1 << 20
const FOUR = SHIFT | CONTROL | OPTION | COMMAND
const THREE = CONTROL | OPTION | COMMAND

test('Hyper + the middle button is a Hyper click; nothing less is', () => {
  assert.equal(isHyperClick({ button: 2, flags: FOUR }), true)
  assert.equal(isHyperClick({ button: 2, flags: FOUR | 256 | (1 << 16) | (1 << 23) }), true, 'Caps Lock, fn and the Mac’s own bits don’t matter')
  for (const missing of [SHIFT, CONTROL, OPTION, COMMAND]) assert.equal(isHyperClick({ button: 2, flags: FOUR & ~missing }), false)
  assert.equal(isHyperClick({ button: 2, flags: 0 }), false, 'a plain middle click is just a middle click')
  assert.equal(isHyperClick({ button: 2, flags: COMMAND }), false, '⌘ + middle is the desk’s own ring')
  for (const button of [0, 1, 3, 4]) assert.equal(isHyperClick({ button, flags: FOUR }), false, `button ${button}`)
  assert.equal(isHyperClick({ button: 2, flags: 'many' }), false)
  assert.equal(isHyperClick({ button: 2, flags: -1 }), false)
  assert.equal(isHyperClick(), false)
})

test('a Hyper key that leaves ⇧ out is ⌃⌥⌘ and no ⇧, as it is for the key', () => {
  assert.equal(isHyperClick({ button: 2, flags: THREE }, 'three'), true)
  assert.equal(isHyperClick({ button: 2, flags: FOUR }, 'three'), false)
  assert.equal(isHyperClick({ button: 2, flags: THREE }, 'four'), false)
  assert.equal(isHyperClick({ button: 2, flags: THREE | 256 }, 'three'), true)
})

test('a line from the helper is ready, a click, or nothing', () => {
  assert.deepEqual(readHelperLine('ready'), { kind: 'ready' })
  assert.deepEqual(readHelperLine(' click 2 1966080 \r'), { kind: 'click', button: 2, flags: 1966080 })
  assert.deepEqual(readHelperLine('click 3 0'), { kind: 'click', button: 3, flags: 0 })
  for (const line of ['', null, undefined, 'ready now', 'click', 'click 2', 'click two 4', 'click 2 x', 'click 2 -5', 'click 2 1.5', 'click 2 4 5', 'clack 2 4', 'ReaDY']) assert.equal(readHelperLine(line), null, String(line))
})

test('the helper’s script is real JavaScript, listens for the other mouse buttons only, and leaves with OSAT', () => {
  const text = script(4242)
  assert.doesNotThrow(() => new vm.Script(text))
  assert.match(text, /addGlobalMonitorForEventsMatchingMaskHandler\(33554432,/, '33554432 is NSEventMaskOtherMouseDown')
  assert.match(text, /\$\.getppid\(\) !== 4242/, 'it goes when its parent does')
  assert.doesNotMatch(text, /KeyDown|KeyUp|FlagsChanged|characters|CGEventTap/, 'no keys, no text')
  assert.match(script('not a number'), /!== 0\)/, 'a pid is only ever a number')
})

/* A process that does what the helper does, by hand. */
function fakeSpawn() {
  const made = []
  const spawn = (command, args, options) => {
    const child = new EventEmitter()
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
    child.stderr = new EventEmitter()
    child.kill = () => { child.killed = true }
    child.command = command
    child.args = args
    child.options = options
    made.push(child)
    return child
  }
  return { spawn, made }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function setup(options = {}) {
  const { spawn, made } = fakeSpawn()
  const clicks = []
  const logged = []
  const middle = createMiddleClick({ spawn, platform: 'darwin', model, onClick: () => clicks.push('click'), log: (text) => logged.push(text), retryMs: 5, ...options })
  return { middle, made, clicks, logged }
}

test('it starts only when asked, says ready, and a Hyper click (and only that) opens the ring', () => {
  const t = setup()
  assert.equal(t.middle.state(), 'off')
  t.middle.sync(false)
  assert.equal(t.made.length, 0, 'nothing runs until it is wanted')
  t.middle.sync(true)
  assert.equal(t.made.length, 1)
  assert.equal(t.made[0].command, 'osascript')
  assert.deepEqual(t.made[0].args.slice(0, 3), ['-l', 'JavaScript', '-e'])
  assert.equal(t.middle.state(), 'starting')
  t.made[0].stdout.emit('data', 'ready\n')
  assert.equal(t.middle.state(), 'listening')
  // Lines can arrive in pieces, or several at once.
  t.made[0].stdout.emit('data', `click 2 ${FOUR}`)
  assert.equal(t.clicks.length, 0, 'half a line waits for the rest')
  t.made[0].stdout.emit('data', `\nclick 2 0\nclick 3 ${FOUR}\nclick 2 ${COMMAND}\nclick 2 ${FOUR}\n`)
  assert.equal(t.clicks.length, 2, 'the two Hyper + middle clicks, not a plain one, a thumb button or ⌘')
  t.middle.sync(true)
  assert.equal(t.made.length, 1, 'asking again doesn’t start another')
})

test('it follows what the Hyper key sends, as it is now', () => {
  let sends = 'four'
  const t = setup({ sends: () => sends })
  t.middle.sync(true)
  t.made[0].stdout.emit('data', `ready\nclick 2 ${THREE}\n`)
  assert.equal(t.clicks.length, 0)
  sends = 'three'
  t.made[0].stdout.emit('data', `click 2 ${THREE}\nclick 2 ${FOUR}\n`)
  assert.equal(t.clicks.length, 1, 'no restart is needed')
})

test('turning it off stops the helper, and turning it on again starts a new one', () => {
  const t = setup()
  t.middle.sync(true)
  t.made[0].stdout.emit('data', 'ready\n')
  t.middle.sync(false)
  assert.equal(t.made[0].killed, true)
  assert.equal(t.middle.state(), 'off')
  t.made[0].emit('exit', null, 'SIGTERM')
  assert.equal(t.middle.state(), 'off', 'stopping it on purpose is not a failure')
  t.made[0].stdout.emit('data', `click 2 ${FOUR}\n`)
  t.middle.sync(true)
  assert.equal(t.made.length, 2)
  t.middle.stop()
  assert.equal(t.made[1].killed, true)
})

test('a helper that can’t start says so and leaves everything else alone', async () => {
  // It stops before it ever listened (no screen, no permission to run scripts…).
  const quick = setup()
  quick.middle.sync(true)
  quick.made[0].stderr.emit('data', 'execution error: nope\nsecond line')
  quick.made[0].emit('exit', 1, null)
  assert.equal(quick.middle.state(), 'failed')
  assert.deepEqual(quick.logged, ['execution error: nope'])
  await wait(25)
  assert.equal(quick.made.length, 1, 'it isn’t tried again and again')
  quick.middle.sync(true)
  assert.equal(quick.made.length, 1, 'a later save doesn’t start it again')
  quick.middle.sync(false)
  quick.middle.sync(true)
  assert.equal(quick.made.length, 2, 'off and on is the way to try again')
  // The command isn't there, or starting it throws.
  const missing = setup()
  missing.middle.sync(true)
  missing.made[0].emit('error', new Error('spawn osascript ENOENT'))
  assert.equal(missing.middle.state(), 'failed')
  const thrown = setup({ spawn: () => { throw new Error('no way') } })
  thrown.middle.sync(true)
  assert.equal(thrown.middle.state(), 'failed')
  assert.deepEqual(thrown.logged, ['no way'])
})

test('a helper that was listening and dies is started again, a few times, then given up on', async () => {
  const t = setup()
  t.middle.sync(true)
  for (let round = 0; round < 3; round += 1) {
    t.made.at(-1).stdout.emit('data', 'ready\n')
    t.made.at(-1).emit('exit', 1, null)
    assert.equal(t.middle.state(), 'starting')
    await wait(25)
    assert.equal(t.made.length, round + 2, 'started again')
  }
  t.made.at(-1).stdout.emit('data', 'ready\n')
  t.made.at(-1).emit('exit', 1, null)
  assert.equal(t.middle.state(), 'failed', 'after the third time it stops trying')
  await wait(25)
  assert.equal(t.made.length, 4)
})

test('off the Mac, or with nothing to start it with, it does nothing and says so', () => {
  const { spawn, made } = fakeSpawn()
  const linux = createMiddleClick({ spawn, platform: 'linux', model, onClick: () => {} })
  linux.sync(true)
  assert.equal(linux.state(), 'unavailable')
  const bare = createMiddleClick({ platform: 'darwin', model, onClick: () => {} })
  bare.sync(true)
  assert.equal(bare.state(), 'unavailable')
  bare.stop()
  assert.equal(bare.state(), 'unavailable')
  assert.equal(made.length, 0)
})
