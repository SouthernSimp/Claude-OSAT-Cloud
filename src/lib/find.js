import { folderPath, isActiveNote, parseQuery } from '../notes-model.js'
import { EVERYWHERE, SPACES } from './spaces.js'

/* What the desk's line finds as you type: notes, files on this Mac (Spotlight's answers,
   passed in as `files`), nodes and branches, projects, rooms and a few actions. Plain rows
   `{ key, label, hint, kind, go: [view, detail] }`; the line runs `navigate(...go)`.
   An empty query is "Jump to": the latest notes and the spaces. Under, only notes. */

const LIMIT = 5
const PLACE = { desktop: 'Desktop', documents: 'Documents', downloads: 'Downloads' }

// Other words each action answers to, so ⌘K finds it the way Nate would say it.
const ACTIONS = [
  { key: 'act:new-note', label: 'New note', also: 'write page', go: ['Notes', { action: 'new' }] },
  { key: 'act:today', label: 'Today’s note', also: 'journal day page', go: ['Notes', { action: 'today' }] },
  { key: 'act:new-folder', label: 'New node', also: 'folder group pile project', go: ['Mindmap', { action: 'new-node' }] },
  { key: 'act:board', label: 'Open the Sky', also: 'map mindmap nodes board sort', go: ['Mindmap'] },
  { key: 'act:sky', label: 'See every note as a star', also: 'stars constellation sky graph', go: ['Sky'] },
  { key: 'act:focus', label: 'Focus for 25 minutes', also: 'timer pomodoro quiet concentrate', go: ['Focus'] },
  { key: 'act:widget', label: 'Add a widget', hint: 'Calendar, Next, Focus, Habits…', also: 'widgets tray', go: ['Widgets'] },
  { key: 'act:under', label: 'Go under', hint: 'Incognito · OSAT with the internet off', also: 'incognito offline private', go: ['Under'] },
]

const newest = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))

// Rooms and actions match by the start of their words: "cal" finds Calendar, "end" doesn't.
const startsWords = (text, words) => {
  const own = text.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  return words.length > 0 && words.every((word) => own.some((part) => part.startsWith(word)))
}

function noteRow(workspace, note) {
  return { key: `note:${note.id}`, label: note.title || 'Untitled note', hint: folderPath(workspace.folders, note.folderId).join(' / '), kind: 'note', go: ['Notes', { noteId: note.id }] }
}

function fileRow(item) {
  const parent = item.relative.split('/').slice(0, -1)
  return {
    key: `file:${item.rootId}:${item.relative}`,
    label: item.name,
    hint: [PLACE[item.rootId] || 'Your folder', ...parent].join(' / '),
    kind: item.kind === 'folder' ? 'mac-folder' : 'file',
    go: ['Files', item.kind === 'folder'
      ? { rootId: item.rootId, relative: item.relative }
      : { rootId: item.rootId, relative: parent.join('/'), select: item.relative }],
  }
}

export function findAll(workspace, query, { files = [], under = false } = {}) {
  const notes = workspace.notes.filter(isActiveNote)
  const q = String(query || '').trim().toLowerCase()
  if (!q) {
    const latest = [...notes].sort(newest).slice(0, 4).map((note) => noteRow(workspace, note))
    if (under) return latest
    return [...latest, ...SPACES.filter((space) => space.id !== 'Today').map((space) => ({ key: `room:${space.id}`, label: space.label, hint: space.hint, kind: 'room', go: [space.id] }))]
  }

  const { tags, words } = parseQuery(q)
  const found = notes
    .filter((note) => tags.every((tag) => note.tags.includes(tag)))
    .filter((note) => words.every((word) => `${note.title}\n${note.markdown}`.toLowerCase().includes(word)))
    .sort((a, b) => Number(b.title.toLowerCase().includes(q)) - Number(a.title.toLowerCase().includes(q)) || newest(a, b))
    .map((note) => noteRow(workspace, note))
  if (under) return found.slice(0, LIMIT)
  if (tags.length) return found.slice(0, LIMIT)

  const places = [
    ...EVERYWHERE.filter((route) => route.id !== 'Today' && startsWords(route.label, words))
      .map((route) => ({ key: `room:${route.id}`, label: route.label, hint: route.hint, kind: 'room', go: [route.id] })),
    ...ACTIONS.filter((action) => startsWords(`${action.label} ${action.also}`, words))
      .map(({ key, label, hint = '', go }) => ({ key, label, hint, kind: 'action', go })),
  ]
  const macFiles = files.map(fileRow)
  // Nodes and branches open laid out in the Sky.
  const folders = workspace.folders.filter((folder) => folder.name.toLowerCase().includes(q))
    .map((folder) => ({ key: `folder:${folder.id}`, label: folder.name, hint: folder.parentId ? folderPath(workspace.folders, folder.parentId).join(' › ') : 'Node', kind: 'folder', go: ['Mindmap', { folderId: folder.id }] }))
  const projects = (workspace.projects || []).filter((project) => `${project.title} ${project.summary}`.toLowerCase().includes(q))
    .map((project) => ({ key: `project:${project.id}`, label: project.title, hint: 'Project', kind: 'project', go: ['Projects'] }))
  // Notes leave room for files on this Mac once Spotlight answers.
  return [...places, ...found.slice(0, macFiles.length ? 3 : LIMIT), ...macFiles, ...folders, ...projects].slice(0, LIMIT)
}
