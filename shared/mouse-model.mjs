/* Mouse (Phase 64): which way the wheel scrolls, how fast, and what the side buttons do. The settings live in
   launcher.json (`mouse`); a small helper (desktop/helpers/osat-mouse.swift, started by desktop/launcher/mouse.cjs)
   applies them to the events macOS sends. The helper cannot import this file, so `scrollAxis`, `deviceOf` and
   `buttonAction` are written out again in Swift with the same rules; tests/mouse.test.mjs checks the rules here and
   that the helper still says only what this file reads. Pure.

   Ideas from LinearMouse (MIT, github.com/linearmouse/linearmouse), written again here; see docs/MOUSE-FINDINGS.md. */

export const SPEED_MIN = 0.5
export const SPEED_MAX = 4
export const SPEED_STEP = 0.25

/* The side buttons OSAT can change. `button` is the number macOS gives the press (0 left, 1 right, 2 middle, so the
   first side button is 3). The middle button is left alone: Hyper + middle-click opens the ring. */
export const BUTTONS = [
  { button: 3, label: 'Side button 1' },
  { button: 4, label: 'Side button 2' },
]

/* What a button can do. `back` and `forward` press ⌘[ and ⌘] (key codes 33 and 30), which Safari, Finder, Chrome and
   most editors take as back and forward; `nothing` swallows the press. */
export const BUTTON_ACTIONS = [
  ['default', 'As it is'],
  ['back', 'Back'],
  ['forward', 'Forward'],
  ['nothing', 'Do nothing'],
]
export const BUTTON_KEYS = { back: { code: 33, command: true }, forward: { code: 30, command: true } }

export const DEFAULT_MOUSE = Object.freeze({
  // Nothing changes until this is on. It is the master switch: off, OSAT touches no mouse event at all.
  on: false,
  // Per device kind and per axis. `vertical` is up and down, `horizontal` is left and right.
  reverse: { mouse: { vertical: false, horizontal: false }, trackpad: { vertical: false, horizontal: false } },
  // How much faster (or slower) the mouse wheel scrolls; the trackpad is never sped up.
  speed: 1,
  // { '3': 'back' }: only buttons that do something other than their own thing.
  buttons: {},
})

const axes = (from) => ({ vertical: from?.vertical === true, horizontal: from?.horizontal === true })

export function cleanSpeed(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, number)) / SPEED_STEP) * SPEED_STEP
}

/* What a saved file may hold; anything broken falls back to the default, so an old launcher.json (no `mouse`) loads. */
export function cleanMouse(from) {
  const own = from && typeof from === 'object' ? from : {}
  const buttons = {}
  for (const { button } of BUTTONS) {
    const action = own.buttons?.[button]
    if (typeof action === 'string' && action !== 'default' && BUTTON_ACTIONS.some(([id]) => id === action)) buttons[button] = action
  }
  return {
    on: own.on === true,
    reverse: { mouse: axes(own.reverse?.mouse), trackpad: axes(own.reverse?.trackpad) },
    speed: cleanSpeed(own.speed ?? 1),
    buttons,
  }
}

/* A patch from Settings over what is kept: the two device kinds and the buttons merge one level down. */
export function mergeMouse(current, patch) {
  const base = cleanMouse(current)
  const from = patch && typeof patch === 'object' ? patch : {}
  const buttons = { ...base.buttons }
  for (const [button, action] of Object.entries(from.buttons || {})) {
    if (action === 'default' || action === null) delete buttons[button]
    else buttons[button] = action
  }
  return cleanMouse({
    ...base,
    ...from,
    reverse: { mouse: { ...base.reverse.mouse, ...(from.reverse?.mouse || {}) }, trackpad: { ...base.reverse.trackpad, ...(from.reverse?.trackpad || {}) } },
    buttons,
  })
}

export const reversesAny = (mouse) => ['mouse', 'trackpad'].some((kind) => mouse.reverse[kind].vertical || mouse.reverse[kind].horizontal)

/* Does OSAT have any reason to watch the mouse? Off, or on with nothing to change, it starts nothing. */
export const wantsHelper = (mouse) => mouse.on === true && (reversesAny(mouse) || mouse.speed !== 1 || Object.keys(mouse.buttons).length > 0)

/* What the helper is told (one JSON line on its standard input, again whenever a setting changes). */
export function configLine(mouse) {
  const clean = cleanMouse(mouse)
  return `${JSON.stringify({ reverse: clean.reverse, speed: clean.speed, buttons: clean.buttons })}\n`
}

/* One line from the helper: `ready` (the tap is on), `denied` (macOS wouldn't let it listen) or `stopped`. Anything
   else is nothing. */
export function readHelperLine(line) {
  const word = String(line || '').trim()
  return ['ready', 'denied', 'stopped'].includes(word) ? { kind: word } : null
}

/* ---- The rules the helper applies, event by event ---- */

/* Mouse or trackpad? A finger on a trackpad (and the Magic Mouse's surface) sends a scroll phase while it moves and a
   momentum phase while it glides on; a wheel with notches sends neither. So any phase means "touch", which stays as
   the Mac has it unless the trackpad itself was asked to change. When in doubt it is a trackpad: that is the side that
   fails safe (the wheel simply isn't changed). */
export const deviceOf = ({ phase = 0, momentum = 0 } = {}) => (phase !== 0 || momentum !== 0 ? 'trackpad' : 'mouse')

/* One axis of one scroll event: `axis` is { line, fixed, point } (the whole-line step and the two finer measures the
   Mac sends together), `reverse` flips it and `factor` scales it. The finer measures scale exactly; the whole-line step
   keeps the part it could not show in `residual`, so a factor of 0.5 gives every second notch. Returns the new axis and
   the residual to carry to the next event on this axis. */
export function scrollAxis(axis, { reverse = false, factor = 1 } = {}, residual = 0) {
  if (!reverse && factor === 1) return { line: axis.line, fixed: axis.fixed, point: axis.point, residual: 0 }
  const sign = reverse ? -1 : 1
  const wanted = axis.line * sign * factor
  const carried = wanted !== 0 && residual !== 0 && Math.sign(wanted) !== Math.sign(residual) ? 0 : residual
  const total = wanted + carried
  const line = Math.trunc(total) || 0
  return { line, fixed: axis.fixed * sign * factor || 0, point: axis.point * sign * factor || 0, residual: total - line }
}

/* A whole scroll event: { phase, momentum, vertical: axis, horizontal: axis } with the rules (a cleaned `mouse`) and the
   residuals so far ({ vertical, horizontal }). → { device, vertical, horizontal, residual }. */
export function scrollEvent(event, rules, residual = { vertical: 0, horizontal: 0 }) {
  const device = deviceOf(event)
  const reverse = rules.reverse[device]
  const factor = device === 'mouse' ? rules.speed : 1
  const vertical = scrollAxis(event.vertical, { reverse: reverse.vertical, factor }, residual.vertical)
  const horizontal = scrollAxis(event.horizontal, { reverse: reverse.horizontal, factor }, residual.horizontal)
  return { device, vertical, horizontal, residual: { vertical: vertical.residual, horizontal: horizontal.residual } }
}

/* What a side button press does: 'default' (the press goes on as it was) or one of BUTTON_ACTIONS. */
export const buttonAction = (rules, button) => rules.buttons[button] || 'default'
