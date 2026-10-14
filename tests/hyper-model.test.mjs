import assert from 'node:assert/strict'
import test from 'node:test'

import { CAPS_LOCK, ESCAPE_CODE, F20, HYPER_FLAGS, TAP_MS, TRIGGER_CODE, describe, hasOurs, initial, readHelperLine, readMappings, setArgument, step, withHyper, withOurs, withoutOurs } from '../shared/hyper-model.mjs'

const key = (type, code, at = 0) => ({ type, code, at })
const V = 9
const SHIFT = 1 << 17
const CONTROL = 1 << 18
const OPTION = 1 << 19
const COMMAND = 1 << 20

/* Runs events through `step`; → what each did and the state at the end. */
function run(events, options) {
  let state = initial()
  const out = []
  for (const event of events) {
    const result = step(state, event, options)
    state = result.state
    out.push({ swallow: result.swallow, flags: result.flags, esc: result.esc })
  }
  return { out, state }
}

test('the four flags are the four modifier bits', () => {
  assert.equal(HYPER_FLAGS, SHIFT | CONTROL | OPTION | COMMAND)
  assert.equal(withHyper(0), HYPER_FLAGS)
  assert.equal(withHyper(1 << 16), HYPER_FLAGS | (1 << 16), 'whatever else was on the event stays')
  assert.equal(TRIGGER_CODE, 90)
  assert.equal(ESCAPE_CODE, 53)
})

test('a key pressed while the trigger is held carries the four flags, and the trigger itself is swallowed', () => {
  const { out, state } = run([key('keyDown', TRIGGER_CODE), key('keyDown', V), key('keyUp', V), key('keyUp', TRIGGER_CODE)])
  assert.deepEqual(out.map((entry) => [entry.swallow, entry.flags]), [[true, false], [false, true], [false, true], [true, false]])
  assert.deepEqual(state, initial(), 'the trigger let go: nothing is held')
})

test('keys and buttons outside a hold are left exactly alone', () => {
  const { out } = run([key('keyDown', V), key('keyUp', V), { type: 'mouse' }, { type: 'flagsChanged', code: 58 }])
  assert.deepEqual(out, Array(4).fill({ swallow: false, flags: false, esc: false }))
})

test('a click while held is a Hyper click, and a modifier going down or up passes through as it was', () => {
  const { out } = run([key('keyDown', TRIGGER_CODE), { type: 'mouse' }, { type: 'flagsChanged', code: 58 }, { type: 'mouse' }])
  assert.deepEqual(out.map((entry) => entry.flags), [false, true, false, true])
  assert.equal(out[2].swallow, false)
})

test('the repeats of a held trigger are swallowed and change nothing', () => {
  const events = [key('keyDown', TRIGGER_CODE, 0), key('keyDown', V, 10)]
  for (let i = 1; i <= 20; i += 1) events.push(key('keyDown', TRIGGER_CODE, 10 + i * 30))
  events.push(key('keyDown', V, 900), key('keyUp', TRIGGER_CODE, 950))
  const { out, state } = run(events)
  assert.equal(out.filter((entry) => entry.swallow).length, 22, 'the first down, 20 repeats and the up')
  assert.equal(out.filter((entry) => entry.flags).length, 2, 'both keys got the flags')
  assert.deepEqual(state, initial())
})

test('a repeat does not restart a tap’s clock', () => {
  const { out } = run([key('keyDown', TRIGGER_CODE, 0), key('keyDown', TRIGGER_CODE, 400), key('keyUp', TRIGGER_CODE, 700)], { tapEscape: true })
  assert.equal(out[2].esc, false, 'held since 0, so 700 ms is not quick')
})

test('a tap of the trigger alone does nothing by default, and sends Esc when asked', () => {
  const tap = [key('keyDown', TRIGGER_CODE, 100), key('keyUp', TRIGGER_CODE, 180)]
  assert.deepEqual(run(tap).out.map((entry) => entry.esc), [false, false])
  assert.deepEqual(run(tap, { tapEscape: true }).out.map((entry) => entry.esc), [false, true])
  assert.equal(run(tap, { tapEscape: true }).out[1].swallow, true, 'the Esc is new; the trigger’s own up is still swallowed')
})

test('it is not a tap when it was slow, or when anything was pressed in between', () => {
  const options = { tapEscape: true }
  assert.equal(run([key('keyDown', TRIGGER_CODE, 0), key('keyUp', TRIGGER_CODE, TAP_MS)], options).out[1].esc, true, 'exactly the limit still counts')
  assert.equal(run([key('keyDown', TRIGGER_CODE, 0), key('keyUp', TRIGGER_CODE, TAP_MS + 1)], options).out[1].esc, false)
  assert.equal(run([key('keyDown', TRIGGER_CODE, 0), key('keyDown', V, 20), key('keyUp', V, 40), key('keyUp', TRIGGER_CODE, 60)], options).out[3].esc, false, 'Hyper V is not a tap')
  assert.equal(run([key('keyDown', TRIGGER_CODE, 0), { type: 'mouse' }, key('keyUp', TRIGGER_CODE, 60)], options).out[2].esc, false, 'Hyper + click is not a tap')
  assert.equal(run([key('keyDown', TRIGGER_CODE, 0), key('keyUp', V, 20), key('keyUp', TRIGGER_CODE, 60)], options).out[2].esc, true, 'a key coming up that went down earlier does not make it a use')
})

test('an up with no down is swallowed and is never an Esc', () => {
  const { out } = run([key('keyUp', TRIGGER_CODE, 5)], { tapEscape: true })
  assert.deepEqual(out, [{ swallow: true, flags: false, esc: false }])
})

test('letting go of keys in either order never leaves anything held', () => {
  // The trigger first, the letter after: the letter’s up goes out plain, and nothing is held.
  const first = run([key('keyDown', TRIGGER_CODE), key('keyDown', V), key('keyUp', TRIGGER_CODE), key('keyUp', V)])
  assert.deepEqual(first.out.map((entry) => entry.flags), [false, true, false, false])
  assert.deepEqual(first.state, initial())
  // The letter first.
  const second = run([key('keyDown', TRIGGER_CODE), key('keyDown', V), key('keyUp', V), key('keyUp', TRIGGER_CODE), key('keyDown', V)])
  assert.deepEqual(second.out.map((entry) => entry.flags), [false, true, true, false, false])
  // A letter held down before the trigger, let go during it, and pressed again after.
  const third = run([key('keyDown', V), key('keyDown', TRIGGER_CODE), key('keyUp', V), key('keyUp', TRIGGER_CODE), key('keyDown', V)])
  assert.deepEqual(third.out.map((entry) => entry.flags), [false, false, true, false, false])
  assert.deepEqual(third.state, initial())
})

test('two quick holds in a row each start fresh', () => {
  const { out } = run([key('keyDown', TRIGGER_CODE, 0), key('keyDown', V, 10), key('keyUp', TRIGGER_CODE, 20), key('keyDown', TRIGGER_CODE, 30), key('keyUp', TRIGGER_CODE, 60)], { tapEscape: true })
  assert.deepEqual(out.map((entry) => entry.esc), [false, false, false, false, true], 'the second hold was a tap; the first one’s use is forgotten')
})

test('the Mac switching the tap off clears the hold, and the next trigger starts it again', () => {
  const { out, state } = run([key('keyDown', TRIGGER_CODE), { type: 'reset' }, key('keyDown', V), key('keyDown', TRIGGER_CODE, 900), key('keyDown', V, 910)])
  assert.deepEqual(out.map((entry) => entry.flags), [false, false, false, false, true])
  assert.equal(state.held, true, 'the trigger’s repeat while still pressed holds again')
  assert.deepEqual(run([key('keyDown', TRIGGER_CODE), { type: 'reset' }]).state, initial())
  // Sleep, wake, a locked screen: the same event.
  assert.equal(step({ held: true, used: true, at: 5 }, { type: 'reset' }).flags, false)
})

test('a reset after a hold ends it without an Esc', () => {
  const { out } = run([key('keyDown', TRIGGER_CODE, 0), { type: 'reset' }, key('keyUp', TRIGGER_CODE, 10)], { tapEscape: true })
  assert.equal(out[2].esc, false)
  assert.equal(out[2].swallow, true)
})

test('events it does not know are left alone', () => {
  for (const event of [null, undefined, 'x', {}, { type: 'scroll' }, { type: 'keyDown' }]) {
    const { state, swallow, flags, esc } = step(initial(), event)
    assert.deepEqual([state, swallow, flags, esc], [initial(), false, false, false])
  }
})

test('the helper says three words and nothing else counts', () => {
  assert.deepEqual(readHelperLine('ready'), { kind: 'ready' })
  assert.deepEqual(readHelperLine('denied\n'), { kind: 'denied' })
  assert.deepEqual(readHelperLine(' stopped '), { kind: 'stopped' })
  for (const line of ['', 'hit 1', 'down', 'ready now', 'READY', null, undefined, 'v']) assert.equal(readHelperLine(line), null, String(line))
})

/* hidutil, as this Mac prints it: every keyboard, each `(null)` or its list. */
const NONE = '100000d7e   UserKeyMapping   (null)\n100000d56   UserKeyMapping   (null)\n'
const RAYCAST = `${NONE}1000105b6   UserKeyMapping   (
        {
        HIDKeyboardModifierMappingDst = 30064771183;
        HIDKeyboardModifierMappingSrc = 30064771129;
    }
)
1000105b1   UserKeyMapping   (
        {
        HIDKeyboardModifierMappingDst = 30064771183;
        HIDKeyboardModifierMappingSrc = 30064771129;
    }
)
`
const FOREIGN = { src: 0x700000064, dst: 0x700000035 }

test('the numbers are Caps Lock and F20 on the keyboard page', () => {
  assert.equal(CAPS_LOCK, 30064771129)
  assert.equal(F20, 30064771183)
})

test('hidutil’s listing is read: nothing, ours once, and other mappings kept', () => {
  assert.deepEqual(readMappings(NONE), { ok: true, list: [] })
  const raycast = readMappings(RAYCAST)
  assert.deepEqual(raycast, { ok: true, list: [{ src: CAPS_LOCK, dst: F20 }] }, 'the same mapping on two keyboards is one')
  assert.equal(hasOurs(raycast.list), true)
  const mixed = readMappings(`${NONE}1  UserKeyMapping   (\n {\n  HIDKeyboardModifierMappingDst = 0x700000035;\n  HIDKeyboardModifierMappingSrc = 0x700000064;\n },\n {\n  HIDKeyboardModifierMappingDst = ${F20};\n  HIDKeyboardModifierMappingSrc = ${CAPS_LOCK};\n }\n)\n`)
  assert.deepEqual(mixed.list, [FOREIGN, { src: CAPS_LOCK, dst: F20 }], 'hex and decimal both read')
})

test('text that is not hidutil’s listing is not understood, so nothing gets changed', () => {
  for (const output of ['', undefined, null, 'hidutil: error', 'Segmentation fault', '{ "a": 1 }', '(null)', 'UserKeyMapping', 'UserKeyMapping ( { HIDKeyboardModifierMappingSrc = 5; } )', 'UserKeyMapping ( { HIDKeyboardModifierMappingSrc = x; HIDKeyboardModifierMappingDst = 1; } )']) {
    assert.deepEqual(readMappings(output), { ok: false }, String(output))
  }
})

test('ours is added once after what was there, and taken out alone', () => {
  assert.deepEqual(withOurs([]), [{ src: CAPS_LOCK, dst: F20 }])
  assert.deepEqual(withOurs([FOREIGN]), [FOREIGN, { src: CAPS_LOCK, dst: F20 }])
  const already = [FOREIGN, { src: CAPS_LOCK, dst: F20 }]
  assert.deepEqual(withOurs(already), already, 'never twice')
  assert.deepEqual(withoutOurs(already), [FOREIGN])
  assert.deepEqual(withoutOurs([FOREIGN]), [FOREIGN])
  assert.deepEqual(withoutOurs([{ src: CAPS_LOCK, dst: 0x700000029 }]), [{ src: CAPS_LOCK, dst: 0x700000029 }], 'Caps Lock to something else is not ours')
})

test('hidutil is given decimal numbers', () => {
  assert.equal(setArgument([{ src: CAPS_LOCK, dst: F20 }]), '{"UserKeyMapping":[{"HIDKeyboardModifierMappingSrc":30064771129,"HIDKeyboardModifierMappingDst":30064771183}]}')
  assert.equal(setArgument([]), '{"UserKeyMapping":[]}')
})

test('Settings says what is going on in plain words', () => {
  assert.match(describe('working'), /^Working/)
  assert.match(describe('access'), /Needs Accessibility/)
  assert.match(describe('denied'), /Input Monitoring/)
  assert.match(describe('failed'), /off and on/)
  assert.match(describe('unavailable'), /Not on this Mac/)
  assert.equal(describe('off'), '')
  for (const state of ['working', 'starting', 'access', 'denied', 'failed', 'unavailable']) assert.doesNotMatch(describe(state), /Hyperkey|Karabiner|install/i, state)
})
