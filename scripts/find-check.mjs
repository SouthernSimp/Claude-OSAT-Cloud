/* CI on a Mac: the queries "find a file" builds (shared/file-query.mjs) are ones Spotlight
   accepts, and, where the Mac indexes, they find a word in a name and a word inside a file.
     node scripts/find-check.mjs */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFileQuery, spotlightQuery } from '../shared/file-query.mjs'

const run = (command, args) => new Promise((resolve) => {
  execFile(command, args, { timeout: 20000 }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, out: String(stdout), err: String(stderr) }))
})
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const dir = fs.mkdtempSync(path.join(os.homedir(), 'osat-find-check-'))
fs.writeFileSync(path.join(dir, 'packing list.txt'), 'Tent, stove, flashlight and a good book about lighthouses')
fs.writeFileSync(path.join(dir, 'Lighthouse trip.txt'), 'Leave Friday')
await run('mdimport', [dir])

const searches = [
  // "lighthouses" inside the packing list starts with the word too.
  ['lighthouse', ['Lighthouse trip.txt', 'packing list.txt']],
  ['flashlight', ['packing list.txt']],
  ['stove this week', ['packing list.txt']],
  ['pdf stove last month', []],
  ['screenshots yesterday', []],
  ['photos and videos from the trip last year', []],
  ['"last week" word docs', []],
]

const broken = []
let indexed = false
for (let attempt = 0; attempt < 15 && !indexed; attempt += 1) {
  const probe = await run('mdfind', ['-onlyin', dir, spotlightQuery(parseFileQuery('lighthouse'))])
  indexed = probe.out.includes('Lighthouse trip.txt')
  if (!indexed) await wait(2000)
}
const missed = []
for (const [words, want] of searches) {
  const query = spotlightQuery(parseFileQuery(words))
  const result = await run('mdfind', ['-onlyin', dir, query])
  const names = result.out.split('\n').filter(Boolean).map((file) => path.basename(file)).sort()
  console.log(`${JSON.stringify(words)} → ${query}\n    ${result.code ? `exit ${result.code} ` : ''}${result.err.trim() || ''}${names.join(', ') || '(nothing)'}`)
  if (result.code !== 0 || /failed to create query|syntax/i.test(result.err)) broken.push(words)
  else if (indexed && JSON.stringify(names) !== JSON.stringify(want)) missed.push(`${words}: found ${names.join(', ') || 'nothing'}`)
}
fs.rmSync(dir, { recursive: true, force: true })

if (broken.length) {
  console.error(`Find check failed: Spotlight refused ${broken.map((words) => JSON.stringify(words)).join(', ')}`)
  process.exit(1)
}
if (missed.length) {
  console.error(`Find check failed: ${missed.join('; ')}`)
  process.exit(1)
}
console.log(indexed
  ? 'Find check: Spotlight accepts every query and finds words in names and inside files.'
  : 'Find check: Spotlight accepts every query (this Mac does not index, so what it finds was not checked).')
