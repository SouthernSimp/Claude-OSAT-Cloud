import assert from 'node:assert/strict'
import test from 'node:test'

import { listFromTyping, toMarkdown } from '../src/search/rich-text.js'
import { pictureLine, pictureOf } from '../shared/capture-model.mjs'

// A tiny DOM: el('UL', el('LI', 'one')) and text strings.
const text = (value) => ({ nodeType: 3, nodeName: '#text', textContent: value })
const el = (name, ...children) => ({ nodeType: 1, nodeName: name, childNodes: children.map((child) => (typeof child === 'string' ? text(child) : child)) })
const root = (...children) => el('DIV', ...children)

test('the quick sticky’s words become Markdown: lines, bold, italic, lists (nested), and nothing else', () => {
  assert.equal(toMarkdown(root('Groceries', el('DIV', 'for ', el('B', 'Friday ')), el('UL', el('LI', 'eggs'), el('LI', 'milk', el('OL', el('LI', 'whole'), el('LI', 'oat')))))),
    'Groceries\nfor **Friday**\n- eggs\n- milk\n   1. whole\n   2. oat')
  assert.equal(toMarkdown(root('one', el('BR'), 'two', el('DIV', el('I', 'three')))), 'one\ntwo\n*three*')
  assert.equal(toMarkdown(root(el('DIV', el('BR')), el('DIV', 'after a gap'), el('SPAN', ' and words\u00a0'))), 'after a gap\nand words')
  assert.equal(toMarkdown(root(el('OL', el('LI', 'first'), el('LI', el('STRONG', 'second'))))), '1. first\n2. **second**')
  assert.equal(toMarkdown(root(el('DIV', el('UL', el('LI', 'inside a div'))))), '- inside a div', 'Chromium sometimes wraps a list in a div')
  assert.equal(toMarkdown(root(el('SCRIPT', 'x'), el('A', 'a link'))), 'xa link', 'anything else gives only its words')
  assert.equal(toMarkdown(null), '')
})

test('typing "- " or "1. " at the start of a line starts a list', () => {
  assert.equal(listFromTyping('- '), 'insertUnorderedList')
  assert.equal(listFromTyping('* '), 'insertUnorderedList')
  assert.equal(listFromTyping('1. '), 'insertOrderedList')
  assert.equal(listFromTyping('1) '), 'insertOrderedList')
  assert.equal(listFromTyping('2. '), null)
  assert.equal(listFromTyping('-x'), null)
})

test('a screenshot line is read back only for a name OSAT made', () => {
  const name = '0f8fad5b-d9cb-469f-a165-70867728950e.png'
  assert.equal(pictureOf(pictureLine(name)), name)
  assert.equal(pictureOf(`  ${pictureLine(name)}  `), name)
  assert.equal(pictureOf('![x](osat-picture:../../etc/passwd)'), null)
  assert.equal(pictureOf('![x](https://example.com/a.png)'), null)
  assert.equal(pictureOf(`words ${pictureLine(name)}`), null)
})
