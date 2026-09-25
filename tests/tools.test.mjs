import assert from 'node:assert/strict'
import test from 'node:test'
import { clipMarkdown, toAddress } from '../src/tools/address.js'

test('the address bar opens addresses and searches everything else', () => {
  assert.equal(toAddress('https://example.com/a'), 'https://example.com/a')
  assert.equal(toAddress('example.com'), 'https://example.com')
  assert.equal(toAddress('news.ycombinator.com/item?id=1'), 'https://news.ycombinator.com/item?id=1')
  assert.equal(toAddress('localhost:5239'), 'http://localhost:5239')
  assert.equal(toAddress('best notes app'), 'https://duckduckgo.com/?q=best%20notes%20app')
  assert.equal(toAddress('javascript:alert(1)'), 'https://duckduckgo.com/?q=javascript%3Aalert(1)')
  assert.equal(toAddress('   '), '')
})

test('a clip keeps the chosen words, the source and a #clip tag', () => {
  const clip = clipMarkdown({ url: 'https://www.example.com/post', title: 'A post', selection: 'First line\n\nSecond line' }, new Date('2026-09-24T12:00:00'))
  assert.equal(clip.title, 'A post')
  assert.equal(clip.markdown, '# A post\n\n> First line\n>\n> Second line\n\nClipped from [example.com](https://www.example.com/post) on September 24, 2026. #clip')
  assert.match(clipMarkdown({ url: 'https://a.io', title: '', text: 'Body' }).markdown, /^# a\.io\n\n> Body/)
})
