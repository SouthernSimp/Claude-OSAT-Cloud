/* The OSAT connector: a small MCP server (Model Context Protocol, over HTTP) so Claude Code,
   Claude Desktop, Grok Bot or any app that speaks MCP can list, read and add nodes and
   stickies. Off until Nate turns it on in Settings → Bots, and then:
     - it only listens on this Mac (127.0.0.1), never on the network;
     - every request needs an app's own key (Authorization: Bearer <key>), which lives in the
       Keychain and can be reset; an app that may only read sees and runs only the tools that
       read (annotations.readOnlyHint), and is told so plainly if it tries another (Phase 44);
     - web pages can't reach it: a request from a browser (an Origin) or through another
       name (a Host that isn't this Mac) is refused;
     - every change goes through the store, so the windows, Undo and sync see it.
   The same tools answer as a plain web API too, for Shortcuts, scripts and curl:
   GET /api/search?query=garden, POST /api/add_sticky {"text": "…"}; the answer is plain text.
   `appFor(key)` says which app a key belongs to (or null); `call(name, args, app)` runs a tool
   for it and resolves { text } or throws with a plain sentence. */
const http = require('node:http')
const { timingSafeEqual } = require('node:crypto')

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY = 1024 * 1024
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
const INSTRUCTIONS = 'OSAT is the owner’s private notes app on their Mac. Nodes are topics in its Sky; a node has branches, and stickies are short notes. Read before you add, add only what was asked, and name yourself as the source.'

const sameKey = (given, key) => {
  const a = Buffer.from(String(given || ''))
  const b = Buffer.from(String(key || ''))
  return Boolean(key) && a.length === b.length && timingSafeEqual(a, b)
}

/* The app a key belongs to, of [{ app, key }], or null. Every key is compared, in constant time. */
function appWithKey(given, entries) {
  let found = null
  for (const entry of entries) if (sameKey(given, entry.key)) found = entry.app
  return found
}

function createConnector({ tools, call, appFor, version = '0' }) {
  let server = null
  // A tool without readOnlyHint counts as one that changes things.
  const reads = (tool) => tool.annotations?.readOnlyHint === true
  const toolsFor = (app) => (app.access === 'write' ? tools : tools.filter(reads))
  const readOnly = (app, name) => app.access !== 'write' && tools.some((tool) => tool.name === name && !reads(tool))
  const onlyReads = (app) => `${app.name} can only read. Change that in Settings → Bots.`

  const reply = (response, status, body, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
    response.end(body === undefined ? '' : JSON.stringify(body))
  }

  async function answer(message, app) {
    const { id, method, params } = message || {}
    const result = (value) => ({ jsonrpc: '2.0', id, result: value })
    const error = (code, text) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: text } })
    if (!message || message.jsonrpc !== '2.0' || typeof method !== 'string') return error(-32600, 'Invalid request')
    if (id === undefined) return null // a notification (e.g. notifications/initialized): nothing to say
    if (method === 'initialize') {
      const asked = params?.protocolVersion
      return result({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'osat', title: 'OSAT', version },
        instructions: INSTRUCTIONS,
      })
    }
    if (method === 'ping') return result({})
    if (method === 'tools/list') return result({ tools: toolsFor(app) })
    if (method === 'tools/call') {
      const name = String(params?.name || '')
      if (readOnly(app, name)) return result({ content: [{ type: 'text', text: onlyReads(app) }], isError: true })
      try {
        const { text } = await call(name, params?.arguments || {}, app)
        return result({ content: [{ type: 'text', text }] })
      } catch (problem) {
        return result({ content: [{ type: 'text', text: problem.message || 'That didn’t work.' }], isError: true })
      }
    }
    return error(-32601, `OSAT doesn’t know ${method}.`)
  }

  const text = (response, status, words) => {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`${words}\n`)
  }

  /* /api/<tool>: arguments from the address (GET) or a JSON body (POST); the answer as text. */
  async function answerApi(name, url, request, response, app) {
    if (!tools.some((tool) => tool.name === name)) return text(response, 404, `OSAT has no tool called “${name}”. It has: ${toolsFor(app).map((tool) => tool.name).join(', ')}.`)
    if (readOnly(app, name)) return text(response, 403, onlyReads(app))
    let args = {}
    if (request.method === 'GET') {
      for (const [key, value] of url.searchParams) args[key] = /^\d+$/.test(value) && key === 'limit' ? Number(value) : value
    } else if (request.method === 'POST') {
      let body = ''
      for await (const chunk of request) {
        body += chunk
        if (body.length > MAX_BODY) return text(response, 413, 'That request is too big.')
      }
      try {
        args = body.trim() ? JSON.parse(body) : {}
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object')
      } catch {
        return text(response, 400, 'Send the arguments as JSON, for example {"text": "Buy seeds"}.')
      }
    } else {
      return text(response, 405, 'Use GET or POST.')
    }
    try {
      return text(response, 200, (await call(name, args, app)).text)
    } catch (problem) {
      return text(response, 400, problem.message || 'That didn’t work.')
    }
  }

  async function handle(request, response) {
    // Only this Mac, by name too: a web page that renamed itself to 127.0.0.1 gets nothing.
    if (!LOOPBACK_HOST.test(request.headers.host || '')) return reply(response, 403, { error: 'This connector only answers on this Mac.' })
    const origin = request.headers.origin
    if (origin && origin !== 'null' && !LOOPBACK_ORIGIN.test(origin)) return reply(response, 403, { error: 'Web pages can’t use OSAT’s connector.' })
    const url = new URL(request.url, 'http://127.0.0.1')
    const api = /^\/api\/([a-z_]+)$/.exec(url.pathname)?.[1]
    if (url.pathname !== '/mcp' && !api) return reply(response, 404, { error: 'The connector is at /mcp, and its tools at /api/<tool>.' })
    const auth = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '')?.[1]
    const app = auth ? appFor(auth) : null
    if (!app) return reply(response, 401, { error: 'OSAT needs this app’s connector key (Settings → Bots).' }, { 'www-authenticate': 'Bearer' })
    if (api) return answerApi(api, url, request, response, app)
    if (request.method === 'DELETE') return reply(response, 200, {})
    if (request.method !== 'POST') return reply(response, 405, { error: 'Send requests with POST.' }, { allow: 'POST, DELETE' })
    let body = ''
    for await (const chunk of request) {
      body += chunk
      if (body.length > MAX_BODY) return reply(response, 413, { error: 'That request is too big.' })
    }
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      return reply(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
    const batch = Array.isArray(parsed)
    const answers = (await Promise.all((batch ? parsed : [parsed]).map((message) => answer(message, app)))).filter(Boolean)
    if (!answers.length) return reply(response, 202)
    return reply(response, 200, batch ? answers : answers[0])
  }

  /* Listens on 127.0.0.1 at `port` (or the next free one after it); resolves the port. */
  function start(port) {
    stop()
    return new Promise((resolve, reject) => {
      const tryPort = (at, left) => {
        const next = http.createServer((request, response) => {
          handle(request, response).catch(() => { if (!response.headersSent) reply(response, 500, { error: 'OSAT couldn’t answer that.' }) })
        })
        next.once('error', (error) => {
          if (error.code === 'EADDRINUSE' && left > 0) tryPort(at === 0 ? 0 : at + 1, left - 1)
          else reject(error)
        })
        next.listen(at, '127.0.0.1', () => {
          server = next
          resolve(next.address().port)
        })
      }
      tryPort(port || 0, 10)
    })
  }

  function stop() {
    server?.closeAllConnections?.()
    server?.close()
    server = null
  }

  return { start, stop, running: () => Boolean(server), address: () => server?.address() || null }
}

module.exports = { createConnector, appWithKey, PROTOCOLS }
