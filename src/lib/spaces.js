import {
  BookOpenText, CalendarBlank, CurrencyDollar, Files, GearSix, Globe, House, ListChecks,
  MapTrifold, MusicNotes, NotePencil, Sparkle, Stack, TerminalWindow, TreeStructure, UploadSimple,
} from '@phosphor-icons/react'

/* The one definition of where things live. The dock, the sheet titles, ⌘K and
   the keyboard all read from here. Room ids stay what the code already calls
   them; the labels are what Nate sees. */

export const SPACES = [
  { id: 'Today', label: 'Desk', icon: House, hint: 'The desk and your day' },
  { id: 'Notes', label: 'Notes', icon: NotePencil, hint: 'Every page, sorted or not' },
  // The Sky, the layer above the desk: your nodes (it was the Map).
  { id: 'Mindmap', label: 'Sky', icon: TreeStructure, hint: 'Your nodes, on one whiteboard  ⌥⌘↑' },
  // Ask lives in the desk's line; its room (every chat) is under Tools and ⌘4.
  { id: 'Assistant', label: 'Ask', icon: Sparkle, hint: 'Think out loud with the AI on this Mac', dock: false },
  { id: 'Files', label: 'Files', icon: Files, hint: 'Your Desktop, Documents and Downloads' },
]

export const TOOLS = [
  // A table of its own for a pile of paper stickies, until it's sorted and goes to the Sky.
  { id: 'Pile', label: 'Sort a pile', icon: Stack, hint: 'Toss a pile of stickies down, group them, send it to the Sky' },
  { id: 'Journal', label: 'Journal', icon: BookOpenText, hint: 'A page for every day' },
  { id: 'Calendar', label: 'Calendar', icon: CalendarBlank, hint: 'The month, and the day in it' },
  { id: 'Habits', label: 'Habits', icon: ListChecks, hint: 'Small things, kept daily' },
  { id: 'Budget', label: 'Money', icon: CurrencyDollar, hint: 'A ledger you keep by hand' },
  { id: 'Browser', label: 'Browser', icon: Globe, hint: 'The web, with a clipper into Notes' },
  { id: 'Terminal', label: 'Terminal', icon: TerminalWindow, hint: 'Your shell, in the Mac app' },
  { id: 'Roadmap', label: 'Roadmap', icon: MapTrifold, hint: 'Where OSAT is going' },
]

export const SETTINGS = { id: 'Settings', label: 'Settings', icon: GearSix, hint: 'Appearance, data, the shortcut' }
export const HIDDEN = [
  { id: 'Obsidian', label: 'Export to Obsidian', icon: UploadSimple, hint: 'In Settings → Data' },
  { id: 'NowPlaying', label: 'Now playing', icon: MusicNotes, hint: 'Spotify, bigger' },
]

const ALL = [...SPACES, ...TOOLS, SETTINGS, ...HIDDEN]

/* The Sky is the room once called the Map. */
const ALIASES = { Sky: 'Mindmap' }

export function spaceFor(view) {
  const id = ALIASES[view] || view
  return ALL.find((item) => item.id === id) || null
}

export function titleFor(view) {
  return spaceFor(view)?.label || view
}

/* ⌘1–5 go to the five spaces. */
export function spaceForKey(key) {
  return SPACES[Number(key) - 1]?.id || null
}

export const EVERYWHERE = ALL
