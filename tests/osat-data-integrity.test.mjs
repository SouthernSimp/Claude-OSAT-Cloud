import test from 'node:test'
import assert from 'node:assert/strict'

import { createDefaultWorkspace, makeBackup, normalizeWorkspace, parseBudgetCsv, readWorkspaceBackup } from '../src/osat-data.js'

test('a fresh workspace has one desk board and nothing seeded', () => {
  const workspace = createDefaultWorkspace()
  assert.deepEqual(workspace.notes, [])
  assert.deepEqual(workspace.projects, [])
  assert.equal(workspace.sorter.boards.length, 1)
  assert.equal(workspace.sorter.boards[0].scope.kind, 'all')
  for (const gone of ['records', 'capture', 'savedIds', 'legacySnapshot', 'mindmap', 'importedLegacyAt']) assert.equal(gone in workspace, false, gone)
})

test('normalizing a normalized workspace changes nothing', () => {
  const once = normalizeWorkspace({ ...createDefaultWorkspace(), notes: [{ id: 'n', title: 'N', markdown: 'x #tag', unsorted: true, source: 'Overlay' }] })
  assert.deepEqual(normalizeWorkspace(once), once)
  assert.equal(once.notes[0].unsorted, true)
  assert.equal(once.notes[0].source, 'Overlay')
})

test('unterminated quoted CSV fails closed', () => {
  const result = parseBudgetCsv('date,label,amount\n2026-09-01,"Coffee,12.00\n2026-09-02,Lunch,10.00')
  assert.deepEqual(result.rows, [])
  assert.match(result.errors[0], /unterminated quoted field/i)
})

test('a backup restores exactly, and damaged backups are rejected before anything is replaced', () => {
  const workspace = { ...createDefaultWorkspace(), notes: [{ id: 'kept', title: 'Keep me', markdown: '# Exact\n\n- [ ] Text  \n' }] }
  const backup = makeBackup(workspace)
  assert.equal('rev' in backup.workspace, false)
  const restored = readWorkspaceBackup(JSON.parse(JSON.stringify(backup)))
  assert.equal(restored.notes[0].id, 'kept')
  assert.equal(restored.notes[0].markdown, workspace.notes[0].markdown)
  for (const invalid of [null, 'bad', {}, { ...backup.workspace, notes: null }, { ...backup.workspace, notes: [null] },
    { ...backup.workspace, notes: [{ id: 'kept', markdown: 42 }] }, { ...backup.workspace, notes: [...workspace.notes, ...workspace.notes] },
    { ...backup.workspace, schema: 99 }, { ...backup.workspace, schema: 2 }]) {
    assert.throws(() => readWorkspaceBackup({ ...backup, workspace: invalid }), /workspace has not changed/)
  }
  assert.throws(() => readWorkspaceBackup({ ...backup, format: 'osat-local-backup' }), /unsupported/)
  assert.throws(() => readWorkspaceBackup({ ...backup, version: 99 }), /unsupported/)
})
