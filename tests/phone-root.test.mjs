import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { settleRoot } = require('../desktop/phone-root.cjs')

const write = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text) }
const read = (file) => fs.readFile(file, 'utf8')

test('before the iPhone app exists, the OSAT folder is a plain folder in iCloud Drive', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-root-'))
  const root = await settleRoot({ drive: path.join(home, 'drive'), container: path.join(home, 'app', 'Documents') })
  assert.equal(root, path.join(home, 'drive', 'OSAT'))
  await fs.rm(home, { recursive: true, force: true })
})

test('once the app’s folder exists everything moves into it, and nothing is lost', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-root-'))
  const plain = path.join(home, 'drive', 'OSAT')
  const container = path.join(home, 'app', 'Documents')
  await write(path.join(plain, 'Sync', 'mac-1', '00000001.json'), 'mac change')
  await write(path.join(plain, 'Sync', 'mac-1', 'snapshot.json'), 'mac snapshot')
  await write(path.join(plain, 'Inbox', 'Added', 'Text.txt'), 'old thought')
  await write(path.join(plain, 'Notes', 'Garden.md'), 'garden')
  await write(path.join(plain, 'What lives here.txt'), 'readme')
  await write(path.join(container, 'Sync', 'iphone-1', 'snapshot.json'), 'phone snapshot')
  await write(path.join(container, 'Notes', 'Garden.md'), 'the app has one too')

  const root = await settleRoot({ drive: path.join(home, 'drive'), container })
  assert.equal(root, container)
  assert.equal(await read(path.join(container, 'Sync', 'mac-1', '00000001.json')), 'mac change')
  assert.equal(await read(path.join(container, 'Sync', 'iphone-1', 'snapshot.json')), 'phone snapshot')
  assert.equal(await read(path.join(container, 'Inbox', 'Added', 'Text.txt')), 'old thought')
  assert.equal(await read(path.join(container, 'Notes', 'Garden.md')), 'the app has one too')
  assert.equal(await read(path.join(container, 'Notes', 'Garden (2).md')), 'garden')
  await assert.rejects(fs.access(plain), 'the old folder is gone once empty')
  assert.equal(await settleRoot({ drive: path.join(home, 'drive'), container }), container, 'settling again changes nothing')
  await fs.rm(home, { recursive: true, force: true })
})
