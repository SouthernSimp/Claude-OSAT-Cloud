/* Meetings (Phase 57, Tools → Meetings): OSAT listens to a meeting on this Mac, then writes it up.
   Nothing leaves the Mac: the sound is heard by whisper.cpp (listen.cjs, its model from ears.cjs) and
   written up by the AI on this Mac, never a cloud model. The sound is kept on disk only until the notes
   exist (`<data folder>/meetings/<id>/`); then it is deleted.
     recording:  OSAT's listening helper (capture.cjs, osat-listen.swift) is a small program of its own, so
                 the desk can be put away and a crash in the app cannot stop it. It writes the microphone
                 as `me.pcm` and the sound the Mac plays as `them.pcm` (16 kHz mono 16-bit), a second or
                 so at a time, straight into the meeting's folder: a quit or a crash loses at most that.
     writing up: each sound is heard in turn (listen.cjs), the two become one conversation, the AI reads it in
                 parts of a few thousand words (shared/meeting-model.mjs), and two notes arrive: the
                 write-up (Unsorted, so the sorting flows find it) and the transcript, linked with [[ ]].
     a meeting that could not be finished (quit, a crash, the AI not answering) stays in `unfinished`
     with Finish writing up / Delete; nothing is thrown away on its own.
   meetings.json in the data folder: { last }.
     meeting:status · meeting:ears-install · meeting:ears-cancel · meeting:start ({ system }) · meeting:stop ·
     meeting:finish (id) · meeting:discard (id) · meeting:undo
     and 'meeting:changed' to every window when anything changes. */
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const TRACKS = ['me', 'them']
const BYTES_PER_SECOND = 32000
// A sound shorter than this is not worth listening to.
const MIN_SECONDS = 2
// A meeting left running is written up after this long.
const LONGEST_MS = 3 * 60 * 60 * 1000
const NO_EARS = 'Get the listening model first: it is the part of OSAT that turns speech into words.'
const NOT_DONE = 'OSAT couldn’t finish writing up the meeting. The recording is kept: try again below.'

async function createMeetings({
  dataDir, sharedModule, ears, fork, capture, hasAi, chat, commitNotes, removeNotes, handle, fail,
  send = () => {}, notify = () => {}, listening = () => {}, now = () => Date.now(), timeZone, language = 'en',
}) {
  const model = await sharedModule('meeting-model.mjs')
  const root = path.join(dataDir, 'meetings')
  const lastFile = path.join(dataDir, 'meetings.json')
  const dirOf = (id) => path.join(root, id)

  let session = null // { id, startedAt, system, note, timer }
  let starting = null // the id of a meeting the helper is still being asked to start
  let work = null // { id, stage, percent }
  let problem = ''
  let last = null

  try { last = JSON.parse(await fs.readFile(lastFile, 'utf8')).last || null } catch { /* none yet */ }

  async function unfinished() {
    const out = []
    for (const id of await fs.readdir(root).catch(() => [])) {
      if (id === session?.id || id === work?.id || id === starting) continue
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dirOf(id), 'meta.json'), 'utf8'))
        const sizes = await Promise.all(TRACKS.map((track) => fs.stat(path.join(dirOf(id), `${track}.pcm`)).then((stat) => stat.size, () => 0)))
        out.push({ id, startedAt: meta.startedAt, seconds: Math.round(Math.max(...sizes) / BYTES_PER_SECOND) })
      } catch { /* not a meeting folder */ }
    }
    return out.sort((a, b) => b.startedAt - a.startedAt)
  }

  async function status() {
    return {
      ears: ears.status(),
      ai: hasAi(),
      state: session ? 'recording' : work ? 'working' : 'idle',
      startedAt: session?.startedAt || null,
      system: session?.system ?? true,
      note: session?.note || '',
      stage: work?.stage || '',
      percent: work ? Math.round(work.percent) : 0,
      last,
      problem,
      unfinished: await unfinished(),
    }
  }
  const changed = async () => send('meeting:changed', await status())
  const remember = async (value) => {
    last = value
    await fs.writeFile(lastFile, `${JSON.stringify({ last })}\n`).catch((error) => console.error('Meetings:', error))
  }

  /* ---- recording ---- */

  async function start({ system = true } = {}) {
    if (session || starting) fail('A meeting is already being heard.')
    if (work) fail('OSAT is still writing up the last meeting.')
    if (!ears.path()) fail(NO_EARS)
    const id = `${new Date(now()).toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`
    starting = id
    try {
      return await begin({ id, system })
    } finally {
      starting = null
    }
  }

  async function begin({ id, system }) {
    const startedAt = now()
    await fs.mkdir(dirOf(id), { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(dirOf(id), 'meta.json'), JSON.stringify({ id, startedAt, system: system !== false }))
    problem = ''
    let began
    try {
      began = await capture.begin({ id, dir: dirOf(id), system: system !== false })
    } catch (error) {
      began = { ok: false, message: error.message }
    }
    if (!began?.ok) {
      await fs.rm(dirOf(id), { recursive: true, force: true })
      fail(began?.message || 'OSAT couldn’t start listening.')
    }
    session = { id, startedAt, system: began.system !== false, note: began.note || '', timer: setTimeout(() => stop().catch(() => {}), LONGEST_MS) }
    listening(true)
    await changed()
    return status()
  }

  async function stop() {
    if (!session) fail('No meeting is being heard.')
    const { id, timer } = session
    clearTimeout(timer)
    await capture.end().catch(() => {})
    session = null
    listening(false)
    work = { id, stage: 'listening', percent: 0 }
    problem = ''
    await changed()
    writeUp(id).catch((error) => console.error('Meetings:', error))
    return status()
  }

  /* ---- writing it up ---- */

  const progress = (stage, percent = 0) => { if (work) { work.stage = stage; work.percent = percent; changed() } }

  /* The words, from the sound: { turns, labelled, durationMs }. */
  async function hear(id) {
    const dir = dirOf(id)
    const files = Object.fromEntries(TRACKS.map((track) => [track, path.join(dir, `${track}.pcm`)]))
    const sizes = Object.fromEntries(await Promise.all(TRACKS.map(async (track) => [track, await fs.stat(files[track]).then((stat) => stat.size, () => 0)])))
    const durationMs = Math.round(Math.max(...Object.values(sizes)) / BYTES_PER_SECOND * 1000)
    const modelPath = ears.path()
    if (!modelPath) throw new Error(NO_EARS)
    const heard = { me: [], them: [] }
    const live = TRACKS.filter((track) => sizes[track] >= MIN_SECONDS * BYTES_PER_SECOND)
    if (live.length) {
      const engine = fork()
      try {
        for (const [index, track] of live.entries()) {
          const bytes = await fs.readFile(files[track])
          const lv = model.levels(new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length - (bytes.length % 2))))
          // Only where someone is talking: a muted microphone has nothing, and silence makes whisper invent words.
          const windows = model.speechWindows(lv)
          if (!windows.length) continue
          const segments = await new Promise((resolve, reject) => {
            const job = randomUUID()
            const over = () => { engine.removeListener('message', onMessage); engine.removeListener('exit', onExit) }
            const onMessage = (message) => {
              if (message?.id !== job) return
              if (message.type === 'progress') progress('listening', ((index + message.percent / 100) / live.length) * 100)
              else if (message.type === 'done') { over(); resolve(message.segments) }
              else if (message.type === 'error') { over(); reject(new Error(message.message)) }
            }
            const onExit = () => { over(); reject(new Error('The listening engine stopped.')) }
            engine.on('message', onMessage)
            engine.once('exit', onExit)
            engine.postMessage({ type: 'transcribe', id: job, modelPath, pcmPath: files[track], language, windows })
          })
          heard[track] = model.cleanSegments(segments, lv)
        }
      } finally {
        engine.kill()
      }
    }
    return { turns: model.mergeTracks(heard), labelled: heard.me.length > 0 && heard.them.length > 0, durationMs }
  }

  /* The AI's part: notes for each part of the conversation, joined in code, then a name. null when it can't. */
  async function think(turns, labelled) {
    const parts = model.chunkLines(model.transcriptLines(turns, { labelled }))
    const notes = []
    for (const [index, text] of parts.entries()) {
      progress('writing', (index / parts.length) * 100)
      // One part the AI can't answer is left out; the others still make notes.
      const answer = await chat(model.notesMessages(text, { index, count: parts.length }), model.NOTES_SCHEMA).then(model.readNotes, (error) => { console.error('Meetings:', error); return null })
      if (answer) notes.push(answer)
    }
    if (!notes.length) return null
    const joined = model.joinNotes(notes)
    const summaries = notes.map((part) => part.summary).filter(Boolean)
    const named = summaries.length ? model.readTitle(await chat(model.titleMessages(summaries), model.TITLE_SCHEMA).catch(() => '')) : null
    return { ...joined, title: named?.title || '', summary: parts.length > 1 && named?.summary ? named.summary : joined.summary }
  }

  async function writeUp(id) {
    const dir = dirOf(id)
    work = { id, stage: 'listening', percent: 0 }
    try {
      const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
      // What was heard is kept, so a second try (the AI wasn't there) doesn't listen again.
      let heard = await fs.readFile(path.join(dir, 'turns.json'), 'utf8').then(JSON.parse, () => null)
      if (!heard) {
        heard = await hear(id)
        await fs.writeFile(path.join(dir, 'turns.json'), JSON.stringify(heard))
      }
      const { turns, labelled, durationMs } = heard
      if (!turns.length) {
        await fs.rm(dir, { recursive: true, force: true })
        problem = 'OSAT didn’t hear anyone talking, so nothing was saved.'
        return
      }
      progress('writing', 0)
      const common = { turns, startedAt: meta.startedAt, durationMs, labelled, timeZone }
      let notes = null
      if (hasAi()) notes = await think(turns, labelled).catch((error) => { console.error('Meetings:', error); return null })
      let made
      if (notes) {
        const { writeUp: up, transcript } = model.meetingNotes({ ...common, notes })
        // What was promised: a To-do sticky each, in Just in, linked to the write-up (Phase 74). Undo takes all back.
        made = [{ ...up, unsorted: true }, { ...transcript, unsorted: false }, ...model.followUps(notes.actions, { from: `From [[${up.title}]]` })]
      } else {
        made = [{ ...model.transcriptOnly(common), unsorted: true }]
      }
      const ids = await commitNotes(made)
      await remember({ title: made[0].title, writeUpId: ids[0], ids, at: now(), full: Boolean(notes) })
      await fs.rm(dir, { recursive: true, force: true })
      notify({ title: 'Your meeting is written up', body: notes ? made[0].title : 'The words are saved. Set up the AI in Settings → AI to get a summary next time.' })
    } catch (error) {
      console.error('Meetings:', error)
      problem = NOT_DONE
    } finally {
      work = null
      await changed()
    }
  }

  async function finish(id) {
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id) || !(await unfinished()).some((item) => item.id === id)) fail('That recording isn’t there any more.')
    if (session || work) fail('OSAT is busy with another meeting.')
    work = { id, stage: 'listening', percent: 0 }
    problem = ''
    await changed()
    writeUp(id).catch((error) => console.error('Meetings:', error))
    return status()
  }

  async function discard(id) {
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) fail('That recording isn’t there any more.')
    if (id === session?.id || id === work?.id) fail('OSAT is busy with that meeting.')
    await fs.rm(dirOf(id), { recursive: true, force: true })
    await changed()
    return status()
  }

  /* Takes the notes the last meeting made back out (they were only just added; Undo). */
  async function undo() {
    if (!last?.ids?.length) fail('There is nothing to undo.')
    await removeNotes(last.ids)
    await remember(null)
    await changed()
    return status()
  }

  // The helper ending on its own writes up what there is; losing only the Mac's sound is told, and the meeting goes on.
  capture.onLost?.((why) => {
    if (!session) return
    if (why === 'exit') stop().then(() => { problem = 'Listening stopped by itself, so OSAT wrote up what it had heard.' }, () => {})
    else { session.system = false; session.note = 'OSAT lost the Mac’s sound partway through, so from here it can only hear you.'; changed() }
  })

  handle('meeting:status', () => status(), { from: 'app' })
  handle('meeting:ears-install', async () => { ears.install(); return status() }, { from: 'app' })
  handle('meeting:ears-cancel', async () => { ears.cancel(); return status() }, { from: 'app' })
  handle('meeting:start', (options) => start({ system: options?.system !== false }), { from: 'app' })
  handle('meeting:stop', () => stop(), { from: 'app' })
  handle('meeting:finish', (id) => finish(id), { from: 'app' })
  handle('meeting:discard', (id) => discard(id), { from: 'app' })
  handle('meeting:undo', () => undo(), { from: 'app' })

  return {
    status, start, stop, finish, discard, undo,
    /* A quit in the middle of a meeting leaves the sound on disk; it shows as unfinished at the next launch. */
    stopNow() {
      clearTimeout(session?.timer)
      capture.kill?.()
    },
  }
}

module.exports = { createMeetings, TRACKS, LONGEST_MS }
