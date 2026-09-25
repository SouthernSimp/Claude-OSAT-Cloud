import { createHabit } from './daily-practice.js'
import { createDefaultWorkspace, normalizeNote, normalizeWorkspace } from './osat-data.js'

/* An explicitly requested sample workspace: a few folders, linked notes with
   next steps, two captures and two habits. Nothing here replaces real records. */

const FOLDERS = [
  { id: 'tour-folder-projects', name: 'Projects', parentId: null },
  { id: 'tour-folder-osat', name: 'OSAT', parentId: 'tour-folder-projects' },
  { id: 'tour-folder-mccreery', name: 'McCreery.ai', parentId: 'tour-folder-projects' },
  { id: 'tour-folder-personal', name: 'Personal', parentId: null },
  { id: 'tour-folder-ideas', name: 'Ideas', parentId: null },
]

export function createTourWorkspace() {
  const base = createDefaultWorkspace()
  const notes = [
    normalizeNote({ id: 'tour-osat-direction', title: 'OSAT direction', folderId: 'tour-folder-osat', pinned: true, markdown: '# OSAT direction\n\nOne private workspace, many useful views. Notes carry the next steps; the [[Mindmap]] is where they get sorted. #osat\n\n- [ ] Keep the workspace calm and local\n- [ ] Make the next action obvious\n- [x] Decide that every card is a real note' }),
    normalizeNote({ id: 'tour-mindmap', title: 'Mindmap', folderId: 'tour-folder-osat', markdown: '# Mindmap\n\nEvery note is a sticky card. Tags colour the paper, frames group the clusters, and wires connect ideas. See [[OSAT direction]] for the why. #osat #design' }),
    normalizeNote({ id: 'tour-mccreery-next', title: 'McCreery.ai next chapter', folderId: 'tour-folder-mccreery', markdown: '# McCreery.ai next chapter\n\nProof first, polish second. #mccreery\n\n- [ ] Shape the next chapter\n- [ ] Review the strongest proof\n- [ ] Draft the [[Launch checklist]]' }),
    normalizeNote({ id: 'tour-launch', title: 'Launch checklist', folderId: 'tour-folder-mccreery', markdown: '# Launch checklist\n\n- [ ] Hero section\n- [ ] Pricing page copy\n- [ ] Announcement note\n\nRelated: [[McCreery.ai next chapter]] #mccreery #launch' }),
    normalizeNote({ id: 'tour-thought', title: 'A thought worth keeping', folderId: 'tour-folder-ideas', markdown: '# A thought worth keeping\n\nWhat if the weekly review only asked one question? #ideas\n\n- [ ] Give this idea a quiet place to grow' }),
    normalizeNote({ id: 'tour-reading', title: 'Reading list', folderId: 'tour-folder-personal', markdown: '# Reading list\n\n- Deep Work\n- The Shape of Design\n- Make Time #personal #reading' }),
    normalizeNote({ id: 'daily-plan-tour', title: 'Today’s next steps', tags: ['today'], markdown: '# Today\n\n- [ ] Choose one clear next step' }),
  ]
  const captures = [
    { id: 'tour-capture-1', type: 'capture', title: 'A calmer way to review the day', summary: 'A calmer way to review the day', source: 'Tour example', createdAt: '2026-09-10T09:00:00.000Z', status: 'inbox', bookmarked: false },
    { id: 'tour-capture-2', type: 'capture', title: 'Save the useful thread for later', summary: 'Save the useful thread for later', source: 'Tour example', createdAt: '2026-09-10T08:30:00.000Z', status: 'inbox', bookmarked: false },
  ]
  return normalizeWorkspace({
    ...base,
    capture: captures[0],
    records: captures,
    folders: FOLDERS.map((folder) => ({ ...folder, createdAt: '2026-09-10T08:00:00.000Z' })),
    notes,
    projects: [
      { id: 'nateos', title: 'OSAT', summary: 'Private local-first workspace', status: 'active' },
      { id: 'tour-project-mccreery', title: 'McCreery.ai', summary: 'The next chapter', status: 'active' },
      { id: 'tour-project-personal', title: 'Personal', summary: 'Life and ideas', status: 'active' },
    ],
    habits: [createHabit('Make one clear next step', 'build', 'tour-habit-build'), createHabit('Avoid unnecessary noise', 'avoid', 'tour-habit-avoid')],
  })
}

const mergeById = (current, samples) => {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...samples.filter((item) => !seen.has(item.id))]
}

export function addTourWorkspace(current) {
  const existing = normalizeWorkspace(current || createDefaultWorkspace())
  const samples = createTourWorkspace()
  return normalizeWorkspace({
    ...existing,
    folders: mergeById(existing.folders, samples.folders),
    notes: mergeById(existing.notes, samples.notes),
    projects: mergeById(existing.projects, samples.projects),
    records: mergeById(existing.records, samples.records),
    habits: mergeById(existing.habits, samples.habits),
  })
}
