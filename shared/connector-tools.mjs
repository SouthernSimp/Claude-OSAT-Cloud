/* The OSAT connector's tools (desktop/bots/connector.cjs serves them over MCP, on this Mac
   only): list the nodes, read one, add a node, add a sticky to a node, a branch or Unsorted.
   Pure: each takes the workspace and the arguments a bot sent, and gives back the words to
   answer with and the store operations to make (main commits them, so the windows, Undo
   and sync see every change). Names work as well as ids, since that is how bots talk. */

import { arrivalOps, markdownTree, nodeTree, NodeFileError } from './node-file.mjs'
import { normalizeNote, rankOf } from './note-core.mjs'

const MAX_TEXT = 8000
const clean = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

export const TOOLS = [
  {
    name: 'list_nodes',
    title: 'List nodes',
    description: 'Lists the nodes in OSAT (the top-level topics in its Sky), with their branches and how many stickies each holds, and how many stickies wait in Unsorted.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_node',
    title: 'Read a node',
    description: 'Reads one node as Markdown: "# " its name, its own stickies as list items, then each branch as "## " (a branch inside one as "### ") with its stickies. Use "Unsorted" to read the stickies that are in no node.',
    inputSchema: { type: 'object', properties: { node: { type: 'string', description: 'The node’s name (or id), or "Unsorted".' } }, required: ['node'], additionalProperties: false },
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
  },
]

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
  return { text: `Added the node “${result.folder.name}” to the Sky, marked New.${packed}`, ops: result.ops, folder: result.folder }
}

function addSticky(doc, args, { now, makeId, source }) {
  const folders = doc.folders || []
  const text = clean(args.text, MAX_TEXT)
  if (!text) throw new ToolError('A sticky needs some words.')
  let target = null
  let where = 'Unsorted'
  if (clean(args.node)) {
    const node = nodeOrSay(folders, args.node)
    target = node
    where = node.name
    if (clean(args.branch)) {
      const inside = subtree(folders, node.id)
      const branch = folders.find((folder) => inside.has(folder.id) && folder.id !== node.id && (folder.id === clean(args.branch) || folder.name.toLowerCase() === clean(args.branch).toLowerCase()))
      if (!branch) {
        const names = [...inside].filter((id) => id !== node.id).map((id) => folders.find((folder) => folder.id === id)?.name).filter(Boolean)
        throw new ToolError(`“${node.name}” has no branch called “${clean(args.branch, 80)}”.${names.length ? ` Its branches are: ${names.join(', ')}.` : ' It has no branches yet.'}`)
      }
      target = branch
      where = `${node.name} › ${branch.name}`
    }
  } else if (clean(args.branch)) {
    throw new ToolError('Say which node the branch is in.')
  }
  const last = pile(doc.notes || [], target?.id || null).at(-1)
  const note = normalizeNote({
    id: makeId('note'),
    title: text.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'A sticky',
    markdown: text,
    folderId: target?.id || null,
    unsorted: !target,
    source: clean(args.source, 40) || source,
    createdAt: now,
    updatedAt: now,
    rank: (last ? rankOf(last) : 0) + 1024,
  })
  return { text: `Added a sticky to ${where}.`, ops: [{ t: 'add', c: 'notes', v: note, at: 0 }] }
}

/* Runs one tool: { text, ops? }. Throws ToolError with a plain sentence for the bot. */
export function runTool(name, args, { doc, now = new Date().toISOString(), makeId, source = 'Connector' }) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  if (name === 'list_nodes') return { text: listNodes(doc) }
  if (name === 'read_node') return { text: readNode(doc, input) }
  if (name === 'add_node') return addNode(doc, input, { now, makeId, source })
  if (name === 'add_sticky') return addSticky(doc, input, { now, makeId, source })
  throw new ToolError(`OSAT has no tool called “${clean(name, 60)}”.`)
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
  return `Address: ${url}\nHeader: Authorization: Bearer ${key}`
}
