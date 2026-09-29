/* A node file: what a bot (Muse, Grok Bot, Claude) or Nate saves for OSAT to turn into
   one new node. Two shapes, read the same way everywhere (the drop folder, the Sky's
   Import, the connector):
     JSON      { title, summary, source, branches: [{ title, summary, leaves: [{ text,
               done }], sub_branches: [...] }], leaves: [...] } (the Sky's Import format)
     Markdown  "# Title", then the summary; "## Branch" (and "### " inside it); list items
               are stickies ("- [x] …" a finished one). Front matter may name the source.
   A node with only a title and a summary is *packed*: it arrives as a New node, to be
   unpacked later (by hand, or with the AI). Pure: shared by main, the windows and tests. */

import { normalizeNote, rankOf } from './note-core.mjs'

export const NODE_FILE_TYPES = ['.json', '.md', '.markdown', '.txt']

const GAP = 1024
const LIMITS = { depth: 8, branches: 300, stickies: 1000, text: 8000, name: 80, title: 72, summary: 8000, source: 40 }

export class NodeFileError extends Error {
  constructor(message = 'That file isn’t a node file.') {
    super(message)
    this.name = 'NodeFileError'
  }
}

const text = (value, max = LIMITS.text) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : '')
const oneLine = (value, max) => text(value, max * 4).replace(/\s+/g, ' ').trim().slice(0, max)

/* A node file's data, checked and trimmed to one shape:
   { title, summary, source, leaves: [{ text, done }], branches: [same, without source] }.
   Throws NodeFileError when there is no title, or branches aren't a list. */
export function nodeTree(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new NodeFileError()
  const title = oneLine(data.title, LIMITS.title) || oneLine(data.name, LIMITS.title)
  if (!title || (data.branches !== undefined && !Array.isArray(data.branches))) throw new NodeFileError()
  const count = { branches: 0, stickies: 0 }
  const leavesOf = (source) => (Array.isArray(source.leaves) ? source.leaves : []).flatMap((leaf) => {
    const words = text(typeof leaf === 'string' ? leaf : leaf?.text)
    if (!words || count.stickies >= LIMITS.stickies) return []
    count.stickies += 1
    // A day it names (a scan's), offered to the Calendar; normalizeNote checks it.
    const event = leaf?.event && typeof leaf.event === 'object' && !Array.isArray(leaf.event) ? leaf.event : null
    return [{ text: words, done: leaf?.done === true, ...(event ? { event } : {}) }]
  })
  const branchesOf = (source, depth) => {
    if (depth >= LIMITS.depth) return []
    const list = [...(Array.isArray(source.branches) ? source.branches : []), ...(Array.isArray(source.sub_branches) ? source.sub_branches : [])]
    return list.flatMap((branch) => {
      const name = oneLine(branch?.title, LIMITS.name) || oneLine(branch?.name, LIMITS.name)
      if (!name || count.branches >= LIMITS.branches) return []
      count.branches += 1
      return [{ title: name, summary: text(branch.summary, LIMITS.summary), leaves: leavesOf(branch), branches: branchesOf(branch, depth + 1) }]
    })
  }
  return {
    title,
    summary: text(data.summary, LIMITS.summary),
    source: oneLine(data.source, LIMITS.source),
    leaves: leavesOf(data),
    branches: branchesOf(data, 0),
  }
}

/* Only a title and a summary: it waits, packed, to be unpacked. */
export const isPacked = (tree) => !tree.branches.length && !tree.leaves.length

const LIST_ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

/* Markdown (or plain text) as a node file's data. With no "# " heading, the first line
   is the title. Front matter ("---" lines at the top) may say `source: Muse`. */
export function markdownTree(value) {
  let lines = String(value || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  let source = ''
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const match = /^\s*(source|from)\s*:\s*(.+)$/i.exec(line)
        if (match) source = match[2].replace(/^["']|["']$/g, '')
      }
      lines = lines.slice(end + 1)
    }
  }
  const root = { title: '', summary: [], leaves: [], branches: [], level: 1 }
  const stack = [root]
  let fence = false
  let item = null // the sticky being written: indented lines under it belong to it
  for (const line of lines) {
    const current = stack[stack.length - 1]
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const heading = !fence && HEADING.exec(line)
    if (heading) {
      item = null
      const level = heading[1].length
      const name = heading[2].trim()
      if (level === 1 && !root.title) { root.title = name; continue }
      if (level === 1) { current.summary.push(line); continue }
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop()
      const branch = { title: name, summary: [], leaves: [], branches: [], level }
      stack[stack.length - 1].branches.push(branch)
      stack.push(branch)
      continue
    }
    // Indented lines under a sticky (a sub-list, a second paragraph) stay part of it.
    if (!fence && item && line.trim() && /^\s{2,}/.test(line)) { item.text += `\n${line.replace(/^\s{2,}/, '')}`; continue }
    const listed = !fence && LIST_ITEM.exec(line)
    if (listed) {
      item = { text: listed[2], done: /x/i.test(listed[1] || '') }
      current.leaves.push(item)
      continue
    }
    item = null
    current.summary.push(line)
  }
  if (!root.title) {
    const first = root.summary.findIndex((line) => line.trim())
    if (first >= 0) {
      root.title = root.summary[first].replace(/^#+\s*/, '').trim()
      root.summary.splice(0, first + 1)
    }
  }
  const plain = (node) => ({
    title: node.title,
    summary: node.summary.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    leaves: node.leaves,
    branches: node.branches.map(plain),
  })
  return nodeTree({ ...plain(root), source })
}

/* The file as it was saved: JSON when it is JSON, Markdown or plain text otherwise. */
export function readNodeFile(value, name = '') {
  const body = String(value || '').replace(/^﻿/, '')
  if (!body.trim()) throw new NodeFileError('That file is empty.')
  if (/\.json$/i.test(name) || /^\s*[{[]/.test(body)) {
    let data
    try {
      data = JSON.parse(body)
    } catch {
      throw new NodeFileError('That file isn’t valid JSON.')
    }
    return nodeTree(data)
  }
  return markdownTree(body)
}

/* `name`, or "name 2", "name 3"… when a node is already called that. */
export function freeNodeName(folders, name) {
  const taken = new Set(folders.filter((folder) => !folder.parentId).map((folder) => String(folder.name).toLowerCase()))
  const base = String(name || '').trim().slice(0, LIMITS.title) || 'Imported'
  if (!taken.has(base.toLowerCase())) return base
  let n = 2
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1
  return `${base} ${n}`
}

const titleOf = (value) => value.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'A sticky'

/* The records that make one new node at the end of the Sky from a node file's tree: the
   node, its branches (a summary is the first sticky where it is, then the leaves), in the
   order written. Never merged into a node that's there (a taken name gets "2").
   `makeId(prefix)` names each record; `node` adds fields to the node itself (packed, fresh,
   from). Returns { folder, folders, notes }. */
export function nodeRecords(folders, tree, { now = new Date().toISOString(), makeId, source = 'Import', node = {} } = {}) {
  const top = folders.filter((folder) => !folder.parentId)
  const last = top.length ? Math.max(...top.map(rankOf)) : 0
  const folder = { id: makeId('folder'), name: freeNodeName(folders, tree.title), parentId: null, createdAt: now, collapsed: false, rank: last + GAP, ...node }
  const made = { folder, folders: [folder], notes: [] }
  const fill = (part, folderId) => {
    const pile = [
      ...(part.summary ? [{ words: part.summary }] : []),
      ...part.leaves.map((leaf) => ({ words: leaf.done ? `- [x] ${leaf.text}` : leaf.text, event: leaf.event })),
    ]
    pile.forEach(({ words, event }, index) => {
      made.notes.push(normalizeNote({
        id: makeId('note'), title: titleOf(words), markdown: words, folderId, unsorted: false, source, createdAt: now, updatedAt: now, rank: (index + 1) * GAP,
        ...(event ? { ask: { event } } : {}),
      }))
    })
    part.branches.forEach((branch, index) => {
      const child = { id: makeId('folder'), name: branch.title, parentId: folderId, createdAt: now, collapsed: false, rank: (index + 1) * GAP }
      made.folders.push(child)
      fill(branch, child.id)
    })
  }
  fill(tree, folder.id)
  return made
}

/* Where an arriving node says it came from, kept on the node: who sent it (`source`, shown
   quietly), the file's name and a fingerprint of what it said (`hash`, so the same file
   saved twice makes one node), and for a scan its copy (`scan`) and the name and summary
   the AI proposes until they're confirmed (`proposal`). */
export function fromOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const from = {}
  const source = oneLine(value.source, LIMITS.source)
  const file = oneLine(value.file, 160)
  if (source) from.source = source
  if (file) from.file = file
  if (typeof value.hash === 'string' && /^[a-f0-9]{16,128}$/.test(value.hash)) from.hash = value.hash
  if (typeof value.scan === 'string' && /^scan-[A-Za-z0-9_-]{1,80}\.[a-z0-9]{2,5}$/.test(value.scan)) from.scan = value.scan
  const name = oneLine(value.proposal?.name, LIMITS.name)
  if (name) from.proposal = { name, summary: text(value.proposal.summary, 1600) }
  return Object.keys(from).length ? from : null
}

/* The node already made from the same file (same fingerprint), if it is still there. */
export const sameFile = (folders, hash) => (hash ? folders.find((folder) => !folder.parentId && folder.from?.hash === hash) || null : null)

/* The store operations that bring a node file (or a scan: `scan` is OSAT's copy of it) into
   the workspace as a New node (packed when it's only a summary), or { duplicate } when the
   same file already made one. */
export function arrivalOps(doc, tree, { hash, file, source, scan, now, makeId }) {
  const folders = Array.isArray(doc.folders) ? doc.folders : []
  const duplicate = sameFile(folders, hash)
  if (duplicate) return { duplicate }
  const from = fromOf({ source: tree.source || source, file, hash, scan })
  const made = nodeRecords(folders, tree, {
    now,
    makeId,
    source: tree.source || source || 'Drop folder',
    node: { fresh: true, ...(isPacked(tree) ? { packed: true } : {}), ...(from ? { from } : {}) },
  })
  return {
    folder: made.folder,
    ops: [
      ...made.folders.map((value) => ({ t: 'add', c: 'folders', v: value })),
      ...made.notes.map((value) => ({ t: 'add', c: 'notes', v: value, at: 0 })),
    ],
  }
}

/* What a bot needs to know to write a node file OSAT can read, in plain words. */
export function botInstructions(folder) {
  return `Saving a node for OSAT

Save one file per node in this folder:
${folder}

OSAT turns each file into a node in its Sky within a few seconds, then moves the file to
"Added" in the same folder. Nothing is ever deleted. A file OSAT can't read moves to
"Set aside" instead. Use a new file name each time; saving the exact same file twice makes
only one node.

Markdown (.md) is easiest:

---
source: Muse
---
# Garden plan
One or two sentences on what this node is about.

## Beds
- Tomatoes along the fence
- [x] Dig the first bed

## Herbs
- Basil by the kitchen door

"# " is the node's name. The words under it are its summary. "## " starts a branch
("### " a branch inside it). Each list item is a sticky; "- [x]" is a finished one.
The source line (between the "---" lines) says who sent it; OSAT shows it quietly.

A packed node: just the "# " name and a summary, no branches or list items. It arrives
marked New, and Nate unpacks it in OSAT when he's ready (by hand, or with the AI):

---
source: Muse
---
# Ideas for the spring launch
A short paragraph with everything worth keeping. OSAT keeps it as the node's first
sticky and can unpack it into branches later.

JSON (.json) works too:

{
  "title": "Garden plan",
  "source": "Muse",
  "summary": "One or two sentences on what this node is about.",
  "branches": [
    { "title": "Beds", "leaves": [{ "text": "Tomatoes along the fence" }, { "text": "Dig the first bed", "done": true }] },
    { "title": "Herbs", "leaves": ["Basil by the kitchen door"] }
  ]
}

A packed node in JSON is only "title", "source" and "summary".
`
}
