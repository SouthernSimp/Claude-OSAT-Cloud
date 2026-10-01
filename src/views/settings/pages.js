import {
  ClipboardText, Command, Database, DeviceMobile, GearSix, Info, Keyboard, Link, MagnifyingGlass, Palette, Printer, Robot,
  Sparkle, SquaresFour, Target,
} from '@phosphor-icons/react'

/* Settings' pages (Phase 13b), in the order the sidebar shows them. Plain data: the sidebar, ⌘K and the older links
   into Settings (`sectionFor`) all read it. `words` are what the search box also answers to; `blurb` is the one plain
   line under a page's title. To add a page: an entry here and a component in Settings.jsx's PAGES. */

export const SETTINGS_GROUPS = [
  { id: 'osat', label: '' },
  { id: 'launcher', label: 'Launcher' },
]

export const SETTINGS_PAGES = [
  { id: 'general', group: 'osat', label: 'General', icon: GearSix, blurb: 'The keys that bring OSAT up from any app, and the keys inside it.', words: 'shortcut hotkey desk quick chat keys esc' },
  { id: 'appearance', group: 'osat', label: 'Appearance', icon: Palette, blurb: 'Light or dark, the backdrop, and how much your desktop blurs behind OSAT.', words: 'theme light dark auto backdrop blur wallpaper look' },
  { id: 'ai', group: 'osat', label: 'AI', icon: Sparkle, blurb: 'How big an AI runs on this Mac, and what it should know about you.', words: 'model local lm studio about you download size light balanced deep gemma' },
  { id: 'bots', group: 'osat', label: 'Bots', icon: Robot, blurb: 'Muse, Grok Bot, Claude and cloud models: what reaches OSAT, and what leaves your Mac.', words: 'drop folder cloud model key connector mcp deepseek openai provider nodes' },
  { id: 'data', group: 'osat', label: 'Data', icon: Database, blurb: 'Where your workspace lives, backups, and the Obsidian export.', words: 'backup restore folder obsidian saved storage vault download' },
  { id: 'scans', group: 'osat', label: 'Scans', icon: Printer, blurb: 'Paper in: a scan becomes a sorted node, waiting in the Sky.', words: 'scanner brother paper folder ocr document' },
  { id: 'iphone', group: 'osat', label: 'iPhone', icon: DeviceMobile, blurb: 'Send a thought from your iPhone, and read your notes there.', words: 'icloud drive phone shortcuts sync inbox' },
  { id: 'about', group: 'osat', label: 'About', icon: Info, blurb: 'Which OSAT this is, and where it keeps things.', words: 'version privacy data folder' },

  { id: 'quick-search', group: 'launcher', label: 'Quick search', icon: MagnifyingGlass, blurb: 'A small bar over every app: find a file, something you copied, an app or a note, and go straight to it.', words: 'spotlight search bar full view places files apps notes calculator' },
  { id: 'shortcuts', group: 'launcher', label: 'Shortcuts', icon: Keyboard, blurb: 'Every word and every key, in one table.', words: 'word alias hotkey key hyper table keyword' },
  { id: 'keyboard', group: 'launcher', label: 'Keyboard', icon: Command, blurb: 'The Hyper key, and the two things only you can change on your Mac.', words: 'hyper caps lock karabiner hyperkey spotlight command space shift' },
  { id: 'clipboard', group: 'launcher', label: 'Clipboard', icon: ClipboardText, blurb: 'Everything you copy, kept only on this Mac, searchable, with pins for the things you paste often.', words: 'history copies paste pin pause clear limits password privacy' },
  { id: 'quick-links', group: 'launcher', label: 'Quick links', icon: Link, blurb: 'A web address with a short word: type it, and it opens, or searches for what you typed after it.', words: 'web address url search google github bookmark query' },
  { id: 'windows', group: 'launcher', label: 'Window layouts', icon: SquaresFour, blurb: 'Snap the window you were in to a half, a third or a corner.', words: 'snap halves thirds corners maximize center accessibility move resize rectangle' },
  { id: 'ring', group: 'launcher', label: 'The ring', icon: Target, blurb: 'Quick tools in a circle around your pointer.', words: 'circle middle click radial pie menu tools' },
]

export const pageById = (id) => SETTINGS_PAGES.find((page) => page.id === id) || null

/* Names older links still use (the menu-bar icon, Tools → Appearance, the first Launcher tab). */
const MOVED = { launcher: 'quick-search', shortcut: 'general' }
export const sectionFor = (id) => (pageById(id) ? id : MOVED[id] || 'general')
