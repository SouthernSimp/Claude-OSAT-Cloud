import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import net from 'node:net'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createAskApps, splitCommandLine, headerFrom, webAddress, WAITS } = require('../desktop/bots/ask-apps.cjs')
const { createKeychain } = require('../desktop/bots/keychain.cjs')
const { createBots } = require('../desktop/bots/index.cjs')
const { createStore } = require('../desktop/store/index.cjs')
const storeCore = await import('../shared/store-core.mjs')

const TOOLS = [
  { name: 'list_events', description: 'Lists events.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'create_event', description: 'Makes an event.', inputSchema: { type: 'object' } },
]

/* Ask apps in a temp folder, with a Keychain in memory, a stand-in connection and timers to fire by hand. */
async function setup({ claude } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-ask-apps-'))
  const file = path.join(dir, 'ask-apps.json')
  const claudeConfig = path.join(dir, 'claude_desktop_config.json')
  if (claude) await fs.writeFile(claudeConfig, JSON.stringify(claude))
  const keychain = createKeychain({ platform: 'memory' })
  const started = []
  const closed = []
  const timers = new Set()
  const world = { offline: false, fail: null }
  let n = 0
  const connect = async (server) => {
    started.push(server)
    if (world.fail) throw new Error(world.fail)
    return {
      tools: async () => TOOLS,
      call: async (name, args) => {
        if (name === 'broken') throw new Error('It stopped before answering.')
        return { text: `${name} ${JSON.stringify(args)}`, isError: false }
      },
      close: () => closed.push(server),
    }
  }
  const apps = createAskApps({
    file,
    keychain,
    claudeConfig,
    connect,
    offline: () => world.offline,
    ownPort: () => 47823,
    makeId: () => `app${++n}`,
    now: () => '2026-10-08T10:00:00.000Z',
    timers: { setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.add(timer); return timer }, clearTimeout: (timer) => timers.delete(timer) },
  })
  await apps.load()
  const onDisk = async () => fs.readFile(file, 'utf8')
  return { apps, keychain, started, closed, timers, world, file, onDisk }
}

test('a command line: quotes group words, NAME=value in front is its env; a key as typed becomes a header', () => {
  assert.deepEqual(splitCommandLine('NOTION_TOKEN=abc=1 npx -y "@notionhq/notion-mcp-server" \'two words\' back\\ slash'), {
    command: 'npx', args: ['-y', '@notionhq/notion-mcp-server', 'two words', 'back slash'], env: { NOTION_TOKEN: 'abc=1' },
  })
  assert.throws(() => splitCommandLine('npx "open'), /quote in the command isn’t closed/)
  assert.throws(() => splitCommandLine('  '), /Write the command/)
  assert.throws(() => splitCommandLine('A=1'), /Write the command/)
  assert.deepEqual(headerFrom('sk-123'), { Authorization: 'Bearer sk-123' })
  assert.deepEqual(headerFrom('Bearer abc'), { Authorization: 'Bearer abc' })
  assert.deepEqual(headerFrom('X-Api-Key: abc'), { 'X-Api-Key': 'abc' })
  assert.deepEqual(headerFrom(''), {})
  assert.equal(webAddress('https://mcp.notion.com/mcp'), 'https://mcp.notion.com/mcp')
  assert.equal(webAddress('http://127.0.0.1:3000/mcp'), 'http://127.0.0.1:3000/mcp')
  assert.throws(() => webAddress('http://mcp.example.com/mcp'), /starting with https/, 'a key never crosses the network unlocked')
  assert.throws(() => webAddress('https://me:secret@mcp.example.com/'), /key box/)
  assert.throws(() => webAddress('notion'), /starting with https/)
})

test('add a web address with a key: on at once, checked, and the key is only in the Keychain', async () => {
  const { apps, keychain, started, onDisk } = await setup()
  const row = await apps.add({ kind: 'http', url: 'https://mcp.notion.com/mcp', header: 'secret-key-123' })
  assert.deepEqual(row, {
    id: 'app1', name: 'notion.com', kind: 'http', on: true, where: 'https://mcp.notion.com/mcp', withKey: true, from: '',
    tools: 2, toolNames: ['list_events', 'create_event'], error: '', checkedAt: '2026-10-08T10:00:00.000Z',
  })
  assert.deepEqual(started, [{ kind: 'http', url: 'https://mcp.notion.com/mcp', headers: { Authorization: 'Bearer secret-key-123' } }])
  const saved = await onDisk()
  assert.ok(!saved.includes('secret-key-123'))
  assert.deepEqual(JSON.parse(saved)[0].secrets, ['Authorization'])
  assert.deepEqual(JSON.parse(Buffer.from(await keychain.get('ask-app-app1'), 'base64').toString()), { headers: { Authorization: 'Bearer secret-key-123' } })
})

test('add a command line: its env goes to the Keychain, and the line is shown with the value as dots', async () => {
  const { apps, keychain, started, onDisk, file } = await setup()
  const row = await apps.add({ name: '  Notion ', kind: 'command', command: 'NOTION_TOKEN=ntn_secret npx -y @notionhq/notion-mcp-server' })
  assert.equal(row.name, 'Notion')
  assert.equal(row.where, 'NOTION_TOKEN=•••• npx -y @notionhq/notion-mcp-server')
  assert.deepEqual(started, [{ kind: 'command', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_secret' } }])
  await apps.add({ kind: 'command', command: 'A=1 run-it', env: { B: '2' } })
  assert.deepEqual(started[1].env, { A: '1', B: '2' }, 'env in front of the line and env given both count')
  assert.ok(!(await onDisk()).includes('ntn_secret'))
  assert.ok((await keychain.get('ask-app-app1')).length > 0)
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  await assert.rejects(apps.add({ kind: 'http', url: 'http://mcp.example.com/' }), /https/)
  await assert.rejects(apps.add({ kind: 'command', command: '' }), /Write the command/)
  // Read back by a new OSAT: the same list, nothing running yet.
  const again = createAskApps({ file, keychain })
  await again.load()
  assert.deepEqual(again.status().apps.map((app) => [app.name, app.on, app.tools, app.where]), [['Notion', true, 2, 'NOTION_TOKEN=•••• npx -y @notionhq/notion-mcp-server'], ['run-it', true, 2, 'A=•••• B=•••• run-it']])
  assert.deepEqual(again.running(), [])
})

const CLAUDE = {
  mcpServers: {
    notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_from_claude' } },
    osat: { command: 'npx', args: ['-y', 'mcp-remote@latest', 'http://127.0.0.1:47823/mcp', '--allow-http'], env: { AUTH_HEADER: 'Bearer k' } },
    'osat-web': { type: 'http', url: 'http://127.0.0.1:47823/mcp' },
    calendar: { type: 'http', url: 'https://calendar.example.com/mcp', headers: { Authorization: 'Bearer cal' } },
    filesystem: { command: '/usr/local/bin/mcp-fs', args: ['/Users/nate/My Notes'] },
    broken: { nothing: true },
  },
}

test('import from Claude Desktop: names and command lines shown, OSAT’s own connector left out, nothing started', async () => {
  const { apps, keychain, started, onDisk } = await setup({ claude: CLAUDE })
  const offered = await apps.claudeOffers()
  assert.deepEqual(offered.apps, [
    { name: 'notion', kind: 'command', where: 'NOTION_TOKEN=•••• npx -y @notionhq/notion-mcp-server', withKey: true, added: false },
    { name: 'calendar', kind: 'http', where: 'https://calendar.example.com/mcp', withKey: true, added: false },
    { name: 'filesystem', kind: 'command', where: '/usr/local/bin/mcp-fs \'/Users/nate/My Notes\'', withKey: false, added: false },
  ])
  const result = await apps.importClaude(['notion', 'calendar', 'osat'])
  assert.deepEqual(result.added.map((row) => [row.name, row.on, row.from, row.tools]), [['notion', false, 'Claude Desktop', null], ['calendar', false, 'Claude Desktop', null]])
  assert.deepEqual(started, [], 'an imported app waits until Nate turns it on')
  const saved = await onDisk()
  assert.ok(!saved.includes('ntn_from_claude') && !saved.includes('Bearer cal'), 'env values and keys never reach the file')
  assert.match(Buffer.from(await keychain.get('ask-app-app1'), 'base64').toString(), /ntn_from_claude/)
  assert.deepEqual((await apps.importClaude(['notion'])).added, [], 'the same one twice comes once')
  assert.deepEqual((await apps.claudeOffers()).apps.map((item) => item.added), [true, true, false])
  // Turned on, it starts with the env it was imported with.
  await apps.toggle('app1', true)
  assert.deepEqual(started, [{ kind: 'command', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_from_claude' } }])
})

test('no Claude Desktop settings: said plainly', async () => {
  const { apps } = await setup()
  await assert.rejects(apps.claudeOffers(), /Claude Desktop’s settings aren’t on this Mac/)
})

test('on, off, remove and Undo; a call to an app that is off says so', async () => {
  const { apps, keychain, closed, onDisk } = await setup({ claude: CLAUDE })
  await apps.importClaude(['notion', 'calendar'])
  await assert.rejects(apps.call('app1', 'list_events', {}), /notion is off\. Turn it on in Settings → Bots first/)
  assert.equal((await apps.toggle('app1', true)).tools, 2)
  assert.deepEqual(await apps.call('app1', 'list_events', { day: 'today' }), { text: 'list_events {"day":"today"}', isError: false })
  assert.deepEqual(apps.running(), ['app1'])
  await apps.toggle('app1', false)
  assert.deepEqual(apps.running(), [])
  assert.equal(closed.length, 1)
  assert.deepEqual(await apps.remove('app1'), { name: 'notion' })
  assert.equal(await keychain.get('ask-app-app1'), null)
  assert.deepEqual(JSON.parse(await onDisk()).map((app) => app.name), ['calendar'])
  const back = await apps.undoRemove()
  assert.equal(back.name, 'notion')
  assert.deepEqual(apps.status().apps.map((app) => app.name), ['notion', 'calendar'], 'back in its place')
  assert.match(Buffer.from(await keychain.get('ask-app-app1'), 'base64').toString(), /ntn_from_claude/)
  await assert.rejects(apps.undoRemove(), /nothing to put back/)
})

test('what the apps that are on can do, for Ask; a failed call starts fresh next time', async () => {
  const { apps, started, closed } = await setup()
  await apps.add({ kind: 'http', url: 'https://one.example.com/mcp' })
  const two = await apps.add({ kind: 'http', url: 'https://two.example.com/mcp' })
  await apps.toggle(two.id, false)
  assert.deepEqual(await apps.tools(), [
    { app: 'app1', appName: 'one.example.com', name: 'list_events', description: 'Lists events.', inputSchema: { type: 'object' }, readOnly: true },
    { app: 'app1', appName: 'one.example.com', name: 'create_event', description: 'Makes an event.', inputSchema: { type: 'object' }, readOnly: false },
  ])
  await assert.rejects(apps.call('app1', 'broken'), /stopped before answering/)
  assert.equal(closed.length, 2, 'two was closed when turned off, one after its failed call')
  await apps.call('app1', 'list_events')
  assert.equal(started.length, 3)
})

test('a connection that can’t start keeps its reason on its row', async () => {
  const { apps, world } = await setup()
  world.fail = 'Nothing answered at that address.'
  const row = await apps.add({ kind: 'http', url: 'https://down.example.com/mcp' })
  assert.deepEqual([row.on, row.tools, row.error], [true, null, 'Nothing answered at that address.'])
  assert.deepEqual(apps.running(), [])
  world.fail = null
  assert.deepEqual([(await apps.check(row.id)).error, apps.status().apps[0].tools], ['', 2])
})

test('offline: nothing starts, using one says it waits, and going offline closes them all', async () => {
  const { apps, started, closed, world } = await setup()
  await apps.add({ kind: 'command', command: 'npx -y some-server' })
  await apps.call('app1', 'list_events')
  world.offline = true
  apps.closeAll() // main does this through bots.changed() when Offline turns on
  assert.deepEqual(apps.running(), [])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(closed.length, 1)
  await assert.rejects(apps.call('app1', 'list_events'), (error) => error.message === WAITS)
  assert.equal((await apps.check('app1')).error, WAITS)
  assert.deepEqual(await apps.tools(), [])
  const added = await apps.add({ kind: 'command', command: 'npx -y other-server' })
  assert.deepEqual([added.on, added.tools], [true, null], 'added offline, it is checked back online')
  assert.equal(started.length, 1, 'nothing started while offline')
  world.offline = false
  assert.equal(apps.status().apps[0].error, '', 'back online, it no longer says it waits')
  await apps.call('app1', 'list_events')
  assert.equal(started.length, 2)
})

test('a connection closes after 10 idle minutes; using it again starts the clock again', async () => {
  const { apps, timers, closed, started } = await setup()
  await apps.add({ kind: 'http', url: 'https://one.example.com/mcp' })
  assert.equal(timers.size, 1)
  const [first] = timers
  assert.equal(first.ms, 10 * 60 * 1000)
  await apps.call('app1', 'list_events')
  assert.equal(timers.size, 1)
  assert.notEqual([...timers][0], first, 'each use starts the 10 minutes again')
  ;[...timers][0].fn()
  assert.deepEqual(apps.running(), [])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(closed.length, 1)
  await apps.call('app1', 'list_events')
  assert.equal(started.length, 2, 'the next use starts it again')
})

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) })
})

/* Bots as main wires it (temp folder, a Keychain in memory), with OSAT's own connector as the app:
   Ask's side (createBots().askApps) lists only what an app that may only look can do, and calls it. */
test('wired into Bots: Ask lists and uses an app that is on, here OSAT’s own connector', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-ask-apps-bots-'))
  await fs.writeFile(path.join(dir, 'bots.json'), JSON.stringify({ connector: { port: await freePort() } }))
  const store = await createStore({ dir: path.join(dir, 'store'), core: storeCore, writeDelay: 0, maxDelay: 0 })
  const handlers = {}
  const bots = await createBots({
    dataDir: dir,
    nodesDir: path.join(dir, 'nodes'),
    service: 'OSAT-Test',
    store,
    sharedModule: (name) => import(`../shared/${name}`),
    handle: (channel, work, options) => { handlers[channel] = { work, from: options?.from } },
    fail: (message) => { throw new Error(message) },
    send: () => {},
    shell: {},
    clipboard: { writeText: () => {} },
    keychain: createKeychain({ platform: 'memory' }),
  })
  const ipc = (channel, ...args) => handlers[channel].work(...args)
  try {
    assert.deepEqual(['status', 'add', 'remove', 'undo-remove', 'toggle', 'check', 'claude-config', 'import', 'tools', 'call'].map((name) => handlers[`askapps:${name}`].from),
      ['app', 'app', 'app', 'app', 'app', 'app', 'app', 'app', 'any', 'any'], 'the quick bar’s Ask may list and call; only the desk manages')
    await ipc('bots:connector-on')
    const { key } = await bots.appKey('Ask test', 'read')
    const row = await ipc('askapps:add', { kind: 'http', name: 'Myself', url: ipc('bots:status').connector.url, header: key })
    assert.deepEqual([row.on, row.error, row.tools > 0], [true, '', true])
    assert.deepEqual(ipc('bots:status').askApps.map((app) => app.name), ['Myself'])
    const tools = await bots.askApps.tools()
    assert.ok(tools.length && tools.every((tool) => tool.app === row.id && tool.appName === 'Myself' && tool.readOnly), 'an app that may only look shows only what looks')
    assert.ok(tools.some((tool) => tool.name === 'search'))
    const found = await bots.askApps.call(row.id, 'search', { query: 'nothing like this' })
    assert.equal(found.isError, false)
    assert.ok(!(await fs.readFile(path.join(dir, 'ask-apps.json'), 'utf8')).includes(key), 'the key never reaches the file')
  } finally {
    bots.stop()
  }
})
