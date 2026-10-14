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
  { id: 'general', tint: 'graphite', group: 'osat', label: 'General', icon: GearSix, blurb: 'The keys that bring OSAT up from any app, and the keys inside it.', words: 'shortcut hotkey desk quick bar ask chat keys esc' },
  { id: 'appearance', tint: 'indigo', group: 'osat', label: 'Appearance', icon: Palette, blurb: 'Light or dark, the backdrop, and how much your desktop blurs behind OSAT.', words: 'theme light dark auto backdrop blur wallpaper look' },
  { id: 'ai', tint: 'violet', group: 'osat', label: 'AI', icon: Sparkle, blurb: 'How big an AI runs on this Mac, and what it should know about you.', words: 'model local lm studio about you download size light balanced deep gemma' },
  { id: 'bots', tint: 'pink', group: 'osat', label: 'Bots', icon: Robot, blurb: 'Muse, Grok Bot, Claude, cloud models and the apps OSAT can use: what reaches OSAT, and what leaves your Mac.', words: 'drop folder cloud model key connector mcp deepseek openai provider topics apps gmail notion google calendar import claude desktop webhooks zapier slack discord ntfy siri' },
  { id: 'data', tint: 'blue', group: 'osat', label: 'Data', icon: Database, blurb: 'Where your workspace lives, backups, and the Obsidian export.', words: 'backup restore folder obsidian saved storage vault download' },
  { id: 'scans', tint: 'slate', group: 'osat', label: 'Scans', icon: Printer, blurb: 'Paper in: a scan becomes a sorted topic, waiting on the canvas.', words: 'scanner brother paper folder ocr document' },
  { id: 'iphone', tint: 'graphite', group: 'osat', label: 'iPhone', icon: DeviceMobile, blurb: 'Send a thought from your iPhone, and read your notes there.', words: 'icloud drive phone shortcuts sync inbox' },
  { id: 'about', tint: 'slate', group: 'osat', label: 'About', icon: Info, blurb: 'Which OSAT this is, and where it keeps things.', words: 'version privacy data folder' },

  { id: 'quick-search', tint: 'blue', group: 'launcher', label: 'Quick bar', icon: MagnifyingGlass, blurb: 'One bar over every app: find a file, something you copied, an app or a note, ask the AI, or save a sticky.', words: 'spotlight search quick search bar full view places files apps notes calculator ask chat sticky raycast' },
  { id: 'shortcuts', tint: 'indigo', group: 'launcher', label: 'Shortcuts', icon: Keyboard, blurb: 'Every word and every key, in one table.', words: 'word alias hotkey key hyper table keyword' },
  { id: 'keyboard', tint: 'graphite', group: 'launcher', label: 'Keyboard', icon: Command, blurb: 'Caps Lock as a Hyper key, built into OSAT, and giving the quick bar ⌘Space.', words: 'hyper caps lock karabiner hyperkey raycast spotlight command space shift' },
  { id: 'clipboard', tint: 'sky', group: 'launcher', label: 'Clipboard', icon: ClipboardText, blurb: 'Everything you copy, kept only on this Mac, searchable, with pins for the things you paste often.', words: 'history copies paste pin pause clear limits password privacy' },
  { id: 'snippets', tint: 'violet', group: 'launcher', label: 'Snippets', icon: TextAlignLeft, blurb: 'Text you paste often, with a short word: from the quick bar, or typed in any app.', words: 'snippet text expand expansion template address signature reply word' },
  { id: 'quick-links', tint: 'blue', group: 'launcher', label: 'Quick links', icon: Link, blurb: 'A web address with a short word: type it, and it opens, or searches for what you typed after it.', words: 'web address url search google github bookmark query' },
  { id: 'windows', tint: 'indigo', group: 'launcher', label: 'Window layouts', icon: SquaresFour, blurb: 'Snap the window you were in to a half, a third or a corner.', words: 'snap halves thirds corners maximize center accessibility move resize rectangle' },
  { id: 'screenshots', tint: 'pink', group: 'launcher', label: 'Screenshots', icon: Camera, blurb: 'Screenshots and recording, with CleanShot X or the Mac’s own.', words: 'screenshot capture record recording video cleanshot ocr text scrolling' },
  { id: 'mouse', tint: 'slate', group: 'launcher', label: 'Mouse', icon: Mouse, blurb: 'Make the mouse wheel scroll the opposite way from the trackpad, scroll faster or slower, and change what the side buttons do.', words: 'scroll reverse natural wheel direction trackpad speed button back forward linearmouse windows' },
  { id: 'ring', tint: 'rose', group: 'launcher', label: 'The ring', icon: Target, blurb: 'Quick tools in a circle around your pointer.', words: 'circle middle click radial pie menu tools' },
]

export const pageById = (id) => SETTINGS_PAGES.find((page) => page.id === id) || null

/* Names older links still use (the menu-bar icon, Tools → Appearance, the first Launcher tab). */
const MOVED = { launcher: 'quick-search', shortcut: 'general' }
export const sectionFor = (id) => (pageById(id) ? id : MOVED[id] || 'general')
