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

/* System Settings' panes (Raycast lists them too), opened by their id (`x-apple.systempreferences:<id>`; the ids are
   the panes' bundle ids in /System/Library/ExtensionKit/Extensions, macOS 13 and later). */
const PANES = [
  ['com.apple.wifi-settings-extension', 'Wi-Fi', 'wifi wireless internet network'],
  ['com.apple.BluetoothSettings', 'Bluetooth', 'bluetooth headphones airpods devices'],
  ['com.apple.Network-Settings.extension', 'Network', 'network ethernet internet'],
  ['com.apple.NetworkExtensionSettingsUI.NESettingsUIExtension', 'VPN', 'vpn'],
  ['com.apple.Notifications-Settings.extension', 'Notifications', 'notifications alerts banners'],
  ['com.apple.Sound-Settings.extension', 'Sound', 'sound volume output input microphone speakers'],
  ['com.apple.Focus-Settings.extension', 'Focus', 'focus do not disturb dnd'],
  ['com.apple.Screen-Time-Settings.extension', 'Screen Time', 'screen time limits'],
  ['com.apple.systempreferences.GeneralSettings', 'General', 'general'],
  ['com.apple.SystemProfiler.AboutExtension', 'About this Mac', 'about mac serial version'],
  ['com.apple.Software-Update-Settings.extension', 'Software Update', 'software update upgrade macos'],
  ['com.apple.settings.Storage', 'Storage', 'storage disk space'],
  ['com.apple.LoginItems-Settings.extension', 'Login Items', 'login items startup open at login'],
  ['com.apple.Appearance-Settings.extension', 'Appearance', 'appearance dark light accent'],
  ['com.apple.Accessibility-Settings.extension', 'Accessibility', 'accessibility zoom voiceover'],
  ['com.apple.ControlCenter-Settings.extension', 'Control Center', 'control center menu bar'],
  ['com.apple.Siri-Settings.extension', 'Siri', 'siri apple intelligence'],
  ['com.apple.Spotlight-Settings.extension', 'Spotlight', 'spotlight search'],
  ['com.apple.settings.PrivacySecurity.extension', 'Privacy & Security', 'privacy security permissions accessibility allow'],
  ['com.apple.Desktop-Settings.extension', 'Desktop & Dock', 'desktop dock stage manager mission control hot corners'],
  ['com.apple.Displays-Settings.extension', 'Displays', 'displays monitor resolution brightness night shift'],
  ['com.apple.Wallpaper-Settings.extension', 'Wallpaper', 'wallpaper background'],
  ['com.apple.Battery-Settings.extension', 'Battery', 'battery energy power'],
  ['com.apple.Lock-Screen-Settings.extension', 'Lock Screen', 'lock screen saver password'],
  ['com.apple.Touch-ID-Settings.extension', 'Touch ID & Password', 'touch id password fingerprint'],
  ['com.apple.Users-Groups-Settings.extension', 'Users & Groups', 'users groups accounts'],
  ['com.apple.Internet-Accounts-Settings.extension', 'Internet Accounts', 'internet accounts mail google'],
  ['com.apple.Keyboard-Settings.extension', 'Keyboard', 'keyboard shortcuts input dictation'],
  ['com.apple.Mouse-Settings.extension', 'Mouse', 'mouse scrolling'],
  ['com.apple.Trackpad-Settings.extension', 'Trackpad', 'trackpad gestures scrolling'],
  ['com.apple.Print-Scan-Settings.extension', 'Printers & Scanners', 'printers scanners print'],
  ['com.apple.Sharing-Settings.extension', 'Sharing', 'sharing airplay screen sharing file sharing'],
  ['com.apple.Date-Time-Settings.extension', 'Date & Time', 'date time clock timezone'],
  ['com.apple.Localization-Settings.extension', 'Language & Region', 'language region'],
  ['com.apple.Time-Machine-Settings.extension', 'Time Machine', 'time machine backup'],
  ['com.apple.systempreferences.AppleIDSettings', 'Apple Account', 'apple account id icloud'],
]
SYSTEM_COMMANDS.push(...PANES.map(([pane, label, words]) => ({ id: `pane:${pane}`, label, words: `${words} settings preferences`, pane })))

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

export const systemRow = (item, section = item.pane ? 'System Settings' : 'Mac') => ({
  key: `sys:${item.id}`, source: 'system', kind: 'system', title: item.label, subtitle: item.pane ? 'System Settings' : item.confirm ? 'Can’t be undone' : 'Mac', section, data: { id: item.id },
})
