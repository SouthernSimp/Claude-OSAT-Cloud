import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as core from '../shared/node-file.mjs'
import { nameMessages, readNameAnswer } from '../shared/ai-tasks.mjs'
import { applyOps, createEmptyDoc } from '../shared/store-core.mjs'
import { createDefaultWorkspace, normalizeWorkspace } from '../src/osat-data.js'
import { acceptProposal, dismissProposal, pileOf } from '../src/nodes-model.js'

const require = createRequire(import.meta.url)
const { createScans, hashFile, nameOf } = require('../desktop/bots/scans.cjs')
const { readScan } = require('../desktop/mac-files.cjs')

const later = () => Date.now() + 60_000 // every file has settled
const PDF = Buffer.from('%PDF-1.4 a pretend scan of a car insurance renewal\n%%EOF\n')

/* A scan folder (Drive's, pretend) and OSAT's data folder, over real temp dirs, putting
   nodes in a plain doc the way the bots module does. */
async function setUp({ read = async () => 'Car insurance renewal notice. Due October 12.', answer = 'Name: Car insurance renewal\nSummary: The renewal notice; pay by October 12.' } = {}) {
  const drive = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-drive-'))
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-data-'))
  let doc = createEmptyDoc()
  let n = 0
  const makeId = (prefix = 'id') => `${prefix}-${++n}`
  const commit = (ops) => { doc = applyOps(doc, ops).doc }
  const scans = createScans({
    dataDir: data,
    folder: () => drive,
    now: later,
    makeId: () => `${++n}`,
    read,
    take: (tree, { name, hash, source, scan }) => {
      const result = core.arrivalOps(doc, tree, { hash, file: name, source, scan, now: '2026-09-29T10:00:00.000Z', makeId })
      if (result.ops) commit(result.ops)
      return result
    },
    addText: (folderId, text) => commit([{ t: 'add', c: 'notes', v: { id: makeId('note'), title: 'Words', markdown: text, folderId, source: 'Scan' } }]),
    propose: async (folderId, text, name) => {
      assert.match(nameMessages({ text, file: name }).at(-1).content, /Car insurance renewal notice/)
      const proposal = readNameAnswer(answer)
      const folder = doc.folders.find((item) => item.id === folderId)
      commit([{ t: 'patch', c: 'folders', id: folderId, v: { from: core.fromOf({ ...folder.from, proposal }) } }])
    },
  })
  return { drive, data, scans, doc: () => doc }
}

test('a new scan becomes a packed New node from Scan; the original stays exactly where it was', async () => {
  const { drive, data, scans, doc } = await setUp()
  const original = path.join(drive, 'Scan_2026-09-29_101403.pdf')
  await fs.writeFile(original, PDF)
  await fs.writeFile(path.join(drive, 'Summary.docx'), 'the Word step’s own file')
  const before = await fs.stat(original)
  assert.equal(await scans.look(), 1)
  await scans.settled()
  const [node] = doc().folders
  assert.deepEqual([node.name, node.fresh, node.packed, node.from.source, node.from.file], ['Scan 2026-09-29 101403', true, true, 'Scan', 'Scan_2026-09-29_101403.pdf'])
  assert.match(node.from.scan, /^scan-\d+\.pdf$/)
  assert.deepEqual(await fs.readFile(path.join(data, 'scans', node.from.scan)), PDF, 'OSAT keeps its own copy')
  const after = await fs.stat(original)
  assert.deepEqual([await fs.readFile(original), after.mtimeMs, after.ino], [PDF, before.mtimeMs, before.ino], 'never moved, renamed or changed')
  assert.deepEqual((await fs.readdir(drive)).sort(), ['Scan_2026-09-29_101403.pdf', 'Summary.docx'], 'nothing in the folder is touched')
  assert.deepEqual(pileOf(doc().notes, node.id).map((note) => note.markdown), ['Car insurance renewal notice. Due October 12.'], 'the words are a sticky, for ⌘K and Unpack')
  assert.deepEqual(doc().folders[0].from.proposal, { name: 'Car insurance renewal', summary: 'The renewal notice; pay by October 12.' })
  assert.deepEqual(scans.status().arrived.map((item) => item.node), ['Scan 2026-09-29 101403'])
})

test('the same scan renamed in Drive (the Word flow renames them) is still the same scan', async () => {
  const { drive, scans, doc } = await setUp()
  await fs.writeFile(path.join(drive, 'scan.pdf'), PDF)
  await scans.look()
  await fs.rename(path.join(drive, 'scan.pdf'), path.join(drive, 'Car insurance renewal.pdf'))
  assert.equal(await scans.look(), 0)
  assert.equal(doc().folders.length, 1)
})

test('a folder just picked: what’s there is noted, not brought in, until asked', async () => {
  const { drive, scans, doc } = await setUp()
  await fs.writeFile(path.join(drive, 'old one.pdf'), PDF)
  await fs.writeFile(path.join(drive, 'old two.png'), Buffer.from('png bytes'))
  assert.equal(await scans.baseline(drive), 2)
  assert.equal(scans.status().waiting, 2)
  assert.equal(await scans.look(), 0, 'old scans don’t flood in')
  await fs.writeFile(path.join(drive, 'new.jpg'), Buffer.from('a new one'))
  assert.equal(await scans.look(), 1)
  assert.equal(await scans.bringWaiting(), 2)
  await scans.settled()
  assert.deepEqual(doc().folders.map((folder) => folder.name).sort(), ['new', 'old one', 'old two'])
  assert.equal(scans.status().waiting, 0)
  assert.equal(await scans.look(), 0)
})

test('a scan with no words it can read still arrives, and says to name it by hand', async () => {
  const { drive, scans, doc } = await setUp({ read: async () => { throw new Error('no Vision here') } })
  await fs.writeFile(path.join(drive, 'blank.pdf'), PDF)
  await scans.look()
  await scans.settled()
  assert.equal(doc().folders.length, 1)
  assert.equal(doc().notes.length, 0)
  assert.match(scans.status().naming, /couldn’t read words on “blank\.pdf”\. Name it yourself/)
})

test('an AI that answers badly leaves the scan in the Sky, unnamed, and says why', async () => {
  const { drive, scans, doc } = await setUp({ answer: 'I am not sure.' })
  await fs.writeFile(path.join(drive, 'x.pdf'), PDF)
  await scans.look()
  await scans.settled()
  assert.equal(doc().folders[0].from.proposal, undefined)
  assert.match(scans.status().naming, /wasn’t named: The AI didn’t suggest a name/)
})

test('a scan folder that went away says so plainly', async () => {
  const { drive, scans } = await setUp()
  await fs.rm(drive, { recursive: true })
  assert.equal(await scans.look(), 0)
  assert.match(scans.status().error, /isn’t there any more/)
})

test('names, fingerprints and OSAT’s copies', async () => {
  assert.equal(nameOf('/x/Scan_2026-09-29__101403.PDF'), 'Scan 2026-09-29 101403')
  assert.equal(nameOf('___.pdf'), 'Scan')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-hash-'))
  await fs.writeFile(path.join(dir, 'a.pdf'), PDF)
  await fs.writeFile(path.join(dir, 'b.pdf'), PDF)
  assert.equal(await hashFile(path.join(dir, 'a.pdf')), await hashFile(path.join(dir, 'b.pdf')))
  const scans = createScans({ dataDir: dir, folder: () => '', take: () => ({}), addText: () => {}, propose: async () => {}, read: async () => '' })
  assert.equal(scans.copyPath('scan-abc.pdf'), path.join(dir, 'scans', 'scan-abc.pdf'))
  assert.equal(scans.copyPath('../../etc/passwd'), null)
  assert.equal(await scans.look(), 0, 'no folder picked: nothing to do')
})

test('reading a scan on the Mac: only scans, words tidied', async () => {
  const exec = async (command, args) => {
    assert.equal(command, 'osascript')
    assert.ok(args.includes('JavaScript'))
    return 'CAR  INSURANCE \r\nRenewal\n\n\n\nDue Oct 12   \n'
  }
  assert.equal(await readScan('/x/a.pdf', { exec }), 'CAR  INSURANCE\nRenewal\n\nDue Oct 12')
  await assert.rejects(readScan('/x/a.docx', { exec }), /UNREADABLE/)
})

test('confirming a proposed name: the name (a taken one gets 2), the summary first; or keep the name', () => {
  const state = normalizeWorkspace({
    ...createDefaultWorkspace(),
    folders: [
      { id: 'taken', name: 'Car insurance renewal' },
      { id: 's', name: 'Scan 1', packed: true, from: { source: 'Scan', scan: 'scan-1.pdf', proposal: { name: 'Car insurance renewal', summary: 'Pay by Oct 12.' } } },
    ],
    notes: [{ id: 'words', markdown: 'CAR INSURANCE…', folderId: 's', rank: 2048 }],
  })
  const named = acceptProposal(state, 's')
  const node = named.folders.find((folder) => folder.id === 's')
  assert.deepEqual([node.name, node.packed, node.from], ['Car insurance renewal 2', true, { source: 'Scan', scan: 'scan-1.pdf' }])
  assert.deepEqual(pileOf(named.notes, 's').map((note) => note.markdown), ['Pay by Oct 12.', 'CAR INSURANCE…'])
  const kept = dismissProposal(state, 's')
  assert.deepEqual([kept.folders[1].name, kept.folders[1].from], ['Scan 1', { source: 'Scan', scan: 'scan-1.pdf' }])
  assert.equal(acceptProposal(kept, 's'), kept, 'nothing to confirm')
})
