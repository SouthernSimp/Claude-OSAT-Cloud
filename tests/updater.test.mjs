import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { SWAP, createUpdater, isNewer, pickUpdate } = require('../desktop/updater.cjs')

const asset = (name, size = 100) => ({ name, size, browser_download_url: `https://github.com/x/releases/download/v0.1.9/${name}` })
const release = (tag, extra = {}) => ({
  tag_name: tag,
  assets: [asset('OSAT-0.1.9-arm64-mac.dmg'), asset('OSAT-0.1.9-arm64-mac.zip', 5000), asset('OSAT-0.1.9-arm64-mac.zip.sha256', 65)],
  ...extra,
})

test('versions compare by number, not by text', () => {
  assert.ok(isNewer('0.1.10', '0.1.9'))
  assert.ok(isNewer('v0.2.0', '0.1.99'))
  assert.ok(!isNewer('0.1.9', '0.1.9'))
  assert.ok(!isNewer('0.1.8', '0.1.9'))
  assert.ok(!isNewer('nightly', '0.1.0') && !isNewer('0.1.9', undefined))
})

test('only a newer, complete, non-draft release is offered', () => {
  assert.deepEqual(pickUpdate(release('v0.1.9'), '0.1.0'), {
    version: '0.1.9', name: 'OSAT-0.1.9-arm64-mac.zip', size: 5000,
    url: 'https://github.com/x/releases/download/v0.1.9/OSAT-0.1.9-arm64-mac.zip',
    shaUrl: 'https://github.com/x/releases/download/v0.1.9/OSAT-0.1.9-arm64-mac.zip.sha256',
  })
  assert.equal(pickUpdate(release('v0.1.9'), '0.1.9'), null, 'same build')
  assert.equal(pickUpdate(release('v0.1.9', { draft: true }), '0.1.0'), null)
  assert.equal(pickUpdate(release('v0.1.9', { prerelease: true }), '0.1.0'), null)
  assert.equal(pickUpdate(release('v0.1.9', { assets: release('x').assets.slice(0, 2) }), '0.1.0'), null, 'no checksum file')
  const http = release('v0.1.9'); http.assets[1].browser_download_url = 'http://example.com/a.zip'
  assert.equal(pickUpdate(http, '0.1.0'), null, 'plain http is never fetched')
  assert.equal(pickUpdate(null, '0.1.0'), null)
})

const packaged = (fetchImpl, version = '0.1.0') => createUpdater({
  app: { isPackaged: true, getVersion: () => version },
  dataDir: os.tmpdir(), quit: () => {}, platform: 'darwin', execPath: '/Applications/OSAT.app/Contents/MacOS/OSAT', fetchImpl,
})
const json = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body })

test('check: says current, available, or why it could not look', async () => {
  assert.deepEqual(await packaged(json(release('v0.1.0'))).check(), { state: 'current', version: '0.1.0' })
  assert.deepEqual(await packaged(json(release('v0.1.9'))).check(), { state: 'available', version: '0.1.9', size: 5000 })
  await assert.rejects(packaged(json({}, false)).check(), /couldn’t reach GitHub/)
  await assert.rejects(packaged(async () => { throw new TypeError('fetch failed') }).check(), /Try again when you’re online/)
})

test('a build run from source never offers to replace itself', async () => {
  const dev = createUpdater({ app: { isPackaged: false, getVersion: () => '0.1.0' }, dataDir: os.tmpdir(), quit: () => {}, platform: 'darwin', fetchImpl: () => assert.fail('no request') })
  assert.equal((await dev.check()).state, 'unavailable')
  await assert.rejects(dev.install(), /Check for updates first/)
  await assert.rejects(packaged(json(release('v0.1.9'))).install(), /Check for updates first/, 'install needs a check first')
})

async function swap({ withNew = true, withOld = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-swap-'))
  const target = path.join(root, 'Apps', 'OSAT.app')
  const fresh = path.join(root, 'updates', 'new', 'OSAT.app')
  const keep = path.join(root, 'updates', 'previous')
  await fs.mkdir(path.dirname(target), { recursive: true })
  if (withOld) { await fs.mkdir(target); await fs.writeFile(path.join(target, 'v'), 'old') }
  if (withNew) { await fs.mkdir(fresh, { recursive: true }); await fs.writeFile(path.join(fresh, 'v'), 'new') }
  // pid 2 ** 22 + 1 is not running, so the script does not wait.
  execFileSync('/bin/sh', ['-c', SWAP, 'sh', '4194305', target, fresh, keep, 'true'])
  return { target, keep, read: (file) => fs.readFile(file, 'utf8').catch(() => null) }
}

test('the swap puts the new app in place and keeps the old one', async () => {
  const { target, keep, read } = await swap()
  assert.equal(await read(path.join(target, 'v')), 'new')
  assert.equal(await read(path.join(keep, 'OSAT.app', 'v')), 'old')
})

test('a missing download changes nothing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-swap-'))
  const target = path.join(root, 'OSAT.app')
  await fs.mkdir(target); await fs.writeFile(path.join(target, 'v'), 'old')
  assert.throws(() => execFileSync('/bin/sh', ['-c', SWAP, 'sh', '4194305', target, path.join(root, 'nope'), path.join(root, 'keep'), 'true']))
  assert.equal(await fs.readFile(path.join(target, 'v'), 'utf8'), 'old')
})
