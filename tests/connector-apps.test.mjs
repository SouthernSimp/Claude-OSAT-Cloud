import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import net from 'node:net'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as storeCore from '../shared/store-core.mjs'
import { cleanBotSettings } from '../shared/providers.mjs'

const require = createRequire(import.meta.url)
const { createBots } = require('../desktop/bots/index.cjs')
const { createKeychain } = require('../desktop/bots/keychain.cjs')
const { createStore } = require('../desktop/store/index.cjs')

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) })
})

/* Settings → Bots as main wires it, on a temp folder, a Keychain held in memory (never the
   Mac's) and a clock the test moves; IPC handlers are called directly. */
async function bots({ dir, keychain = createKeychain({ platform: 'memory' }) } = {}) {
  dir ||= await fs.mkdtemp(path.join(os.tmpdir(), 'osat-apps-'))
  const file = path.join(dir, 'bots.json')
  if (!(await fs.stat(file).catch(() => null))) await fs.writeFile(file, JSON.stringify({ connector: { port: await freePort() } }))
  const store = await createStore({ dir: path.join(dir, 'store'), core: storeCore, writeDelay: 0, maxDelay: 0 })
  const handlers = {}
  const t = { dir, keychain, store, clock: Date.parse('2026-10-08T10:00:00Z'), copied: '' }
  t.bots = await createBots({
    dataDir: dir,
    nodesDir: path.join(dir, 'nodes'),
    service: 'OSAT-Test',
    store,
    sharedModule: (name) => import(`../shared/${name}`),
    handle: (channel, work) => { handlers[channel] = work },
    fail: (message) => { throw new Error(message) },
    send: () => {},
    shell: {},
    clipboard: { writeText: (text) => { t.copied = text } },
    keychain,
    now: () => t.clock,
  })
  t.ipc = (channel, ...args) => handlers[channel](...args)
  t.status = () => t.ipc('bots:status').connector
  // What Copy setup puts on the clipboard for an app, read back as its key.
  t.keyOf = async (id) => { await t.ipc('bots:copy-setup', 'other', id); return /Bearer (\S+)/.exec(t.copied)[1] }
  t.mcp = async (key, method, params) => {
    const response = await fetch(t.status().url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    return { status: response.status, body: response.status === 200 ? await response.json() : null }
  }
  t.api = async (key, tool, args) => {
    const response = await fetch(t.status().url.replace(/\/mcp$/, `/api/${tool}`), { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(args) })
    return { status: response.status, text: await response.text() }
  }
  return t
}

const sticky = (text) => ({ name: 'add_sticky', arguments: { text } })

test('each app has its own key; one that may only look can’t change anything; Undo says who did it', async () => {
  const t = await bots()
  try {
    const on = await t.ipc('bots:connector-on')
    assert.deepEqual([on.running, on.apps], [true, []])
    await assert.rejects(t.ipc('bots:app-add', { name: '   ', access: 'write' }), /Give the app a name/)
    await t.ipc('bots:app-add', { name: '  Claude   Code ', access: 'write' })
    const { apps } = await t.ipc('bots:app-add', { name: 'Shortcuts', access: 'read' })
    assert.deepEqual(apps.map(({ name, access }) => [name, access]), [['Claude Code', 'write'], ['Shortcuts', 'read']])
    await assert.rejects(t.ipc('bots:app-add', { name: 'claude code', access: 'read' }), /“claude code” is already here/)
    const claude = await t.keyOf(apps[0].id)
    const shortcuts = await t.keyOf(apps[1].id)
    assert.notEqual(claude, shortcuts)
    assert.ok(!JSON.stringify(t.ipc('bots:status')).includes(claude), 'a key never reaches the window')

    assert.equal((await t.mcp('not-a-key', 'tools/list')).status, 401, 'an unknown key is refused')
    const added = await t.mcp(claude, 'tools/call', sticky('Water the garden'))
    assert.match(added.body.result.content[0].text, /^Added a sticky to Unsorted \(note-[\w-]+\)\.$/)
    const note = t.store.load().doc.notes.find((item) => item.markdown === 'Water the garden')
    assert.equal(note.source, 'Claude Code', 'what an app adds carries its name')

    const refused = await t.mcp(shortcuts, 'tools/call', sticky('Sneak in'))
    assert.deepEqual([refused.body.result.isError, refused.body.result.content[0].text], [true, 'Shortcuts can only read. Change that in Settings → Bots.'])
    assert.deepEqual(await t.api(shortcuts, 'add_sticky', { text: 'Sneak in' }), { status: 403, text: 'Shortcuts can only read. Change that in Settings → Bots.\n' })
    assert.ok((await t.mcp(shortcuts, 'tools/list')).body.result.tools.every((tool) => tool.annotations?.readOnlyHint === true), 'it only sees the tools that read')
    assert.ok(!t.store.load().doc.notes.some((item) => item.markdown === 'Sneak in'))

    await t.ipc('bots:app-access', apps[1].id, 'write')
    assert.equal((await t.api(shortcuts, 'add_sticky', { text: 'Now allowed' })).status, 200)
    assert.equal(t.store.load().doc.notes.find((item) => item.markdown === 'Now allowed').source, 'Shortcuts')

    const { recent } = t.status()
    assert.deepEqual(recent.map((item) => item.text), ['Shortcuts added a sticky to Unsorted.', 'Claude Code added a sticky to Unsorted.'])
    await t.ipc('bots:undo-connector', recent[1].at)
    assert.ok(!t.store.load().doc.notes.some((item) => item.markdown === 'Water the garden'), 'Undo takes it back')

    await t.ipc('bots:connector-off')
    const saved = await fs.readFile(path.join(t.dir, 'bots.json'), 'utf8')
    assert.ok(!saved.includes(claude) && !saved.includes(shortcuts), 'keys are never written to bots.json')
    assert.equal(await t.keychain.get(`connector-key-${apps[0].id}`), claude, 'each key lives in the Keychain')
  } finally {
    t.bots.stop()
  }
})

test('removing an app stops its key at once; Undo puts it back with the same key; Reset makes a new one', async () => {
  const t = await bots()
  try {
    await t.ipc('bots:connector-on')
    const [app] = (await t.ipc('bots:app-add', { name: 'Claude Code', access: 'write' })).apps
    const key = await t.keyOf(app.id)
    assert.equal((await t.mcp(key, 'ping')).status, 200)
    const gone = await t.ipc('bots:app-remove', app.id)
    assert.deepEqual([gone.apps, gone.removed], [[], { id: app.id, name: 'Claude Code' }])
    assert.equal((await t.mcp(key, 'ping')).status, 401, 'its key stopped at once')
    assert.equal(await t.keychain.get(`connector-key-${app.id}`), null, 'and left the Keychain')
    const back = await t.ipc('bots:app-undo-remove')
    assert.deepEqual([back.apps.map((item) => item.id), back.removed], [[app.id], null])
    assert.equal((await t.mcp(key, 'ping')).status, 200, 'the same key works again')
    await assert.rejects(t.ipc('bots:app-undo-remove'), /nothing to put back/)

    await t.ipc('bots:app-reset', app.id)
    const fresh = await t.keyOf(app.id)
    assert.notEqual(fresh, key)
    assert.equal((await t.mcp(key, 'ping')).status, 401, 'the old key stopped')
    assert.equal((await t.mcp(fresh, 'ping')).status, 200)
    await assert.rejects(t.ipc('bots:app-remove', 'no-such-app'), /isn’t connected any more/)
  } finally {
    t.bots.stop()
  }
})

test('the one key from before becomes “First app”, able to change things, with the same key', async () => {
  const keychain = createKeychain({ platform: 'memory' })
  await keychain.set('connector-key', 'k-the-old-shared-key-0000')
  const t = await bots({ keychain })
  try {
    const on = await t.ipc('bots:connector-on')
    assert.deepEqual(on.apps.map(({ name, access }) => [name, access]), [['First app', 'write']])
    assert.match((await t.mcp('k-the-old-shared-key-0000', 'tools/call', sticky('Still works'))).body.result.content[0].text, /^Added a sticky to Unsorted/)
    assert.equal(await keychain.get('connector-key'), null, 'the old key moved')
    await t.ipc('bots:app-remove', on.apps[0].id)
  } finally {
    t.bots.stop()
  }
  // Removed for good: the next start doesn't bring it back.
  const again = await bots({ dir: t.dir, keychain })
  try {
    assert.deepEqual((await again.ipc('bots:connector-on')).apps, [])
  } finally {
    again.bots.stop()
  }
})

test('“Used” is saved at most once a minute per app', async () => {
  const t = await bots()
  try {
    await t.ipc('bots:connector-on')
    const [app] = (await t.ipc('bots:app-add', { name: 'Claude Code', access: 'read' })).apps
    const key = await t.keyOf(app.id)
    const usedAt = () => t.status().apps[0].usedAt
    assert.equal(usedAt(), undefined)
    await t.mcp(key, 'ping')
    assert.equal(usedAt(), '2026-10-08T10:00:00.000Z')
    t.clock += 59000
    await t.mcp(key, 'ping')
    assert.equal(usedAt(), '2026-10-08T10:00:00.000Z', 'not again within the minute')
    t.clock += 2000
    await t.mcp(key, 'ping')
    assert.equal(usedAt(), '2026-10-08T10:01:01.000Z')
    await t.mcp('wrong', 'ping')
    assert.equal(usedAt(), '2026-10-08T10:01:01.000Z', 'a wrong key uses nothing')
  } finally {
    t.bots.stop()
  }
})

test('appKey: OSAT’s own features get an app by its exact name, made once', async () => {
  const t = await bots()
  try {
    await t.ipc('bots:connector-on')
    const first = await t.bots.appKey('Siri', 'write')
    const second = await t.bots.appKey('Siri', 'read')
    assert.deepEqual(second, first)
    assert.deepEqual(t.status().apps.map(({ name, access }) => [name, access]), [['Siri', 'write']])
    assert.equal((await t.api(first.key, 'add_sticky', { text: 'From Siri' })).status, 200)
  } finally {
    t.bots.stop()
  }
})

test('settings: apps are cleaned, never keep a key, and a bad or repeated one is dropped', () => {
  const { connector } = cleanBotSettings({
    connector: {
      on: true,
      apps: [
        { id: 'a-1', name: '  Claude\n Code  ', access: 'write', createdAt: '2026-10-08T10:00:00.000Z', usedAt: '2026-10-08T11:00:00.000Z', key: 'k-secret' },
        { id: 'a-2', name: 'x'.repeat(60), access: 'read', createdAt: '2026-10-08T10:00:00.000Z' },
        { id: 'a-1', name: 'Twice', access: 'read' },
        { id: 'A 3; rm -rf', name: 'Bad id', access: 'read' },
        { id: 4, name: 'Number id', access: 'read' },
        { id: 'a-5', name: '   ', access: 'read' },
        { id: 'a-6', name: 'Admin', access: 'everything' },
        null,
        'a-7',
      ],
    },
  })
  assert.deepEqual(connector.apps, [
    { id: 'a-1', name: 'Claude Code', access: 'write', createdAt: '2026-10-08T10:00:00.000Z', usedAt: '2026-10-08T11:00:00.000Z' },
    { id: 'a-2', name: 'x'.repeat(40), access: 'read', createdAt: '2026-10-08T10:00:00.000Z' },
  ])
  assert.deepEqual(cleanBotSettings({ connector: { apps: 'nope' } }).connector.apps, [])
})
