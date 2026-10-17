import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const { createGranola, localDay } = createRequire(import.meta.url)('../desktop/meetings/granola.cjs')
const sharedModule = (name) => import(`../shared/${name}`)
const NOW = new Date(2026, 9, 19, 9, 0).getTime()
const meeting = (id, title, at, steps) => ({
  tag: `<meeting id="${id}" title="${title}" meeting_at="${new Date(at).toISOString()}" url="https://notes.granola.ai/d/${id}">`,
  steps,
})

/* A stand-in Granola: list_meetings and get_meetings, as text, and what was asked. */
function fakeApps(meetings, { on = true } = {}) {
  const asked = []
  return {
    asked,
    tools: async () => (on ? [{ app: 'g1', appName: 'Granola', name: 'list_meetings' }, { app: 'g1', appName: 'Granola', name: 'get_meetings' }] : []),
    call: async (app, name, args) => {
      asked.push([name, args])
      if (name === 'list_meetings') return { text: `<meetings_data>${meetings.map((item) => `${item.tag}</meeting>`).join('\n')}</meetings_data>` }
      const item = meetings.find((one) => one.tag.includes(args.meeting_ids[0]))
      const summary = item.steps === null ? '' : `<summary>\n# Next Steps\n${item.steps.map((step) => `- **${step}**`).join('\n')}\n</summary>`
      return { text: `${item.tag}\n  <known_participants>\n  Nate (note creator)\n  </known_participants>\n${summary}</meeting>` }
    },
  }
}

async function setUp(apps, { offline = false } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'osat-granola-'))
  const committed = []
  const removed = []
  const handlers = {}
  const granola = await createGranola({
    dataDir, sharedModule, apps, offline: () => offline, now: () => NOW,
    commitNotes: async (made, source) => { committed.push({ made, source }); return made.map((_, i) => `n${committed.length}-${i}`) },
    removeNotes: async (ids) => { removed.push(...ids) },
    handle: (channel, fn) => { handlers[channel] = fn },
    fail: (message) => { throw new Error(message) },
  })
  return { granola, committed, removed, handlers, dataDir }
}

test('each new Granola meeting’s next steps come in once, as to-dos, written on the meeting’s day', async () => {
  const apps = fakeApps([
    meeting('aaaaaaaa-1', 'Merchant check-in', NOW - 3 * 3600000, ['Call the merchant back', 'Send the fee options (Sam)']),
    meeting('bbbbbbbb-2', 'Still writing', NOW - 600000, null),
  ])
  const { granola, committed, dataDir } = await setUp(apps)
  const status = await granola.look()
  assert.equal(committed.length, 1)
  assert.equal(committed[0].source, 'Granola')
  assert.deepEqual(committed[0].made.map((item) => item.title), ['Call the merchant back', 'Sam: send the fee options'])
  assert.ok(committed[0].made.every((item) => item.what === 'todo' && item.createdAt === new Date(NOW - 3 * 3600000).toISOString()))
  assert.match(committed[0].made[0].markdown, /From Granola: \[Merchant check-in\]\(https:\/\/notes\.granola\.ai\/d\/aaaaaaaa-1\)/)
  assert.deepEqual({ count: status.last.count, meetings: status.last.meetings, connected: status.connected }, { count: 2, meetings: 1, connected: true })
  // Only my meetings, from two days back the first time.
  const [, args] = apps.asked[0]
  assert.deepEqual(args.involvement, { captured_by_me: true })
  assert.equal(args.custom_start, localDay(NOW - 2 * 86400000 - 3600000))
  // Looking again brings nothing twice; the one with no notes yet is asked again.
  await granola.look()
  assert.equal(committed.length, 1)
  assert.deepEqual(apps.asked.filter(([name]) => name === 'get_meetings').map(([, a]) => a.meeting_ids[0]), ['aaaaaaaa-1', 'bbbbbbbb-2', 'bbbbbbbb-2'])
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'granola.json'), 'utf8')).seen, ['aaaaaaaa-1'])
})

test('Take them back puts the last look’s to-dos in the Bin; off, offline or without Granola, nothing is read', async () => {
  const apps = fakeApps([meeting('cccccccc-3', 'Site review', NOW - 3600000, ['Send the preview'])])
  const { granola, removed, handlers } = await setUp(apps)
  await granola.look()
  const after = await handlers['meeting:granola-undo']()
  assert.deepEqual(removed, ['n1-0'])
  assert.equal(after.last.undo, false)
  await assert.rejects(handlers['meeting:granola-undo'](), /nothing to take back/)

  const off = await setUp(fakeApps([meeting('dddddddd-4', 'Off', NOW - 3600000, ['Nope'])]))
  await off.handlers['meeting:granola-set'](false)
  await off.granola.look()
  assert.equal(off.committed.length, 0)

  const away = await setUp(fakeApps([meeting('eeeeeeee-5', 'Away', NOW - 3600000, ['Nope'])]), { offline: true })
  await away.granola.look()
  assert.equal(away.committed.length, 0)
  await assert.rejects(away.handlers['meeting:granola-now'](), /back online/)

  const none = await setUp(fakeApps([], { on: false }))
  assert.equal((await none.granola.look()).connected, false)
})

test('Granola saying no is one calm line, and the next look tries again', async () => {
  const apps = fakeApps([])
  apps.call = async () => ({ text: 'Not signed in', isError: true })
  const { granola } = await setUp(apps)
  const status = await granola.look()
  assert.match(status.problem, /didn’t answer just now/)
  assert.equal(status.busy, false)
})
