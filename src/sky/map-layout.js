/* The Sky as a mind map (Phase 27), after Nate's Mindmap: an open node (or a branch on the
   Sky on its own) spreads out around its card. Its branches and stickies hang off it on
   both sides, joined by curved lines, and each branch's own things hang further out. A
   folded branch keeps its things tucked away. Something moved by hand keeps where it hangs
   off its parent (`at`, from the parent's top-left corner, schema 10); the rest are laid out
   in rank order, and Tidy lays everything out again. Pure: sizes come from the cards as they
   were last measured (MAP's until then). */

import { folderChildren, folderSubtree } from '../notes-model.js'
import { pileOf } from '../nodes-model.js'

export const MAP = { gapX: 72, gapY: 14, folder: { w: 180, h: 48 }, note: { w: 200, h: 80 } }

/* What hangs off a folder, in order: its branches, then its own stickies. */
export function childrenOf(state, folderId) {
  return [
    ...folderChildren(state.folders, folderId).map((folder) => ({ key: folder.id, kind: 'folder', record: folder })),
    ...pileOf(state.notes, folderId).map((note) => ({ key: `note:${note.id}`, kind: 'note', record: note })),
  ]
}

/* Where every card of an open tree goes: Map key → { x, y, w, h, parent, side, kind, record }
   (a folder's key is its id, a sticky's 'note:<id>'). `origin` is the root card's top-left
   corner on the board; `side` is 1 for the right, -1 for the left, 0 for the root. */
export function layoutTree(state, root, origin, { sizes = new Map(), folds = new Set() } = {}) {
  const boxes = new Map()
  const sizeOf = (item) => sizes.get(item.key) || MAP[item.kind]
  const kidsOf = (item) => (item.kind === 'folder' && !folds.has(item.record.id) ? childrenOf(state, item.record.id) : [])
  const heights = new Map()
  // The room a card takes with what is laid out off it.
  const roomOf = (item) => {
    if (!heights.has(item.key)) {
      const kids = kidsOf(item).filter((kid) => !kid.record.at)
      const column = kids.reduce((sum, kid) => sum + roomOf(kid), 0) + Math.max(0, kids.length - 1) * MAP.gapY
      heights.set(item.key, Math.max(sizeOf(item).h, column))
    }
    return heights.get(item.key)
  }

  const put = (item, x, y, parent, side) => {
    if (boxes.has(item.key)) return
    const box = { x, y, ...sizeOf(item), parent, side, kind: item.kind, record: item.record }
    boxes.set(item.key, box)
    const kids = kidsOf(item)
    // Moved by hand: where it was left, on the side it lies.
    kids.filter((kid) => kid.record.at).forEach((kid) => {
      const at = kid.record.at
      put(kid, x + at.x, y + at.y, item.key, at.x + sizeOf(kid).w / 2 < box.w / 2 ? -1 : 1)
    })
    const auto = kids.filter((kid) => !kid.record.at)
    if (!auto.length) return
    // The root's things are shared between its two sides, about half the height each.
    const columns = side ? [[side, auto]] : balance(auto)
    for (const [dir, list] of columns) {
      const column = list.reduce((sum, kid) => sum + roomOf(kid), 0) + (list.length - 1) * MAP.gapY
      let top = y + box.h / 2 - column / 2
      for (const kid of list) {
        const size = sizeOf(kid)
        const room = roomOf(kid)
        put(kid, dir > 0 ? x + box.w + MAP.gapX : x - MAP.gapX - size.w, top + (room - size.h) / 2, item.key, dir)
        top += room + MAP.gapY
      }
    }
  }
  const balance = (list) => {
    const total = list.reduce((sum, kid) => sum + roomOf(kid), 0)
    const right = []
    const left = []
    let used = 0
    list.forEach((kid) => {
      if (!right.length || used + roomOf(kid) / 2 <= total / 2) right.push(kid)
      else left.push(kid)
      used += roomOf(kid)
    })
    return [[1, right], [-1, left]].filter(([, items]) => items.length)
  }

  put({ key: root.id, kind: 'folder', record: root }, origin.x, origin.y, null, 0)
  return boxes
}

/* The keys of a card and everything laid out off it. */
export function branchOf(boxes, key) {
  const out = new Set([key])
  let grew = true
  while (grew) {
    grew = false
    boxes.forEach((box, id) => {
      if (box.parent && out.has(box.parent) && !out.has(id)) { out.add(id); grew = true }
    })
  }
  return out
}

/* Tidy: everything in a node (or a branch) laid out again, in rank order; the node itself
   stays where it is. */
export function tidyTree(state, rootId) {
  const inside = folderSubtree(state.folders, rootId)
  const without = (item) => {
    const { at, ...rest } = item
    return rest
  }
  const folders = state.folders.map((folder) => (folder.id !== rootId && inside.has(folder.id) && folder.at ? without(folder) : folder))
  const notes = state.notes.map((note) => (inside.has(note.folderId) && note.at ? without(note) : note))
  return { ...state, folders, notes }
}

/* Where a card of a tree is left when dropped at `point` (its top-left corner, in board
   points): kept from its parent's corner. */
export const hangAt = (parentBox, point) => ({ x: Math.round(point.x - parentBox.x), y: Math.round(point.y - parentBox.y) })
