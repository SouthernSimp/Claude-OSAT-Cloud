import assert from 'node:assert/strict'
import test from 'node:test'

import { detailsIn, namesIn, offerFor, offerLine } from '../shared/clipboard-offer.mjs'

const folders = [
  { id: 'jordan', name: 'Jordan', parentId: null },
  { id: 'acme', name: 'Acme', parentId: null },
  { id: 'lee', name: 'Sam Lee', parentId: null },
  { id: 'quotes', name: 'Quotes', parentId: 'jordan' },
  { id: 'ab', name: 'AB', parentId: null },
]
const notes = [
  { id: 'n1', title: 'Call notes', markdown: 'Phone: (555) 010-2299', folderId: 'quotes', trashedAt: null },
  { id: 'n2', title: 'Trashed', markdown: 'kim@old.example', folderId: 'acme', trashedAt: '2026-09-01T00:00:00Z' },
]
const copy = (text, kind = 'text') => ({ id: 'c', kind, text })

test('emails and phone numbers are found inside a copy; dates, prices and short numbers are not phones', () => {
  assert.deepEqual(detailsIn('Reach Jordan Lee at Jordan.Lee@Acme.com or (555) 010-2299.'), { emails: ['jordan.lee@acme.com'], phones: ['5550102299'] })
  assert.deepEqual(detailsIn('+44 20 7946 0958').phones, ['442079460958'])
  assert.deepEqual(detailsIn('555-0102').phones, ['5550102'])
  for (const words of ['due 2026-09-29', '$1,299.50 total', 'order 12345', 'call 911', '2026-09-29 10:30', 'version 1.2.3']) assert.deepEqual(detailsIn(words).phones, [], words)
  assert.deepEqual(detailsIn('nothing here'), { emails: [], phones: [] })
  assert.deepEqual(detailsIn(undefined), { emails: [], phones: [] })
})

test('the names a copy could be saying: an address’s words, its company (not a mailbox), and capitalised words beside it', () => {
  assert.deepEqual(namesIn('jordan.lee@acme.com'), ['jordan lee', 'jordan', 'acme', 'lee'].sort((a, b) => b.length - a.length))
  assert.ok(!namesIn('jordan@gmail.com').includes('gmail'), 'a mailbox says nothing about who it is')
  assert.ok(namesIn('Jordan Lee 555-010-2299').includes('jordan lee'))
  assert.ok(!namesIn('Call Jordan on 555-010-2299').includes('call'), 'a word that starts a sentence is not a name')
  assert.ok(namesIn('x@big-corp.io').includes('big corp'))
})

test('a node by that name is offered; only ever an existing node, never a new one', () => {
  assert.deepEqual(offerFor(copy('jordan@example.com', 'email'), { folders, notes: [] }), { folderId: 'jordan', folderName: 'Jordan', why: 'name' })
  assert.deepEqual(offerFor(copy('kim@acme.com', 'email'), { folders, notes: [] }), { folderId: 'acme', folderName: 'Acme', why: 'name' }, 'the company in the address')
  assert.equal(offerFor(copy('pat@nobody.example', 'email'), { folders, notes: [] }), null, 'no node by that name')
  assert.deepEqual(offerFor(copy('Jordan: 555-010-2299'), { folders, notes: [] }).folderName, 'Jordan')
  assert.equal(offerFor(copy('555-010-2299', 'phone'), { folders, notes: [] }), null, 'a number alone tells nothing')
  assert.equal(offerFor(copy('Jordan is a good name'), { folders, notes: [] }), null, 'no email or phone, no offer')
  assert.equal(offerFor(copy('ab@ab.example', 'email'), { folders, notes: [] }), null, 'a two-letter node name is too short to trust')
  assert.equal(offerFor(copy('sam.lee@x.example', 'email'), { folders, notes: [] }).folderName, 'Sam Lee', 'both words of a name are in the address')
  assert.equal(offerFor(copy('lee@x.example', 'email'), { folders, notes: [] }), null, 'only one of the two words')
})

test('a number or address already written in a node is the surest sign; its top node is offered', () => {
  assert.deepEqual(offerFor(copy('555.010.2299', 'phone'), { folders, notes }), { folderId: 'jordan', folderName: 'Jordan', why: 'written' }, 'a sticky in a branch offers the node')
  assert.equal(offerFor(copy('kim@old.example', 'email'), { folders, notes }), null, 'a deleted sticky counts for nothing')
  assert.equal(offerFor({ id: 'i', kind: 'image' }, { folders, notes }), null)
  assert.equal(offerFor(copy('jordan@example.com', 'email'), { folders: [], notes }), null)
  assert.equal(offerFor(null, { folders, notes }), null)
})

test('the offer is one calm line', () => {
  const offer = { folderId: 'jordan', folderName: 'Jordan' }
  assert.equal(offerLine(copy('a@b.co', 'email'), offer), 'You copied an email address. Add it to Jordan?')
  assert.equal(offerLine(copy('555-010-2299', 'phone'), offer), 'You copied a phone number. Add it to Jordan?')
  assert.equal(offerLine(copy('Jordan 555-010-2299'), offer), 'You copied something with contact details. Add it to Jordan?')
})
