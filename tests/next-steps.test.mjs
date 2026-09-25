import test from 'node:test'
import assert from 'node:assert/strict'
import { appendNextStep, nextSteps, toggleNextStep } from '../src/next-steps.js'
import { addTourWorkspace, createTourWorkspace } from '../src/experience-tour.js'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'

test('extracts checklists outside fenced code', () => {
  const steps = nextSteps([{ id: 'n1', title: 'Plan', tags: ['work'], markdown: '- [ ] Ship it\n````md\n```md\n- [ ] Ignore me\n````\n- [x] Review it' }])
  assert.deepEqual(steps.map(({ line, text, done, tag }) => ({ line, text, done, tag })), [
    { line: 1, text: 'Ship it', done: false, tag: 'work' },
    { line: 6, text: 'Review it', done: true, tag: 'work' },
  ])
})

test('toggles a matching line while preserving surrounding Markdown', () => {
  const notes = [{ id: 'n1', title: 'Plan', markdown: '# Plan\n\n- [ ] Ship it\nParagraph', updatedAt: '' }]
  const step = nextSteps(notes)[0]
  const changed = toggleNextStep(notes, step, '2026-09-10T12:00:00.000Z')
  assert.equal(changed[0].markdown, '# Plan\n\n- [x] Ship it\nParagraph')
  assert.equal(changed[0].updatedAt, '2026-09-10T12:00:00.000Z')
})

test('rejects stale line updates', () => {
  const notes = [{ id: 'n1', title: 'Plan', markdown: '- [ ] Changed' }]
  assert.deepEqual(toggleNextStep(notes, { noteId: 'n1', line: 1, text: 'Old' }), notes)
})

test('appends to or creates a daily plan and survives normalization', () => {
  const appended = appendNextStep([], 'Call it done', '2026-09-10')
  const normalized = normalizeWorkspace({ ...createDefaultWorkspace(), notes: appended })
  assert.equal(normalized.notes[0].id, 'daily-plan-2026-09-10')
  assert.equal(nextSteps(normalized.notes)[0].text, 'Call it done')
  assert.equal(appendNextStep(appended, 'Second step', '2026-09-10')[0].markdown.includes('Second step'), true)
})

test('tour workspace uses the core schema with demo content', () => {
  const tour = createTourWorkspace()
  assert.equal(tour.notes.length, 7)
  assert.equal(tour.folders.length, 5)
  assert.equal(tour.projects.length, 3)
  assert.equal(tour.records.length, 2)
  assert.equal(nextSteps(tour.notes).length, 11)
  assert.equal(tour.sorter.boards[0].notes.length, 7)
  assert.ok(tour.notes.every((note) => !note.folderId || tour.folders.some((folder) => folder.id === note.folderId)))
})

test('tour merge preserves existing records and local focus state', () => {
  const current = createDefaultWorkspace()
  current.notes = [{ id: 'real-note', title: 'Real note', markdown: '- [ ] Keep me', tags: ['real'] }]
  current.records = [{ id: 'real-capture', type: 'capture', title: 'Real capture', summary: 'Real capture', source: 'Private note', createdAt: '2026-09-10T10:00:00.000Z', status: 'inbox', bookmarked: false }]
  current.capture = current.records[0]
  current.habits = [{ id: 'real-habit', name: 'Real habit', type: 'build', doneDates: [] }]
  current.focus = { status: 'paused', remainingMs: 120000 }
  const merged = addTourWorkspace(current)
  assert.equal(merged.notes.some((note) => note.id === 'real-note'), true)
  assert.equal(merged.records.some((record) => record.id === 'real-capture'), true)
  assert.equal(merged.habits.some((habit) => habit.id === 'real-habit'), true)
  assert.deepEqual(merged.focus, current.focus)
  assert.equal(merged.capture.id, 'real-capture')
})

test('a step added to a trashed plan brings the plan back', () => {
  const plan = { id: 'daily-plan-2026-09-24', title: 'Plan', markdown: '# Today', tags: [], trashedAt: '2026-09-24T01:00:00Z', archived: true }
  const [next] = appendNextStep([plan], 'Water the plants', '2026-09-24')
  assert.equal(next.trashedAt, null)
  assert.equal(next.archived, false)
  assert.ok(nextSteps([next]).some((step) => step.text === 'Water the plants'))
})
