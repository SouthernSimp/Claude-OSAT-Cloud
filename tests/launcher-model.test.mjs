import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import {
  DEFAULT_SETTINGS, SEARCH_HOTKEY, activeSources, botJob, cleanSettings, handOff, hyper, hyperLabel, keywordAddress, matchKeyword, readLine, validAddress, validKeyword,
} from '../shared/launcher-model.mjs'

const { DEFAULT_SEARCH_HOTKEY, hotkeyLabel, validHotkey } = createRequire(import.meta.url)('../desktop/desk.cjs')
const clean = (saved) => cleanSettings(saved, { validHotkey })

test('the search hotkey and the Hyper hotkeys are ones OSAT can register', () => {
  assert.equal(validHotkey(SEARCH_HOTKEY), true)
  assert.equal(SEARCH_HOTKEY, DEFAULT_SEARCH_HOTKEY, 'the shared model and main agree on the default')
  assert.equal(hyper('v'), 'Control+Alt+Shift+Command+V')
  assert.equal(validHotkey(hyper('v')), true)
  assert.equal(hyper(null), null)
  assert.equal(hyperLabel(hyper('s'), hotkeyLabel), 'Hyper S')
  assert.equal(hyperLabel('Alt+Space', hotkeyLabel), '⌥Space')
  assert.equal(hyperLabel('Control+Alt+Left', hotkeyLabel), '⌃⌥Left')
})

test('with nothing saved every source is on with its usual keyword and Hyper key', () => {
  const settings = clean(undefined)
  assert.deepEqual(settings, clean(DEFAULT_SETTINGS))
  assert.equal(settings.view, 'bar')
  assert.equal(settings.sources.clipboard.keyword, 'v')
  assert.equal(settings.sources.clipboard.hotkey, 'Control+Alt+Shift+Command+V')
  assert.equal(settings.sources.calc.hotkey, null)
  assert.deepEqual(settings.keywords.map((item) => item.keyword), ['ss', 'g'])
  assert.deepEqual(activeSources(settings).map((source) => source.id), ['files', 'clipboard', 'apps', 'notes', 'calc', 'windows'])
})

test('what is saved is read carefully: a bad hotkey, keyword or address falls back or goes', () => {
  const settings = clean({
    view: 'full',
    sources: { files: { on: false, keyword: 'ff', hotkey: 'nonsense' }, clipboard: { keyword: 'Clip', hotkey: null }, apps: { keyword: 'clip' }, notes: { keyword: 'bad keyword!' } },
    keywords: [
      { keyword: 'ss', app: 'Music' }, { keyword: 'ss', app: 'Spotify' }, { keyword: 'clip', app: 'Nope' }, { keyword: 'gh', url: 'https://github.com/{query}' },
      { keyword: 'bad', url: 'javascript:alert(1)' }, { keyword: 'x', app: '/etc/passwd' }, { keyword: 'none' }, null,
    ],
    clipboard: { items: 7, days: 90 },
    pins: [{ kind: 'file', rootId: 'desktop', relative: 'a.txt', name: 'a.txt', extra: 1 }, { kind: 'bogus', rootId: 'x', relative: 'y', name: 'z' }],
  })
  assert.equal(settings.view, 'full')
  assert.deepEqual(settings.sources.files, { on: false, keyword: 'ff', hotkey: 'Control+Alt+Shift+Command+S' })
  assert.deepEqual(settings.sources.clipboard, { on: true, keyword: 'clip', hotkey: null })
  assert.equal(settings.sources.apps.keyword, 'a', 'a word already taken falls back to the usual one')
  assert.equal(settings.sources.notes.keyword, 'n')
  assert.deepEqual(settings.keywords.map((item) => [item.keyword, item.app || item.url]), [['ss', 'Music'], ['gh', 'https://github.com/{query}']])
  assert.deepEqual(settings.clipboard, { items: 200, days: 90, offers: true })
  assert.deepEqual(settings.pins, [{ kind: 'file', rootId: 'desktop', relative: 'a.txt', name: 'a.txt', where: '' }])
  assert.equal(clean({ keywords: [] }).keywords.length, 0, 'an empty list stays empty')
  assert.equal(validKeyword('ss'), true)
  assert.equal(validKeyword('two words'), false)
  assert.equal(validAddress('https://example.com/?q={query}'), true)
  assert.equal(validAddress('ftp://example.com'), false)
  assert.equal(validAddress('https://'), false)
})

test('a keyword is a whole word at the start of the line; a sentence is never hijacked', () => {
  const settings = clean(undefined)
  assert.deepEqual(matchKeyword(settings, 'v'), { source: 'clipboard', query: '' })
  assert.deepEqual(matchKeyword(settings, 'V invoice'), { source: 'clipboard', query: 'invoice' })
  assert.equal(matchKeyword(settings, 'very good'), null)
  assert.equal(matchKeyword(settings, 've'), null)
  assert.deepEqual(matchKeyword(settings, 'f taxes 2025'), { source: 'files', query: 'taxes 2025' })
  assert.equal(matchKeyword(settings, 'ss').keyword.app, 'Spotify')
  assert.equal(matchKeyword(settings, 'ss daft punk'), null, 'an app opens on its word alone')
  const search = matchKeyword(settings, 'g best crms')
  assert.equal(keywordAddress(search.keyword, search.query), 'https://www.google.com/search?q=best%20crms')
  assert.equal(matchKeyword(settings, 'g'), null, 'a web search wants words')
  assert.equal(matchKeyword(settings, ''), null)
  const off = clean({ sources: { clipboard: { on: false } } })
  assert.equal(matchKeyword(off, 'v'), null, 'a source that is off has no keyword')
  assert.deepEqual(matchKeyword(clean({ sources: { clipboard: { keyword: 'clip' } } }), 'clip x'), { source: 'clipboard', query: 'x' })
})

test('> hands a job to a bot; today none can take one, and the words say so', () => {
  assert.deepEqual(botJob('> research best CRMs'), { job: 'research best CRMs' })
  assert.deepEqual(botJob('>x'), { job: 'x' })
  assert.equal(botJob('>'), null)
  assert.equal(botJob('a > b'), null)
  const none = handOff('research best CRMs')
  assert.equal(none.ok, false)
  assert.match(none.message, /No bot takes jobs yet/)
  const sent = []
  const taker = { id: 'muse', name: 'Muse', run: (job) => { sent.push(job); return 'sent' } }
  const some = handOff('research best CRMs', [{ id: 'broken' }, taker])
  assert.equal(some.ok, true)
  assert.equal(some.taker.name, 'Muse')
  assert.equal(some.run(), 'sent')
  assert.deepEqual(sent, ['research best CRMs'])
})

test('the line reads a launcher word, a sum or a bot job, and leaves a sentence alone', () => {
  const settings = clean(undefined)
  assert.deepEqual(readLine('a good idea for the shop', settings), { typed: 'a good idea for the shop', scope: 'apps', keyword: null, words: 'good idea for the shop', sum: null, bot: null }, 'the line only offers rows for it; Save stays first')
  assert.deepEqual(readLine('  v  invoice ', settings), { typed: 'v  invoice', scope: 'clipboard', keyword: null, words: 'invoice', sum: null, bot: null })
  assert.equal(readLine('ss', settings).keyword.keyword.app, 'Spotify')
  assert.equal(readLine('g best crms', settings).keyword.query, 'best crms')
  assert.deepEqual(readLine('2*49', settings).sum.plain, '98')
  assert.equal(readLine('2*49', clean({ sources: { calc: { on: false } } })).sum, null)
  assert.equal(readLine('meeting at 3', settings).sum, null)
  const bot = readLine('> research best CRMs', settings)
  assert.deepEqual([bot.bot.job, bot.scope, bot.sum, bot.words], ['research best CRMs', null, null, '> research best CRMs'])
  assert.equal(readLine('', settings).words, '')
})
