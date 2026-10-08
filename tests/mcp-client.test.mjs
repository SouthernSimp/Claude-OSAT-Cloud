import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { connect, textOf, searchPath } = require('../desktop/bots/mcp-client.cjs')
const { createConnector } = require('../desktop/bots/connector.cjs')

const FIXTURE = fileURLToPath(new URL('./fixtures/stdio-mcp.mjs', import.meta.url))
const fixture = (options = {}) => connect({ kind: 'command', command: process.execPath, args: [FIXTURE], env: options.env }, options)
const gone = (pid) => { try { process.kill(pid, 0); return false } catch { return true } }
const until = async (check) => { for (let i = 0; i < 100 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 20)) }

test('over the web: OSAT’s own connector, with its key', async () => {
  const KEY = 'k-0123456789abcdefghij'
  const tools = [
    { name: 'search', description: 'Finds stickies.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
    { name: 'add_sticky', description: 'Adds a sticky.', inputSchema: { type: 'object' } },
  ]
  const app = { id: 'a1', name: 'Tester', access: 'read' }
  const connector = createConnector({ tools, appFor: (given) => (given === KEY ? app : null), call: async (name, args, by) => ({ text: `${name} for ${by.name}: ${args.query}` }) })
  const port = await connector.start(0)
  const url = `http://127.0.0.1:${port}/mcp`
  try {
    const client = await connect({ kind: 'http', url, headers: { Authorization: `Bearer ${KEY}` } })
    assert.deepEqual(client.server.name, 'osat')
    const listed = await client.tools()
    assert.deepEqual(listed.map((tool) => [tool.name, tool.annotations?.readOnlyHint]), [['search', true]], 'an app that may only look sees only what looks')
    assert.deepEqual(await client.call('search', { query: 'seeds' }), { text: 'search for Tester: seeds', isError: false })
    assert.deepEqual(await client.call('add_sticky', { text: 'Buy seeds' }), { text: 'Tester can only read. Change that in Settings → Bots.', isError: true })
    client.close()
    await assert.rejects(connect({ kind: 'http', url, headers: { Authorization: 'Bearer wrong' } }), /turned OSAT away: it needs a key/)
    await assert.rejects(connect({ kind: 'http', url: `http://127.0.0.1:${port}/nothing` }), /Nothing answers at that address/)
  } finally {
    connector.stop()
  }
  await assert.rejects(connect({ kind: 'http', url }), /Nothing answered at that address/)
})

/* A server that answers as an event stream, keeps a session, and pages its tools. */
async function streamingServer() {
  const seen = []
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    seen.push({ method: request.method, session: request.headers['mcp-session-id'], version: request.headers['mcp-protocol-version'], body: body ? JSON.parse(body) : null })
    if (request.method === 'DELETE') return response.writeHead(200).end()
    const { id, method, params } = JSON.parse(body)
    if (id === undefined) return response.writeHead(202).end()
    if (method === 'initialize') {
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'session-1' })
      return response.end(JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'stream' } } }))
    }
    if (method === 'tools/call' && params.name === 'hang') return undefined // never answers
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    // A progress note first, then the answer split across writes, with CRLF line ends.
    response.write('event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\n')
    const result = method === 'tools/list'
      ? params?.cursor ? { tools: [{ name: 'second' }] } : { tools: [{ name: 'first' }], nextCursor: 'more' }
      : { content: [{ type: 'text', text: 'Three events today.' }, { type: 'image', data: 'x', mimeType: 'image/png' }] }
    const text = JSON.stringify({ jsonrpc: '2.0', id, result })
    response.write(`data: ${text.slice(0, 10)}`)
    setTimeout(() => response.end(`${text.slice(10)}\r\n\r\n`), 10)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, seen, url: `http://127.0.0.1:${server.address().port}/mcp` }
}

test('over the web: an event-stream answer, the session kept, the agreed version sent after the handshake', async () => {
  const { server, seen, url } = await streamingServer()
  try {
    const client = await connect({ kind: 'http', url, headers: { 'X-Extra': 'yes' } }, { timeout: 300 })
    assert.deepEqual((await client.tools()).map((tool) => tool.name), ['first', 'second'])
    assert.deepEqual(await client.call('today', {}), { text: 'Three events today.\n\n(a picture)', isError: false })
    await assert.rejects(client.call('hang', {}), /didn’t answer within 1 second/)
    client.close()
    await until(() => seen.some((item) => item.method === 'DELETE'))
    assert.deepEqual(seen.map((item) => [item.body?.method || item.method, item.session, item.version]), [
      ['initialize', undefined, undefined],
      ['notifications/initialized', 'session-1', '2025-03-26'],
      ['tools/list', 'session-1', '2025-03-26'],
      ['tools/list', 'session-1', '2025-03-26'],
      ['tools/call', 'session-1', '2025-03-26'],
      ['tools/call', 'session-1', '2025-03-26'],
      ['DELETE', 'session-1', '2025-03-26'],
    ])
    assert.equal(seen[0].body.params.protocolVersion, '2025-06-18')
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('over the web: Offline’s refusal passes through in its own words', async () => {
  const offline = Object.assign(new Error('OSAT is offline. It will reach the internet again when you go back online.'), { code: 'OFFLINE' })
  await assert.rejects(connect({ kind: 'http', url: 'https://mcp.example.com/mcp' }, { fetch: () => Promise.reject(offline) }), /OSAT is offline/)
})

test('a command on this Mac: handshake, two pages of tools, a call, its env, and closing ends it', async () => {
  const client = await fixture({ env: { SECRET_THING: 'shh' } })
  const tools = await client.tools()
  assert.deepEqual(tools.map((tool) => tool.name), ['echo', 'env', 'pid', 'slow', 'crash'])
  assert.equal(tools[0].annotations.readOnlyHint, true)
  assert.deepEqual(await client.call('echo', { words: 'hello' }), { text: 'You said: hello', isError: false })
  assert.equal((await client.call('env')).text, 'shh')
  await assert.rejects(client.call('nope'), /It answered: Unknown tool nope\./)
  const pid = Number((await client.call('pid')).text)
  assert.equal(gone(pid), false)
  client.close()
  await until(() => gone(pid))
  assert.equal(gone(pid), true, 'closing ends the program')
  await assert.rejects(client.call('echo', { words: 'x' }), /It was closed/)
})

test('a command: timeouts, a crash said plainly, a missing program', async () => {
  const client = await fixture({ timeout: 200 })
  await assert.rejects(client.call('slow'), /didn’t answer within 1 second/)
  await assert.rejects(client.call('crash'), /^Error: It stopped: The disk is on fire\.$/)
  await assert.rejects(connect({ kind: 'command', command: 'osat-no-such-program-here' }), /couldn’t find “osat-no-such-program-here” on this Mac/)
  await assert.rejects(connect({ kind: 'command', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }, { timeout: 150 }), /didn’t answer/)
})

test('the words out of an answer; a bare PATH gets Homebrew’s folders', () => {
  assert.equal(textOf({ content: [{ type: 'text', text: 'a' }, { type: 'audio' }, { type: 'resource', resource: { uri: 'file:///x', text: 'inside' } }, { type: 'resource_link', name: 'Doc' }, { type: 'weird' }] }), 'a\n\n(a sound)\n\ninside\n\n(a link: Doc)\n\n(something OSAT can’t show)')
  assert.equal(textOf({ content: [], structuredContent: { n: 1 } }), '{"n":1}')
  const found = searchPath('/usr/bin:/bin').split(':')
  assert.deepEqual(found.slice(0, 4), ['/usr/bin', '/bin', '/opt/homebrew/bin', '/usr/local/bin'])
  assert.equal(searchPath('/opt/homebrew/bin').split(':').filter((item) => item === '/opt/homebrew/bin').length, 1)
})
