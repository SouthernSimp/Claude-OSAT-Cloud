import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { registerTidy } = require('../desktop/tidy.cjs')
const { resolveApprovedPath, resolveApprovedWritePath } = require('../desktop/path-guard.cjs')

/* The real tidy module over real folders in a temp directory, with files.cjs's pieces stood in. */
async function stage({ ai = null, now = () => new Date(2026, 8, 30, 12) } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'osat-tidy-desk-')))
  const grants = { desktop: path.join(root, 'Desktop'), documents: path.join(root, 'Documents') }
  const bin = path.join(root, 'Bin')
  for (const dir of [...Object.values(grants), bin]) await mkdir(dir)
  const handlers = new Map()
  const undos = new Map()
  const at = (place, ...parts) => path.join(grants[place], ...parts)
  await registerTidy({
    handle: (channel, run) => handlers.set(channel, run),
    fail: (message) => { throw new Error(message) },
    getGrant: (id) => ({ id, root: grants[id], kind: 'folder', place: true }),
    approvedPath: (grant, relative = '') => resolveApprovedPath(grant.root, relative),
    approvedWritePath: (grant, relative) => resolveApprovedWritePath(grant.root, relative),
    folderPath: (grant, relative) => resolveApprovedPath(grant.root, relative),
    sourcePath: async (grant, relative) => {
      const target = await resolveApprovedWritePath(grant.root, relative)
      await lstat(target) // the real one fails the same way for a file that is gone
      return target
    },
    binTrash: async (file) => {
      const to = path.join(bin, path.basename(file))
      await rename(file, to)
      return to
    },
    keepUndo: (undo) => { const token = String(undos.size); undos.set(token, undo); return token },
    dataDir: path.join(root, 'data'),
    ai: () => ai,
    extractText: async () => ({ text: 'Invoice total 40' }),
    sharedModule: (name) => import(pathToFileURL(path.join(process.cwd(), 'shared', name)).href),
    now,
  })
  return { root, at, bin, call: (channel, ...args) => handlers.get(channel)(...args), undo: (token) => undos.get(token)(), done: () => rm(root, { recursive: true, force: true }) }
}

const ls = async (dir) => (await readdir(dir)).sort()

test('with no AI the plan is by kind, moves nothing, and leaves folders, apps and hidden files alone', async () => {
  const t = await stage()
  try {
    for (const name of ['Screenshot 1.png', 'Screenshot 2.png', 'bill.pdf', 'Setup.dmg', '.hidden.png']) await writeFile(t.at('desktop', name), 'x')
    await mkdir(t.at('desktop', 'A folder'))
    await mkdir(t.at('desktop', 'Tool.app'))
    await mkdir(t.at('documents', 'Money'))
    const plan = await t.call('files:tidy-plan')
    assert.equal(plan.how, 'rules')
    assert.deepEqual(plan.groups.map((group) => [group.id, group.names]), [
      ['folder:Screenshots', ['Screenshot 1.png', 'Screenshot 2.png']],
      ['folder:Papers', ['bill.pdf']],
      ['bin', ['Setup.dmg']],
    ])
    assert.equal(plan.menu[0], 'Money')
    assert.deepEqual(await ls(t.at('desktop')), ['.hidden.png', 'A folder', 'Screenshot 1.png', 'Screenshot 2.png', 'Setup.dmg', 'Tool.app', 'bill.pdf'])
  } finally { await t.done() }
})

test('the AI is asked in batches with the fixed shape, and a batch that fails keeps the rules', async () => {
  const asked = []
  const ai = {
    models: () => [{ id: 'osat:x' }],
    chatStream: async ({ messages, schema }) => {
      asked.push({ text: messages[1].content, schema })
      if (asked.length === 2) throw new Error('model fell over')
      const lines = messages[1].content.split('\n').filter((line) => /^\d+\./.test(line))
      return JSON.stringify({ files: lines.map((line) => ({ n: parseInt(line, 10), to: 'Money' })) })
    },
  }
  const t = await stage({ ai })
  try {
    for (let i = 0; i < 30; i += 1) await writeFile(t.at('desktop', `bill ${String(i).padStart(2, '0')}.pdf`), 'x')
    const plan = await t.call('files:tidy-plan')
    assert.equal(asked.length, 2) // 25 + 5
    assert.equal(plan.how, 'ai')
    assert.match(asked[0].text, /starts: Invoice total 40/) // a few are read
    assert.ok(asked[0].schema.properties.files.items.properties.to.enum.includes('Money'))
    assert.deepEqual(plan.groups.map((group) => [group.id, group.names.length]), [['folder:Money', 25], ['folder:Papers', 5]])
  } finally { await t.done() }
})

test('do it: the ticked groups move, a taken name is numbered, and ONE undo puts everything back', async () => {
  const t = await stage()
  try {
    for (const name of ['a.png', 'b.png', 'Setup.dmg', 'keep.txt']) await writeFile(t.at('desktop', name), name)
    await mkdir(t.at('documents', 'Pictures'))
    await writeFile(t.at('documents', 'Pictures', 'a.png'), 'already here')
    const result = await t.call('files:tidy-do', [
      { to: 'folder', folder: 'Pictures', names: ['a.png', 'b.png', 'gone.png'] },
      { to: 'folder', folder: 'Archive/2026-09', names: ['keep.txt'] },
      { to: 'bin', names: ['Setup.dmg'] },
    ])
    assert.deepEqual([result.moved, result.binned, result.failed], [3, 1, null])
    assert.deepEqual(await ls(t.at('desktop')), [])
    assert.deepEqual(await ls(t.at('documents', 'Pictures')), ['a 2.png', 'a.png', 'b.png'])
    assert.equal(await readFile(t.at('documents', 'Pictures', 'a.png'), 'utf8'), 'already here')
    assert.deepEqual(await ls(t.at('documents', 'Archive', '2026-09')), ['keep.txt'])
    assert.deepEqual(await ls(t.bin), ['Setup.dmg'])

    assert.deepEqual(await t.undo(result.undo), { failed: null })
    assert.deepEqual(await ls(t.at('desktop')), ['Setup.dmg', 'a.png', 'b.png', 'keep.txt'])
    assert.equal(await readFile(t.at('desktop', 'a.png'), 'utf8'), 'a.png')
    assert.deepEqual(await ls(t.at('documents')), ['Pictures']) // the Archive folders made for it are gone again
    assert.deepEqual(await ls(t.at('documents', 'Pictures')), ['a.png'])
  } finally { await t.done() }
})

test('do it refuses names that could reach outside the Desktop, and folders that could', async () => {
  const t = await stage()
  try {
    await writeFile(t.at('documents', 'secret.txt'), 's')
    await writeFile(t.at('desktop', 'a.txt'), 'a')
    const sneaky = await t.call('files:tidy-do', [{ to: 'folder', folder: 'Money', names: ['../Documents/secret.txt', '.hidden', 'a/b'] }])
    assert.equal(sneaky.moved, 0)
    const bad = await t.call('files:tidy-do', [{ to: 'folder', folder: '../Outside', names: ['a.txt'] }])
    assert.equal(bad.moved, 0)
    assert.ok(bad.failed)
    assert.deepEqual(await ls(t.at('documents')), ['secret.txt'])
    assert.deepEqual(await ls(t.at('desktop')), ['a.txt'])
  } finally { await t.done() }
})

test('the folder layout makes only what is missing, and Undo removes what it made', async () => {
  const t = await stage()
  try {
    await mkdir(t.at('documents', 'money'))
    const result = await t.call('files:tidy-layout')
    assert.deepEqual(result.made, ['Projects', 'Home', 'School', 'Archive'])
    assert.deepEqual(await ls(t.at('documents')), ['Archive', 'Home', 'Projects', 'School', 'money'])
    await t.undo(result.undo)
    assert.deepEqual(await ls(t.at('documents')), ['money'])
    assert.equal((await t.call('files:tidy-layout')).made.length, 4)
  } finally { await t.done() }
})

test('the archive offer is off until switched on, has no count, and waits a month after "Not now"', async () => {
  let today = new Date(2026, 8, 30, 12)
  const t = await stage({ now: () => today })
  try {
    await writeFile(t.at('desktop', 'old.pdf'), 'x')
    await writeFile(t.at('desktop', 'fresh.pdf'), 'x')
    const longAgo = new Date(2026, 6, 1)
    await utimes(t.at('desktop', 'old.pdf'), longAgo, longAgo)
    // A file's "changed" time can't be set, so both count as new until a month has really passed.
    assert.deepEqual(await t.call('files:tidy-offer'), { on: false, offer: null })
    assert.equal((await t.call('files:tidy-set', true)).on, true)
    assert.equal((await t.call('files:tidy-offer')).offer, null)
    today = new Date(Date.now() + 40 * 86400000)
    const later = await t.call('files:tidy-offer')
    assert.equal(later.offer.folder, `Archive/${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
    assert.deepEqual(later.offer.names, ['fresh.pdf', 'old.pdf'])
    assert.equal((await t.call('files:tidy-later')).offer, null)
    assert.equal((await t.call('files:tidy-set', false)).on, false)
  } finally { await t.done() }
})
