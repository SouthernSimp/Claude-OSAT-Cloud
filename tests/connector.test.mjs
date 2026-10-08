import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as storeCore from '../shared/store-core.mjs'
import { connectorSetup, runTool, TOOLS, ToolError } from '../shared/connector-tools.mjs'

const require = createRequire(import.meta.url)
const { createStore } = require('../desktop/store/index.cjs')
const { appWithKey, createConnector } = require('../desktop/bots/connector.cjs')

let n = 0
const makeId = (prefix) => `${prefix}-${++n}`
const NOW = '2026-09-29T10:00:00.000Z'

/* A real store in a temp folder: tools run against it, their changes are committed the
   way main commits them, and what's on disk is read back. */
async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-connector-'))
  const store = await createStore({ dir, core: storeCore, writeDelay: 0, maxDelay: 0 })
  const client = store.connect(() => {})
  const run = (name, args) => {
    const result = runTool(name, args, { doc: store.load().doc, now: NOW, makeId })
    if (result.ops) store.commit(client, result.ops)
    return result.text
  }
  const onDisk = async () => { await store.flush(); return JSON.parse(await fs.readFile(path.join(dir, 'workspace.json'), 'utf8')) }
  return { store, run, onDisk }
}

test('tools: each with a plain description and an input schema', () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), ['list_nodes', 'read_node', 'add_node', 'add_sticky', 'edit_sticky', 'move_sticky', 'delete_sticky', 'add_branch', 'rename', 'search', 'read_journal', 'add_to_journal', 'list_events', 'add_event', 'find_files'])
  assert.ok(TOOLS.every((tool) => tool.description.length > 40 && tool.inputSchema.type === 'object'))
})

test('add a node, list it, read it back as the Markdown a node file is made of; saved to disk', async () => {
  const { run, onDisk } = await tempStore()
  assert.match(run('list_nodes', {}), /There are no nodes yet\. 0 stickies wait in Unsorted/)
  assert.match(run('add_node', { title: 'Garden', summary: 'What grows where.', source: 'Claude', branches: [{ title: 'Beds', leaves: ['Tomatoes', 'Dig the bed'] }] }),
    /Added the node “Garden” \(folder-\d+\) to the Sky, marked New\.$/)
  assert.match(run('add_node', { markdown: '# Spring launch\nA party in April.' }), /packed \(only a summary so far\)/)
  assert.match(run('add_node', { title: 'Garden', summary: 'What grows where.', source: 'Claude', branches: [{ title: 'Beds', leaves: ['Tomatoes', 'Dig the bed'] }] }), /already in OSAT/, 'the same node twice makes it once')
  assert.equal(run('list_nodes', {}), '2 nodes in OSAT:\n- Garden (New, from Claude): 3 stickies; branches: Beds\n- Spring launch (New, packed, from Connector): 1 sticky\n\nUnsorted: 0 stickies.')
  assert.equal(run('read_node', { node: 'garden' }), '# Garden\n\n- What grows where.\n\n## Beds\n- Tomatoes\n- Dig the bed')
  const saved = await onDisk()
  assert.deepEqual(saved.folders.map((folder) => [folder.name, folder.fresh, folder.from?.source]), [['Garden', true, 'Claude'], ['Beds', undefined, undefined], ['Spring launch', true, 'Connector']])
})

test('add a sticky to a node, a branch or Unsorted; wrong names say what there is', async () => {
  const { run, store } = await tempStore()
  run('add_node', { title: 'Garden', branches: [{ title: 'Beds', leaves: ['Tomatoes'] }] })
  assert.match(run('add_sticky', { text: 'Water on Sunday', node: 'Garden', branch: 'beds', source: 'Claude' }), /^Added a sticky to Garden › Beds \(note-\d+\)\.$/)
  assert.match(run('add_sticky', { text: 'Buy seeds', node: 'Garden' }), /^Added a sticky to Garden \(note-\d+\)\.$/)
  assert.match(run('add_sticky', { text: 'Call Jordan' }), /^Added a sticky to Unsorted \(note-\d+\)\.$/)
  assert.equal(run('read_node', { node: 'Garden' }), '# Garden\n\n- Buy seeds\n\n## Beds\n- Tomatoes\n- Water on Sunday')
  assert.equal(run('read_node', { node: 'Unsorted' }), '# Unsorted\n\n- Call Jordan')
  const unsorted = store.load().doc.notes.find((note) => note.markdown === 'Call Jordan')
  assert.deepEqual([unsorted.unsorted, unsorted.source], [true, 'Connector'])
  assert.throws(() => run('add_sticky', { text: 'x', node: 'Gardn' }), (error) => error instanceof ToolError && /no node called “Gardn”\. The nodes are: Garden\./.test(error.message))
  assert.throws(() => run('add_sticky', { text: 'x', node: 'Garden', branch: 'Herbs' }), /no branch called “Herbs”\. Its branches are: Beds\./)
  assert.throws(() => run('add_sticky', { text: 'x', branch: 'Beds' }), /Say which node/)
  assert.throws(() => run('add_sticky', { text: '  ' }), /needs some words/)
  assert.throws(() => run('add_node', { summary: 'no title' }), /needs a title/)
  assert.throws(() => run('delete_everything', {}), /no tool called/)
})

/* The connector over HTTP, on a free port on this Mac: Claude Code may change things, Shortcuts only reads. */
const READ_KEY = 'k-read-only-0123456789ab'
async function served({ tools = TOOLS } = {}) {
  let key = 'k-0123456789abcdefghij'
  const calls = []
  const apps = [
    { app: { id: 'a1', name: 'Claude Code', access: 'write' }, get key() { return key } },
    { app: { id: 'a2', name: 'Shortcuts', access: 'read' }, key: READ_KEY },
  ]
  const connector = createConnector({
    tools,
    appFor: (given) => appWithKey(given, apps),
    version: '9.9',
    call: async (name, args, app) => {
      assert.ok(app?.name, 'every call knows which app asked')
      calls.push([name, args])
      if (name === 'boom') throw new ToolError('That went wrong, plainly.')
      return { text: `ran ${name}` }
    },
  })
  const port = await connector.start(0)
  const send = (body, { headers = {}, method = 'POST', route = '/mcp' } = {}) => new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: route, method, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...headers } }, (response) => {
      let text = ''
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body: /json/.test(response.headers['content-type']) && text ? JSON.parse(text) : text || null }))
    })
    request.on('error', reject)
    request.end(body === undefined ? undefined : JSON.stringify(body))
  })
  return { connector, send, calls, setKey: (value) => { key = value } }
}

test('the connector speaks MCP: initialize, tools/list, tools/call, notifications and batches', async () => {
  const { connector, send, calls } = await served()
  try {
    assert.equal(connector.address().address, '127.0.0.1', 'this Mac only')
    const init = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-code', version: '2' } } })
    assert.equal(init.status, 200)
    assert.deepEqual([init.body.result.protocolVersion, init.body.result.serverInfo.name, init.body.result.capabilities.tools.listChanged], ['2025-03-26', 'osat', false])
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).body.result.protocolVersion, '2025-06-18')
    assert.equal((await send({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
    assert.deepEqual((await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).body.result.tools.map((tool) => tool.name), TOOLS.map((tool) => tool.name))
    const called = await send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_sticky', arguments: { text: 'Hi' } } })
    assert.deepEqual(called.body.result, { content: [{ type: 'text', text: 'ran add_sticky' }] })
    assert.deepEqual(calls.at(-1), ['add_sticky', { text: 'Hi' }])
    const failed = await send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom' } })
    assert.deepEqual(failed.body.result, { content: [{ type: 'text', text: 'That went wrong, plainly.' }], isError: true })
    const batch = await send([{ jsonrpc: '2.0', id: 5, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/cancelled' }, { jsonrpc: '2.0', id: 6, method: 'resources/list' }])
    assert.deepEqual(batch.body.map((item) => item.result || item.error.code), [{}, -32601])
    assert.equal((await send('not json')).body.error.code, -32600)
  } finally {
    connector.stop()
  }
})

test('the connector refuses anyone without the key, other hosts and web pages', async () => {
  const { connector, send, setKey, calls } = await served()
  try {
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { authorization: 'Bearer wrong' } })).status, 401)
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { authorization: '' } })).status, 401)
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { host: 'evil.example:80' } })).status, 403, 'DNS rebinding: another name for this Mac')
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { origin: 'https://evil.example' } })).status, 403, 'a web page')
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { origin: 'http://localhost:3000' } })).status, 200)
    assert.equal((await send(undefined, { method: 'GET' })).status, 405)
    assert.equal((await send({}, { route: '/other' })).status, 404)
    assert.equal((await send('x'.repeat(1024 * 1024 + 10))).status, 413)
    // Reset: the old key stops at once.
    setKey('k-a-brand-new-key-0000000000')
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { authorization: 'Bearer k-0123456789abcdefghij' } })).status, 401)
    assert.equal(calls.length, 0, 'no tool ever ran')
    setKey(null)
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { authorization: 'Bearer null' } })).status, 401, 'no key set: nobody gets in')
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { authorization: 'Bearer undefined' } })).status, 401)
  } finally {
    connector.stop()
  }
  assert.equal(connector.running(), false)
})

test('setup lines: Claude Code, Claude Desktop (through mcp-remote) and any other app', () => {
  const url = 'http://127.0.0.1:47823/mcp'
  assert.equal(connectorSetup('claude-code', { url, key: 'KEY' }), 'claude mcp add --transport http osat http://127.0.0.1:47823/mcp --header "Authorization: Bearer KEY"')
  const desktop = JSON.parse(connectorSetup('claude-desktop', { url, key: 'KEY' }))
  assert.deepEqual(desktop.mcpServers.osat.args, ['-y', 'mcp-remote@latest', url, '--allow-http', '--header', 'Authorization:${AUTH_HEADER}'])
  assert.equal(desktop.mcpServers.osat.env.AUTH_HEADER, 'Bearer KEY')
  assert.equal(connectorSetup('other', { url, key: 'KEY' }), `Address: ${url}\nHeader: Authorization: Bearer KEY`)
  assert.match(connectorSetup('api', { url, key: 'KEY' }), /^curl -H "Authorization: Bearer KEY" "http:\/\/127\.0\.0\.1:47823\/api\/search\?query=garden"\n.*\/api\/add_sticky$/)
})

test('search finds stickies by every word, newest first, saying where each lives', async () => {
  const { run } = await tempStore()
  run('add_node', { title: 'Garden', branches: [{ title: 'Beds', leaves: ['Water the tomatoes'] }] })
  run('add_sticky', { text: 'Tomatoes: buy cages' })
  assert.match(run('search', { query: 'TOMATOES' }), /^2 found for “tomatoes”:\n- \(note-\d+\) \[Unsorted, 2026-09-29\] Tomatoes: buy cages\n- \(note-\d+\) \[Garden › Beds, 2026-09-29\] Water the tomatoes$/)
  assert.match(run('search', { query: 'tomatoes cages' }), /^1 found/)
  assert.equal(run('search', { query: 'zucchini' }), 'Nothing in OSAT holds “zucchini”.')
  assert.match(run('search', { limit: 1 }), /^2 found, newest first:\n- .*\n\n…and 1 more\.$/)
})

test('the journal: write today, write again, read it, and a bad day says how to write one', async () => {
  const { run, onDisk } = await tempStore()
  assert.equal(run('read_journal', { date: '2026-09-29' }), 'The journal has nothing for 2026-09-29 yet.')
  assert.equal(run('add_to_journal', { text: 'Planted garlic #garden', date: '2026-09-29' }), 'Added to the journal for 2026-09-29.')
  run('add_to_journal', { text: 'Rain later', date: '2026-09-29' })
  assert.equal(run('read_journal', { date: '2026-09-29' }), '# Journal, 2026-09-29\n\nPlanted garlic #garden\nRain later')
  assert.match(run('search', { query: 'garlic' }), /\[Journal, 2026-09-29, /)
  const page = (await onDisk()).notes.find((note) => note.id === 'day-2026-09-29')
  assert.deepEqual([page.kind, page.title, page.tags], ['day', 'Tuesday, September 29', ['garden']])
  assert.throws(() => run('add_to_journal', { text: 'x', date: 'tomorrow' }), /YYYY-MM-DD/)
  assert.throws(() => run('add_to_journal', { text: ' ' }), /what to add/)
  assert.match(run('add_to_journal', { text: 'Today, whatever day it is' }), /^Added to the journal for \d{4}-\d{2}-\d{2}\.$/)
})

test('the plain web API: the same tools by address, with the same key and the same walls', async () => {
  const { connector, send, calls } = await served()
  try {
    const found = await send(undefined, { method: 'GET', route: '/api/search?query=garden&limit=3' })
    assert.deepEqual([found.status, found.body], [200, 'ran search\n'])
    assert.deepEqual(calls.at(-1), ['search', { query: 'garden', limit: 3 }])
    assert.equal((await send({ text: 'Buy seeds' }, { route: '/api/add_sticky' })).status, 200)
    assert.deepEqual(calls.at(-1), ['add_sticky', { text: 'Buy seeds' }])
    assert.match((await send({}, { route: '/api/boom' })).body, /no tool called “boom”/)
    assert.equal((await send('not json', { route: '/api/add_sticky' })).status, 400)
    assert.equal((await send(undefined, { method: 'GET', route: '/api/search', headers: { authorization: 'Bearer wrong' } })).status, 401)
    assert.equal((await send(undefined, { method: 'GET', route: '/api/search', headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal(calls.length, 2, 'nothing ran without the key, or for a web page')
  } finally {
    connector.stop()
  }
})

test('appWithKey: the app a key belongs to, or nobody', () => {
  const entries = [{ app: { id: 'a' }, key: 'key-a' }, { app: { id: 'b' }, key: 'key-b' }, { app: { id: 'c' }, key: undefined }]
  assert.equal(appWithKey('key-b', entries).id, 'b')
  assert.equal(appWithKey('key-', entries), null)
  assert.equal(appWithKey('', entries), null)
  assert.equal(appWithKey(undefined, entries), null, 'an app without a key is never matched')
  assert.equal(appWithKey('key-a', []), null)
})

test('an app that may only read sees and runs only the tools that read, over MCP and the web API', async () => {
  // Annotated here as shared/connector-tools.mjs annotates them: a tool without readOnlyHint changes things.
  const tools = TOOLS.map((tool) => (/^add/.test(tool.name) ? tool : { ...tool, annotations: { readOnlyHint: true } }))
  const { connector, send, calls } = await served({ tools })
  const asReader = { headers: { authorization: `Bearer ${READ_KEY}` } }
  try {
    const listed = (await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, asReader)).body.result.tools.map((tool) => tool.name)
    assert.deepEqual(listed, ['list_nodes', 'read_node', 'search', 'read_journal'])
    assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools.length, TOOLS.length, 'an app that may change things sees every tool')
    const refused = await send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'add_sticky', arguments: { text: 'Hi' } } }, asReader)
    assert.deepEqual(refused.body.result, { content: [{ type: 'text', text: 'Shortcuts can only read. Change that in Settings → Bots.' }], isError: true })
    const api = await send({ text: 'Hi' }, { ...asReader, route: '/api/add_to_journal' })
    assert.deepEqual([api.status, api.body], [403, 'Shortcuts can only read. Change that in Settings → Bots.\n'])
    assert.match((await send({}, { ...asReader, route: '/api/nope' })).body, /It has: list_nodes, read_node, search, read_journal\./)
    assert.equal(calls.length, 0, 'nothing that changes ran')
    assert.equal((await send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'x' } } }, asReader)).body.result.content[0].text, 'ran search')
    assert.equal((await send(undefined, { ...asReader, method: 'GET', route: '/api/read_journal' })).status, 200)
    assert.deepEqual(calls.map(([name]) => name), ['search', 'read_journal'])
  } finally {
    connector.stop()
  }
})

test('a tool without the read-only mark counts as one that changes things', async () => {
  const { connector, send, calls } = await served({ tools: TOOLS.map(({ annotations, ...tool }) => tool) })
  try {
    const asReader = { headers: { authorization: `Bearer ${READ_KEY}` } }
    assert.deepEqual((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, asReader)).body.result.tools, [])
    assert.equal((await send(undefined, { ...asReader, method: 'GET', route: '/api/search' })).status, 403)
    assert.equal(calls.length, 0)
  } finally {
    connector.stop()
  }
})
