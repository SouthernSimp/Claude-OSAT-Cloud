import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { describeFileQuery, matchedBy, matchesFile, parseFileQuery, spotlightQuery } from '../shared/file-query.mjs'

const require = createRequire(import.meta.url)
const { inside, rankFound, walkFind } = require('../desktop/mac-files.cjs')

// Thursday, Sep 24 2026, mid-afternoon (local time).
const NOW = new Date(2026, 8, 24, 15, 30)
const day = (month, date, year = 2026) => new Date(year, month - 1, date)
const ids = (query) => query.kinds.map((kind) => kind.id)

test('plain words stay words: nothing is dropped when the search names no kind or time', () => {
  const query = parseFileQuery('the plan for May', NOW)
  assert.deepEqual(query.words, ['the', 'plan', 'for', 'May'])
  assert.deepEqual(query.kinds, [])
  assert.equal(query.since, null)
  assert.equal(describeFileQuery(query, NOW), '')
})

test('kinds and times are read out of the words, and the glue words go', () => {
  const query = parseFileQuery('pdf taxes last week', NOW)
  assert.deepEqual(query.words, ['taxes'])
  assert.deepEqual(ids(query), ['pdf'])
  // Last week's Monday, so nothing from last week is missed.
  assert.deepEqual(query.since, day(9, 14))

  const trip = parseFileQuery('photos from the trip last month', NOW)
  assert.deepEqual(trip.words, ['trip'])
  assert.deepEqual(ids(trip), ['picture'])
  assert.deepEqual(trip.since, day(8, 1))

  assert.deepEqual(parseFileQuery('screenshots and pictures', NOW).kinds.map((kind) => kind.id), ['screenshot', 'picture'])
  assert.deepEqual(parseFileQuery('folders', NOW).kinds.map((kind) => kind.id), ['folder'])
})

test('every time phrase starts from the right day', () => {
  const since = (text) => parseFileQuery(`notes ${text}`, NOW).since
  assert.deepEqual(since('today'), day(9, 24))
  assert.deepEqual(since('yesterday'), day(9, 23))
  assert.deepEqual(since('this week'), day(9, 21))
  assert.deepEqual(since('past week'), day(9, 17))
  assert.deepEqual(since('this month'), day(9, 1))
  assert.deepEqual(since('past month'), day(8, 25))
  assert.deepEqual(since('this year'), day(1, 1))
  assert.deepEqual(since('last year'), day(1, 1, 2025))
  assert.deepEqual(since('recently'), day(9, 10))
  assert.deepEqual(since('last 3 days'), day(9, 21))
  assert.deepEqual(since('past 2 weeks'), day(9, 10))
  // On a Monday, "this week" is today, and "last week" is the Monday before.
  const monday = new Date(2026, 8, 21, 9)
  assert.deepEqual(parseFileQuery('this week', monday).since, day(9, 21))
  assert.deepEqual(parseFileQuery('last week', monday).since, day(9, 14))
})

test('words in quotes are only words, and a lone "last" is a word', () => {
  const query = parseFileQuery('"last week" pdf', NOW)
  assert.deepEqual(query.words, ['last', 'week'])
  assert.deepEqual(ids(query), ['pdf'])
  assert.equal(query.since, null)
  assert.deepEqual(parseFileQuery('last will', NOW).words, ['last', 'will'])
  assert.deepEqual(parseFileQuery('"the" pdf', NOW).words, ['the'])
})

test('Spotlight gets every word in the name or inside, any of the kinds, and the day', () => {
  const query = parseFileQuery('pdf taxes last week', NOW)
  assert.equal(spotlightQuery(query),
    `(kMDItemFSName == "*taxes*"cd || kMDItemTextContent == "taxes*"cdw) && kMDItemContentTypeTree == "com.adobe.pdf" && kMDItemFSContentChangeDate >= $time.iso(${day(9, 14).toISOString().replace('.000Z', 'Z')})`)
  assert.equal(spotlightQuery(parseFileQuery('word docs', NOW)),
    '(kMDItemFSName == "*docs*"cd || kMDItemTextContent == "docs*"cdw) && (kMDItemContentTypeTree == "org.openxmlformats.wordprocessingml.document" || kMDItemContentTypeTree == "com.microsoft.word.doc")')
  assert.equal(spotlightQuery(parseFileQuery('screenshots', NOW)), 'kMDItemIsScreenCapture == 1')
  // Quotes, backslashes and wildcards can't break out of the query.
  assert.equal(spotlightQuery(parseFileQuery('a*b\\"c', NOW)), '(kMDItemFSName == "*abc*"cd || kMDItemTextContent == "abc*"cdw)')
  assert.equal(spotlightQuery(parseFileQuery('""', NOW)), null)
})

test('the Files room says back what it understood, in plain words', () => {
  assert.equal(describeFileQuery(parseFileQuery('pdf taxes last week', NOW), NOW), 'PDFs changed since Mon, Sep 14 with “taxes”')
  assert.equal(describeFileQuery(parseFileQuery('photos and videos today', NOW), NOW), 'Pictures and Videos changed today')
  assert.equal(describeFileQuery(parseFileQuery('budget plan last year', NOW), NOW), 'Files changed since Jan 1, 2025 with “budget” and “plan”')
})

test('where there is no Spotlight, the same words, kinds and times decide', () => {
  const query = parseFileQuery('pdf taxes last week', NOW)
  const recent = day(9, 20).toISOString()
  assert.equal(matchesFile(query, { name: 'Taxes 2025.pdf', modifiedAt: recent }), true)
  assert.equal(matchesFile(query, { name: 'Taxes 2025.pdf', modifiedAt: day(8, 1).toISOString() }), false)
  assert.equal(matchesFile(query, { name: 'Taxes.docx', modifiedAt: recent }), false)
  assert.equal(matchesFile(query, { name: 'Taxes', folder: true, modifiedAt: recent }), false)
  const words = parseFileQuery('stove', NOW)
  assert.equal(matchesFile(words, { name: 'packing.txt', inside: 'Tent, stove, a good book' }), true)
  // Inside a file, a word is found from its start: "stove" is not in "restoved".
  assert.equal(matchesFile(words, { name: 'notes.txt', inside: 'restoved' }), false)
  assert.equal(matchedBy(words, 'Stove manual.pdf'), 'name')
  assert.equal(matchedBy(words, 'packing.txt'), 'inside')
})

test('results rank names first, then the newest when a kind or time was asked', () => {
  const roots = [{ id: 'documents', root: '/u/Documents' }]
  const found = inside(['/u/Documents/a/notes.txt', '/u/Documents/Taxes.pdf', '/u/Documents/.x/taxes.txt', '/u/Documents/old taxes.pdf'], roots)
    .map((item, index) => ({ ...item, modifiedAt: day(9, 10 + index).toISOString() }))
  assert.deepEqual(rankFound(found, ['taxes']).map((item) => item.name), ['Taxes.pdf', 'old taxes.pdf', 'notes.txt'])
  assert.deepEqual(rankFound(found, [], { newest: true }).map((item) => item.name), ['old taxes.pdf', 'Taxes.pdf', 'notes.txt'])
})

test('the walk finds words inside text files, skips hidden things and stays in its folders', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'osat-find-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'Desktop', 'Plans'), { recursive: true })
  await mkdir(path.join(dir, 'Desktop', '.hidden'), { recursive: true })
  await writeFile(path.join(dir, 'Desktop', 'Plans', 'packing.txt'), 'Tent, stove, a good book')
  await writeFile(path.join(dir, 'Desktop', '.hidden', 'stove.txt'), 'never')
  await writeFile(path.join(dir, 'Desktop', 'Stove manual.pdf'), '%PDF')
  await writeFile(path.join(dir, 'Outside stove.txt'), 'stove')
  const old = day(1, 5, 2025)
  await utimes(path.join(dir, 'Desktop', 'Stove manual.pdf'), old, old)
  const roots = [{ id: 'desktop', root: path.join(dir, 'Desktop') }]

  const all = await walkFind(roots, (item) => matchesFile(parseFileQuery('stove', NOW), item))
  assert.deepEqual(all.map((file) => path.relative(dir, file)).sort(), [path.join('Desktop', 'Plans', 'packing.txt'), path.join('Desktop', 'Stove manual.pdf')])
  const recent = await walkFind(roots, (item) => matchesFile(parseFileQuery('stove this year', NOW), item))
  assert.deepEqual(recent.map((file) => path.basename(file)), ['packing.txt'])
  const pdfs = await walkFind(roots, (item) => matchesFile(parseFileQuery('pdfs', NOW), item))
  assert.deepEqual(pdfs.map((file) => path.basename(file)), ['Stove manual.pdf'])
})
