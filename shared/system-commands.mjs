/* The Mac's own commands in the quick bar (Oct 2026, Raycast's "system commands"): lock the screen, sleep, turn the
   screen off, dark mode, mute, empty the Bin, hide other apps. Each is found by its words; one that can't be undone
   (`confirm`) asks for Return a second time. desktop/launcher/system.cjs runs them. Pure. */

export const SYSTEM_COMMANDS = [
  { id: 'lock', label: 'Lock the screen', words: 'lock screen away leave' },
  { id: 'sleep', label: 'Sleep', words: 'sleep mac suspend' },
  { id: 'screen-off', label: 'Turn off the screen', words: 'display screen off sleep monitor' },
  { id: 'dark-mode', label: 'Dark mode on or off', words: 'dark light mode appearance theme night' },
  { id: 'mute', label: 'Mute or unmute', words: 'mute unmute sound volume silence quiet' },
  { id: 'hide-others', label: 'Hide other apps', words: 'hide others apps windows clean focus' },
  { id: 'empty-bin', label: 'Empty the Bin', words: 'empty bin trash delete', confirm: 'Empty the Bin? This can’t be undone. Press Return again to empty it.' },
]

export const systemCommand = (id) => SYSTEM_COMMANDS.find((item) => item.id === id) || null

/* "lock", "dark", "empty tr": the commands every word of the query starts a word of (three letters at least). */
export function findSystem(query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length || words.join('').length < 3) return []
  return SYSTEM_COMMANDS.filter((item) => {
    const own = `${item.label} ${item.words}`.toLowerCase().split(/[^a-z]+/)
    return words.every((word) => own.some((part) => part.startsWith(word)))
  })
}

export const systemRow = (item, section = 'Mac') => ({
  key: `sys:${item.id}`, source: 'system', kind: 'system', title: item.label, subtitle: item.confirm ? 'Can’t be undone' : 'Mac', section, data: { id: item.id },
})
