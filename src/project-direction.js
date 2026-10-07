import { addFolder, addSticky } from './nodes-model.js'

/* Nate asked for OSAT's own plan as the first node in the Sky: what's done, what's being
   built now, what's next and what's later, and the open questions. Added once per
   workspace (settings.seeded.direction), never again, even if he removes it. */

const BRANCHES = [
  ['Done', 'mint', [
    'Phases 0–1 · One app named OSAT, one place your notes live',
    'Phases 2–3 · The desk over your Mac, one way around it',
    'Phase 3b · A calm day: Next, Undo, the evening questions',
    'Phase 4 · The AI sets itself up and runs on this Mac',
    'Phases 5–6 · iPhone capture, and devices in step through iCloud',
    'Phase 7 · Polish, and Undo everywhere',
    'Phase 8 · Your Mac’s files in OSAT, and the quick chat',
    'Phase 9 · One desk: rooms pop out beside the line',
    'Phase 10 · One line for everything, widgets that open up',
  ]],
  ['Now · Phase 11', 'canary', [
    'The canvas is a whiteboard: topics anywhere, zoom out forever',
    'Write @Garden in any note and it links to that topic',
    'Open a topic to see its branches as lanes',
    'Stickies on the desk: double-click to write one, drag it into a topic',
    'Offline: one switch on the line, nothing leaves OSAT',
    'Help me sort: a branch suggested for every sticky',
    'Clean light and dark, in the Mac’s own accent color',
    'Esc never hides the desk; only the shortcut does',
  ]],
  ['Next · Phase 12', 'sky', [
    'Hyper key: Caps Lock + a letter (V clipboard, S find files, C Chrome)',
    'Keywords in the line: type ss, press Return, Spotify opens',
    'The ring: ⌘ + middle-click opens quick tools around the pointer',
    'Clipboard history, from Stash',
    'Window snapping like Rectangle, from WindowFlow',
    'Tools as a wheel you scroll, with what each one does',
    'Move the dock anywhere; resize widgets and icons; snap to a grid',
    'Any tool full screen',
    'Settings: online, semi-offline or offline',
  ]],
  ['Later', 'lilac', [
    'Connectors: Apple Mail first, then Gmail in the browser, then Outlook',
    'Calendar and Reminders from the Mac',
    'Messages beside OSAT',
    'A photo of paper stickies becomes stickies (the Mac reads the handwriting)',
    'iPad: GoodNotes-style pages and the Apple Pencil Pro squeeze ring, synced to the Mac',
    'iPhone: a document scanner',
    'OSAT’s own agents',
  ]],
  ['Questions', 'rose', [
    'A switchboard for what may use the internet or the cloud: where should it live?',
    'Which tools should the ring hold first?',
  ]],
]

export function seedDirection(state) {
  const seeded = { ...(state.settings?.seeded || {}), direction: true }
  const marked = { ...state, settings: { ...(state.settings || {}), seeded } }
  if (state.settings?.seeded?.direction) return state
  if (state.folders.some((folder) => folder.name === 'Project Direction' && !folder.parentId)) return marked
  let next = marked
  const node = addFolder(next, 'Project Direction', null, 0)
  next = { ...node.state, folders: node.state.folders.map((folder) => (folder.id === node.folder.id ? { ...folder, color: 'sky' } : folder)) }
  for (const [name, color, stickies] of BRANCHES) {
    const branch = addFolder(next, name, node.folder.id)
    next = { ...branch.state, folders: branch.state.folders.map((folder) => (folder.id === branch.folder.id ? { ...folder, color } : folder)) }
    for (const text of stickies) next = addSticky(next, text, branch.folder.id, { source: 'OSAT', index: Infinity }).state
  }
  return next
}
