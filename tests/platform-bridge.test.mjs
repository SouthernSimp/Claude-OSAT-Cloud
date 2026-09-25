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
const { DATA_MARKER, claimDataFolder } = require('../desktop/data-folder.cjs')
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

test('the data folder is claimed without touching an older app\'s data', async (t) => {
  const directory = await fixture(t)
  const now = () => new Date('2026-09-25T12:00:00Z')

  const fresh = path.join(directory, 'fresh', 'OSAT')
  assert.deepEqual(claimDataFolder(fresh, { now }), { folder: fresh, movedAside: null })
  assert.match(await readFile(path.join(fresh, DATA_MARKER), 'utf8'), /ai\.mccreery\.osat/)
  await writeFile(path.join(fresh, 'notes.json'), 'mine')
  assert.equal(claimDataFolder(fresh, { now }).movedAside, null)
  assert.equal(await readFile(path.join(fresh, 'notes.json'), 'utf8'), 'mine')

  const older = path.join(directory, 'OSAT')
  await mkdir(older)
  await writeFile(path.join(older, 'old.json'), 'older app')
  await mkdir(`${older} (before 2026-09-25)`)
  const claimed = claimDataFolder(older, { now })
  assert.equal(claimed.movedAside, `${older} (before 2026-09-25) 2`)
  assert.equal(await readFile(path.join(claimed.movedAside, 'old.json'), 'utf8'), 'older app')
  assert.match(await readFile(path.join(older, DATA_MARKER), 'utf8'), /ai\.mccreery\.osat/)

  const empty = path.join(directory, 'empty')
  await mkdir(empty)
  assert.equal(claimDataFolder(empty, { now }).movedAside, null)
})

test('platform metadata uses the OSAT identity and its own data folder in both modes', async () => {
  const read = (relative) => readFile(path.join(root, relative), 'utf8')
  const pkg = JSON.parse(await read('package.json'))
  const [index, main, preload, entitlements] = await Promise.all([
    read('index.html'),
    read('desktop/main.cjs'),
    read('desktop/preload.cjs'),
    read('build/entitlements.mas.plist'),
  ])

  assert.equal(pkg.name, 'osat')
  assert.equal(pkg.build.appId, 'ai.mccreery.osat')
  assert.equal(pkg.build.productName, 'OSAT')
  assert.deepEqual(pkg.build.masDev, {
    entitlements: 'build/entitlements.mas.plist',
    entitlementsInherit: 'build/entitlements.mas.inherit.plist',
  })
  assert.equal(Object.keys(pkg.dependencies).some((dependency) => dependency.startsWith('@tiptap/')), false)
  assert.match(index, /<title>OSAT<\/title>/)
  assert.doesNotMatch(index, /manifest|pwa-register|apple-mobile-web-app/)
  assert.match(main, /app\.isPackaged \? 'OSAT' : 'OSAT Dev'/)
  assert.match(main, /app\.setName\('OSAT'\)/)
  assert.doesNotMatch(main, /'NateOS'|'OSAT V2'|'OSAT Field'/)
  assert.doesNotMatch(main, /MINDMAP_URL|mccreery\.ai\/mindmap|mindmap:open/)
  assert.match(preload, /files:write-text/)
  assert.doesNotMatch(preload, /osatSecrets|secrets:|app:open-assistant/)
  assert.match(main, /if \(stat\.isDirectory\(\)\) \{\s+shell\.showItemInFolder\(target\)/)
  assert.match(entitlements, /com\.apple\.security\.app-sandbox/)
  assert.match(entitlements, /com\.apple\.security\.files\.user-selected\.read-write/)
  assert.match(main, /globalShortcut\.register\(process\.platform === 'darwin' \? 'Alt\+Space'/)
  assert.match(main, /createSurfaceWindow\('quick-capture'/)
  assert.doesNotMatch(main, /createSurfaceWindow\('assistant'/)
  assert.match(preload, /quick-capture:done/)
  assert.match(preload, /store:commit-sync/)
  assert.match(main, /requestSingleInstanceLock/)
  assert.deepEqual(pkg.build.asarUnpack.includes('shared/**'), true)

  const forbiddenExpansion = ['One', 'Step', 'Atta', 'Time'].join(' ')
  assert.equal([pkg.description, index, main].join('\n').includes(forbiddenExpansion), false)
})
