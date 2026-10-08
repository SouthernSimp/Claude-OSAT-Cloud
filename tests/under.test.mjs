import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const { OfflineError, createUnder, guardFetch, isLocal, refusal } = createRequire(import.meta.url)('../desktop/under.cjs')
const repo = fileURLToPath(new URL('..', import.meta.url))

test('only this Mac counts as local', () => {
  for (const url of [
    'file:///Users/nate/app/index.html', 'file://localhost/tmp/x', 'data:text/plain,hi', 'blob:file:///abc', 'about:blank',
    'devtools://devtools/bundled/inspector.html', 'chrome-extension://abc/x.js',
    'http://127.0.0.1:1234/v1/models', 'http://127.1.2.3/', 'http://localhost:5173/', 'ws://127.0.0.1:5173/', 'http://[::1]:8080/', 'http://app.localhost/',
  ]) assert.equal(isLocal(url), true, url)
  for (const url of [
    'https://huggingface.co/model.gguf', 'https://i.scdn.co/image/abc', 'wss://example.com/', 'http://localhost.example.com/',
    'http://127.0.0.1.nip.io/', 'http://10.0.0.1/', 'http://0.0.0.0/', 'file://server/share/x', 'ftp://127.0.0.1/', 'mailto:a@b.c', '', 'not a url', undefined,
  ]) assert.equal(isLocal(url), false, String(url))
})

test('the main process fetch reaches out only while above; loopback always', async () => {
  let under = false
  const seen = []
  const fetch = guardFetch(async (input) => { seen.push(String(input.url || input)); return 'ok' }, () => under)
  assert.equal(await fetch('https://huggingface.co/x'), 'ok')
  under = true
  await assert.rejects(fetch('https://huggingface.co/x'), OfflineError)
  await assert.rejects(fetch(new URL('https://i.scdn.co/image/a')), (error) => error.code === 'OFFLINE')
  await assert.rejects(fetch(new Request('https://example.com/')), OfflineError)
  assert.equal(await fetch('http://127.0.0.1:1234/api/v0/models'), 'ok')
  assert.deepEqual(seen, ['https://huggingface.co/x', 'http://127.0.0.1:1234/api/v0/models'])
})

test('under, a loopback answer can’t send the main process fetch anywhere else', async () => {
  const asked = []
  const server = http.createServer((request, response) => {
    asked.push(request.url)
    if (request.url === '/elsewhere') return response.end('there')
    response.writeHead(307, { location: `http://127.0.0.1:${server.address().port}/elsewhere` }).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  try {
    let under = false
    const fetch = guardFetch(globalThis.fetch, () => under)
    assert.equal(await (await fetch(url, { method: 'POST', body: 'my notes' })).text(), 'there', 'above, redirects work as always')
    under = true
    await assert.rejects(fetch(url, { method: 'POST', body: 'my notes' }))
    assert.deepEqual(asked, ['/', '/elsewhere', '/'])
  } finally {
    server.close()
  }
})

test('what reaches out answers in plain words while offline; the rest works', () => {
  for (const channel of ['browser:open', 'browser:navigate', 'skills:record-start', 'skills:run', 'files:open', 'search:open-file', 'search:open-app', 'search:open-app-named', 'search:open-link', 'media:now', 'media:control', 'desk:launch', 'terminal:start', 'ai:resume', 'ai:install', 'phone:enable', 'phone:disable', 'askapps:call', 'askapps:check']) {
    assert.match(refusal(channel), /when you’re back online|until you’re back online/, channel)
  }
  // Files on this Mac still list, show and search; the desk shows the Desktop while offline.
  for (const channel of ['skills:list', 'skills:state', 'skills:stop', 'files:list', 'files:thumb', 'files:search', 'files:quick-look', 'browser:state', 'browser:close', 'terminal:list', 'terminal:attach', 'ai:status', 'ai:cancel', 'ai:choose', 'phone:status', 'desk:prefs', 'store:load', 'under:set', 'local-ai:models', 'search:files', 'search:clipboard', 'search:apps', 'search:reveal-file', 'search:paste-clip', 'search:trash-file', 'askapps:status', 'askapps:tools', 'askapps:add', 'askapps:toggle', 'askapps:remove', 'askapps:import', 'askapps:claude-config']) {
    assert.equal(refusal(channel), null, channel)
  }
})

/* A command OSAT starts for an app (Settings → Bots) could reach the internet on its own, past the
   fetch lock: going offline ends it (bots.changed() calls closeAll), and none starts while offline. */
test('an app’s command ends when OSAT goes offline, and none starts while offline', async () => {
  const require = createRequire(import.meta.url)
  const { createAskApps } = require('../desktop/bots/ask-apps.cjs')
  const { connect } = require('../desktop/bots/mcp-client.cjs')
  const { createKeychain } = require('../desktop/bots/keychain.cjs')
  const dir = await mkdtemp(path.join(tmpdir(), 'osat-under-apps-'))
  let offline = false
  let starts = 0
  const apps = createAskApps({
    file: path.join(dir, 'ask-apps.json'),
    keychain: createKeychain({ platform: 'memory' }),
    offline: () => offline,
    connect: (...args) => { starts += 1; return connect(...args) },
  })
  const app = await apps.add({ kind: 'command', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/stdio-mcp.mjs', import.meta.url))] })
  const pid = Number((await apps.call(app.id, 'pid')).text)
  const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }
  assert.equal(alive(), true)
  offline = true
  apps.closeAll()
  for (let i = 0; i < 100 && alive(); i += 1) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(alive(), false, 'going offline ended it')
  await assert.rejects(apps.call(app.id, 'pid'), /wait until you’re back online/)
  assert.match((await apps.check(app.id)).error, /wait until you’re back online/)
  assert.deepEqual(await apps.tools(), [])
  assert.equal(starts, 1, 'nothing started while offline')
})

test('going offline closes the locks first, then pauses, then saves; going online saves first', async () => {
  const steps = []
  let under
  under = createUnder({
    save: async (on) => steps.push(`save ${on} (on: ${under.on})`),
    down: async () => steps.push(`down (on: ${under.on})`),
    up: async () => steps.push(`up (on: ${under.on})`),
    changed: (on) => steps.push(`changed ${on}`),
  })
  assert.equal(await under.set(true), true)
  assert.equal(await under.set(true), true)
  assert.equal(await under.set(false), false)
  assert.deepEqual(steps, ['down (on: true)', 'save true (on: true)', 'changed true', 'save false (on: true)', 'up (on: false)', 'changed false'])
})

test('a failed save leaves nothing half done', async () => {
  const steps = []
  let fails = true
  const under = createUnder({
    save: async () => { if (fails) throw new Error('disk full') },
    down: async () => steps.push('down'),
    up: async () => steps.push('up'),
    changed: (on) => steps.push(`changed ${on}`),
  })
  await assert.rejects(under.set(true), /couldn’t go offline \(disk full\)/)
  assert.equal(under.on, false)
  assert.deepEqual(steps, ['down', 'up'])
  fails = false
  await under.set(true)
  fails = true
  await assert.rejects(under.set(false), /still offline/)
  assert.equal(under.on, true, 'a failed save going back online stays safely offline')
  // At launch, from prefs, nothing has started, so nothing needs pausing.
  const launched = createUnder({ down: () => assert.fail('nothing to pause at launch') })
  launched.begin(true)
  assert.equal(launched.on, true)
})

/* Every way OSAT's main process could reach the internet on its own (desktop/, and the
   shared/ modules main imports). A new one must be added here on purpose, with the
   reason Offline still covers it. */
const MODULE = '(node:)?(http|https|http2|net|tls|dgram|dns|undici)'
const FENCE = [
  [new RegExp(`(require|import)\\(\\s*['"]${MODULE}['"]\\s*\\)|\\bfrom\\s+['"]${MODULE}['"]`), 'a raw network module'],
  [/\bnet\.(request|fetch)\b/, 'Electron’s net'],
  [/\bnew\s+WebSocket\b/, 'a WebSocket'],
  [/\bopenExternal\b/, 'opening a link outside OSAT'],
  [/\bwebRequest\.on[A-Z]/, 'a webRequest listener (a second onBeforeRequest replaces the Offline lock)'],
  // The AI engine runs in its own process, where the main process's fetch lock doesn't reach.
  [/\bfetch\(/, 'a fetch outside the main process', (file) => file === 'desktop/ai/runtime.cjs'],
  // A program Bots starts could reach the internet on its own, where neither lock reaches.
  [/\bspawn\(/, 'a program started for bots', (file) => file.startsWith('desktop/bots/')],
]
const ALLOWED = {
  'desktop/main.cjs': [
    // Refused offline: the check sits on the same line.
    'if (!under.on && /^https:\\/\\//i.test(url)) shell.openExternal(url)',
    // The lock itself. Anything else that wants to see requests belongs inside it.
    'ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: under.on && !isLocal(details.url) }))',
  ],
  'desktop/bots/index.cjs': [
    // A cloud provider's own key or usage page (Settings → Bots). Refused offline on the same line.
    'if (!offline() && /^https:\\/\\//i.test(url)) await shell.openExternal(url)',
  ],
  'desktop/launcher/index.cjs': [
    // A web address Nate chose in the quick search (a keyword like `g cats`, or a link he copied) opens in his own
    // browser. Refused offline on the same line (and search:open-link answers "the web waits").
    'if (!offline() && /^https?:\\/\\//i.test(url)) await shell.openExternal(url)',
  ],
  'desktop/launcher/capture.cjs': [
    // A screenshot or recording by CleanShot X, an app on this Mac: only cleanshot:// commands OSAT builds itself, and
    // never CleanShot's `upload` (shared/capture-model.mjs CLEANSHOT_URL, tested in tests/capture.test.mjs).
    'if (model.CLEANSHOT_URL.test(url)) await shell.openExternal(url)',
  ],
  'desktop/bots/keychain.cjs': [
    // Apple's own `security` tool, which only talks to the Keychain on this Mac.
    "child = spawn(file, args, { stdio: ['pipe', 'ignore', 'ignore'] })",
  ],
  'desktop/bots/mcp-client.cjs': [
    // An app's command (Settings → Bots), only one Nate added, or imported and turned on. Going offline
    // ends it, and none starts while offline (ask-apps.cjs; the test above).
    "const child = spawn(command, args, { env: { ...process.env, PATH: searchPath(process.env.PATH), ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true })",
  ],
  'desktop/bots/connector.cjs': [
    // The OSAT connector: a server that only listens on 127.0.0.1 and never reaches out
    // (tests/connector.test.mjs checks it refuses other hosts and web pages).
    "const http = require('node:http')",
  ],
}

async function sourceFiles(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(full))
    else if (/\.(cjs|mjs)$/.test(entry.name)) files.push(full)
  }
  return files
}

test('no new way out of the Mac slips past Offline', async () => {
  const found = []
  const files = [...await sourceFiles(path.join(repo, 'desktop')), ...await sourceFiles(path.join(repo, 'shared'))]
  for (const file of files) {
    const relative = path.relative(repo, file).split(path.sep).join('/')
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, index) => {
      for (const [pattern, what, only = () => true] of FENCE) {
        if (only(relative) && pattern.test(line) && !(ALLOWED[relative] || []).includes(line.trim())) found.push(`${relative}:${index + 1} ${what}: ${line.trim()}`)
      }
    })
  }
  assert.deepEqual(found, [])
  // The fence itself still catches what it is for.
  const caught = (line, file = 'desktop/x.cjs') => FENCE.some(([pattern, , only = () => true]) => only(file) && pattern.test(line))
  for (const line of ["require('node:https')", "await import('dns')", "import http2 from 'node:http2'", 'ses.webRequest.onBeforeRequest(log)']) assert.ok(caught(line), line)
  assert.ok(caught("fetch('https://x')", 'desktop/ai/runtime.cjs'))
  assert.ok(!caught("fetch('https://x')", 'desktop/media.cjs'), 'the main process fetch is locked already')
  assert.ok(caught("spawn('curl', [url])", 'desktop/bots/x.cjs'))
})
