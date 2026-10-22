import assert from 'node:assert/strict'
import test from 'node:test'

import { addCanvas, boardOfLink, kanbanElement, kanbanLink, middleOf, normalizeCanvases, removeCanvas, renameCanvas, saveElements, stickySkeleton } from '../src/canvas/canvas-model.js'
import { normalizeWorkspace } from '../src/osat-data.js'
import { applyOps, createEmptyDoc, diffDocs, migrate, SCHEMA, validateOps } from '../shared/store-core.mjs'

const NOW = '2026-10-22T12:00:00.000Z'
const el = (id, version = 1, more = {}) => ({ id, type: 'rectangle', version, x: 0, y: 0, ...more })

test('schema 17: every workspace gets an empty list of canvases; one already there is kept', () => {
  assert.ok(SCHEMA >= 17)
  assert.deepEqual(migrate({ schema: 16, notes: [], folders: [] }).canvases, [])
  const kept = [{ id: 'canvas-1', name: 'Plan', elements: [] }]
  assert.deepEqual(migrate({ schema: 16, notes: [], folders: [], canvases: kept }).canvases, kept)
  assert.deepEqual(createEmptyDoc().canvases, [])
})

test('make, rename and remove a canvas; a blank name is never kept', () => {
  const { state, canvas } = addCanvas({ canvases: [] }, '  Q4 plan ', NOW)
  assert.equal(canvas.name, 'Q4 plan')
  assert.match(canvas.id, /^canvas-/)
  assert.equal(addCanvas({}, '   ', NOW).canvas.name, 'Canvas')
  assert.equal(renameCanvas(state, canvas.id, '  ').canvases[0].name, 'Q4 plan')
  assert.equal(renameCanvas(state, canvas.id, 'Launch').canvases[0].name, 'Launch')
  assert.deepEqual(removeCanvas(state, canvas.id).canvases, [])
})

test('saving keeps what is drawn, drops what was deleted, and changes nothing when nothing moved', () => {
  const { state, canvas } = addCanvas({ canvases: [] }, 'Plan', NOW)
  const saved = saveElements(state, canvas.id, [el('a'), el('b', 2, { isDeleted: true })], NOW)
  assert.deepEqual(saved.canvases[0].elements.map((item) => item.id), ['a'])
  assert.equal(saveElements(saved, canvas.id, [el('a')], NOW), saved, 'same versions: no write')
  assert.notEqual(saveElements(saved, canvas.id, [el('a', 2)], NOW), saved)
  assert.equal(saveElements(saved, 'missing', [el('z')], NOW), saved)
})

test('a canvas travels through the store as small ops, like any other record', () => {
  const before = { ...createEmptyDoc(), schema: SCHEMA }
  const { state, canvas } = addCanvas(before, 'Plan', NOW)
  const after = saveElements(state, canvas.id, [el('a')], NOW)
  const ops = validateOps(diffDocs(before, after))
  assert.ok(ops.every((op) => op.c === 'canvases'))
  assert.deepEqual(applyOps(before, ops).doc.canvases, after.canvases)
})

test('a kanban on a canvas names its board, and only an OSAT board link counts', () => {
  assert.equal(boardOfLink(kanbanLink('folder-abc')), 'folder-abc')
  for (const link of ['https://evil.example/board/x', 'osat://board/../x', 'osat://board/', null]) assert.equal(boardOfLink(link), null, String(link))
  const made = kanbanElement(el('k'), 'folder-abc')
  assert.equal(made.type, 'embeddable')
  assert.equal(boardOfLink(made.link), 'folder-abc')
})

test('a new sticky lands in the middle of what is on screen, the next one a little lower', () => {
  const view = { width: 1000, height: 600, scrollX: -100, scrollY: 50, zoom: { value: 2 } }
  assert.deepEqual(middleOf(view), { x: 350, y: 100 })
  assert.deepEqual(middleOf(view, 1), { x: 374, y: 124 })
  const sticky = stickySkeleton({ x: 350, y: 100 }, 'Call Sam')
  assert.equal(sticky.label.text, 'Call Sam')
  assert.equal(sticky.x + sticky.width / 2, 350)
})

test('damaged canvases are dropped or mended when a workspace opens', () => {
  const canvases = normalizeCanvases([{ id: 'c1', name: '', elements: [el('a'), null, 'x'] }, { id: 'c1' }, { name: 'no id' }, null])
  assert.deepEqual(canvases.map((canvas) => [canvas.id, canvas.name, canvas.elements.length]), [['c1', 'Canvas', 1]])
  assert.deepEqual(normalizeWorkspace({ canvases: [{ id: 'c2', name: 'Ideas', elements: [] }] }).canvases.map((canvas) => canvas.name), ['Ideas'])
})
