import {
  BookOpenText, CalendarBlank, CheckCircle, CurrencyDollar, EnvelopeSimple, Files, GearSix, GithubLogo, Globe, Key, Kanban, ListChecks,
  MapTrifold, Microphone, Shapes, MusicNotes, NotePencil, Sparkle, Stack, Sun, Target, TerminalWindow, Tray, UploadSimple,
} from '@phosphor-icons/react'

/* The one definition of where things live (Phase 73: one window, one sidebar). The sidebar, ⌘K, the keyboard and the
   Mac's Go menu (main.cjs, by hand) read from here. Ids stay what the code already calls them (Budget is Money,
   Mindmap the boards, Assistant is Ask); the labels are what you see; `tint` colours each one's tile. */

// The four tiles at the top of the sidebar, then Notes and Files: ⌘1–6.
export const SPACES = [
  { id: 'Today', tint: 'blue', label: 'Today', icon: Sun, hint: 'What to do, what’s on, what came in' },
  { id: 'JustIn', tint: 'indigo', label: 'Just in', icon: Tray, hint: 'Everything you wrote down, and where it went' },
  { id: 'Calendar', tint: 'red', label: 'Calendar', icon: CalendarBlank, hint: 'The month, and the day in it' },
  { id: 'Todo', tint: 'green', label: 'To do', icon: CheckCircle, hint: 'Every open to-do, wherever it was filed' },
  { id: 'Notes', tint: 'yellow', label: 'Notes', icon: NotePencil, hint: 'Every note and sticky' },
  { id: 'Files', tint: 'sky', label: 'Files', icon: Files, hint: 'Your Desktop, Documents and Downloads' },
]

export const TOOLS = [
  { id: 'Meetings', tint: 'pink', label: 'Meetings', icon: Microphone, hint: 'Listen to a meeting on this Mac; it is written up for you' },
  { id: 'Mail', tint: 'blue', label: 'Mail', icon: EnvelopeSimple, hint: 'Your inbox, read here' },
  { id: 'Habits', tint: 'orange', label: 'Habits', icon: ListChecks, hint: 'Small things, kept daily' },
  { id: 'Goals', tint: 'violet', label: 'Goals', icon: Target, hint: 'The few big things, each moving with a board or a habit' },
  { id: 'Budget', tint: 'green', label: 'Money', icon: CurrencyDollar, hint: 'A ledger you keep by hand' },
  { id: 'Journal', tint: 'orange', label: 'Journal', icon: BookOpenText, hint: 'A page for every day' },
  { id: 'Mindmap', tint: 'teal', label: 'Boards', icon: Kanban, hint: 'Your boards: OSAT, Fortis, Home…' },
  { id: 'Canvas', tint: 'yellow', label: 'Canvases', icon: Shapes, hint: 'Whiteboards: stickies, shapes, mind maps and kanbans' },
  { id: 'Assistant', tint: 'violet', label: 'Ask', icon: Sparkle, hint: 'Think out loud with the AI on this Mac' },
  { id: 'Browser', tint: 'blue', label: 'Web', icon: Globe, hint: 'The web, with a clipper into Notes' },
  { id: 'Terminal', tint: 'graphite', label: 'Terminal', icon: TerminalWindow, hint: 'Your shell, in the Mac app' },
  { id: 'GitHub', tint: 'graphite', label: 'GitHub', icon: GithubLogo, hint: 'Your repositories: what waits for you, and Merge' },
  { id: 'Passwords', tint: 'slate', label: 'Passwords', icon: Key, hint: 'Locked until you unlock them with your master password' },
  { id: 'Roadmap', tint: 'indigo', label: 'Roadmap', icon: MapTrifold, hint: 'What’s new, what’s coming next, and where OSAT is going' },
  { id: 'Pile', tint: 'orange', label: 'Sort a pile', icon: Stack, hint: 'Toss a pile of stickies down, group them, send them to a board' },
]

// The sidebar's groups under the tiles and the boards. A folded group opens with one click.
export const GROUPS = [
  { name: 'Business', items: ['Meetings', 'Mail'] },
  { name: 'Life', items: ['Habits', 'Goals', 'Budget', 'Journal'] },
  { name: 'Library', items: ['Notes', 'Files'] },
  { name: 'Power tools', fold: true, items: ['Browser', 'Terminal', 'GitHub', 'Passwords', 'Roadmap'] },
]

export const SETTINGS = { id: 'Settings', tint: 'graphite', label: 'Settings', icon: GearSix, hint: 'AI, connections, keys, appearance' }
export const HIDDEN = [
  { id: 'Obsidian', tint: 'violet', label: 'Export to Obsidian', icon: UploadSimple, hint: 'In Settings → Data' },
  { id: 'NowPlaying', tint: 'green', label: 'Now playing', icon: MusicNotes, hint: 'Spotify, bigger' },
]

const ALL = [...SPACES, ...TOOLS, SETTINGS, ...HIDDEN]

/* The boards were once the Map, then the Sky; the desk is Today now. Canvas is the whiteboards again (Phase 85). */
const ALIASES = { Sky: 'Mindmap', Desk: 'Today' }

export function spaceFor(view) {
  const id = ALIASES[view] || view
  return ALL.find((item) => item.id === id) || null
}

export function titleFor(view) {
  return spaceFor(view)?.label || view
}

/* ⌘1–6 go to the six spaces. */
export function spaceForKey(key) {
  return SPACES[Number(key) - 1]?.id || null
}

export const EVERYWHERE = ALL
