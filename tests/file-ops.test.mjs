import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { TidyError, cleanName, makeFolder, moveInto, rename, toBin } = require('../desktop/file-ops.cjs')

async function stage() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'osat-tidy-'))
  const bin = path.join(root, 'bin')
  await mkdir(bin)
  const at = (...parts) => path.join(root, ...parts)
  // A stand-in Bin that says where each file landed, like the Mac's.
  const trash = async (file) => {
    const to = path.join(bin, path.basename(file))
    await (await import('node:fs/promises')).rename(file, to)
    return to
  }
  return { root, at, trash, done: () => rm(root, { recursive: true, force: true }) }
}
const names = async (dir) => (await readdir(dir)).sort()

test('a new folder is "untitled folder", then "untitled folder 2"', async () => {
  const t = await stage()
  try {
    assert.equal(await makeFolder(t.root), 'untitled folder')
    assert.equal(await makeFolder(t.root), 'untitled folder 2')
  } finally { await t.done() }
})

test('names: no slashes, colons or dots in front; spaces are trimmed', () => {
  assert.equal(cleanName('  Taxes 2026 '), 'Taxes 2026')
  for (const bad of ['', '   ', 'a/b', 'a:b', '..', '.hidden', 'x'.repeat(300), null]) assert.throws(() => cleanName(bad), TidyError)
})

test('rename keeps the file, refuses a taken name, allows a change of case, and undoes', async () => {
  const t = await stage()
  try {
    await writeFile(t.at('a.txt'), 'one')
    await writeFile(t.at('b.txt'), 'two')
    await assert.rejects(rename(t.at('a.txt'), 'b.txt'), /already there/)
    const { to, undo } = await rename(t.at('a.txt'), 'A.txt')
    assert.equal(await readFile(to, 'utf8'), 'one')
    assert.deepEqual((await names(t.root)).filter((n) => /\.txt$/.test(n)), ['A.txt', 'b.txt'])
    assert.equal((await undo()).failed, null)
    assert.deepEqual((await names(t.root)).filter((n) => /\.txt$/.test(n)), ['a.txt', 'b.txt'])
  } finally { await t.done() }
})

test('moving several into a folder numbers a clash, skips what is already there, and undoes', async () => {
  const t = await stage()
  try {
    await mkdir(t.at('Money'))
    await writeFile(t.at('Money', 'bill.pdf'), 'old')
    await writeFile(t.at('bill.pdf'), 'new')
    await writeFile(t.at('note.txt'), 'n')
    const { done, failed, undo } = await moveInto([t.at('bill.pdf'), t.at('note.txt'), t.at('Money', 'bill.pdf')], t.at('Money'))
    assert.equal(failed, null)
    assert.deepEqual(done.map((item) => path.basename(item.to)), ['bill 2.pdf', 'note.txt'])
    assert.deepEqual(await names(t.at('Money')), ['bill 2.pdf', 'bill.pdf', 'note.txt'])
    assert.equal(await readFile(t.at('Money', 'bill.pdf'), 'utf8'), 'old')
    await undo()
    assert.deepEqual(await names(t.at('Money')), ['bill.pdf'])
    assert.equal(await readFile(t.at('bill.pdf'), 'utf8'), 'new')
  } finally { await t.done() }
})

test('a folder can’t go inside itself or its own folders; the rest still moves before it', async () => {
  const t = await stage()
  try {
    await mkdir(t.at('A', 'B'), { recursive: true })
    await writeFile(t.at('x.txt'), 'x')
    const { done, failed } = await moveInto([t.at('x.txt'), t.at('A')], t.at('A', 'B'))
    assert.match(failed, /inside itself/)
    assert.deepEqual(done.map((item) => path.basename(item.to)), ['x.txt'])
    assert.equal((await moveInto([t.at('A')], t.at('A'))).failed.includes('inside itself'), true)
  } finally { await t.done() }
})

test('copy leaves the original, numbers the copy, and undo puts the copy in the Bin', async () => {
  const t = await stage()
  try {
    await writeFile(t.at('a.txt'), 'one')
    const { done, undo } = await moveInto([t.at('a.txt')], t.root, { copy: true, trash: t.trash })
    assert.equal(path.basename(done[0].to), 'a 2.txt')
    assert.deepEqual((await names(t.root)).filter((n) => /\.txt$/.test(n)), ['a 2.txt', 'a.txt'])
    await undo()
    assert.deepEqual((await names(t.root)).filter((n) => /\.txt$/.test(n)), ['a.txt'])
    assert.deepEqual(await names(path.join(t.root, 'bin')), ['a 2.txt'])
  } finally { await t.done() }
})

test('the Bin takes folders whole, and undo brings them back, or says why it can’t', async () => {
  const t = await stage()
  try {
    await mkdir(t.at('Trip'))
    await writeFile(t.at('Trip', 'map.txt'), 'm')
    await writeFile(t.at('a.txt'), 'a')
    const { done, undo } = await toBin([t.at('Trip'), t.at('a.txt')], t.trash)
    assert.equal(done.length, 2)
    assert.deepEqual((await names(t.root)).filter((n) => n !== 'bin'), [])
    await writeFile(t.at('a.txt'), 'someone else')
    const result = await undo()
    assert.match(result.failed, /a\.txt” can’t go back: Something with that name is already there/)
    assert.equal(await readFile(t.at('Trip', 'map.txt'), 'utf8'), 'm')
    assert.equal(await readFile(t.at('a.txt'), 'utf8'), 'someone else')
    assert.deepEqual(await names(path.join(t.root, 'bin')), ['a.txt'])
  } finally { await t.done() }
})

test('a restore hand-off is tried when the Bin is not readable', async () => {
  const t = await stage()
  try {
    await writeFile(t.at('a.txt'), 'a')
    const locked = async (file) => { const to = await t.trash(file); return to }
    const { undo } = await toBin([t.at('a.txt')], locked, async (inBin, to) => { await (await import('node:fs/promises')).rename(inBin, to) })
    // Pretend reading the Bin is refused: the first try fails with EPERM, the hand-off does the move.
    const fs = require('node:fs/promises')
    const real = fs.lstat
    fs.lstat = async (file) => { if (String(file).includes(`${path.sep}bin${path.sep}`)) throw Object.assign(new Error('nope'), { code: 'EPERM' }); return real(file) }
    try { assert.equal((await undo()).failed, null) } finally { fs.lstat = real }
    assert.equal(await readFile(t.at('a.txt'), 'utf8'), 'a')
  } finally { await t.done() }
})

test('a link is moved as a link, never followed', async () => {
  const t = await stage()
  try {
    await mkdir(t.at('Docs'))
    await writeFile(t.at('real.txt'), 'r')
    await symlink(t.at('real.txt'), t.at('link.txt'))
    await moveInto([t.at('link.txt')], t.at('Docs'))
    assert.equal(await readFile(t.at('real.txt'), 'utf8'), 'r')
    assert.deepEqual(await names(t.at('Docs')), ['link.txt'])
  } finally { await t.done() }
})
