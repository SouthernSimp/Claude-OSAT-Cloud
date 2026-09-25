import {
  BookOpenText, CalendarBlank, CurrencyDollar, Files, FolderSimple, GearSix, Globe, House, ListChecks,
  NotePencil, ShareNetwork, Sparkle, TerminalWindow, UploadSimple,
} from '@phosphor-icons/react'

/* The one definition of where things live. The dock, the sheet titles, ⌘K and
   the keyboard all read from here. Room ids stay what the code already calls
   them; the labels are what Nate sees. */

export const SPACES = [
  { id: 'Today', label: 'Desk', icon: House, hint: 'The desk and your day' },
  { id: 'Notes', label: 'Notes', icon: NotePencil, hint: 'Every page, sorted or not' },
  { id: 'Mindmap', label: 'Map', icon: ShareNetwork, hint: 'Your notes as a board, or as a sky' },
  { id: 'Assistant', label: 'Ask', icon: Sparkle, hint: 'Think out loud with the AI on this Mac' },
]

export const TOOLS = [
  { id: 'Journal', label: 'Today’s page', icon: BookOpenText, hint: 'A page for every day' },
  { id: 'Calendar', label: 'Calendar', icon: CalendarBlank, hint: 'The month, and the day in it' },
  { id: 'Habits', label: 'Habits', icon: ListChecks, hint: 'Small things, kept daily' },
  { id: 'Reflection', label: 'Reflect', icon: BookOpenText, hint: 'Three quiet questions' },
  { id: 'Budget', label: 'Money', icon: CurrencyDollar, hint: 'A ledger you keep by hand' },
  { id: 'Projects', label: 'Projects', icon: FolderSimple, hint: 'Work and safe links' },
  { id: 'Files', label: 'Files', icon: Files, hint: 'Folders you approved' },
  { id: 'Browser', label: 'Browser', icon: Globe, hint: 'The web, with a clipper into Notes' },
  { id: 'Terminal', label: 'Terminal', icon: TerminalWindow, hint: 'Your shell, in the Mac app' },
]

export const SETTINGS = { id: 'Settings', label: 'Settings', icon: GearSix, hint: 'Appearance, data, the shortcut' }
export const HIDDEN = [{ id: 'Obsidian', label: 'Export to Obsidian', icon: UploadSimple, hint: 'In Settings → Data' }]

const ALL = [...SPACES, ...TOOLS, SETTINGS, ...HIDDEN]

/* Sky is the Map seen from far away; Unsorted lives in Notes. */
const ALIASES = { Sky: 'Mindmap', Inbox: 'Notes' }

export function spaceFor(view) {
  const id = ALIASES[view] || view
  return ALL.find((item) => item.id === id) || null
}

export function titleFor(view) {
  return spaceFor(view)?.label || view
}

/* ⌘1–4 go to the four spaces. */
export function spaceForKey(key) {
  return SPACES[Number(key) - 1]?.id || null
}

export const EVERYWHERE = ALL
