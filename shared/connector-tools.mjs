/* The OSAT connector's tools (desktop/bots/connector.cjs serves them over MCP, and as a plain
   web API, on this Mac only): list the topics, read one, find stickies by their words, add a
   topic, add, change, move and delete stickies, add and rename branches and topics, read and
   write in the journal, read and add to OSAT's calendar, and find files on this Mac.
   Pure: each takes the workspace and the arguments a bot sent, and gives back the words to
   answer with and the store operations to make (main commits them, so the windows, Undo
   and sync see every change). Names work as well as ids, since that is how bots talk; a
   sticky named by words must be the only one holding them, never a guess. */

import { arrivalOps, markdownTree, nodeTree, NodeFileError } from './node-file.mjs'
import { normalizeNote, parseTags, rankOf } from './note-core.mjs'

const MAX_TEXT = 8000
const GAP = 1024
const clean = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/* MCP's hints (spec 2025-06-18). Read-only tools only look; a destructive one takes words
   away (Undo still brings them back); an idempotent one does nothing more the second time. */
const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
const hints = (destructiveHint, idempotentHint) => ({ readOnlyHint: false, destructiveHint, idempotentHint })
const STICKY = { type: 'string', description: 'The sticky’s id (search shows ids, like note-12), or words only that sticky holds.' }
const NODE = { type: 'string', description: 'The topic’s name (or id). The argument is called node, OSAT’s older word for a topic.' }

export const TOOLS = [
  {
    name: 'list_nodes',
    title: 'List nodes',
    description: 'Lists the nodes in OSAT (the top-level topics in its Sky), with their branches and how many stickies each holds, and how many stickies wait in Unsorted.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READS,
  },
  {
    name: 'read_node',
    title: 'Read a node',
    description: 'Reads one node as Markdown: "# " its name, its own stickies as list items, then each branch as "## " (a branch inside one as "### ") with its stickies. Use "Unsorted" to read the stickies that are in no node.',
    inputSchema: { type: 'object', properties: { node: { type: 'string', description: 'The node’s name (or id), or "Unsorted".' } }, required: ['node'], additionalProperties: false },
    annotations: READS,
  },
  {
    name: 'add_node',
    title: 'Add a node',
    description: 'Adds a new node to OSAT’s Sky, marked New. Give a title and a summary; branches (each with a title and leaves, the stickies) are optional. A node with only a title and a summary arrives packed, for Nate to unpack when he is ready. Or give the whole node as Markdown ("# Title", summary, "## Branch", "- sticky"). Adding the very same node twice makes it once.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The node’s name.' },
        summary: { type: 'string', description: 'What it is about, in a sentence or a paragraph.' },
        branches: {
          type: 'array',
          description: 'Optional branches, in order.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              summary: { type: 'string' },
              leaves: { type: 'array', items: { type: 'string' }, description: 'Its stickies, one line or a short paragraph each.' },
            },
            required: ['title'],
          },
        },
        markdown: { type: 'string', description: 'Instead of the fields above: the whole node as Markdown.' },
        source: { type: 'string', description: 'Who is sending it, shown quietly on the node (for example "Claude").' },
      },
      additionalProperties: false,
    },
    annotations: hints(false, true),
  },
  {
    name: 'add_sticky',
    title: 'Add a sticky',
    description: 'Adds one sticky (a short note) to a node, to a branch of it, or, with no node given, to Unsorted.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The sticky’s words. The first line is its title.' },
        node: { type: 'string', description: 'The node’s name (or id). Leave out for Unsorted.' },
        branch: { type: 'string', description: 'A branch of that node, by name (or id).' },
        source: { type: 'string', description: 'Who is sending it (for example "Claude").' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: hints(false, false),
  },
  {
    name: 'edit_sticky',
    title: 'Change a sticky',
    description: 'Replaces the words of one sticky. Its first line becomes its title. Name the sticky by its id or by words only it holds; if several hold them, nothing changes and you are shown their ids. Nate can undo it in OSAT.',
    inputSchema: {
      type: 'object',
      properties: { sticky: STICKY, text: { type: 'string', description: 'The sticky’s new words, all of them.' } },
      required: ['sticky', 'text'],
      additionalProperties: false,
    },
    annotations: hints(true, true),
  },
  {
    name: 'move_sticky',
    title: 'Move a sticky',
    description: 'Files one sticky into a topic (the node argument) or one of its branches, at the end of its stickies; with no node given, it goes back to Unsorted. This is how a sticky waiting in Unsorted gets filed. Nate can undo it in OSAT.',
    inputSchema: {
      type: 'object',
      properties: {
        sticky: STICKY,
        node: { ...NODE, description: `${NODE.description} Leave out to put the sticky back in Unsorted.` },
        branch: { type: 'string', description: 'A branch of that topic, by name (or id).' },
      },
      required: ['sticky'],
      additionalProperties: false,
    },
    annotations: hints(false, true),
  },
  {
    name: 'delete_sticky',
    title: 'Delete a sticky',
    description: 'Deletes one sticky: it moves to the Trash in OSAT’s Notes, where Nate can restore it. Name it by its id or by words only it holds.',
    inputSchema: { type: 'object', properties: { sticky: STICKY }, required: ['sticky'], additionalProperties: false },
    annotations: hints(true, true),
  },
  {
    name: 'add_branch',
    title: 'Add a branch',
    description: 'Adds a branch (a group of stickies) to a topic (the node argument), or inside one of its branches. A branch of that name already there is used instead of making a second one.',
    inputSchema: {
      type: 'object',
      properties: {
        node: NODE,
        title: { type: 'string', description: 'The branch’s name.' },
        inside: { type: 'string', description: 'Optional: a branch of that topic to put the new one inside, by name (or id).' },
      },
      required: ['node', 'title'],
      additionalProperties: false,
    },
    annotations: hints(false, true),
  },
  {
    name: 'rename',
    title: 'Rename a topic or branch',
    description: 'Renames a topic (the node argument), or, with branch given, one of its branches. Only the name changes; everything in it and every link to it stays.',
    inputSchema: {
      type: 'object',
      properties: {
        node: NODE,
        branch: { type: 'string', description: 'Optional: the branch of that topic to rename, by name (or id).' },
        name: { type: 'string', description: 'The new name.' },
      },
      required: ['node', 'name'],
      additionalProperties: false,
    },
    annotations: hints(false, true),
  },
  {
    name: 'search',
    title: 'Find stickies',
    description: 'Finds stickies and journal pages that hold every word asked for (any case), newest first, each with its id and where it lives. With no words, gives the newest ones. Use it before adding, to see what is already there, and to get the id of a sticky to change, move or delete.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The words to look for. Leave out for the newest stickies.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many to give back (10 if left out).' },
      },
      additionalProperties: false,
    },
    annotations: READS,
  },
  {
    name: 'read_journal',
    title: 'Read the journal',
    description: 'Reads one day of the journal (OSAT keeps one page a day), today if no date is given.',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'The day, as YYYY-MM-DD. Leave out for today.' } }, additionalProperties: false },
    annotations: READS,
  },
  {
    name: 'add_to_journal',
    title: 'Write in the journal',
    description: 'Adds a line (or a few) to the end of today’s journal page, or another day’s.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to add.' },
        date: { type: 'string', description: 'The day, as YYYY-MM-DD. Leave out for today.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: hints(false, false),
  },
  {
    name: 'list_events',
    title: 'List calendar events',
    description: 'Lists the events on OSAT’s own calendar (not the Mac’s Calendar app), one a line with its id, day and time on this Mac’s clock. From today through the next 7 days unless other days are given.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'The first day, as YYYY-MM-DD. Leave out for today.' },
        to: { type: 'string', description: 'The last day, as YYYY-MM-DD. Leave out for 7 days after the first.' },
      },
      additionalProperties: false,
    },
    annotations: READS,
  },
  {
    name: 'add_event',
    title: 'Add a calendar event',
    description: 'Adds an event to OSAT’s own calendar. Times are on this Mac’s clock: YYYY-MM-DDTHH:MM for a time, or YYYY-MM-DD for the whole day. Without an end, a timed event lasts an hour and a whole-day one the day.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What it is.' },
        start: { type: 'string', description: 'When it starts: YYYY-MM-DDTHH:MM, or YYYY-MM-DD for the whole day.' },
        end: { type: 'string', description: 'Optional: when it ends, the same way.' },
        notes: { type: 'string', description: 'Optional: a few words more.' },
      },
      required: ['title', 'start'],
      additionalProperties: false,
    },
    annotations: hints(false, false),
  },
  {
    name: 'find_files',
    title: 'Find files',
    description: 'Finds files on this Mac by their name or the words inside, in plain words (for example "taxes pdf last week"), in the places OSAT may look. Gives each file’s name, kind, where it is and when it last changed. It never opens or changes a file.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many to give back (10 if left out).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: READS,
  },
]

/* True for a tool that only looks (an app allowed only to read may use these). */
export const isReadOnly = (name) => TOOLS.find((tool) => tool.name === name)?.annotations.readOnlyHint === true

export class ToolError extends Error {}

const active = (note) => note && !note.trashedAt && !note.archived && !note.kind
const childrenOf = (folders, parentId) => folders.filter((folder) => (folder.parentId || null) === (parentId || null)).sort((a, b) => rankOf(a) - rankOf(b) || String(a.name).localeCompare(String(b.name)))
const pile = (notes, folderId) => notes.filter((note) => active(note) && (note.folderId || null) === (folderId || null)).sort((a, b) => rankOf(a) - rankOf(b))
const subtree = (folders, id) => {
  const ids = new Set([id])
  for (let grew = true; grew;) {
    grew = false
    for (const folder of folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); grew = true }
  }
  return ids
}
const titleOf = (text) => text.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'A sticky'
const limitOf = (limit) => Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 10))
const andMore = (count, shown) => (count > shown ? `\n\n…and ${count - shown} more.` : '')

/* A folder under `parentId` by id or by name (any case). */
function findIn(folders, parentId, wanted) {
  const value = clean(wanted, 120)
  if (!value) return null
  const list = childrenOf(folders, parentId)
  return list.find((folder) => folder.id === value) || list.find((folder) => folder.name.toLowerCase() === value.toLowerCase()) || null
}

function nodeOrSay(folders, wanted) {
  const node = findIn(folders, null, wanted) || folders.find((folder) => folder.id === clean(wanted, 200)) || null
  if (node) return node
  const names = childrenOf(folders, null).map((folder) => folder.name)
  throw new ToolError(`There is no node called “${clean(wanted, 80)}”.${names.length ? ` The nodes are: ${names.join(', ')}.` : ' There are no nodes yet.'}`)
}

/* A branch anywhere inside `node`, by id or name (any case). */
function branchOrSay(folders, node, wanted) {
  const inside = subtree(folders, node.id)
  const branches = folders.filter((folder) => inside.has(folder.id) && folder.id !== node.id)
  const value = clean(wanted)
  const branch = branches.find((folder) => folder.id === value || folder.name.toLowerCase() === value.toLowerCase())
  if (branch) return branch
  const names = branches.map((folder) => folder.name)
  throw new ToolError(`“${node.name}” has no branch called “${clean(wanted, 80)}”.${names.length ? ` Its branches are: ${names.join(', ')}.` : ' It has no branches yet.'}`)
}

/* A folder's place in words: "Garden › Beds". */
function pathOf(folders, id) {
  const names = []
  for (let folder = folders.find((item) => item.id === id); folder && names.length < 8; folder = folders.find((item) => item.id === folder.parentId)) names.unshift(folder.name)
  return names.join(' › ')
}

/* Where a sticky goes: a topic, a branch of it, or with neither given, Unsorted. */
function placeOrSay(folders, { node, branch }) {
  if (!clean(node)) {
    if (clean(branch)) throw new ToolError('Say which node the branch is in.')
    return { target: null, where: 'Unsorted' }
  }
  const home = nodeOrSay(folders, node)
  const target = clean(branch) ? branchOrSay(folders, home, branch) : home
  return { target, where: pathOf(folders, target.id) }
}

/* One sticky, by its id or by words only it holds (every word, any case, as search reads
   them; a sticky whose title is exactly those words wins over ones that merely hold them). */
function stickyOrSay(doc, wanted) {
  const value = clean(wanted, 400)
  if (!value) throw new ToolError('Say which sticky, by its id or by words it holds.')
  const live = (doc.notes || []).filter(active)
  const byId = live.find((note) => note.id === value)
  if (byId) return byId
  const words = value.toLowerCase().split(/\s+/)
  const holding = live.filter((note) => { const text = `${note.title}\n${note.markdown}`.toLowerCase(); return words.every((word) => text.includes(word)) })
  const exact = holding.filter((note) => note.title.trim().toLowerCase() === value.toLowerCase())
  const one = holding.length === 1 ? holding : exact
  if (one.length === 1) return one[0]
  const quoted = clean(wanted, 80)
  if (!holding.length) throw new ToolError(`No sticky holds “${quoted}”.`)
  const lines = holding.slice(0, 5).map((note) => `- (${note.id}) ${note.title.slice(0, 80)}`)
  throw new ToolError(`${holding.length} stickies hold “${quoted}”:\n${lines.join('\n')}${holding.length > 5 ? `\n…and ${holding.length - 5} more.` : ''}\nSay which by its id.`)
}

function listNodes(doc) {
  const folders = doc.folders || []
  const notes = doc.notes || []
  const nodes = childrenOf(folders, null)
  const unsorted = notes.filter((note) => active(note) && !note.folderId).length
  if (!nodes.length) return `There are no nodes yet. ${unsorted} ${unsorted === 1 ? 'sticky waits' : 'stickies wait'} in Unsorted.`
  const lines = nodes.map((node) => {
    const inside = subtree(folders, node.id)
    const count = notes.filter((note) => active(note) && inside.has(note.folderId)).length
    const branches = childrenOf(folders, node.id).map((branch) => branch.name)
    const marks = [node.fresh && 'New', node.packed && 'packed', node.from?.source && `from ${node.from.source}`].filter(Boolean)
    return `- ${node.name}${marks.length ? ` (${marks.join(', ')})` : ''}: ${count} ${count === 1 ? 'sticky' : 'stickies'}${branches.length ? `; branches: ${branches.join(', ')}` : ''}`
  })
  return `${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'} in OSAT:\n${lines.join('\n')}\n\nUnsorted: ${unsorted} ${unsorted === 1 ? 'sticky' : 'stickies'}.`
}

const item = (note) => `- ${note.markdown.trim().replace(/\n/g, '\n  ')}`

function readNode(doc, { node: wanted }) {
  const folders = doc.folders || []
  const notes = doc.notes || []
  if (/^unsorted$/i.test(clean(wanted, 40))) {
    const loose = pile(notes, null)
    return loose.length ? `# Unsorted\n\n${loose.map(item).join('\n')}` : '# Unsorted\n\nNothing waits in Unsorted.'
  }
  const node = nodeOrSay(folders, wanted)
  const out = [`# ${node.name}`]
  const own = pile(notes, node.id)
  if (own.length) out.push('', own.map(item).join('\n'))
  const walk = (parentId, depth) => {
    for (const branch of childrenOf(folders, parentId)) {
      out.push('', `${'#'.repeat(Math.min(6, depth + 2))} ${branch.name}`)
      const stickies = pile(notes, branch.id)
      if (stickies.length) out.push(stickies.map(item).join('\n'))
      walk(branch.id, depth + 1)
    }
  }
  walk(node.id, 0)
  return out.join('\n')
}

/* A short fingerprint of what was sent, so the same node sent twice makes one node. */
function fingerprint(value) {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${(value.length >>> 0).toString(16).padStart(8, '0')}`
}

function addNode(doc, args, { now, makeId, source }) {
  let tree
  try {
    tree = clean(args.markdown, 200000) ? markdownTree(args.markdown) : nodeTree({ ...args, source: args.source || source })
  } catch (error) {
    if (error instanceof NodeFileError) throw new ToolError('A node needs a title (or Markdown starting with "# " and its name).')
    throw error
  }
  const from = clean(args.source, 40) || tree.source || source
  const result = arrivalOps(doc, { ...tree, source: from }, { hash: fingerprint(JSON.stringify({ ...tree, source: '' })), file: '', source: from, now, makeId })
  if (result.duplicate) return { text: `“${result.duplicate.name}” is already in OSAT, so nothing new was made.` }
  const packed = result.folder.packed ? ' It is packed (only a summary so far), for Nate to unpack when he is ready.' : ''
  return { text: `Added the node “${result.folder.name}” (${result.folder.id}) to the Sky, marked New.${packed}`, ops: result.ops, folder: result.folder }
}

function addSticky(doc, args, { now, makeId, source }) {
  const text = clean(args.text, MAX_TEXT)
  if (!text) throw new ToolError('A sticky needs some words.')
  const { target, where } = placeOrSay(doc.folders || [], args)
  const last = pile(doc.notes || [], target?.id || null).at(-1)
  const note = normalizeNote({
    id: makeId('note'),
    title: titleOf(text),
    markdown: text,
    folderId: target?.id || null,
    unsorted: !target,
    source: clean(args.source, 40) || source,
    createdAt: now,
    updatedAt: now,
    rank: (last ? rankOf(last) : 0) + GAP,
  })
  return { text: `Added a sticky to ${where} (${note.id}).`, ops: [{ t: 'add', c: 'notes', v: note, at: 0 }] }
}

/* New words for a sticky, like the note editor: the title follows the first line, tags follow
   the words. Its @ links (refs) stay as they were. */
function editSticky(doc, args, { now }) {
  const note = stickyOrSay(doc, args.sticky)
  const text = clean(args.text, MAX_TEXT)
  if (!text) throw new ToolError('A sticky needs some words.')
  if (text === note.markdown.trim()) return { text: `“${note.title}” already says that.` }
  const title = titleOf(text)
  return { text: `Changed the sticky “${title}” (${note.id}).`, ops: [{ t: 'patch', c: 'notes', id: note.id, v: { title, markdown: text, tags: parseTags(`${title}\n${text}`), updatedAt: now } }] }
}

/* Files a sticky the way the canvas does (moveSticky): at the end of its new home, out of
   Unsorted, and laid out afresh there (its spot on the canvas, `at`, is let go). */
function moveStickyTool(doc, args) {
  const note = stickyOrSay(doc, args.sticky)
  const { target, where } = placeOrSay(doc.folders || [], args)
  const to = target?.id || null
  if ((note.folderId || null) === to && (to || !note.at)) return { text: `“${note.title}” is already in ${where}.` }
  const last = pile(doc.notes || [], to).filter((item) => item.id !== note.id).at(-1)
  const v = { folderId: to, unsorted: !to, rank: (last ? rankOf(last) : 0) + GAP }
  return { text: `Moved “${note.title}” to ${where}.`, ops: [{ t: 'patch', c: 'notes', id: note.id, v, ...(note.at ? { unset: ['at'] } : {}) }] }
}

/* Like Delete in Notes (trashNotes): into the Trash, where Restore brings it back. */
function deleteSticky(doc, args, { now }) {
  const note = stickyOrSay(doc, args.sticky)
  return { text: `Moved “${note.title}” to the Trash in Notes, where it can be restored.`, ops: [{ t: 'patch', c: 'notes', id: note.id, v: { trashedAt: now, pinned: false } }] }
}

function addBranch(doc, args, { now, makeId }) {
  const folders = doc.folders || []
  const name = clean(args.title, 80)
  if (!name) throw new ToolError('A branch needs a title.')
  const node = nodeOrSay(folders, args.node)
  const parent = clean(args.inside) ? branchOrSay(folders, node, args.inside) : node
  const where = pathOf(folders, parent.id)
  const siblings = childrenOf(folders, parent.id)
  const same = siblings.find((folder) => folder.name.toLowerCase() === name.toLowerCase())
  if (same) return { text: `${where} already has a branch called “${same.name}” (${same.id}), so nothing new was made.` }
  const last = siblings.at(-1)
  const branch = { id: makeId('folder'), name, parentId: parent.id, createdAt: now, collapsed: false, rank: (last ? rankOf(last) : 0) + GAP }
  return { text: `Added the branch “${name}” to ${where} (${branch.id}).`, ops: [{ t: 'add', c: 'folders', v: branch }] }
}

/* Only the name changes (like renameFolder): links and @s point at the id, so they follow. */
function rename(doc, args) {
  const folders = doc.folders || []
  const name = clean(args.name, 80)
  if (!name) throw new ToolError('Give the new name.')
  const node = nodeOrSay(folders, args.node)
  const folder = clean(args.branch) ? branchOrSay(folders, node, args.branch) : node
  const what = folder.parentId || folder.kind === 'branch' ? 'branch' : 'topic'
  if (name === folder.name) return { text: `The ${what} is already called “${name}”.` }
  // Two of the same name side by side would leave bots (and Nate) guessing which is which.
  const taken = childrenOf(folders, folder.parentId).find((other) => other.id !== folder.id && other.name.toLowerCase() === name.toLowerCase())
  if (taken) throw new ToolError(`There is already a ${what} called “${taken.name}” there. Pick another name.`)
  return { text: `Renamed the ${what} “${folder.name}” to “${name}”.`, ops: [{ t: 'patch', c: 'folders', id: folder.id, v: { name } }] }
}

/* Where a note lives, in words: "Garden › Beds", "Unsorted", "Journal, 2026-10-07". */
function whereOf(folders, note) {
  if (note.kind === 'day') return `Journal, ${note.date || note.id.slice(4)}`
  return (note.folderId && pathOf(folders, note.folderId)) || 'Unsorted'
}

function search(doc, { query, limit }) {
  const folders = doc.folders || []
  const words = clean(query, 200).toLowerCase().split(/\s+/).filter(Boolean)
  const most = limitOf(limit)
  const found = (doc.notes || [])
    .filter((note) => note && !note.trashedAt && !note.archived && (!note.kind || note.kind === 'day') && note.markdown?.trim())
    .filter((note) => { const text = `${note.title}\n${note.markdown}`.toLowerCase(); return words.every((word) => text.includes(word)) })
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
  if (!found.length) return words.length ? `Nothing in OSAT holds “${words.join(' ')}”.` : 'OSAT has no stickies yet.'
  const shown = found.slice(0, most).map((note) => `- (${note.id}) [${whereOf(folders, note)}, ${String(note.updatedAt || note.createdAt).slice(0, 10)}] ${note.markdown.trim().slice(0, 600).replace(/\n/g, '\n  ')}`)
  return `${found.length} found${words.length ? ` for “${words.join(' ')}”` : ', newest first'}:\n${shown.join('\n')}${andMore(found.length, most)}`
}

/* Days and times on this Mac's clock. */
const pad = (number) => String(number).padStart(2, '0')
const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const localTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`
const dayStart = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d) }

/* The day asked for, as YYYY-MM-DD; today on this Mac's clock if none. */
function dayKey(date, now) {
  const asked = clean(date, 20)
  if (asked) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asked) || Number.isNaN(Date.parse(`${asked}T12:00:00Z`))) throw new ToolError('Give the day as YYYY-MM-DD, for example 2026-10-07.')
    return asked
  }
  return localDay(new Date(now))
}

const dayPage = (doc, key) => (doc.notes || []).find((note) => note?.id === `day-${key}`)

function readJournal(doc, { date }, { now }) {
  const key = dayKey(date, now)
  const page = dayPage(doc, key)
  return page?.markdown?.trim() && !page.trashedAt ? `# Journal, ${key}\n\n${page.markdown.trim()}` : `The journal has nothing for ${key} yet.`
}

function addToJournal(doc, { text: words, date }, { now }) {
  const text = clean(words, MAX_TEXT)
  if (!text) throw new ToolError('Say what to add to the journal.')
  const key = dayKey(date, now)
  const page = dayPage(doc, key)
  if (!page) {
    const title = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`))
    const note = normalizeNote({ id: `day-${key}`, kind: 'day', date: key, title, markdown: text, createdAt: now, updatedAt: now })
    return { text: `Added to the journal for ${key}.`, ops: [{ t: 'add', c: 'notes', v: note, at: 0 }] }
  }
  // Like the Journal's own appendToDay: a trashed or archived page comes back.
  const markdown = page.markdown?.trim() ? `${page.markdown.replace(/\n+$/, '')}\n${text}` : text
  return { text: `Added to the journal for ${key}.`, ops: [{ t: 'patch', c: 'notes', id: page.id, v: { markdown, tags: parseTags(`${page.title}\n${markdown}`), trashedAt: null, archived: false, updatedAt: now } }] }
}

/* "2026-10-09" (the whole day) or "2026-10-09T14:30" on this Mac's clock: { at, timed }, or
   null for anything else, a day that doesn't exist included. */
function localStamp(value) {
  const match = clean(value, 40).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/)
  if (!match) return null
  const [y, mo, d, h, mi] = match.slice(1).map((part) => Number(part || 0))
  const at = new Date(y, mo - 1, d, h, mi)
  const real = at.getFullYear() === y && at.getMonth() === mo - 1 && at.getDate() === d && at.getHours() === h && at.getMinutes() === mi
  return real ? { at, timed: match[4] !== undefined } : null
}

const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59)
const howToWrite = (what) => `Give the ${what} as YYYY-MM-DDTHH:MM on this Mac’s clock, for example 2026-10-09T14:30, or YYYY-MM-DD for the whole day.`

/* "2026-10-09 14:30–15:30", "2026-10-09, all day" (00:00 to 23:59, how add_event writes one). */
function whenOf(event) {
  const start = new Date(event.start)
  const end = event.end ? new Date(event.end) : null
  const valid = end && end > start
  if (valid && localTime(start) === '00:00' && localTime(end) === '23:59' && localDay(end) === localDay(start)) return `${localDay(start)}, all day`
  return `${localDay(start)} ${localTime(start)}${valid ? `–${localDay(end) === localDay(start) ? '' : `${localDay(end)} `}${localTime(end)}` : ''}`
}

const eventLine = (event) => `- (${event.id}) ${whenOf(event)}: ${event.title}${event.notes ? ` (${String(event.notes).replace(/\s+/g, ' ').slice(0, 200)})` : ''}`

function listEvents(doc, { from, to }, { now }) {
  const first = dayKey(from, now)
  const after = dayStart(first)
  after.setDate(after.getDate() + 7)
  const last = clean(to) ? dayKey(to, now) : localDay(after)
  if (last < first) throw new ToolError('The last day comes before the first.')
  const begin = dayStart(first).getTime()
  const close = dayStart(last)
  close.setDate(close.getDate() + 1)
  const events = (doc.calendar?.events || [])
    .filter((event) => { const at = Date.parse(event?.start); return at >= begin && at < close.getTime() })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  if (!events.length) return `Nothing on OSAT’s calendar from ${first} to ${last}.`
  return `${events.length} ${events.length === 1 ? 'event' : 'events'} from ${first} to ${last}:\n${events.map(eventLine).join('\n')}`
}

/* Like the Calendar room's own: { id, title, start, end, notes }, the times as ISO stamps,
   kept in order of start. */
function addEvent(doc, args, { makeId }) {
  const title = clean(args.title, 200)
  if (!title) throw new ToolError('An event needs a title.')
  const start = localStamp(args.start)
  if (!start) throw new ToolError(howToWrite('start'))
  let end = start.timed ? new Date(start.at.getTime() + 60 * 60 * 1000) : endOfDay(start.at)
  if (clean(args.end, 40)) {
    const until = localStamp(args.end)
    if (!until) throw new ToolError(howToWrite('end'))
    end = until.timed ? until.at : endOfDay(until.at)
  }
  if (end <= start.at) throw new ToolError('The end comes before the start.')
  const event = { id: makeId('event'), title, start: start.at.toISOString(), end: end.toISOString(), notes: clean(args.notes, 1000) }
  const events = doc.calendar?.events || []
  const later = events.findIndex((other) => Date.parse(other?.start) > start.at.getTime())
  return { text: `Added “${title}” to OSAT’s calendar: ${whenOf(event)} (${event.id}).`, ops: [{ t: 'add', c: 'calendar.events', v: event, at: later < 0 ? events.length : later }] }
}

/* `find` is main's file search: (query) → [{ name, where, kind, modifiedAt }]. */
async function findFiles({ query: asked, limit }, find) {
  const query = clean(asked, 200)
  if (!query) throw new ToolError('Say what to look for, for example “taxes pdf last week”.')
  const found = (await find(query)) || []
  if (!found.length) return { text: `No files match “${query}”.` }
  const most = limitOf(limit)
  const lines = found.slice(0, most).map((file) => {
    const changed = file.modifiedAt ? new Date(file.modifiedAt) : null
    return `- ${file.name}${file.kind ? ` (${file.kind})` : ''}${file.where ? ` in ${file.where}` : ''}${changed && !Number.isNaN(changed.getTime()) ? `, changed ${localDay(changed)}` : ''}`
  })
  return { text: `${found.length} ${found.length === 1 ? 'file' : 'files'} for “${query}”:\n${lines.join('\n')}${andMore(found.length, most)}` }
}

const RUN = {
  list_nodes: (doc) => ({ text: listNodes(doc) }),
  read_node: (doc, args) => ({ text: readNode(doc, args) }),
  add_node: addNode,
  add_sticky: addSticky,
  edit_sticky: editSticky,
  move_sticky: moveStickyTool,
  delete_sticky: deleteSticky,
  add_branch: addBranch,
  rename,
  search: (doc, args) => ({ text: search(doc, args) }),
  read_journal: (doc, args, opts) => ({ text: readJournal(doc, args, opts) }),
  add_to_journal: addToJournal,
  list_events: (doc, args, opts) => ({ text: listEvents(doc, args, opts) }),
  add_event: addEvent,
}

/* Runs one tool: { text, ops? }. Throws ToolError with a plain sentence for the bot.
   find_files is the one that waits: it gives back a Promise of { text } (it only looks, so
   no ops), and needs `findFiles` from main, so callers `await` what runTool returns. */
export function runTool(name, args, { doc, now = new Date().toISOString(), makeId, source = 'Connector', findFiles: find }) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  if (name === 'find_files') {
    if (typeof find !== 'function') throw new ToolError('Finding files works in the Mac app.')
    return findFiles(input, find)
  }
  if (!Object.hasOwn(RUN, name)) throw new ToolError(`OSAT has no tool called “${clean(name, 60)}”.`)
  return RUN[name](doc, input, { now, makeId, source })
}

export const CONNECTOR_PORT = 47823

/* What to paste where, to connect an app to OSAT. `key` is the real key (copied to the
   clipboard) or dots (shown in Settings). */
export function connectorSetup(which, { url, key }) {
  if (which === 'claude-code') return `claude mcp add --transport http osat ${url} --header "Authorization: Bearer ${key}"`
  if (which === 'claude-desktop') {
    // Claude Desktop starts servers itself, so mcp-remote (run by npx) carries it to OSAT's address.
    return JSON.stringify({ mcpServers: { osat: { command: 'npx', args: ['-y', 'mcp-remote@latest', url, '--allow-http', '--header', 'Authorization:${AUTH_HEADER}'], env: { AUTH_HEADER: `Bearer ${key}` } } } }, null, 2)
  }
  if (which === 'api') {
    // The same tools as a plain web API: Shortcuts' "Get Contents of URL", scripts, curl.
    const api = url.replace(/\/mcp$/, '/api')
    return `curl -H "Authorization: Bearer ${key}" "${api}/search?query=garden"\ncurl -H "Authorization: Bearer ${key}" -d '{"text": "Buy seeds"}' ${api}/add_sticky`
  }
  return `Address: ${url}\nHeader: Authorization: Bearer ${key}`
}
