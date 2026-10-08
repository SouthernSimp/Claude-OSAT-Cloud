/* A small MCP client (Phase 48): OSAT uses the apps Nate connects, the same servers Claude uses
   (Google Calendar, Gmail, Notion…). Two ways to reach one:
     'http'     a web address (MCP's streamable HTTP): each message is a POST, answered as JSON or
                as a short event stream. Through the main process's fetch, so Offline locks it.
     'command'  a program on this Mac that OSAT starts, talking one JSON message per line over
                its input and output. Closing it ends the program (and what it started).
   connect(server) shakes hands (initialize, then notifications/initialized) and resolves
   { tools(), call(name, args), close() }. Each request gives up after 30 seconds, and every
   error is one plain sentence. `fetch`, `spawn` and `timeout` are passed in by the tests. */
const { spawn: nodeSpawn } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')

const PROTOCOL = '2025-06-18'
const TIMEOUT = 30000
const STDERR_KEEP = 2048
const MAX_LINE = 8 * 1024 * 1024

const plain = (text) => new Error(text)
const timedOut = (ms) => {
  const seconds = Math.max(1, Math.round(ms / 1000))
  return plain(`It didn’t answer within ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`)
}

/* The last thing a program said on stderr, for "It stopped: …". */
function lastWords(stderr) {
  const line = stderr.split('\n').map((item) => item.trim()).filter(Boolean).pop() || ''
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

/* An app opened from Finder gets a bare PATH; npx and uvx usually live in Homebrew's or ~/.local.
   ponytail: guessed folders, not the login shell's PATH; read `zsh -lc 'echo $PATH'` if one is missed. */
function searchPath(given = '') {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')]
  return [...new Set([...String(given).split(':').filter(Boolean), ...extra])].join(':')
}

/* ---- a web address ---- */

function httpTransport({ url, headers = {} }, { fetch, timeout }) {
  let session = ''
  let protocol = ''
  const headersNow = () => ({
    ...headers,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(session ? { 'mcp-session-id': session } : {}),
    ...(protocol ? { 'mcp-protocol-version': protocol } : {}),
  })

  async function send(message) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      let response
      try {
        response = await fetch(url, { method: 'POST', headers: headersNow(), body: JSON.stringify(message), signal: controller.signal })
      } catch (error) {
        throw controller.signal.aborted ? timedOut(timeout) : unreachable(error)
      }
      session = response.headers.get('mcp-session-id') || session
      if (!response.ok) {
        response.body?.cancel().catch(() => {})
        throw refused(response.status)
      }
      if (message.id === undefined) {
        response.body?.cancel().catch(() => {})
        return null
      }
      if ((response.headers.get('content-type') || '').includes('text/event-stream')) return await fromStream(response.body, message.id)
      const found = [].concat(await response.json().catch(() => null)).find((item) => item?.id === message.id)
      if (!found) throw plain('It answered with something OSAT couldn’t read.')
      return found
    } catch (error) {
      throw controller.signal.aborted ? timedOut(timeout) : error
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    send,
    agreed: (version) => { protocol = version },
    close() {
      // Ends the session on the app's side; refused offline like any request, which is fine.
      if (session) fetch(url, { method: 'DELETE', headers: headersNow() }).then((response) => response.body?.cancel(), () => {}).catch(() => {})
    },
  }
}

/* An answer sent as events: `data:` lines, each event ending at a blank line. Other messages the
   app sends first (progress, logs) are passed over until the answer with our id arrives. */
async function fromStream(body, id) {
  if (!body) throw plain('It stopped before answering.')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = done ? '' : events.pop()
      for (const event of events) {
        const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n')
        let message = null
        try {
          message = JSON.parse(data)
        } catch {
          continue
        }
        const found = [].concat(message).find((item) => item?.id === id && ('result' in item || 'error' in item))
        if (found) return found
      }
      if (done) throw plain('It stopped before answering.')
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

function unreachable(error) {
  if (error.code === 'OFFLINE') return error // the Offline lock's own words
  const code = error.cause?.code || error.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return plain('OSAT couldn’t find that address. Check it, and that you’re online.')
  return plain('Nothing answered at that address.')
}

function refused(status) {
  if (status === 401 || status === 403) return plain('It turned OSAT away: it needs a key, or the key isn’t right.')
  if (status === 404) return plain('Nothing answers at that address.')
  if (status === 405 || status === 406 || status === 415) return plain('That address isn’t an app OSAT can use.')
  return plain(`It answered with an error (${status}).`)
}

/* ---- a command on this Mac ---- */

function commandTransport({ command, args = [], env = {} }, { spawn, timeout }) {
  // Its own process group, so closing it also ends what it started (npx starts the real server).
  const child = spawn(command, args, { env: { ...process.env, PATH: searchPath(process.env.PATH), ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  let stderr = ''
  let out = ''
  let ended = null // the plain error once it has stopped
  const waiting = new Map() // id → { resolve, reject, timer }

  function stop(error) {
    if (ended) return
    ended = error
    for (const { reject, timer } of waiting.values()) {
      clearTimeout(timer)
      reject(error)
    }
    waiting.clear()
  }
  const write = (message) => { if (!ended) child.stdin.write(`${JSON.stringify(message)}\n`) }

  function heard(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return // a stray log line
    }
    for (const item of [].concat(message)) {
      if (typeof item?.method === 'string' && item.id !== undefined) {
        // The app asking OSAT something: a ping is answered, the rest politely declined.
        write({ jsonrpc: '2.0', id: item.id, ...(item.method === 'ping' ? { result: {} } : { error: { code: -32601, message: 'OSAT doesn’t do that.' } }) })
      } else if (waiting.has(item?.id)) {
        const { resolve, timer } = waiting.get(item.id)
        clearTimeout(timer)
        waiting.delete(item.id)
        resolve(item)
      }
    }
  }

  child.on('error', (error) => stop(plain(error.code === 'ENOENT' ? `OSAT couldn’t find “${command}” on this Mac.` : `It couldn’t start (${error.code || error.message}).`)))
  child.on('close', () => stop(plain(lastWords(stderr) ? `It stopped: ${lastWords(stderr)}` : 'It stopped before answering.')))
  child.stdin.on('error', () => {})
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    out += chunk
    let at
    while ((at = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, at).trim()
      out = out.slice(at + 1)
      if (line) heard(line)
    }
    if (out.length > MAX_LINE) out = ''
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP) })

  function send(message) {
    if (ended) return Promise.reject(ended)
    if (message.id === undefined) {
      write(message)
      return Promise.resolve(null)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(message.id)
        reject(timedOut(timeout))
      }, timeout)
      waiting.set(message.id, { resolve, reject, timer })
      write(message)
    })
  }

  function close() {
    stop(plain('It was closed.'))
    child.stdin.end()
    const kill = (signal) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      try {
        process.kill(-child.pid, signal)
      } catch {
        child.kill(signal)
      }
    }
    kill('SIGTERM')
    setTimeout(() => kill('SIGKILL'), 3000).unref()
  }

  return { send, close }
}

/* ---- what both share ---- */

/* The words out of a tool's answer; anything that isn't words is named briefly. */
function textOf(result) {
  const parts = (Array.isArray(result?.content) ? result.content : []).map((item) => {
    if (item?.type === 'text') return String(item.text ?? '')
    if (item?.type === 'image') return '(a picture)'
    if (item?.type === 'audio') return '(a sound)'
    if (item?.type === 'resource') return typeof item.resource?.text === 'string' ? item.resource.text : `(a file: ${item.resource?.uri || 'unnamed'})`
    if (item?.type === 'resource_link') return `(a link: ${item.name || item.uri})`
    return '(something OSAT can’t show)'
  })
  if (!parts.length && result?.structuredContent) return JSON.stringify(result.structuredContent)
  return parts.join('\n\n')
}

async function connect(server, { fetch = (...args) => globalThis.fetch(...args), spawn = nodeSpawn, timeout = TIMEOUT, version = '0' } = {}) {
  const transport = server.kind === 'command' ? commandTransport(server, { spawn, timeout }) : httpTransport(server, { fetch, timeout })
  let next = 0
  async function ask(method, params) {
    const answer = await transport.send({ jsonrpc: '2.0', id: ++next, method, ...(params ? { params } : {}) })
    if (answer.error) throw plain(`It answered: ${String(answer.error.message || 'something went wrong').replace(/\.$/, '')}.`)
    return answer.result || {}
  }

  let hello
  try {
    hello = await ask('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'osat', title: 'OSAT', version } })
    // Its version stands when it answers with another one it knows.
    transport.agreed?.(typeof hello.protocolVersion === 'string' ? hello.protocolVersion : PROTOCOL)
    await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  } catch (error) {
    transport.close()
    throw error
  }

  return {
    server: hello.serverInfo || null,
    async tools() {
      const all = []
      let cursor
      for (let page = 0; page < 50; page += 1) {
        const result = await ask('tools/list', cursor ? { cursor } : undefined)
        if (Array.isArray(result.tools)) all.push(...result.tools)
        cursor = result.nextCursor
        if (!cursor) break
      }
      return all
    },
    async call(name, args = {}) {
      const result = await ask('tools/call', { name, arguments: args })
      return { text: textOf(result), isError: result.isError === true }
    },
    close: () => transport.close(),
  }
}

module.exports = { connect, textOf, searchPath, PROTOCOL }
