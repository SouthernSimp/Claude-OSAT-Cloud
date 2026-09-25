import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { resolveApprovedPath, resolveApprovedWritePath } = require('../desktop/path-guard.cjs')
const fsPromises = require('node:fs/promises')
const {
  isSafeOpenFilename,
  isSafeTextPreviewName,
  readTextFile,
  writeTextFile,
} = require('../desktop/text-files.cjs')
const { SecretVault } = require('../desktop/secret-vault.cjs')
const root = fileURLToPath(new URL('..', import.meta.url))

async function fixture(t) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'osat-platform-test-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('approved paths contain reads and writes', async (t) => {
  const directory = await fixture(t)
  const approved = path.join(directory, 'approved')
  const outside = path.join(directory, 'outside')
  await mkdir(approved)
  await mkdir(outside)
  await writeFile(path.join(approved, 'note.md'), 'inside')
  await writeFile(path.join(outside, 'secret.md'), 'outside')
  await symlink(outside, path.join(approved, 'escape'))
  await symlink(path.join(approved, 'note.md'), path.join(approved, 'linked.md'))

  assert.equal(await resolveApprovedPath(approved, 'note.md'), path.join(approved, 'note.md'))
  assert.equal(await resolveApprovedWritePath(approved, 'new.md'), path.join(approved, 'new.md'))
  await assert.rejects(resolveApprovedPath(approved, '../outside/secret.md'), /INVALID_RELATIVE_PATH/)
  await assert.rejects(resolveApprovedPath(approved, 'escape/secret.md'), /PATH_OUTSIDE_ROOT/)
  await assert.rejects(resolveApprovedWritePath(approved, 'escape/new.md'), /PATH_OUTSIDE_ROOT/)
  await assert.rejects(resolveApprovedWritePath(approved, 'linked.md'), /PATH_OUTSIDE_ROOT/)
  await assert.rejects(resolveApprovedWritePath(approved, 'nested\\note.md'), /INVALID_RELATIVE_PATH/)
})

test('reviewed text writes reject stale or implicit overwrites', async (t) => {
  const directory = await fixture(t)
  const note = path.join(directory, 'note.md')

  const created = await writeTextFile(note, 'first', null)
  assert.equal((await readTextFile(note)).hash, created.hash)
  await assert.rejects(writeTextFile(note, 'implicit overwrite', null), /WRITE_CONFLICT/)

  const updated = await writeTextFile(note, 'second', created.hash)
  assert.equal((await readTextFile(note)).content, 'second')
  await writeFile(note, 'external edit')
  await assert.rejects(writeTextFile(note, 'stale edit', updated.hash), /WRITE_CONFLICT/)
  assert.equal((await readTextFile(note)).content, 'external edit')
})

test('text reviews are complete and exclude secret config files', async (t) => {
  const directory = await fixture(t)
  const note = path.join(directory, 'note.canvas')
  const content = '0123456789'.repeat(4096)
  await writeFile(note, content)

  const originalOpen = fsPromises.open
  fsPromises.open = async (...args) => {
    const handle = await originalOpen(...args)
    const originalRead = handle.read.bind(handle)
    handle.read = (buffer, offset, length, position) => originalRead(buffer, offset, Math.min(length, 17), position)
    return handle
  }
  try {
    const reviewed = await readTextFile(note)
    assert.equal(reviewed.size, Buffer.byteLength(content))
    assert.equal(reviewed.content, content)
  } finally {
    fsPromises.open = originalOpen
  }

  assert.equal(isSafeTextPreviewName('board.canvas'), true)
  assert.equal(isSafeTextPreviewName('.env'), false)
  assert.equal(isSafeTextPreviewName('.env.production'), false)
  assert.equal(isSafeTextPreviewName('credentials.json'), false)
})

test('system open policy excludes executable and script paths', () => {
  for (const filename of ['note.md', 'board.canvas', 'data.json', 'report.pdf', 'photo.png', 'sheet.xlsx']) {
    assert.equal(isSafeOpenFilename(filename), true)
  }
  for (const filename of ['run.sh', 'script.js', 'image.svg', 'binary', 'installer.pkg', 'application.app']) {
    assert.equal(isSafeOpenFilename(filename), false)
  }
})

test('secret vault persists ciphertext and fails closed', async (t) => {
  const directory = await fixture(t)
  const vaultFile = path.join(directory, 'secure-secrets.json')
  const transform = (value) => Buffer.from(value).map((byte) => byte ^ 0xa5)
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => transform(Buffer.from(value, 'utf8')),
    decryptString: (value) => transform(value).toString('utf8'),
  }
  const vault = new SecretVault(vaultFile, safeStorage, 'darwin')

  await vault.set('gmail.refresh-token', 'top-secret')
  assert.equal(await vault.get('gmail.refresh-token'), 'top-secret')
  assert.deepEqual(await vault.keys(), ['gmail.refresh-token'])
  assert.equal((await readFile(vaultFile, 'utf8')).includes('top-secret'), false)
  assert.equal(await vault.delete('gmail.refresh-token'), true)
  assert.equal(await vault.get('gmail.refresh-token'), null)

  const unavailable = new SecretVault(path.join(directory, 'unavailable.json'), {
    isEncryptionAvailable: () => false,
  }, 'darwin')
  await assert.rejects(unavailable.set('token', 'value'), /SAFE_STORAGE_UNAVAILABLE/)
  await assert.rejects(unavailable.get('token'), /SAFE_STORAGE_UNAVAILABLE/)

  const corruptFile = path.join(directory, 'corrupt.json')
  await writeFile(corruptFile, '{not json')
  const corrupt = new SecretVault(corruptFile, safeStorage, 'darwin')
  await assert.rejects(corrupt.keys(), /SECRET_VAULT_CORRUPT/)
  assert.equal(await readFile(corruptFile, 'utf8'), '{not json')
})

test('platform metadata uses the OSAT Field identity and its own data folder in both modes', async () => {
  const read = (relative) => readFile(path.join(root, relative), 'utf8')
  const pkg = JSON.parse(await read('package.json'))
  const manifest = JSON.parse(await read('public/manifest.webmanifest'))
  const [index, main, preload, serviceWorker, registration, entitlements, modules] = await Promise.all([
    read('index.html'),
    read('desktop/main.cjs'),
    read('desktop/preload.cjs'),
    read('public/service-worker.js'),
    read('public/pwa-register.js'),
    read('build/entitlements.mas.plist'),
    read('src/lib/modules.js'),
  ])

  assert.equal(pkg.name, 'nateos-prototype')
  assert.equal(pkg.build.appId, 'ai.mccreery.osat.field')
  assert.equal(pkg.build.productName, 'OSAT Field')
  assert.deepEqual(pkg.build.masDev, {
    entitlements: 'build/entitlements.mas.plist',
    entitlementsInherit: 'build/entitlements.mas.inherit.plist',
  })
  assert.equal(Object.keys(pkg.dependencies).some((dependency) => dependency.startsWith('@tiptap/')), false)
  assert.equal(manifest.name, 'OSAT Field')
  assert.equal(manifest.short_name, 'OSAT Field')
  assert.match(index, /<title>OSAT Field<\/title>/)
  assert.match(index, /<script type="module" src="\/pwa-register\.js\?v=2"><\/script>/)
  assert.match(index, /worker-src 'self'/)
  assert.match(main, /app\.setPath\('userData', path\.join\(app\.getPath\('appData'\), app\.isPackaged \? 'OSAT Field' : 'OSAT Field Preview'\)\)/)
  assert.doesNotMatch(main, /'NateOS'/)
  assert.doesNotMatch(main, /'OSAT V2'/)
  assert.match(main, /app\.setName\('OSAT Field'\)/)
  assert.doesNotMatch(main, /MINDMAP_URL|mccreery\.ai\/mindmap|mindmap:open/)
  assert.match(preload, /files:write-text/)
  assert.match(preload, /osatSecrets/)
  assert.doesNotMatch(preload, /secrets:get/)
  assert.match(main, /if \(stat\.isDirectory\(\)\) \{\s+shell\.showItemInFolder\(target\)/)
  assert.match(registration, /serviceWorker\.register\('\.\/service-worker\.js'/)
  assert.match(serviceWorker, /osat-field-shell-v1/)
  assert.match(entitlements, /com\.apple\.security\.app-sandbox/)
  assert.match(entitlements, /com\.apple\.security\.files\.user-selected\.read-write/)
  assert.match(main, /globalShortcut\.register\(process\.platform === 'darwin' \? 'Alt\+Space'/)
  assert.match(main, /createSurfaceWindow\('quick-capture'/)
  assert.match(main, /createSurfaceWindow\('assistant'/)
  assert.match(preload, /quick-capture:submit/)
  assert.match(preload, /app:open-assistant/)
  assert.match(modules, /WORKFLOW_NAV/)
  assert.doesNotMatch(modules, /id: "Gmail"|id: "Ideas"/)

  const forbiddenExpansion = ['One', 'Step', 'Atta', 'Time'].join(' ')
  assert.equal([pkg.description, index, main, JSON.stringify(manifest)].join('\n').includes(forbiddenExpansion), false)
})
