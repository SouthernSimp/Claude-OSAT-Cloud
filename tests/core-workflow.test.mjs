import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { boardMap } from '../src/assistant/board-context.js'
import { notesForQuestion } from '../src/assistant/work-scope.js'
import { normalizeChat, notesContext } from '../src/assistant/chats.js'
import { findSky } from '../src/sky/find.js'
import { applyUnpackProposal, undoUnpackProposal } from '../src/sky/unpack-proposal.js'
import { draftJournal } from '../src/store/recovery.js'
import { notePreview } from '../src/notes-model.js'

const folder = (id, name, parentId = null) => ({ id, name, parentId })
const note = (id, title, folderId = null, extra = {}) => ({ id, title, markdown: title, tags: [], folderId, ...extra })
const workspace = () => normalizeWorkspace({ ...createDefaultWorkspace(),
  folders: [folder('garden', 'Garden'), folder('beds', 'Raised beds', 'garden'), folder('business', 'Client work')],
  notes: [note('focused', 'Buy seeds', 'garden'), note('branch', 'Build the raised beds', 'beds'), note('other', 'Client contract', 'business'), ...Array.from({ length: 200 }, (_, i) => note(`unfiled-${i}`, `Unsorted thought ${i} `.padEnd(100, 'x'), null, { unsorted: true }))],
})

test('200 unrelated captures cannot crowd the focused topic out of the AI map', () => {
  const map = boardMap(workspace(), { where: 'sky', focus: 'garden', open: ['business'], maxChars: 2000 })
  assert.match(map, /Open in the Sky: Garden/)
  assert.match(map, /Buy seeds/)
  assert.match(map, /Raised beds/)
  assert.ok(map.indexOf('Garden') < map.indexOf('Unsorted thought'))
  assert.ok(map.length <= 2000)
})

test('topic scope includes descendants and excludes unrelated and trashed notes', () => {
  const state = workspace()
  state.notes.push(note('gone', 'Deleted garden note', 'garden', { trashedAt: '2026-10-03' }))
  assert.deepEqual(notesForQuestion(state, 'Summarize this', { scope: 'focus', focus: 'garden' }).map((item) => item.id).sort(), ['branch', 'focused'])
  const map = boardMap(state, { focus: 'beds', scope: 'focus' })
  assert.match(map, /Raised beds|Build the raised beds/)
  assert.doesNotMatch(map, /Client work|Client contract|Unsorted thought|Buy seeds/)
})

test('no-notes scope contains neither bodies nor workspace titles', () => {
  const state = workspace()
  assert.deepEqual(notesForQuestion(state, 'garden seeds', { scope: 'none' }), [])
  const map = boardMap(state, { scope: 'none', focus: 'garden', open: ['business'] })
  assert.doesNotMatch(map, /Garden|Client|seeds|Unsorted/)
})

test('focused board context respects the actual shared sources and removed source chips', () => {
  const state = workspace()
  const map = boardMap(state, { scope: 'focus', focus: 'garden', noteIds: ['focused'] })
  assert.match(map, /Buy seeds/)
  assert.doesNotMatch(map, /Build the raised beds|Client contract|Unsorted thought/)
  const withoutSources = boardMap(state, { scope: 'focus', focus: 'garden', noteIds: [] })
  assert.doesNotMatch(withoutSources, /Buy seeds|Build the raised beds/)
})

test('Sky finds nodes, nested branches, note content and tags using the desk matching rules', () => {
  const state = workspace()
  state.notes[0].tags = ['garden']
  assert.equal(findSky(state, 'Garden')[0].type, 'Node')
  const branch = findSky(state, 'Raised beds').find((row) => row.type === 'Branch')
  assert.equal(branch.go[1].folderId, 'beds')
  assert.match(branch.hint, /Garden/)
  assert.deepEqual(findSky(state, '#garden').map((row) => row.key), ['note:focused'])
  assert.deepEqual(findSky(state, 'definitely missing'), [])
  assert.deepEqual(findSky(state, ''), [])
})

test('the conversation remembers topic and no-notes scopes after normalization', () => {
  const chat = { id: 'c', messages: [], contextScope: { kind: 'focus', folderId: 'garden' } }
  assert.deepEqual(normalizeChat(chat).contextScope, chat.contextScope)
  assert.deepEqual(normalizeChat({ ...chat, contextScope: { kind: 'none' } }).contextScope, { kind: 'none' })
  assert.equal(normalizeChat({ ...chat, contextScope: { kind: 'invalid' } }).contextScope, undefined)
})

test('unpack proposals apply only on acceptance and preserve existing text', () => {
  const state = workspace()
  state.folders[0].packed = true
  const before = structuredClone(state)
  const made = applyUnpackProposal(state, 'garden', '## Spring\n- Sow lettuce\n## Tools\n- Find the rake')
  assert.deepEqual(state, before)
  assert.equal(made.folders.length, 2)
  assert.equal(made.notes.length, 2)
  assert.equal(made.state.notes.find((item) => item.id === 'focused').markdown, 'Buy seeds')
  assert.throws(() => applyUnpackProposal(state, 'missing', '## X\n- Y'), /changed/)
  assert.throws(() => applyUnpackProposal(state, 'garden', 'nothing useful'), /didn’t suggest/)
})

test('undo of AI unpack never throws away later writing or unrelated edits', () => {
  const state = workspace()
  state.folders[0].packed = true
  const made = applyUnpackProposal(state, 'garden', '## Spring\n- Sow lettuce\n- Order compost')
  const editedId = made.notes[0]
  const edited = { ...made.state, notes: made.state.notes.map((item) => item.id === editedId ? { ...item, markdown: 'My new writing', title: 'Changed' } : item.id === 'other' ? { ...item, markdown: 'New client details' } : item) }
  const undone = undoUnpackProposal(edited, made)
  assert.equal(undone.notes.find((item) => item.id === editedId).markdown, 'My new writing')
  assert.equal(undone.notes.find((item) => item.id === editedId).folderId, 'garden')
  assert.equal(undone.notes.find((item) => item.id === 'other').markdown, 'New client details')
  assert.ok(!undone.notes.some((item) => item.id === made.notes[1]))
  assert.ok(!undone.folders.some((item) => made.folders.includes(item.id)))
})

test('a recovery journal validates operations and removes only its own temporary key', () => {
  const values = new Map([['legacy', 'keep']])
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  const journal = draftJournal(storage, 'draft')
  const value = { ops: [{ t: 'patch', c: 'notes', id: 'a', v: { markdown: 'Keep writing' } }], workspace: workspace() }
  journal.write(value)
  assert.deepEqual(journal.read().ops, value.ops)
  journal.clear()
  assert.equal(values.get('legacy'), 'keep')
  assert.equal(journal.read(), null)
})

test('note previews skip only a repeated opening title and preserve the source byte for byte', () => {
  const value = note('n', 'Trip', null, { markdown: 'Trip\n\nBook the train\n- [ ] Pack a bag' })
  assert.equal(notePreview(value), 'Book the train ☐ Pack a bag')
  assert.equal(value.markdown, 'Trip\n\nBook the train\n- [ ] Pack a bag')
  assert.equal(notePreview({ ...value, title: 'A different title' }), 'Trip Book the train ☐ Pack a bag')
})
