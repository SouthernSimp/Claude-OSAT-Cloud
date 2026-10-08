import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { SHORTCUTS, shortcutFile, shortcutPlan } from '../shared/shortcut-file.mjs'

const require = createRequire(import.meta.url)
const { createShortcuts, SHORTCUTS_TOOL } = require('../desktop/bots/shortcuts.cjs')

const OBJ = '￼'
const WHERE = { api: 'http://127.0.0.1:47823/api', key: 'k&<>"ey-0123456789' }

/* Reads an XML property list back, strictly: a stray < or & fails it. */
function readPlist(xml) {
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<!DOCTYPE plist [^>]+>\n<plist version="1.0">\n/)
  const body = xml.slice(xml.indexOf('<plist version="1.0">') + 21, xml.lastIndexOf('</plist>'))
  const tokens = body.match(/<[^>]*>|[^<]+/g).filter((token) => token.trim())
  for (const token of tokens) if (!token.startsWith('<')) assert.doesNotMatch(token, /&(?!amp;|lt;|gt;)/)
  const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  let at = 0
  const close = (tag) => assert.equal(tokens[at++], tag)
  function value() {
    const tag = tokens[at++]
    if (tag === '<true/>') return true
    if (tag === '<false/>') return false
    if (tag === '<array/>') return []
    if (tag === '<string>' || tag === '<integer>') {
      const text = tokens[at].startsWith('<') ? '' : tokens[at++]
      close(tag.replace('<', '</'))
      return tag === '<integer>' ? Number(text) : unescape(text)
    }
    if (tag === '<array>') {
      const list = []
      while (tokens[at] !== '</array>') list.push(value())
      at++
      return list
    }
    if (tag === '<dict>') {
      const dict = {}
      while (tokens[at] !== '</dict>') {
        close('<key>')
        const key = unescape(tokens[at++])
        close('</key>')
        dict[key] = value()
      }
      at++
      return dict
    }
    throw new Error(`Unexpected ${tag}`)
  }
  const result = value()
  assert.equal(at, tokens.length)
  return result
}

const actions = (id) => shortcutPlan(id, WHERE).WFWorkflowActions
const kinds = (id) => actions(id).map((step) => step.WFWorkflowActionIdentifier.replace('is.workflow.actions.', ''))
const params = (id, kind) => actions(id).find((step) => step.WFWorkflowActionIdentifier === `is.workflow.actions.${kind}`).WFWorkflowActionParameters
const items = (dictionary) => Object.fromEntries(dictionary.Value.WFDictionaryFieldValueItems.map((item) => [item.WFKey.Value.string, item.WFValue.Value]))

test('every shortcut is an XML property list that reads back as planned, its key escaped', () => {
  for (const { id, name } of SHORTCUTS) {
    const file = shortcutFile(id, WHERE)
    assert.equal(file.name, name)
    assert.deepEqual(readPlist(file.text), shortcutPlan(id, WHERE))
    assert.ok(file.text.includes('Bearer k&amp;&lt;&gt;"ey-0123456789'))
    assert.ok(!file.text.includes('k&<'))
  }
})

test('each shortcut has its actions, in order', () => {
  assert.deepEqual(kinds('add'), ['ask', 'downloadurl', 'notification'])
  assert.deepEqual(kinds('send'), ['downloadurl', 'notification'])
  assert.deepEqual(kinds('write'), ['ask', 'downloadurl', 'notification'])
  assert.deepEqual(kinds('read'), ['downloadurl', 'showresult'])
  assert.deepEqual(kinds('find'), ['ask', 'urlencode', 'downloadurl', 'showresult'])
  assert.equal(params('add', 'ask').WFAskActionPrompt, 'What should OSAT keep?')
})

test('Add to OSAT posts what was said, with the key, and shows the answer', () => {
  const asked = params('add', 'ask').UUID
  const request = params('add', 'downloadurl')
  assert.equal(request.WFURL.Value.string, 'http://127.0.0.1:47823/api/add_sticky')
  assert.equal(request.WFHTTPMethod, 'POST')
  assert.equal(request.WFHTTPBodyType, 'JSON')
  assert.deepEqual(items(request.WFHTTPHeaders), { Authorization: { string: `Bearer ${WHERE.key}` } })
  const body = items(request.WFJSONValues)
  assert.deepEqual(body.text, { string: OBJ, attachmentsByRange: { '{0, 1}': { Type: 'ActionOutput', OutputUUID: asked, OutputName: 'Provided Input' } } })
  assert.deepEqual(body.source, { string: 'Siri' })
  const shown = params('add', 'notification').WFNotificationActionBody.Value.attachmentsByRange['{0, 1}']
  assert.deepEqual(shown, { Type: 'ActionOutput', OutputUUID: request.UUID, OutputName: 'Contents of URL' })
})

test('Send to OSAT sits in the Share menu and Services, takes links and words, and asks when run alone', () => {
  const plan = shortcutPlan('send', WHERE)
  assert.deepEqual(plan.WFWorkflowTypes, ['ActionExtension', 'QuickActions'])
  assert.deepEqual(plan.WFQuickActionSurfaces, ['Services'])
  assert.deepEqual(plan.WFWorkflowInputContentItemClasses, ['WFStringContentItem', 'WFURLContentItem', 'WFRichTextContentItem'])
  assert.equal(plan.WFWorkflowHasShortcutInputVariables, true)
  assert.equal(plan.WFWorkflowNoInputBehavior.Name, 'WFWorkflowNoInputBehaviorAskForInput')
  const body = items(params('send', 'downloadurl').WFJSONValues)
  assert.deepEqual(body.text.attachmentsByRange['{0, 1}'], { Type: 'ExtensionInput' })
  assert.deepEqual(body.source, { string: 'Share' })
  // The others take no input and sit nowhere special.
  assert.deepEqual(shortcutPlan('add', WHERE).WFWorkflowTypes, [])
  assert.equal(shortcutPlan('add', WHERE).WFWorkflowNoInputBehavior, undefined)
})

test('the journal shortcuts write and read today’s page; Find sends the words encoded', () => {
  const write = params('write', 'downloadurl')
  assert.equal(write.WFURL.Value.string, `${WHERE.api}/add_to_journal`)
  assert.equal(items(write.WFJSONValues).text.attachmentsByRange['{0, 1}'].OutputUUID, params('write', 'ask').UUID)
  const read = params('read', 'downloadurl')
  assert.equal(read.WFHTTPMethod, 'GET')
  assert.equal(read.WFJSONValues, undefined)
  assert.equal(read.WFURL.Value.string, `${WHERE.api}/read_journal`)
  assert.equal(params('read', 'showresult').Text.Value.attachmentsByRange['{0, 1}'].OutputUUID, read.UUID)
  const encode = params('find', 'urlencode')
  assert.equal(encode.WFInput.Value.attachmentsByRange['{0, 1}'].OutputUUID, params('find', 'ask').UUID)
  const url = params('find', 'downloadurl').WFURL.Value
  assert.equal(url.string, `${WHERE.api}/search?query=${OBJ}`)
  assert.deepEqual(url.attachmentsByRange, { [`{${url.string.indexOf(OBJ)}, 1}`]: { Type: 'ActionOutput', OutputUUID: encode.UUID, OutputName: 'URL Encoded Text' } })
})

test('a shortcut only ever talks to OSAT on this Mac, with a key', () => {
  assert.throws(() => shortcutPlan('add', { ...WHERE, api: 'https://example.com/api' }), /only talk to OSAT on this Mac/)
  assert.throws(() => shortcutPlan('add', { ...WHERE, api: 'http://127.0.0.1:47823/api/../x' }), /only talk/)
  assert.throws(() => shortcutPlan('add', { ...WHERE, key: '' }), /Turn on the connector first/)
  assert.throws(() => shortcutPlan('add', { ...WHERE, key: 'has a space in it' }), /Turn on the connector first/)
  assert.throws(() => shortcutPlan('nope', WHERE), /no shortcut called/)
})

async function tempDir() {
  return path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'osat-shortcuts-')), 'shortcuts')
}

test('making a shortcut signs it for people who know me and leaves only the signed file', async () => {
  const dir = await tempDir()
  const calls = []
  const run = async (file, args) => {
    calls.push([file, args])
    const input = args[args.indexOf('--input') + 1]
    assert.equal(await fs.readFile(input, 'utf8'), shortcutFile('add', WHERE).text, 'the unsigned file holds the shortcut')
    await fs.writeFile(args[args.indexOf('--output') + 1], 'AEA1 signed')
  }
  const shortcuts = createShortcuts({ dir, build: shortcutFile, run, platform: 'darwin' })
  const signed = await shortcuts.make('add', WHERE)
  assert.equal(signed, path.join(dir, 'Add to OSAT.shortcut'))
  assert.equal(calls[0][0], SHORTCUTS_TOOL)
  assert.deepEqual(calls[0][1].slice(0, 3), ['sign', '--mode', 'people-who-know-me'])
  assert.deepEqual(await fs.readdir(dir), ['Add to OSAT.shortcut'])
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700)
})

test('a signing failure says so plainly and leaves nothing behind; old signed files go after an hour', async () => {
  const dir = await tempDir()
  const run = async () => { throw Object.assign(new Error('Command failed'), { stderr: 'Error: No account is signed in.\n' }) }
  const failing = createShortcuts({ dir, build: shortcutFile, run, platform: 'darwin' })
  await assert.rejects(failing.make('read', WHERE), (error) => {
    assert.match(error.message, /^Shortcuts couldn’t get “What's in my OSAT journal” ready \(No account is signed in\.\)\./)
    return true
  })
  assert.deepEqual(await fs.readdir(dir), [])

  const old = path.join(dir, 'Find in OSAT.shortcut')
  const fresh = path.join(dir, 'Add to OSAT.shortcut')
  await fs.writeFile(old, 'old')
  await fs.writeFile(fresh, 'fresh')
  const hourAgo = new Date(Date.now() - 61 * 60 * 1000)
  await fs.utimes(old, hourAgo, hourAgo)
  await createShortcuts({ dir, build: shortcutFile, run, platform: 'darwin' }).sweep()
  assert.deepEqual(await fs.readdir(dir), ['Add to OSAT.shortcut'])

  await assert.rejects(createShortcuts({ dir, build: shortcutFile, run, platform: 'linux' }).make('add', WHERE), /in the Mac app/)
})
