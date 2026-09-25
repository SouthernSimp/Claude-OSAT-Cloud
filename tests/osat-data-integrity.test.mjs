import test from 'node:test'
import assert from 'node:assert/strict'

import {
  importLegacyStorage,
  normalizeWorkspace,
  parseBudgetCsv,
  createDefaultWorkspace,
  readWorkspaceBackup,
} from '../src/osat-data.js'

function storageSpy(entries) {
  const values = new Map(entries)
  const writes = []
  return {
    values,
    writes,
    storage: {
      get length() { return values.size },
      key(index) { return [...values.keys()][index] ?? null },
      getItem(key) { return values.has(key) ? values.get(key) : null },
      setItem(...args) { writes.push(['setItem', ...args]) },
      removeItem(...args) { writes.push(['removeItem', ...args]) },
      clear(...args) { writes.push(['clear', ...args]) },
    },
  }
}

test('legacy import preserves IDs, text, geometry, weekly habits, and source keys', () => {
  const capture = { id: 'capture-fixed', title: '  NateOS capture  ', summary: 'summary  \n', source: 'source\n', createdAt: '2026-08-01T00:00:00.000Z' }
  const records = [{ id: 'journal-fixed', type: 'journal', title: '  NateOS journal  ', summary: 'NateOS summary  \n', body: 'body\n\n', built: ['NateOS task  '], createdAt: '2026-08-02T00:00:00.000Z' }]
  const projects = [{ id: 'project-fixed', title: '  NateOS project  ', summary: 'NateOS project summary\n', status: 'active', url: '', folder: '/tmp/NateOS folder', folderGrantId: 'grant-fixed', createdAt: '2026-08-03T00:00:00.000Z' }]
  const canvas = { nodes: [{ id: 'node-fixed', sourceId: 'note-fixed', kind: 'note', title: '  NateOS node  ', body: 'first line  \nNateOS body\n', x: 101.25, y: -42.5, w: 333, h: 177, color: 'lilac', rot: 1.25 }] }
  const habits = [{ id: 'habit-shared', name: 'Primary habit', type: 'build', doneDates: ['2026-08-30'] }]
  const weeklyHabits = [
    { id: 'habit-shared', name: 'Weekly duplicate', type: 'build', doneDates: ['2026-08-31'] },
    { id: 'habit-weekly', name: 'Flossing every night before bed', type: 'build', doneDates: [] },
  ]
  const rawEntries = [
    ['nateos.capture', JSON.stringify(capture)],
    ['nateos.records.v1', JSON.stringify(records)],
    ['nateos.projects.v1', JSON.stringify(projects)],
    ['nateos.canvas.v1', JSON.stringify(canvas)],
    ['nateos.habits.v1', JSON.stringify(habits)],
    ['nateos.habits.v1w', JSON.stringify(weeklyHabits)],
  ]
  const spy = storageSpy(rawEntries)
  const before = [...spy.values]

  const state = importLegacyStorage(spy.storage, '2026-09-01T00:00:00.000Z')

  assert.deepEqual([...spy.values], before)
  assert.deepEqual(spy.writes, [])
  assert.equal(state.legacySnapshot['nateos.habits.v1w'], rawEntries.at(-1)[1])
  assert.deepEqual(state.capture, capture)
  assert.deepEqual(state.records.find(({ id }) => id === 'journal-fixed'), records[0])
  assert.deepEqual(state.projects.find(({ id }) => id === 'project-fixed'), projects[0])
  const importedNote = state.notes.find(({ id }) => id === 'note-fixed')
  assert.equal(importedNote.title, canvas.nodes[0].title)
  assert.equal(importedNote.markdown, canvas.nodes[0].body)
  assert.deepEqual(state.mindmap.nodes.find(({ id }) => id === 'node-fixed'), { id: 'node-fixed', entityType: 'note', entityId: 'note-fixed' })
  assert.deepEqual(state.mindmap.geometry['node-fixed'], { x: 101.25, y: -42.5, w: 333, h: 177, color: 'lilac', rot: 1.25 })
  assert.deepEqual(state.sorter.boards[0].notes.map(({ id }) => id), ['note-fixed'])
  assert.deepEqual(state.habits.find(({ id }) => id === 'habit-shared'), { id: 'habit-shared', name: 'Primary habit', type: 'build', doneDates: ['2026-08-30', '2026-08-31'] })
  assert.equal(state.habits.find(({ id }) => id === 'habit-weekly').name, 'Flossing every night before bed')
})

test('unterminated quoted CSV fails closed', () => {
  const result = parseBudgetCsv('date,label,amount\n2026-09-01,"Coffee,12.00\n2026-09-02,Lunch,10.00')
  assert.deepEqual(result.rows, [])
  assert.match(result.errors[0], /unterminated quoted field/i)
})

test('restore accepts V1 and V2 backups but rejects incomplete or damaged notes before replacement', () => {
  const workspace = createDefaultWorkspace()
  workspace.notes = [{ id: 'kept', title: 'Keep me', markdown: '# Exact\n\n- [ ] Text  \n' }]
  const backup = { format: 'osat-local-backup', version: 1, workspace }
  for (const schema of [1, 2]) {
    const restored = readWorkspaceBackup({ ...backup, workspace: { ...workspace, schema } })
    assert.equal(restored.notes[0].id, 'kept')
    assert.equal(restored.notes[0].markdown, workspace.notes[0].markdown)
  }
  for (const invalid of [null, 'bad', {}, { ...workspace, notes: null }, { ...workspace, notes: [null] },
    { ...workspace, notes: [{ id: 'kept', markdown: 42 }] }, { ...workspace, notes: [...workspace.notes, ...workspace.notes] },
    { ...workspace, schema: 99 }, { ...workspace, calendar: {} }]) {
    assert.throws(() => readWorkspaceBackup({ ...backup, workspace: invalid }), /workspace has not changed/)
  }
  assert.throws(() => readWorkspaceBackup({ ...backup, version: 99 }), /unsupported/)
  assert.equal(workspace.notes.length, 1)
})
