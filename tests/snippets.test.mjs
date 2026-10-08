import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanSettings, holderOf, matchKeyword, wordsOf } from '../shared/launcher-model.mjs'
import { actionsFor, buildRows, readTyped } from '../shared/quick-search-model.mjs'
import { cleanSnippets, fillSnippet, findSnippets, readSnippetLine, triggersOf, typedStep, validSnippetWord } from '../shared/snippets.mjs'

const now = new Date(2026, 9, 6, 15, 5)
const settings = cleanSettings({ snippets: [
  { id: 'addr', name: 'Home address', keyword: ';addr', text: '12 Oak Lane\nSpringfield' },
  { id: 'sig', name: 'Signature', keyword: 'sig', text: 'Thanks,\nNate — {date}' },
  { id: 'clash', name: 'Clash', keyword: 'g', text: 'never: g is Google’s word' },
  { id: 'empty', name: 'Empty', keyword: 'e', text: '   ' },
] })

test('a snippet keeps its word only when it is free and well formed', () => {
  assert.deepEqual(settings.snippets.map((snippet) => [snippet.id, snippet.keyword]), [['addr', ';addr'], ['sig', 'sig'], ['clash', null]], 'an empty one goes')
  assert.equal(validSnippetWord(';addr'), true)
  assert.equal(validSnippetWord('two words'), false)
  assert.equal(wordsOf(settings)['snip:addr'], ';addr')
  assert.equal(holderOf(settings, { word: 'sig' }), 'the snippet “Signature”')
  assert.deepEqual(cleanSnippets([{ id: 'a', text: 'x', keyword: 'x' }, { id: 'a', text: 'y' }]).length, 1, 'ids are unique')
})

test('placeholders fill in when pasted', () => {
  assert.equal(fillSnippet('On {day}, {date} at {time}: {clipboard}', { now, clipboard: 'the quote' }), 'On Tuesday, October 6, 2026 at 3:05 PM: the quote')
})

test('in the bar: the word finds it first, words find it among the rest, Return pastes', () => {
  const byWord = buildRows(readTyped(';addr', settings), {}, settings, { now })
  assert.deepEqual([byWord[0].kind, byWord[0].title, byWord[0].section], ['snippet', 'Home address', 'Your word “;addr”'])
  assert.deepEqual(actionsFor(byWord[0]).map((action) => [action.id, action.keys]), [['paste-snippet', '↵'], ['copy-snippet', '⇧↵']])
  assert.deepEqual(findSnippets(settings.snippets, 'oak').map((snippet) => snippet.id), ['addr'])
  assert.ok(buildRows(readTyped('signature', settings), {}, settings, { now }).some((row) => row.kind === 'snippet' && row.title === 'Signature'))
  assert.equal(matchKeyword(settings, ';addr'), null, 'the desk’s line keeps to apps and links')
})

test('typed in any app: the helper’s rules, a word only after a space, a line or nothing', () => {
  const triggers = triggersOf(settings.snippets)
  assert.deepEqual(triggers.map((trigger) => trigger.keyword), [';addr', 'sig'])
  const type = (keys) => keys.reduce((state, key) => (state.hit >= 0 ? state : typedStep(state.buffer, key, triggers)), { buffer: '', hit: -1 })
  assert.equal(type([...';addr']).hit, 0)
  assert.equal(type([...'my sig']).hit, 1)
  assert.equal(type([...'design']).hit, -1, 'inside a word it is just typing')
  assert.equal(type([...';adx', 'backspace', 'd', 'r']).hit, 0, '⌫ takes a letter off')
  assert.equal(type([...';ad', 'return', ...'dr']).hit, -1, 'Return starts again')
  assert.deepEqual([readSnippetLine('ready'), readSnippetLine('hit 1'), readSnippetLine('hit secret')], [{ kind: 'ready' }, { kind: 'hit', index: 1 }, null])
})
