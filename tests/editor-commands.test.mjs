import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyAutocomplete, autocompleteContext, continueList, indentLines, insertAtCaret, setHeading, toggleLinePrefix,
  toggleTaskAt, toggleTaskAtCaret, wrapSelection,
} from '../src/notes/editor-commands.js'

test('wrapSelection bolds a selection, the word at the caret, and unwraps again', () => {
  const bold = wrapSelection({ text: 'make this strong', start: 5, end: 9 }, '**')
  assert.deepEqual(bold, { text: 'make **this** strong', start: 7, end: 11 })
  assert.deepEqual(wrapSelection(bold, '**'), { text: 'make this strong', start: 5, end: 9 })
  const word = wrapSelection({ text: 'hello world', start: 8, end: 8 }, '_')
  assert.equal(word.text, 'hello _world_')
  const empty = wrapSelection({ text: '', start: 0, end: 0 }, '`', '`', 'code')
  assert.deepEqual(empty, { text: '`code`', start: 1, end: 5 })
})

test('line prefixes toggle bullets, tasks, numbers and quotes across a selection', () => {
  const text = 'one\ntwo\nthree'
  const bullets = toggleLinePrefix({ text, start: 0, end: text.length }, 'bullet')
  assert.equal(bullets.text, '- one\n- two\n- three')
  assert.equal(toggleLinePrefix(bullets, 'bullet').text, text)
  assert.equal(toggleLinePrefix({ text, start: 0, end: text.length }, 'ordered').text, '1. one\n2. two\n3. three')
  assert.equal(toggleLinePrefix({ text: '- one', start: 0, end: 5 }, 'task').text, '- [ ] one')
  assert.equal(toggleLinePrefix({ text: '- [x] one', start: 0, end: 0 }, 'task').text, 'one')
  assert.equal(toggleLinePrefix({ text: 'a\nb', start: 0, end: 3 }, 'quote').text, '> a\n> b')
  assert.equal(setHeading({ text: '## old', start: 0, end: 0 }, 1).text, '# old')
  assert.equal(setHeading({ text: '## old', start: 0, end: 0 }, 0).text, 'old')
  assert.equal(indentLines({ text: 'a\nb', start: 0, end: 3 }).text, '  a\n  b')
  assert.equal(indentLines({ text: '  a', start: 0, end: 0 }, true).text, 'a')
})

test('Enter continues lists, numbers them, and leaves on an empty item', () => {
  const next = continueList({ text: '- [ ] first', start: 11, end: 11 })
  assert.equal(next.text, '- [ ] first\n- [ ] ')
  const numbered = continueList({ text: '1. one', start: 6, end: 6 })
  assert.equal(numbered.text, '1. one\n2. ')
  const leave = continueList({ text: '- one\n- ', start: 8, end: 8 })
  assert.deepEqual(leave, { text: '- one\n', start: 6, end: 6 })
  assert.equal(continueList({ text: 'plain', start: 5, end: 5 }), null)
  assert.equal(continueList({ text: '> quoted', start: 8, end: 8 }).text, '> quoted\n> ')
})

test('tasks toggle by line and by caret', () => {
  assert.equal(toggleTaskAt('- [ ] a\n- [x] b', 1), '- [ ] a\n- [ ] b')
  assert.equal(toggleTaskAt('plain', 0), 'plain')
  assert.equal(toggleTaskAtCaret({ text: '- [ ] a', start: 3, end: 3 }).text, '- [x] a')
  assert.equal(toggleTaskAtCaret({ text: 'plain', start: 2, end: 2 }).text, '- [ ] plain')
})

test('autocomplete detects [[ and # tokens and applies a choice', () => {
  assert.deepEqual(autocompleteContext('see [[Pla', 9), { kind: 'wikilink', query: 'Pla', from: 4 })
  assert.deepEqual(autocompleteContext('tag #wo', 7), { kind: 'tag', query: 'wo', from: 4 })
  assert.equal(autocompleteContext('a#b', 3), null)
  assert.equal(autocompleteContext('done', 4), null)
  const state = { text: 'see [[Pla', start: 9, end: 9 }
  assert.deepEqual(applyAutocomplete(state, autocompleteContext(state.text, 9), 'Plan A'), { text: 'see [[Plan A]]', start: 14, end: 14 })
  assert.equal(applyAutocomplete({ text: 'tag #wo', end: 7 }, { kind: 'tag', from: 4 }, 'work').text, 'tag #work ')
  assert.deepEqual(insertAtCaret({ text: 'ab', start: 1, end: 1 }, '[x](url)', 1, 2), { text: 'a[x](url)b', start: 2, end: 3 })
})
