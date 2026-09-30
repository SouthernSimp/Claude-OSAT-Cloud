import { hyperLabel } from '../../shared/launcher-model.mjs'

/* Recording a shortcut (Settings → General and → Launcher). It is read from event.code, because ⌥ changes
   event.key on a Mac; main checks the key again (`validHotkey`) and says if another app has it. */
const KEY_NAMES = { Space: 'Space', Tab: 'Tab', Enter: 'Return', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }

export function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code]
  const match = /^(?:Key([A-Z])|Digit([0-9])|(F[0-9]{1,2}))$/.exec(code)
  return match ? match[1] || match[2] || match[3] : null
}

/* A keydown → { combo: "Alt+Shift+Space" }, { error } when no modifier was held, or null while only a modifier is down. */
export function comboFrom(event) {
  const key = keyName(event.code)
  if (!key) return null
  const modifiers = [event.metaKey && 'Command', event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean)
  if (!modifiers.length) return { error: 'Hold ⌘, ⌃, ⌥ or ⇧ together with a key.' }
  // All four is Hyper, always written the one way, so it is the same key wherever it is compared.
  return { combo: [...(modifiers.length === 4 ? ['Control', 'Alt', 'Shift', 'Command'] : modifiers), key].join('+') }
}

const SYMBOLS = { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' }
const symbols = (accelerator) => String(accelerator || '').split('+').map((part) => SYMBOLS[part] || part).join('')

/* "Alt+Space" → "⌥Space"; the four modifiers with a letter → "Hyper V". */
export const labelOf = (accelerator) => hyperLabel(accelerator, symbols)
