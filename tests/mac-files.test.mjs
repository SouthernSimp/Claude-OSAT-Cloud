import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { MAX_CHARS, extractText, isPackage, locate, searchArgs } = require('../desktop/mac-files.cjs')
const { chatBounds } = require('../desktop/quick-chat.cjs')
const { isSafeOpenFilename } = require('../desktop/text-files.cjs')

test('Spotlight looks only in the folders OSAT may show', () => {
  assert.deepEqual(searchArgs('plan', ['/u/Desktop', '/u/Documents']), ['-onlyin', '/u/Desktop', '-onlyin', '/u/Documents', '-name', 'plan'])
})

test('search results stay inside the folders, skip hidden things and package insides, and rank by name', () => {
  const roots = [{ id: 'desktop', root: '/u/Desktop' }, { id: 'grant', root: '/u/Desktop/Work' }, { id: 'documents', root: '/u/Documents' }]
  const found = locate([
    '/u/Documents/Old/Deep/my plan.txt',
    '/u/Desktop/Plan.pdf',
    '/u/Desktop/.secret/plan.md',
    '/u/Desktop/Tool.app/Contents/plan.plist',
    '/etc/plan',
    '/u/Desktop/Work/plans',
    '/u/Desktopper/plan.txt',
  ], roots, 'plan')
  assert.deepEqual(found, [
    { rootId: 'desktop', relative: 'Plan.pdf', name: 'Plan.pdf' },
    { rootId: 'grant', relative: 'plans', name: 'plans' },
    { rootId: 'documents', relative: 'Old/Deep/my plan.txt', name: 'my plan.txt' },
  ])
})

test('apps and documents made of folders count as one file', () => {
  assert.equal(isPackage('Pages.app'), true)
  assert.equal(isPackage('Trip.key'), true)
  assert.equal(isPackage('Photos'), false)
})

test('OSAT opens documents and media, and only shows apps, scripts and installers in Finder', () => {
  for (const name of ['a.pdf', 'b.mov', 'c.pages', 'd.docx', 'e.mp3']) assert.equal(isSafeOpenFilename(name), true, name)
  for (const name of ['Evil.app', 'run.command', 'x.sh', 'setup.pkg', 'disk.dmg', 'page.html', 'Folder']) assert.equal(isSafeOpenFilename(name), false, name)
})

test('Ask reads PDFs and Word files with the Mac\'s own tools, and text as it is', async (t) => {
  const calls = []
  const exec = async (command, args) => { calls.push([command, args.at(-1)]); return command === 'osascript' ? 'From the PDF\r\n\r\n\r\n\r\nPage two' : 'From Word' }
  assert.deepEqual(await extractText('/f/a.pdf', { exec }), { text: 'From the PDF\n\nPage two', truncated: false })
  assert.deepEqual(await extractText('/f/b.docx', { exec }), { text: 'From Word', truncated: false })
  assert.deepEqual(calls.map(([command]) => command), ['osascript', 'textutil'])
  assert.equal(calls[0][1], '/f/a.pdf')

  const dir = await mkdtemp(path.join(os.tmpdir(), 'osat-files-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(path.join(dir, 'long.md'), 'x'.repeat(MAX_CHARS + 50))
  const long = await extractText(path.join(dir, 'long.md'))
  assert.equal(long.text.length, MAX_CHARS)
  assert.equal(long.truncated, true)

  await assert.rejects(extractText('/f/photo.jpg', { exec }), /UNREADABLE/)
  await assert.rejects(extractText('/f/.env', { exec }), /UNREADABLE/)
  await assert.rejects(extractText('/f/scan.pdf', { exec: async () => '  \n ' }), /EMPTY/)
})

test('the quick chat opens where it was left, or at the top right of the screen under the cursor', () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } },
    { bounds: { x: 1512, y: 0, width: 2560, height: 1440 }, workArea: { x: 1512, y: 25, width: 2560, height: 1415 } },
  ]
  const left = { x: 200, y: 300, width: 400, height: 500 }
  assert.deepEqual(chatBounds(left, displays, { x: 3000, y: 500 }), left)
  assert.deepEqual(chatBounds(null, displays, { x: 3000, y: 500 }), { x: 1512 + 2560 - 420 - 24, y: 25 + 24, width: 420, height: 600 })
  // A screen that went away: back to the top right.
  assert.deepEqual(chatBounds({ x: 9000, y: 0, width: 400, height: 500 }, displays, { x: 10, y: 10 }), { x: 1512 - 420 - 24, y: 38 + 24, width: 420, height: 600 })
})
