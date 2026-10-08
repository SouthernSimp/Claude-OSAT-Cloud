/* A tiny MCP server over stdin/stdout for tests/mcp-client.test.mjs: one JSON message per line.
   Its tools: echo (words back), env (the SECRET_THING it was started with), pid, slow (never
   answers), crash (says why on stderr and exits). Tools come in two pages, to follow nextCursor. */
import readline from 'node:readline'

const say = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const tool = (name) => ({ name, description: `The ${name} tool.`, inputSchema: { type: 'object' }, annotations: { readOnlyHint: name !== 'crash' } })

// A stray log line on stdout: the client must pass over it.
process.stdout.write('starting up…\n')

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line)
  if (id === undefined) return
  const answer = (result) => say({ jsonrpc: '2.0', id, result })
  if (method === 'initialize') return answer({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } })
  if (method === 'tools/list') {
    return params?.cursor === 'page-2'
      ? answer({ tools: ['pid', 'slow', 'crash'].map(tool) })
      : answer({ tools: ['echo', 'env'].map(tool), nextCursor: 'page-2' })
  }
  if (method === 'tools/call') {
    const { name, arguments: args } = params
    if (name === 'echo') return answer({ content: [{ type: 'text', text: `You said: ${args.words}` }] })
    if (name === 'env') return answer({ content: [{ type: 'text', text: process.env.SECRET_THING || 'none' }] })
    if (name === 'pid') return answer({ content: [{ type: 'text', text: String(process.pid) }] })
    if (name === 'slow') return undefined
    if (name === 'crash') {
      process.stderr.write('warming up\nThe disk is on fire.\n')
      process.exit(3)
    }
    return say({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool ${name}` } })
  }
  return say({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
})
