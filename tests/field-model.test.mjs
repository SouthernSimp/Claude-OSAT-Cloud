import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultWorkspace } from '../src/osat-data.js'
import { addFieldSample, hasFieldSample, removeFieldSample } from '../src/field/field-sample.js'
import { buildSkyGraph, constellationLabels, dayPhase, homeItems, paperFields, paperPose, paperWrite, runSky, stepSky } from '../src/field/field-model.js'

test('day phase follows the clock', () => {
  assert.equal(dayPhase(new Date('2026-09-22T08:00:00')), 'morning')
  assert.equal(dayPhase(new Date('2026-09-22T14:00:00')), 'afternoon')
  assert.equal(dayPhase(new Date('2026-09-22T19:00:00')), 'evening')
  assert.equal(dayPhase(new Date('2026-09-22T23:30:00')), 'night')
  assert.equal(dayPhase(new Date('2026-09-22T02:00:00')), 'night')
})

test('paper poses stay on the desk and do not drift between calls', () => {
  const first = paperPose('note-a', 0, 4, false)
  const again = paperPose('note-a', 0, 4, false)
  assert.deepEqual(first, again)
  assert.ok(first.x >= 0 && first.x <= 0.82)
  assert.ok(first.y >= 0 && first.y <= 1)
})

test('the sky links real wikilinks and chains tags instead of clumping them', () => {
  const notes = [
    { id: 'a', title: 'A', markdown: 'See [[B]] #room', tags: ['room'], updatedAt: '2026-09-22T00:00:00.000Z', trashedAt: null, archived: false },
    { id: 'b', title: 'B', markdown: 'Alone #room', tags: ['room'], updatedAt: '2026-09-21T00:00:00.000Z', trashedAt: null, archived: false },
    { id: 'c', title: 'C', markdown: 'Third #room', tags: ['room'], updatedAt: '2026-09-20T00:00:00.000Z', trashedAt: null, archived: false },
  ]
  const graph = buildSkyGraph(notes)
  const wiki = graph.links.filter((link) => link.kind === 'wiki')
  const tags = graph.links.filter((link) => link.kind === 'tag')
  assert.equal(wiki.length, 1)
  assert.ok(tags.length >= 1)
  assert.ok(tags.length < 3)
  assert.ok(graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)))
})

test('linked stars draw toward each other without leaving the numbers', () => {
  const nodes = [
    { id: 'a', x: 100, y: 500, vx: 0, vy: 0, pinned: false },
    { id: 'b', x: 1400, y: 500, vx: 0, vy: 0, pinned: false },
  ]
  const end = runSky(nodes, [{ a: 'a', b: 'b', kind: 'wiki' }], 80)
  const distance = Math.hypot(end[0].x - end[1].x, end[0].y - end[1].y)
  assert.ok(distance < 1300)
  assert.ok(end.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)))
  const pinned = stepSky([{ ...nodes[0], pinned: true }, nodes[1]], [{ a: 'a', b: 'b', kind: 'wiki' }])
  assert.equal(pinned[0].x, 100)
})

test('a constellation name sits above its stars', () => {
  const nodes = [
    { id: 'a', tags: ['room'], x: 100, y: 400 },
    { id: 'b', tags: ['room'], x: 180, y: 460 },
    { id: 'c', tags: ['room'], x: 140, y: 520 },
  ]
  const [label] = constellationLabels(nodes)
  assert.equal(label.tag, 'room')
  assert.ok(label.y < 400)
})

test('a sheet lifts the title off the page and sets the same words back down', () => {
  const note = { title: 'The room', markdown: '# The room\n\nA private place.\n' }
  const fields = paperFields(note)
  assert.equal(fields.title, 'The room')
  assert.equal(fields.body, 'A private place.\n')
  assert.deepEqual(paperWrite(note, fields.title, fields.body), { title: 'The room', markdown: note.markdown })
  assert.equal(paperWrite(note, 'The study', fields.body).markdown, '# The study\n\nA private place.\n')
})

test('a one-line thought stays one line until more is written under it', () => {
  const note = { title: 'Leave it here.', markdown: 'Leave it here.' }
  assert.equal(paperFields(note).body, '')
  assert.deepEqual(paperWrite(note, 'Leave it here.', ''), { title: 'Leave it here.', markdown: 'Leave it here.' })
  assert.deepEqual(paperWrite(note, '   ', ''), { title: 'Leave it here.', markdown: 'Leave it here.' })
  assert.deepEqual(paperWrite(note, 'Leave it here.', 'More of it.'), {
    title: 'Leave it here.',
    markdown: 'Leave it here.\n\nMore of it.',
  })
})

test('a page whose first line is not the title keeps its words', () => {
  const note = { title: 'Morning', markdown: 'Not the title\n\nstill here' }
  assert.equal(paperFields(note).body, note.markdown)
  const written = paperWrite(note, 'Evening', note.markdown)
  assert.equal(written.title, 'Evening')
  assert.equal(written.markdown, note.markdown)
})

test('keeping and removing the sample room is explicit and repeatable', () => {
  const once = addFieldSample(createDefaultWorkspace())
  const twice = addFieldSample(once)
  assert.equal(hasFieldSample(once), true)
  assert.equal(twice.notes.filter((note) => note.id.startsWith('field-sample-')).length, once.notes.filter((note) => note.id.startsWith('field-sample-')).length)
  const cleared = removeFieldSample(twice)
  assert.equal(hasFieldSample(cleared), false)
  assert.ok(cleared.notes.every((note) => !note.id.startsWith('field-sample-')))
})

test('home icons put pinned notes, folders and the mindmap first, and count what does not fit', () => {
  const note = (id, updatedAt, extra = {}) => ({ id, title: id, markdown: id, updatedAt, trashedAt: null, archived: false, ...extra })
  const notes = [
    note('old', '2026-09-01T00:00:00Z'),
    note('new', '2026-09-20T00:00:00Z'),
    note('pinned', '2026-08-01T00:00:00Z', { pinned: true }),
    note('daily-plan-2026-09-23', '2026-09-23T00:00:00Z'),
    note('journal-2026-09-23', '2026-09-23T00:00:00Z'),
    note('gone', '2026-09-22T00:00:00Z', { trashedAt: '2026-09-22T01:00:00Z' }),
  ]
  const folders = [{ id: 'f-b', name: 'Work', parentId: null }, { id: 'f-a', name: 'Life', parentId: null }, { id: 'f-c', name: 'Inner', parentId: 'f-a' }]
  const boards = [{ id: 'osat-board', scope: { kind: 'all' } }]
  const all = homeItems({ notes, folders, boards })
  assert.deepEqual(all.map((item) => item.id), ['pinned', 'f-a', 'f-b', 'osat-board', 'new', 'old'])
  const cut = homeItems({ notes, folders, boards }, 4)
  assert.deepEqual(cut.map((item) => item.id), ['pinned', 'f-a', 'f-b', 'more'])
  assert.equal(cut[3].count, 3)
  assert.deepEqual(homeItems({ notes: [], folders: [], boards: [] }, 6), [])
})
