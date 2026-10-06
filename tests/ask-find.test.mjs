import assert from 'node:assert/strict'
import test from 'node:test'

import { evidenceBlock, fileQuestion, looksSecret, passage, pickCopies, questionTerms, redactSecrets } from '../shared/ask-find.mjs'
import { normalizeChat, outbound } from '../src/assistant/chats.js'

const now = new Date('2026-10-06T12:00:00')
const copy = (id, text, at = '2026-10-05T10:00:00', extra = {}) => ({ id, kind: 'text', text, at, ...extra })

test('secret-looking text is caught, ordinary text is not', () => {
  for (const secret of [
    'sk-abcdefghijklmnop1234567890', 'ghp_abcdefghijklmnopqrstuvwxyz0123', 'AKIAABCDEFGHIJKLMNOP', 'xoxb-1234567890-abcdef',
    'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4', '-----BEGIN RSA PRIVATE KEY-----', '123-45-6789',
    'Password: hunter2', 'my api key = abc', 'card 4111 1111 1111 1111', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG',
  ]) assert.equal(looksSecret(secret), true, secret)
  for (const fine of ['Lease starts Nov 1, rent is 1450 a month', 'call 555-1234 about the dentist', 'order 1234 5678 9012 3456', 'https://example.com/a/very/long/path/to/some/page-name'])
    assert.equal(looksSecret(fine), false, fine)
})

test('a file keeps its words but loses the lines that look private', () => {
  const { text, left } = redactSecrets('Rent is 1450\npassword: hunter2\nDue on the 1st')
  assert.equal(left, 1)
  assert.match(text, /Rent is 1450/)
  assert.match(text, /Due on the 1st/)
  assert.doesNotMatch(text, /hunter2/)
})

test('copies: the question\'s words, a time, never a secret or a picture', () => {
  const items = [
    copy('a', 'Lease for 12 Oak St starts Nov 1'),
    copy('b', 'Lease key: sk-abcdefghijklmnop1234567890'),
    copy('c', 'Grocery list: eggs, milk'),
    { id: 'd', kind: 'image', at: '2026-10-05T10:00:00' },
    copy('e', 'Old lease notes', '2026-07-01T10:00:00'),
  ]
  assert.deepEqual(pickCopies(items, 'what did I copy about the lease?', now).map((item) => item.id), ['a', 'e'])
  assert.deepEqual(pickCopies(items, 'the lease I copied last month', now).map((item) => item.id), ['a'])
  assert.deepEqual(pickCopies(items, 'anything about the weather', now), [])
  assert.deepEqual(pickCopies(items, 'what did I copy last week?', now).map((item) => item.id), ['a', 'c'])
})

test('words and a time are read; glue is dropped', () => {
  assert.deepEqual(questionTerms('what did I copy about the lease last month', now).words, ['lease'])
  assert.equal(fileQuestion('find my lease file'), 'lease')
})

test('a passage centres on the match and is cut at both ends', () => {
  const long = `${'x '.repeat(500)}the lease is here${' y'.repeat(500)}`
  const out = passage(long, ['lease'], 200)
  assert.match(out, /lease/)
  assert.ok(out.length <= 204)
  assert.ok(out.startsWith('…') && out.endsWith('…'))
})

test('the evidence block is numbered, labelled and sized', () => {
  const block = evidenceBlock({
    copies: [{ id: 'a', at: '2026-10-05T10:00:00', app: 'Safari', text: 'Lease starts Nov 1' }],
    files: [{ name: 'lease.pdf', where: 'Documents › Home', text: 'Rent 1450\npassword: hunter2' }],
  }, { room: 1000, words: ['lease'] })
  assert.match(block, /^COPIED ITEM 1 \(from Safari, copied Oct 5, 2026\)\nLease starts Nov 1/)
  assert.match(block, /FILE 1: lease\.pdf \(Documents › Home\)/)
  assert.doesNotMatch(block, /hunter2/)
  assert.equal(evidenceBlock({}), '')
})

test('the prompt carries the block; a message keeps only pointers', () => {
  const messages = outbound('sys', [], 'about the lease?', [], [], [], null, 'COPIED ITEM 1\nsecret-free words')
  assert.match(messages.at(-1).content, /FROM WHAT I COPIED AND MY FILES/)
  const chat = normalizeChat({ id: 'c', messages: [{ id: 'm', role: 'user', content: 'q', copies: [{ id: 'a', at: 'x', text: 'MY WORDS' }, { nope: 1 }], fileRefs: [{ rootId: 'documents', relative: 'a/b.pdf', name: 'b.pdf', text: 'WORDS' }] }] })
  assert.deepEqual(chat.messages[0].copies, [{ id: 'a', at: 'x' }])
  assert.deepEqual(chat.messages[0].fileRefs, [{ rootId: 'documents', relative: 'a/b.pdf', name: 'b.pdf' }])
  assert.doesNotMatch(JSON.stringify(chat), /MY WORDS|WORDS/)
})
