import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { cleanSettings, keysOf, nameOf } from '../shared/launcher-model.mjs'
import { actionsFor } from '../shared/quick-search-model.mjs'
import { TEXT_ACTIONS, cleanAnswer, replaces, textActionRows, textMessages } from '../shared/selection-model.mjs'

const require = createRequire(import.meta.url)
const { validHotkey } = require('../desktop/desk.cjs')
const { readSelection } = require('../desktop/launcher/selection.cjs')

test('the actions: all of them, narrowed by words, and your own words first', () => {
  assert.equal(textActionRows('').length, TEXT_ACTIONS.length)
  assert.deepEqual(textActionRows('grammar').map((row) => row.data.id), ['own', 'fix'])
  assert.deepEqual(textActionRows('make it rhyme').map((row) => row.data.id), ['own'])
  assert.equal(actionsFor(textActionRows('')[0])[0].id, 'text-ai')
})

test('each action sends the text and its instruction; the answer comes back clean', () => {
  const [system, user] = textMessages({ id: 'fix' }, 'teh cat')
  assert.match(system.content, /only the result/)
  assert.match(user.content, /spelling and grammar[\s\S]*teh cat/)
  assert.match(textMessages({ id: 'own', ask: 'make it rhyme' }, 'x')[1].content, /^make it rhyme/)
  assert.equal(replaces({ id: 'fix' }), true)
  assert.equal(replaces({ id: 'summarize' }), false)
  assert.equal(cleanAnswer('"The cat."'), 'The cat.')
  assert.equal(cleanAnswer('```\nThe cat.\n```'), 'The cat.')
  assert.equal(cleanAnswer('He said "hi" to me'), 'He said "hi" to me')
})

test('Hyper T is its key, and it can be taken away', () => {
  const settings = cleanSettings(undefined, { validHotkey })
  assert.equal(keysOf(settings).selection, 'Control+Alt+Shift+Command+T')
  assert.equal(nameOf(settings, 'selection'), 'AI on selected text')
  assert.equal(keysOf(cleanSettings({ selection: { hotkey: null } }, { validHotkey })).selection, undefined)
})

/* A pretend Mac: Accessibility answers (or not), and a clipboard that ⌘C fills. */
function fakeMac({ asked = '', selected = 'from copy', formats = ['text/plain'], before = 'what was copied' } = {}) {
  let text = before
  const history = { borrowed: 0, back: 0, borrow() { this.borrowed++ }, giveBack() { this.back++ } }
  const clipboard = {
    availableFormats: () => formats,
    readText: () => text, readHTML: () => '', readRTF: () => '', readImage: () => ({ isEmpty: () => true }),
    writeText: (value) => { text = value }, write: ({ text: value }) => { text = value ?? '' }, clear: () => { text = '' },
  }
  const exec = async (command, args) => {
    if (command === 'osascript' && args[1].includes('AXSelectedText')) return asked
    assert.deepEqual([command, ...args], ['osat-keys', 'cmd+c'], '⌘C through the keys helper, never System Events')
    text = selected
    return ''
  }
  return { options: { exec, platform: 'darwin', trusted: () => true, clipboard, history }, history, now: () => text }
}

test('reading the selection: Accessibility first, else ⌘C with the clipboard put back', async () => {
  const ax = fakeMac({ asked: 'from accessibility\n' })
  assert.deepEqual(await readSelection(ax.options), { text: 'from accessibility' })
  assert.equal(ax.history.borrowed, 0, 'the clipboard is not touched')

  const copy = fakeMac()
  assert.deepEqual(await readSelection(copy.options), { text: 'from copy' })
  assert.equal(copy.now(), 'what was copied', 'put back')
  assert.deepEqual([copy.history.borrowed, copy.history.back], [1, 1])

  const files = fakeMac({ formats: ['text/plain', 'text/uri-list'] })
  assert.deepEqual(await readSelection(files.options), { text: '', reason: 'none' }, 'files on the clipboard are never risked')
  assert.equal(files.now(), 'what was copied')

  assert.equal((await readSelection({ ...copy.options, trusted: () => false })).reason, 'access')
  assert.equal((await readSelection({ ...copy.options, platform: 'linux' })).reason, 'mac')
})
