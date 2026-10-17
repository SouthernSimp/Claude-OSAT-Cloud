import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { createMeetings } = require('../desktop/meetings/index.cjs')
const { EARS, createEars } = require('../desktop/meetings/ears.cjs')
const shared = (name) => import(pathToFileURL(fileURLToPath(new URL(`../shared/${name}`, import.meta.url))).href)

const SECOND = 16000
// Four seconds of a steady tone: loud enough to count as someone talking.
const tone = (seconds = 4) => Int16Array.from({ length: SECOND * seconds }, (_, i) => Math.round(Math.sin(i / 20) * 9000))
const bytesOf = (pcm) => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)

/* A listening engine that answers from a script: what each sound "says", by the name of its file. */
function fakeEngine(says, log) {
  return () => {
    const engine = new EventEmitter()
    log.forks += 1
    engine.kill = () => { log.killed += 1 }
    engine.postMessage = (message) => {
      const track = path.basename(message.pcmPath, '.pcm')
      log.jobs.push({ track, modelPath: message.modelPath, language: message.language, windows: message.windows })
      queueMicrotask(() => {
        engine.emit('message', { type: 'progress', id: message.id, percent: 50 })
        if (says[track] instanceof Error) engine.emit('message', { type: 'error', id: message.id, message: says[track].message })
        else engine.emit('message', { type: 'done', id: message.id, segments: says[track] || [] })
      })
    }
    return engine
  }
}

const NOTES = JSON.stringify({
  summary: 'We chose Nov 12.', decisions: ['Launch Nov 12'], actions: [{ what: 'Write the rollout plan', who: 'Me', due: 'Friday' }], questions: [],
})
const TITLE = JSON.stringify({ title: 'Launch date', summary: 'We chose Nov 12.' })

async function setup(options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'osat-meetings-'))
  const log = { forks: 0, killed: 0, jobs: [], chats: [], notes: [], removed: [], sent: [], notified: [], capture: [], listening: [] }
  const handlers = new Map()
  const says = options.says || {
    me: [{ start: 0, end: 3000, text: 'Thanks for joining everyone.' }],
    them: [{ start: 3500, end: 7000, text: 'Nov 12 works for us.' }],
  }
  const earsFile = path.join(dataDir, 'models', EARS.file)
  const ears = { status: () => ({ ready: true }), path: () => (options.noEars ? null : earsFile), install: () => { log.installed = true }, cancel: () => {} }
  const meetings = await createMeetings({
    dataDir,
    sharedModule: shared,
    ears,
    fork: fakeEngine(says, log),
    // The helper writes the two sounds into the meeting's folder as it listens; here they are there from the start.
    capture: {
      begin: async (request) => {
        log.capture.push(['begin', request])
        if (options.begin) return options.begin(request)
        for (const [track, pcm] of Object.entries(options.audio || { me: tone(), them: tone() })) await writeFile(path.join(request.dir, `${track}.pcm`), bytesOf(pcm))
        return { ok: true, system: request.system }
      },
      end: async () => { log.capture.push(['end']) },
      kill: () => { log.capture.push(['kill']) },
    },
    hasAi: () => options.ai !== false,
    chat: async (messages, schema) => {
      log.chats.push({ messages, schema })
      if (options.chat) return options.chat(messages, schema)
      return /name a meeting/.test(messages[0].content) ? TITLE : NOTES
    },
    commitNotes: async (made) => {
      if (options.commit) await options.commit()
      log.notes.push(made)
      return made.map((_, i) => `note-${log.notes.length}-${i}`)
    },
    removeNotes: async (ids) => { log.removed.push(ids) },
    handle: (channel, operation, config) => handlers.set(channel, { operation, config }),
    fail: (message) => { throw new Error(message) },
    send: (channel, payload) => log.sent.push([channel, payload]),
    notify: (note) => log.notified.push(note),
    listening: (on) => log.listening.push(on),
    now: () => Date.parse('2026-10-13T18:05:00Z'),
    timeZone: 'UTC',
  })
  const idle = async () => {
    for (let i = 0; i < 200; i += 1) {
      if ((await meetings.status()).state === 'idle') return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail('still working')
  }
  return { dataDir, meetings, log, handlers, idle }
}

test('a meeting is heard, written up, and the sound is deleted', async () => {
  const { dataDir, meetings, log, idle } = await setup()
  const started = await meetings.start({ system: true })
  assert.equal(started.state, 'recording')
  assert.equal(log.capture[0][1].system, true)
  assert.match(log.capture[0][1].dir, /meetings/)
  const stopped = await meetings.stop()
  assert.equal(stopped.state, 'working')
  await idle()

  // Both sounds were heard, in turn, with the model on this Mac; the engine was ended afterwards.
  assert.deepEqual(log.jobs.map((job) => [job.track, job.language]), [['me', 'en'], ['them', 'en']])
  // Only the stretch with sound in it was sent to be listened to (four loud seconds, a second of margin: it is the whole track).
  assert.deepEqual(log.jobs[0].windows, [{ start: 0, end: 4000 }])
  assert.equal(log.killed, 1)
  // The write-up lands in Unsorted; the transcript is a plain note beside it, and each links to the other.
  assert.equal(log.notes.length, 1)
  const [writeUp, transcript, todo] = log.notes[0]
  assert.equal(writeUp.title, 'Launch date · Oct 13')
  assert.equal(writeUp.unsorted, true)
  assert.match(writeUp.markdown, /- \[ \] Me: Write the rollout plan \(Friday\)/)
  assert.match(writeUp.markdown, /\[\[Launch date · Oct 13 · Transcript\]\]/)
  assert.equal(transcript.unsorted, false)
  assert.match(transcript.markdown, /\[0:00\] Me: Thanks for joining everyone\.\n\n\[0:03\] Them: Nov 12 works for us\./)
  // What was promised is a to-do of its own in Just in, linked to the write-up (Phase 74).
  assert.deepEqual({ title: todo.title, what: todo.what, unsorted: todo.unsorted }, { title: 'Write the rollout plan (Friday)', what: 'todo', unsorted: true })
  assert.match(todo.markdown, /From \[\[Launch date · Oct 13\]\]/)
  // The AI was asked for notes, then for a name; both with a grammar, and it was told the speakers.
  assert.deepEqual(log.chats.map((c) => Object.keys(c.schema.properties)[0]), ['summary', 'title'])
  // Nothing of the sound is left, and the notes are told to Nate.
  assert.deepEqual(await readdir(path.join(dataDir, 'meetings')), [])
  assert.equal(log.notified.length, 1)
  assert.deepEqual(log.listening, [true, false])
  const status = await meetings.status()
  assert.equal(status.last.title, 'Launch date · Oct 13')
  assert.equal(status.last.full, true)
  assert.equal(status.problem, '')
  assert.deepEqual(status.unfinished, [])
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'meetings.json'), 'utf8')).last.ids, ['note-1-0', 'note-1-1', 'note-1-2'])
})

test('Undo takes the notes back out, the to-dos too', async () => {
  const { meetings, log, idle } = await setup()
  await meetings.start()
  await meetings.stop()
  await idle()
  const status = await meetings.undo()
  assert.deepEqual(log.removed, [['note-1-0', 'note-1-1', 'note-1-2']])
  assert.equal(status.last, null)
  await assert.rejects(meetings.undo(), /nothing to undo/)
})

test('without the AI, the words are still kept, as one note in Unsorted', async () => {
  const { meetings, log, idle } = await setup({ ai: false })
  await meetings.start()
  await meetings.stop()
  await idle()
  assert.equal(log.chats.length, 0)
  assert.equal(log.notes[0].length, 1)
  assert.equal(log.notes[0][0].unsorted, true)
  assert.match(log.notes[0][0].title, /Transcript$/)
  assert.equal((await meetings.status()).last.full, false)
})

test('a long meeting is read in parts, and an action item in any part is kept', async () => {
  const long = Array.from({ length: 9 }, (_, i) => ({ start: i * 400, end: i * 400 + 390, text: Array.from({ length: 800 }, (_, n) => `word${n}`).join(' ') }))
  let call = 0
  const { meetings, log, idle } = await setup({
    says: { me: long, them: [] },
    audio: { me: tone() },
    chat: async (messages) => {
      if (/name a meeting/.test(messages[0].content)) return TITLE
      call += 1
      return JSON.stringify({ summary: `Part ${call}.`, decisions: [], actions: [{ what: `Task ${call}`, who: '', due: '' }], questions: [] })
    },
  })
  await meetings.start()
  await meetings.stop()
  await idle()
  const parts = log.chats.length - 1
  assert.ok(parts >= 3, `${parts} parts`)
  const [writeUp, transcript] = log.notes[0]
  for (let n = 1; n <= parts; n += 1) assert.match(writeUp.markdown, new RegExp(`Task ${n}`))
  // Only the microphone had anything, so nobody is told apart.
  assert.doesNotMatch(transcript.markdown, /\bMe:|\bThem:/)
})

test('while the helper is still starting (waiting on a permission), the meeting is not shown as unfinished', async () => {
  let allow
  const { meetings } = await setup({ begin: () => new Promise((resolve) => { allow = resolve }) })
  const starting = meetings.start()
  await new Promise((resolve) => setTimeout(resolve, 20))
  const status = await meetings.status()
  assert.equal(status.state, 'idle')
  assert.deepEqual(status.unfinished, [])
  await assert.rejects(meetings.start(), /already being heard/)
  allow({ ok: false, message: 'Not allowed.' })
  await assert.rejects(starting, /Not allowed/)
})

test('one part the AI cannot answer is left out; the rest still make the notes', async () => {
  const long = Array.from({ length: 9 }, (_, i) => ({ start: i * 400, end: i * 400 + 390, text: Array.from({ length: 800 }, (_, n) => `word${n}`).join(' ') }))
  let call = 0
  const { meetings, log, idle } = await setup({
    says: { me: long, them: [] },
    audio: { me: tone() },
    chat: async (messages) => {
      if (/name a meeting/.test(messages[0].content)) return TITLE
      call += 1
      if (call === 2) throw new Error('out of memory')
      return JSON.stringify({ summary: `Part ${call}.`, decisions: [], actions: [{ what: `Task ${call}`, who: '', due: '' }], questions: [] })
    },
  })
  await meetings.start()
  await meetings.stop()
  await idle()
  const [writeUp] = log.notes[0]
  assert.match(writeUp.markdown, /Task 1/)
  assert.doesNotMatch(writeUp.markdown, /Task 2/)
  assert.match(writeUp.markdown, /Task 3/)
})

test('nobody talking saves nothing and says so', async () => {
  const { dataDir, meetings, log, idle } = await setup({ says: { me: [{ start: 0, end: 1000, text: '[BLANK_AUDIO]' }], them: [] }, audio: { me: tone() } })
  await meetings.start()
  await meetings.stop()
  await idle()
  assert.equal(log.notes.length, 0)
  assert.match((await meetings.status()).problem, /didn’t hear anyone talking/)
  assert.deepEqual(await readdir(path.join(dataDir, 'meetings')), [])
})

test('a muted microphone (silence all the way) is never sent to be listened to', async () => {
  const { meetings, log, idle } = await setup({ audio: { me: new Int16Array(SECOND * 4), them: tone() } })
  await meetings.start()
  await meetings.stop()
  await idle()
  assert.deepEqual(log.jobs.map((job) => job.track), ['them'])
})

test('if the engine fails, the sound is kept and can be finished later without listening again', async () => {
  const says = { me: new Error('out of memory'), them: [] }
  const { dataDir, meetings, log, idle } = await setup({ says, audio: { me: tone() } })
  await meetings.start()
  await meetings.stop()
  await idle()
  let status = await meetings.status()
  assert.match(status.problem, /recording is kept/)
  assert.equal(status.unfinished.length, 1)
  assert.equal(status.unfinished[0].seconds, 4)
  assert.equal(log.notes.length, 0)

  // Fixed (a script change stands in for more memory): finishing hears it, and writes it up.
  says.me = [{ start: 0, end: 3000, text: 'Hello again everyone.' }]
  await meetings.finish(status.unfinished[0].id)
  await idle()
  status = await meetings.status()
  assert.equal(log.notes.length, 1)
  assert.deepEqual(status.unfinished, [])
  assert.deepEqual(await readdir(path.join(dataDir, 'meetings')), [])
})

test('if the notes can’t be saved after listening, finishing does not listen again', async () => {
  let broken = true
  const { meetings, log, idle } = await setup({ commit: async () => { if (broken) throw new Error('disk full') } })
  await meetings.start()
  await meetings.stop()
  await idle()
  const status = await meetings.status()
  assert.match(status.problem, /recording is kept/)
  assert.equal(log.notes.length, 0)
  broken = false
  await meetings.finish(status.unfinished[0].id)
  await idle()
  assert.equal(log.notes.length, 1)
  assert.equal(log.forks, 1, 'what was heard was kept')
  assert.deepEqual((await meetings.status()).unfinished, [])
})

test('an AI that does not answer still leaves the words, as a transcript', async () => {
  const { meetings, log, idle } = await setup({ chat: async () => { throw new Error('model busy') } })
  await meetings.start()
  await meetings.stop()
  await idle()
  assert.equal(log.notes[0].length, 1)
  assert.match(log.notes[0][0].title, /Transcript$/)
})

test('a recording cut short by a quit is offered at the next launch, and can be deleted', async () => {
  const { dataDir, meetings, idle } = await setup()
  const dir = path.join(dataDir, 'meetings', '2026-10-13-deadbeef')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ id: '2026-10-13-deadbeef', startedAt: 1760378700000, system: true }))
  await writeFile(path.join(dir, 'me.pcm'), bytesOf(tone(10)))
  const status = await meetings.status()
  assert.deepEqual(status.unfinished, [{ id: '2026-10-13-deadbeef', startedAt: 1760378700000, seconds: 10 }])
  await assert.rejects(meetings.discard('../etc'), /isn’t there/)
  await assert.rejects(meetings.finish('nope'), /isn’t there/)
  await meetings.discard('2026-10-13-deadbeef')
  assert.deepEqual((await meetings.status()).unfinished, [])
  await idle()
})

test('starting needs the listening model, and one meeting at a time', async () => {
  const none = await setup({ noEars: true })
  await assert.rejects(none.meetings.start(), /listening model/)

  const { meetings } = await setup()
  await meetings.start()
  await assert.rejects(meetings.start(), /already being heard/)
  await meetings.stop()
  await assert.rejects(meetings.start(), /still writing up/)
  await assert.rejects(meetings.stop(), /No meeting is being heard|Nothing/)
})

test('if the recorder can’t start (no permission), nothing is left behind and the reason is plain', async () => {
  const { dataDir, meetings, log } = await setup({ begin: async () => ({ ok: false, message: 'Allow the microphone in System Settings → Privacy & Security.' }) })
  await assert.rejects(meetings.start(), /Allow the microphone/)
  assert.deepEqual(await readdir(path.join(dataDir, 'meetings')), [])
  assert.deepEqual(log.listening, [])
  assert.equal((await meetings.status()).state, 'idle')
})

test('every channel answers the desk and nothing else', async () => {
  const { handlers } = await setup()
  const channels = [...handlers.keys()]
  assert.deepEqual(channels.sort(), ['meeting:discard', 'meeting:ears-cancel', 'meeting:ears-install', 'meeting:finish', 'meeting:start', 'meeting:status', 'meeting:stop', 'meeting:undo'])
  for (const channel of channels) assert.equal(handlers.get(channel).config.from, 'app', channel)
})

test('quitting in the middle of a meeting ends the helper and leaves the sound for next time', async () => {
  const { dataDir, meetings, log } = await setup()
  await meetings.start()
  meetings.stopNow()
  assert.deepEqual(log.capture.at(-1), ['kill'])
  assert.equal((await readdir(path.join(dataDir, 'meetings'))).length, 1)
})

test('the listening model is fetched resumably and checked, and says how it is going', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'osat-ears-'))
  const seen = []
  const tiny = { file: 'tiny.bin', url: 'https://example.invalid/tiny.bin', size: 4, sha256: 'x' }
  const ears = createEars({
    dir,
    ears: tiny,
    emit: (status) => seen.push(status),
    download: async ({ url, dest, size, sha256, onProgress }) => {
      assert.equal(url, tiny.url)
      assert.equal(sha256, 'x')
      onProgress(2, size)
      await writeFile(dest, 'abcd')
    },
  })
  assert.deepEqual(ears.status(), { ready: false, size: 4, download: null })
  assert.equal(ears.path(), null)
  ears.install()
  await ears.done()
  assert.equal(ears.status().ready, true)
  assert.equal(ears.path(), path.join(dir, 'tiny.bin'))
  assert.ok(seen.some((s) => s.download?.state === 'running'))
  // A broken download says so plainly and can be tried again.
  const broken = createEars({ dir: await mkdtemp(path.join(tmpdir(), 'osat-ears-')), ears: tiny, download: async () => { throw new Error('socket hang up') } })
  broken.install()
  await broken.done()
  assert.equal(broken.status().download.state, 'failed')
  assert.match(broken.status().download.message, /Check the internet connection/)
  assert.equal(broken.status().ready, false)
  // The pinned model is the one that was tried: the size and checksum are the real file's.
  assert.equal(EARS.size, 574041195)
  assert.match(EARS.sha256, /^[0-9a-f]{64}$/)
  assert.match(EARS.url, /resolve\/[0-9a-f]{40}\//)
  assert.ok((await stat(dir)).isDirectory())
})
