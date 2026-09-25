import test from 'node:test'
import assert from 'node:assert/strict'
import { addNextStep, nextSteps, toggleNextStep } from '../src/next-steps.js'
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

test('a next step goes onto the day\'s page, which is created once and survives normalization', () => {
  const once = addNextStep(createDefaultWorkspace(), 'Call it done', '2026-09-10')
  const normalized = normalizeWorkspace(once)
  const day = normalized.notes.find((note) => note.id === 'day-2026-09-10')
  assert.equal(day.kind, 'day')
  assert.equal(day.date, '2026-09-10')
  assert.equal(nextSteps(normalized.notes)[0].text, 'Call it done')
  const twice = addNextStep(normalized, 'Second step', '2026-09-10')
  assert.equal(twice.notes.filter((note) => note.kind === 'day').length, 1)
  assert.equal(twice.notes.find((note) => note.id === 'day-2026-09-10').markdown, '- [ ] Call it done\n- [ ] Second step')
  assert.equal(addNextStep(twice, '  ', '2026-09-10'), twice)
})

test('a step added to a trashed day brings the page back', () => {
  const day = { id: 'day-2026-09-24', kind: 'day', date: '2026-09-24', title: 'Thursday', markdown: '', tags: [], trashedAt: '2026-09-24T01:00:00Z', archived: true }
  const next = addNextStep(normalizeWorkspace({ notes: [day] }), 'Water the plants', '2026-09-24').notes[0]
  assert.equal(next.trashedAt, null)
  assert.equal(next.archived, false)
  assert.ok(nextSteps([next]).some((step) => step.text === 'Water the plants'))
})
