/* The Hyper key, built in (Phase 63). Hyper is ⌃⌥⇧⌘ held together. OSAT turns Caps Lock into F20 (the Mac's own
   `hidutil`, below) and a small helper (desktop/helpers/osat-hyper.swift) holds those four keys down for every other
   key and click while F20 is held. These are the rules both share, written out here so they are tested; the helper
   can't import this file, so its Swift is the same rules, line for line. Pure.

   THE STATE MACHINE (`step`). State: { held, used, at } and events: keyDown, keyUp, flagsChanged and mouse (a button
   going down or up) with the key code and the time, or `reset`.
   1. The trigger (F20, key code 90) is always swallowed, down and up, so no app ever sees it.
      Down: held (the first one remembers when and that nothing was pressed yet; the repeats of a held key change nothing).
      Up: not held. If it was held, nothing was pressed in between and it was quick (TAP_MS), and "a tap is Esc" is on,
      the answer says `esc`.
   2. While held, every other key down or up and every button down or up carries the four flags (⌃⌥⇧⌘) added to
      whatever it had; a key down or button down marks the hold as used (so it isn't a tap).
   3. flagsChanged (a modifier going down or up) passes through exactly as it was: adding the four would make a
      released ⌥ look held.
   4. `reset` (the tap switched off by the Mac, sleep, wake, a locked screen, the keyboard going away) clears
      everything. Fail safe: no state survives anything odd, and a trigger that is really still down simply starts
      the hold again at its next repeat.
   If the helper ends, nothing is left behind in the Mac: the flags only ever existed on events passing through it. */

export const TRIGGER_CODE = 90 // kVK_F20
export const ESCAPE_CODE = 53
export const TAP_MS = 500
// CGEventFlags / NSEvent's modifier bits: ⇧ 17, ⌃ 18, ⌥ 19, ⌘ 20.
export const HYPER_FLAGS = (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20)

export const initial = () => ({ held: false, used: false, at: 0 })

/* → { state, swallow, flags, esc }: whether the event is dropped, whether the four flags are added, and whether a tap
   should send Esc. */
export function step(state, event, { tapEscape = false } = {}) {
  const none = { state, swallow: false, flags: false, esc: false }
  if (!event || typeof event !== 'object') return none
  if (event.type === 'reset') return { ...none, state: initial() }
  if (event.type === 'keyDown' || event.type === 'keyUp') {
    if (event.code === TRIGGER_CODE) {
      if (event.type === 'keyDown') return { ...none, swallow: true, state: state.held ? state : { held: true, used: false, at: Number(event.at) || 0 } }
      const tap = state.held && !state.used && (Number(event.at) || 0) - state.at <= TAP_MS
      return { ...none, swallow: true, state: initial(), esc: tapEscape && tap }
    }
    if (!state.held) return none
    return { ...none, flags: true, state: event.type === 'keyDown' ? { ...state, used: true } : state }
  }
  if (event.type === 'mouse') return state.held ? { ...none, flags: true, state: { ...state, used: true } } : none
  return none
}

/* The flags an event leaves with. */
export const withHyper = (flags) => (Number(flags) | HYPER_FLAGS) >>> 0

/* One line from the helper: `ready` (it listens), `denied` (macOS has not allowed it) or `stopped` (it is leaving).
   → { kind } | null. It says nothing else, and never what was typed. */
export function readHelperLine(line) {
  const word = String(line || '').trim()
  return word === 'ready' || word === 'denied' || word === 'stopped' ? { kind: word } : null
}

/* ---- Caps Lock → F20, with the Mac's `hidutil` ---------------------------------------------------------------------
   `hidutil property --set '{"UserKeyMapping":[…]}'` replaces the key mappings, so ours is added to what is there and
   taken out again alone. Numbers are HID usages: page 7, usage 0x39 (Caps Lock) and 0x6F (F20). */
export const CAPS_LOCK = 0x700000039 // 30064771129
export const F20 = 0x70000006F // 30064771183
export const OURS = { src: CAPS_LOCK, dst: F20 }
const same = (a, b) => a.src === b.src && a.dst === b.dst

/* `hidutil property --get UserKeyMapping` lists every keyboard, each as `(null)` or a list of { Dst = n; Src = n; }.
   The mappings of all of them, once each, in the order seen. → { ok: true, list } | { ok: false }; text that is not
   that (nothing, a different shape, a block missing its numbers) is `ok: false`, and nothing is then changed. */
export function readMappings(output) {
  const text = String(output ?? '')
  if (!text.includes('UserKeyMapping')) return { ok: false }
  const list = []
  for (const [, body] of text.matchAll(/\{([^{}]*)\}/g)) {
    const src = /HIDKeyboardModifierMappingSrc\s*=\s*(0x[0-9a-f]+|\d+)\s*;/i.exec(body)
    const dst = /HIDKeyboardModifierMappingDst\s*=\s*(0x[0-9a-f]+|\d+)\s*;/i.exec(body)
    if (!src || !dst) return { ok: false }
    const entry = { src: Number(src[1]), dst: Number(dst[1]) }
    if (!Number.isSafeInteger(entry.src) || !Number.isSafeInteger(entry.dst)) return { ok: false }
    if (!list.some((other) => same(other, entry))) list.push(entry)
  }
  // Something that says UserKeyMapping, holds no braces and isn't every keyboard `(null)` is not understood.
  if (!list.length && !/\(null\)/.test(text) && !/UserKeyMapping\s*(\(\s*\)|=\s*\(\s*\))/.test(text)) return { ok: false }
  return { ok: true, list }
}

export const hasOurs = (list) => list.some((entry) => same(entry, OURS))
/* Ours once, after whatever was there. */
export const withOurs = (list) => (hasOurs(list) ? list : [...list, OURS])
/* Everything but ours. */
export const withoutOurs = (list) => list.filter((entry) => !same(entry, OURS))

/* The argument for `hidutil property --set`: decimal numbers. */
export const setArgument = (list) => JSON.stringify({ UserKeyMapping: list.map((entry) => ({ HIDKeyboardModifierMappingSrc: entry.src, HIDKeyboardModifierMappingDst: entry.dst })) })

/* What Settings → Keyboard says about the helper, in plain words. `state` is hyper.cjs's. */
export function describe(state) {
  switch (state) {
    case 'working': return 'Working. Hold Caps Lock and press a letter.'
    case 'starting': return 'Starting…'
    case 'access': return 'Needs Accessibility. OSAT can’t hold the Hyper key until you allow it.'
    case 'denied': return 'macOS didn’t let OSAT watch the keyboard. In System Settings → Privacy & Security, allow OSAT in Accessibility (and in Input Monitoring if it is listed), then turn this off and on.'
    case 'failed': return 'OSAT couldn’t start it. Turn this off and on to try again.'
    case 'unavailable': return 'Not on this Mac. It works in the Mac app.'
    default: return ''
  }
}
