/* An explicit sample room. Nothing here is written until the person asks to keep it. */

import { createHabit } from '../daily-practice.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../osat-data.js'
import { isActiveNote } from '../notes-model.js'

const FOLDERS = [
  { id: 'field-folder-room', name: 'The room', parentId: null },
  { id: 'field-folder-work', name: 'Work', parentId: null },
  { id: 'field-folder-life', name: 'Life', parentId: null },
  { id: 'field-folder-ideas', name: 'Ideas', parentId: null },
]

const NOTES = [
  ['field-sample-room', 'The room', 'field-folder-room', 0, '# The room\n\nA private place to put a thought down before it has to be useful. The [[Mindmap]] is the same notes, seen from across the room. #room\n\n- [ ] Leave one true thing on the desk'],
  ['field-sample-mindmap', 'Mindmap', 'field-folder-room', 1, '# Mindmap\n\nEvery card is a real note. Draw a wire when two thoughts belong together. See [[The room]]. #room'],
  ['field-sample-notes', 'Notes that remember', 'field-folder-room', 3, '# Notes that remember\n\nFolders, pins, and links that still point at [[The room]] after a rename. #room'],
  ['field-sample-local', 'Local, on purpose', 'field-folder-room', 2, '# Local, on purpose\n\nThe model runs on this Mac. Nothing is filed unless you ask. [[The room]] #room'],
  ['field-sample-review', 'A calmer review', 'field-folder-room', 4, '# A calmer review\n\nWhat if the week only needed one honest question? [[What if the review asked one question]] #room #ideas'],
  ['field-sample-question', 'What if the review asked one question', 'field-folder-ideas', 1, '# What if the review asked one question\n\nNot a score. A sentence you can answer tired. [[Software should feel like a room]] #ideas'],
  ['field-sample-software', 'Software should feel like a room', 'field-folder-ideas', 2, '# Software should feel like a room\n\nYou should want to come back when your head is loud. [[The room]] #ideas'],
  ['field-sample-threads', 'Keep the loose threads', 'field-folder-ideas', 6, '# Keep the loose threads\n\nNot every thought needs a project. Some just need [[Mindmap]]. #ideas'],
  ['field-sample-mccreery', 'McCreery.ai next chapter', 'field-folder-work', 1, '# McCreery.ai next chapter\n\nProof first. Polish second. [[Proof before polish]] #work'],
  ['field-sample-proof', 'Proof before polish', 'field-folder-work', 2, '# Proof before polish\n\nShow the thing working before the sentence about the thing. [[Launch checklist]] #work'],
  ['field-sample-launch', 'Launch checklist', 'field-folder-work', 3, '# Launch checklist\n\n- [ ] The sentence on the homepage\n- [ ] One proof, visible\n- [ ] A way to begin\n\n[[The sentence on the homepage]] #work'],
  ['field-sample-sentence', 'The sentence on the homepage', 'field-folder-work', 5, '# The sentence on the homepage\n\nIt should sound like a person, not a category. [[McCreery.ai next chapter]] #work'],
  ['field-sample-week', 'This week', 'field-folder-life', 0, '# This week\n\n- [ ] One clear next step\n- [ ] Ten minutes with the guitar\n- [ ] Close the day on purpose\n\n[[Evening reset]] #life'],
  ['field-sample-evening', 'Evening reset', 'field-folder-life', 1, '# Evening reset\n\nOne page. Then leave the desk clear enough to return. [[This week]] #life'],
  ['field-sample-reading', 'Reading list', 'field-folder-life', 9, '# Reading list\n\n- The Shape of Design\n- Make Time\n- A novel with weather in it\n\n#life #reading'],
  ['field-sample-guitar', 'Ten minutes', 'field-folder-life', 2, '# Ten minutes\n\nThe guitar does not care whether the day was useful. [[This week]] #life'],
  ['field-sample-alone', 'A thought with no home yet', null, 8, '# A thought with no home yet\n\nSome stars should stand on their own for a while. #loose'],
]

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString()
}

function buildSampleWorkspace(now = new Date()) {
  const evening = new Date(now)
  evening.setHours(19, 30, 0, 0)
  const notes = NOTES.map(([id, title, folderId, age, markdown]) => ({
    id,
    title,
    folderId,
    pinned: id === 'field-sample-room',
    markdown,
    createdAt: daysAgo(age + 1),
    updatedAt: daysAgo(age),
  }))
  return normalizeWorkspace({
    ...createDefaultWorkspace(now.toISOString()),
    folders: FOLDERS.map((folder) => ({ ...folder, createdAt: daysAgo(12) })),
    notes,
    projects: [
      { id: 'field-sample-project-room', title: 'The room', summary: 'A private place to think', status: 'active' },
      { id: 'field-sample-project-work', title: 'McCreery.ai', summary: 'Proof before polish', status: 'active' },
    ],
    habits: [createHabit('Leave one thing on the desk', 'build', 'field-sample-habit')].filter(Boolean),
    calendar: {
      events: [{
        id: 'field-sample-close',
        title: 'Close the day',
        start: evening.toISOString(),
        end: '',
        notes: 'One page. Then stop.',
      }],
    },
  })
}

let cached = null

function sample() {
  if (!cached) {
    const built = buildSampleWorkspace()
    cached = { notes: built.notes.filter(isActiveNote), events: built.calendar.events, folders: built.folders }
  }
  return cached
}

export const sampleNotes = () => sample().notes
export const sampleEvents = () => sample().events
export const sampleFolders = () => sample().folders

const mergeById = (current, samples) => {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...samples.filter((item) => item && !seen.has(item.id))]
}

export function addFieldSample(current) {
  const existing = normalizeWorkspace(current || createDefaultWorkspace())
  const samples = buildSampleWorkspace()
  return normalizeWorkspace({
    ...existing,
    folders: mergeById(existing.folders, samples.folders),
    notes: mergeById(existing.notes, samples.notes),
    projects: mergeById(existing.projects, samples.projects),
    habits: mergeById(existing.habits, samples.habits),
    calendar: { events: mergeById(existing.calendar.events, samples.calendar.events) },
  })
}

const isSampleId = (id) => String(id || '').startsWith('field-sample-') || String(id || '').startsWith('field-folder-')

export function removeFieldSample(current) {
  const existing = normalizeWorkspace(current || createDefaultWorkspace())
  return normalizeWorkspace({
    ...existing,
    folders: existing.folders.filter((folder) => !isSampleId(folder.id)),
    notes: existing.notes.filter((note) => !isSampleId(note.id)),
    projects: existing.projects.filter((project) => !isSampleId(project.id)),
    habits: existing.habits.filter((habit) => !isSampleId(habit.id)),
    calendar: { events: existing.calendar.events.filter((event) => !isSampleId(event.id)) },
  })
}

export function hasFieldSample(state) {
  return Boolean(state?.notes?.some((note) => String(note.id).startsWith('field-sample-')))
}
