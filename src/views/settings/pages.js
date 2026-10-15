import {
  ClipboardText, Command, Database, DeviceMobile, GearSix, Info, Keyboard, Link, MagnifyingGlass, Palette, Printer, Robot,
  Sparkle, SquaresFour, Target, Camera, TextAlignLeft, Mouse,
} from '@phosphor-icons/react'

/* Settings' pages (Phase 13b), in the order the sidebar shows them. Plain data: the sidebar, ⌘K and the older links
   into Settings (`sectionFor`) all read it. `words` are what the search box also answers to; `blurb` is the one plain
   line under a page's title; `tint` colours its tile (settings.css, cool hues only). To add a page: an entry here and a
   component in Settings.jsx's PAGES. */

export const SETTINGS_GROUPS = [
  { id: 'osat', label: '' },
  { id: 'launcher', label: 'Launcher' },
]

export const SETTINGS_PAGES = [
  { id: 'general', tint: 'graphite', group: 'osat', label: 'General', icon: GearSix, blurb: 'The keys that bring OSAT up.', words: 'shortcut hotkey desk quick bar ask chat keys esc' },
  { id: 'appearance', tint: 'indigo', group: 'osat', label: 'Appearance', icon: Palette, blurb: 'Light or dark, the backdrop and the blur.', words: 'theme light dark auto backdrop blur wallpaper look' },
  { id: 'ai', tint: 'violet', group: 'osat', label: 'AI', icon: Sparkle, blurb: 'The AI on this Mac, and what it knows about you.', words: 'model local lm studio about you download size light balanced deep gemma' },
  { id: 'bots', tint: 'pink', group: 'osat', label: 'Bots', icon: Robot, blurb: 'Cloud models, connected apps, and what leaves your Mac.', words: 'drop folder cloud model key connector mcp deepseek openai provider topics apps gmail notion google calendar import claude desktop webhooks zapier slack discord ntfy siri' },
  { id: 'data', tint: 'blue', group: 'osat', label: 'Data', icon: Database, blurb: 'Where your work lives, and its backups.', words: 'backup restore folder obsidian saved storage vault download' },
  { id: 'scans', tint: 'slate', group: 'osat', label: 'Scans', icon: Printer, blurb: 'A scan becomes a sorted topic.', words: 'scanner brother paper folder ocr document' },
  { id: 'iphone', tint: 'graphite', group: 'osat', label: 'iPhone', icon: DeviceMobile, blurb: 'Your notes on your iPhone.', words: 'icloud drive phone shortcuts sync inbox' },
  { id: 'about', tint: 'slate', group: 'osat', label: 'About', icon: Info, blurb: 'Your version, and updates.', words: 'version privacy data folder' },

  { id: 'quick-search', tint: 'blue', group: 'launcher', label: 'Quick bar', icon: MagnifyingGlass, blurb: 'One bar over every app: find, ask, or jot.', words: 'spotlight search quick search bar full view places files apps notes calculator ask chat sticky raycast' },
  { id: 'shortcuts', tint: 'indigo', group: 'launcher', label: 'Shortcuts', icon: Keyboard, blurb: 'Every word and key, in one place.', words: 'word alias hotkey key hyper table keyword' },
  { id: 'keyboard', tint: 'graphite', group: 'launcher', label: 'Keyboard', icon: Command, blurb: 'Caps Lock as Hyper, and ⌘Space for the bar.', words: 'hyper caps lock karabiner hyperkey raycast spotlight command space shift' },
  { id: 'clipboard', tint: 'sky', group: 'launcher', label: 'Clipboard', icon: ClipboardText, blurb: 'Everything you copy, searchable.', words: 'history copies paste pin pause clear limits password privacy' },
  { id: 'snippets', tint: 'violet', group: 'launcher', label: 'Snippets', icon: TextAlignLeft, blurb: 'Text you paste often, with a short word.', words: 'snippet text expand expansion template address signature reply word' },
  { id: 'quick-links', tint: 'blue', group: 'launcher', label: 'Quick links', icon: Link, blurb: 'Web addresses with a short word.', words: 'web address url search google github bookmark query' },
  { id: 'windows', tint: 'indigo', group: 'launcher', label: 'Window layouts', icon: SquaresFour, blurb: 'Snap windows to halves, thirds and corners.', words: 'snap halves thirds corners maximize center accessibility move resize rectangle' },
  { id: 'screenshots', tint: 'pink', group: 'launcher', label: 'Screenshots', icon: Camera, blurb: 'Screenshots and recording, with CleanShot X or the Mac’s own.', words: 'screenshot capture record recording video cleanshot ocr text scrolling' },
  { id: 'mouse', tint: 'slate', group: 'launcher', label: 'Mouse', icon: Mouse, blurb: 'Scroll direction, speed and side buttons.', words: 'scroll reverse natural wheel direction trackpad speed button back forward linearmouse windows' },
  { id: 'ring', tint: 'rose', group: 'launcher', label: 'The ring', icon: Target, blurb: 'Tools in a circle around your pointer.', words: 'circle middle click radial pie menu tools' },
]

export const pageById = (id) => SETTINGS_PAGES.find((page) => page.id === id) || null

/* Names older links still use (the menu-bar icon, Tools → Appearance, the first Launcher tab). */
const MOVED = { launcher: 'quick-search', shortcut: 'general' }
export const sectionFor = (id) => (pageById(id) ? id : MOVED[id] || 'general')
