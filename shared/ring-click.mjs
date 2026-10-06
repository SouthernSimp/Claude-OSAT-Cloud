/* The ring's middle-click (Phase 13i): Hyper + the middle mouse button opens the ring over any app. Electron cannot
   see clicks outside its own windows, so a small helper (desktop/launcher/middle-click.cjs) watches the mouse and
   writes one line per button press. These are the pure rules main and the tests share: what a line says, and whether
   a click is Hyper + middle. Pure. */

/* NSEvent's numbers: the middle button is button 2; each modifier key is one bit of `modifierFlags`. */
export const MIDDLE_BUTTON = 2
const SHIFT = 1 << 17
const CONTROL = 1 << 18
const OPTION = 1 << 19
const COMMAND = 1 << 20

/* Hyper + middle: the middle button with every key the Hyper key sends held down. That is ⌃⌥⇧⌘, or ⌃⌥⌘ for a Hyper key
   that leaves ⇧ out (`sends: 'three'`, as launcher-model's `systemKey`): then ⇧ must be up, just as it must for the
   key. Caps Lock, fn and the rest are ignored. */
export function isHyperClick({ button, flags } = {}, sends = 'four') {
  if (button !== MIDDLE_BUTTON || !Number.isSafeInteger(flags) || flags < 0) return false
  const wanted = sends === 'three' ? CONTROL | OPTION | COMMAND : SHIFT | CONTROL | OPTION | COMMAND
  return (flags & (SHIFT | CONTROL | OPTION | COMMAND)) === wanted
}

/* One line from the helper: `ready` (it is listening) or `click <button> <flags>` (a button other than left or right was
   pressed). Anything else is nothing: → { kind: 'ready' } | { kind: 'click', button, flags } | null. */
export function readHelperLine(line) {
  const words = String(line || '').trim().split(/\s+/)
  if (words.length === 1 && words[0] === 'ready') return { kind: 'ready' }
  if (words.length === 3 && words[0] === 'click') {
    const button = Number(words[1])
    const flags = Number(words[2])
    if (Number.isSafeInteger(button) && Number.isSafeInteger(flags) && button >= 0 && flags >= 0) return { kind: 'click', button, flags }
  }
  return null
}
