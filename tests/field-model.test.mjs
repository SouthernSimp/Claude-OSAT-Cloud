import assert from 'node:assert/strict'
import test from 'node:test'
import { WARM, buildSkyGraph, freeSpot, constellationLabels, dayPhase, fitCamera, homeItems, paperFields, paperPose, paperWrite, pickSurfacing, restSurfacing, runSky, stepSky } from '../src/field/field-model.js'

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

test('an old note asked for by "See in the Sky" still gets a star', () => {
  const notes = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, title: `N${i}`, markdown: '', tags: [], updatedAt: `2026-09-2${i}T00:00:00.000Z` }))
  assert.deepEqual(buildSkyGraph(notes, undefined, 3).nodes.map((node) => node.id).sort(), ['n2', 'n3', 'n4'])
  const kept = buildSkyGraph(notes, undefined, 3, 'n0').nodes.map((node) => node.id)
  assert.equal(kept.length, 3)
  assert.ok(kept.includes('n0'))
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

test('home icons put pinned notes and nodes first, and count what does not fit', () => {
  const note = (id, updatedAt, extra = {}) => ({ id, title: id, markdown: id, updatedAt, trashedAt: null, archived: false, ...extra })
  const notes = [
    note('old', '2026-09-01T00:00:00Z'),
    note('new', '2026-09-20T00:00:00Z'),
    note('pinned', '2026-08-01T00:00:00Z', { pinned: true }),
    note('day-2026-09-23', '2026-09-23T00:00:00Z', { kind: 'day', date: '2026-09-23' }),
    note('gone', '2026-09-22T00:00:00Z', { trashedAt: '2026-09-22T01:00:00Z' }),
  ]
  const folders = [{ id: 'f-b', name: 'Work', parentId: null }, { id: 'f-a', name: 'Life', parentId: null }, { id: 'f-c', name: 'Inner', parentId: 'f-a' }]
  const all = homeItems({ notes, folders })
  assert.deepEqual(all.map((item) => item.id), ['pinned', 'f-a', 'f-b', 'new', 'old'])
  const cut = homeItems({ notes, folders }, 4)
  assert.deepEqual(cut.map((item) => item.id), ['pinned', 'f-a', 'f-b', 'more'])
  assert.equal(cut[3].count, 2)
  assert.deepEqual(homeItems({ notes: [], folders: [] }, 6), [])
  // A sticky already out on the desk, and one on the scratch page, aren't icons too.
  const scratch = note('scratch', '2026-09-24T00:00:00Z', { kind: 'scratch' })
  assert.deepEqual(homeItems({ notes: [...notes, scratch], folders: [] }, Infinity, new Set(['new'])).map((item) => item.id), ['pinned', 'old'])
})

test('loose thoughts gather into one pile and only a few recent notes stay out', () => {
  const note = (id, day, extra = {}) => ({ id, title: id, markdown: id, updatedAt: `2026-09-${String(day).padStart(2, '0')}T00:00:00Z`, trashedAt: null, archived: false, ...extra })
  const notes = [
    note('loose-1', 20, { unsorted: true }),
    note('loose-2', 19, { unsorted: true }),
    ...Array.from({ length: 8 }, (_, index) => note(`kept-${index}`, 10 - index)),
    note('filed', 21, { folderId: 'f' }),
  ]
  const items = homeItems({ notes, folders: [] })
  assert.deepEqual(items.map((item) => item.kind), ['pile', ...Array(WARM).fill('note')])
  assert.deepEqual(items[0].notes.map((item) => item.id), ['loose-1', 'loose-2'])
  // Only notes in no node; one in a node is found in its node.
  assert.deepEqual(items.slice(1).map((item) => item.id), ['kept-0', 'kept-1', 'kept-2', 'kept-3'])
  // One loose thought is just a note; no pile of one.
  assert.equal(homeItems({ notes: [notes[0]], folders: [] })[0].kind, 'note')
})

test('the sky fits its stars and their names into the window', () => {
  const stars = [{ x: 0, y: 0 }, { x: 300, y: 200 }]
  for (const [w, h] of [[1120, 700], [420, 300]]) {
    const cam = fitCamera(stars, w, h)
    for (const star of stars) {
      assert.ok(star.x * cam.z + cam.x >= 0, 'a star is off the left')
      assert.ok((star.x + 200) * cam.z + cam.x <= w, 'a name runs off the right')
    }
  }
})

test('from before brings back an older note that fits this week\'s writing', () => {
  const today = '2026-09-27'
  const note = (id, title, markdown, created, updated = created, extra = {}) => ({ id, title, markdown, createdAt: `${created}T09:00:00.000Z`, updatedAt: `${updated}T09:00:00.000Z`, trashedAt: null, archived: false, ...extra })
  const notes = [
    note('week', 'Tomato seedlings', 'Moved the tomato seedlings to the garden bed', '2026-09-25'),
    note('garden', 'Garden plan', 'Where the tomato beds and the garden path go', '2026-06-01'),
    note('taxes', 'Tax forms', 'Receipts for the quarter', '2026-05-01'),
    note('young', 'Tomato ideas', 'More tomato garden thoughts', '2026-09-10'),
    note('touched', 'Old garden notes', 'Tomato garden, edited this week', '2026-04-01', '2026-09-26'),
    note('day-2026-07-01', 'Wednesday, July 1', 'Tomato garden day', '2026-07-01', '2026-07-01', { kind: 'day' }),
    note('binned', 'Garden bin', 'tomato garden', '2026-04-01', '2026-04-01', { trashedAt: '2026-05-01T00:00:00.000Z' }),
  ]
  assert.equal(pickSurfacing(notes, today).id, 'garden', 'old and related wins; young, touched, day and binned notes never come back')
  // Resting after "Not now": the pick moves on, and comes back once 30 days have passed.
  assert.equal(pickSurfacing(notes, today, { garden: '2026-09-20' }).id, 'taxes')
  assert.equal(pickSurfacing(notes, today, { garden: '2026-08-20' }).id, 'garden')
  // With nothing related, one pick for the whole day, whatever order the notes come in.
  const quiet = notes.filter((item) => item.id !== 'week')
  const pick = pickSurfacing(quiet, today).id
  assert.ok(['garden', 'taxes'].includes(pick))
  assert.equal(pickSurfacing([...quiet].reverse(), today).id, pick)
  assert.equal(pickSurfacing(notes.slice(3), today), null, 'nothing old enough')
})

test('not now rests a note, and old rests are let go', () => {
  assert.deepEqual(restSurfacing({ a: '2026-08-01', b: '2026-09-20', c: 'soon' }, 'd', '2026-09-27'), { b: '2026-09-20', d: '2026-09-27' })
  assert.deepEqual(restSurfacing(undefined, 'a', '2026-09-27'), { a: '2026-09-27' })
})

test('a new sticky lands in the first clear spot near the line, inside the desk', () => {
  const area = { left: 0, top: 0, right: 1000, bottom: 800 }
  const size = { width: 200, height: 150 }
  assert.deepEqual(freeSpot([], area, size, { x: 400, y: 300 }), { x: 400, y: 300 })
  const taken = [{ left: 380, top: 280, right: 640, bottom: 470 }]
  const spot = freeSpot(taken, area, size, { x: 400, y: 300 })
  const clear = spot.x + 200 + 12 <= 380 || spot.x >= 640 + 12 || spot.y + 150 + 12 <= 280 || spot.y >= 470 + 12
  assert.ok(clear, `clear of what is there: ${JSON.stringify(spot)}`)
  assert.ok(spot.x >= 0 && spot.y >= 0 && spot.x + 200 <= 1000 && spot.y + 150 <= 800)
  // Nowhere clear: it still lands on the desk.
  const full = freeSpot([{ left: -10, top: -10, right: 2000, bottom: 2000 }], area, size, { x: 950, y: 790 })
  assert.deepEqual(full, { x: 800, y: 650 })
})
