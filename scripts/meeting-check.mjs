// Meetings (Phase 57), the real pipeline once, off the app: a spoken two-person meeting (made with the Mac's own
// voices) goes through whisper.cpp, the conversation is put together, and a model on this Mac writes it up with
// the same questions and grammars the app uses. Prints each step and the two notes. Mac only; nothing leaves it.
//   node scripts/meeting-check.mjs [--ears <ggml-*.bin>] [--model <*.gguf>] [--part-words 300]
// `--part-words` forces a short meeting to be read in several parts, as a 45-minute one would be.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

import * as model from '../shared/meeting-model.mjs'

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback }
const data = path.join(homedir(), 'Library', 'Application Support', 'OSAT', 'models')
const earsPath = arg('ears', path.join(data, 'ggml-large-v3-turbo-q5_0.bin'))
const modelPath = arg('model', path.join(data, 'gemma-4-E4B_q4_0-it.gguf'))
const partWords = Number(arg('part-words', model.CHUNK_WORDS))
for (const file of [earsPath, modelPath]) if (!existsSync(file)) { console.error(`Missing ${file}`); process.exit(1) }

const SCRIPT = [
  ['me', 'Okay, thanks everyone for joining. Today I want to settle the launch date for the new client portal, and work out who owns what.'],
  ['them', 'Thanks for having us. The big risk is still the payment integration. Jordan, where are we on the sandbox testing?'],
  ['me', 'Jordan is on another call, so I will answer. The sandbox testing is about eighty percent done. We found two bugs in the refund flow, and I expect them fixed by Wednesday.'],
  ['them', 'Good. Then I think November twelfth is realistic for launch, as long as we freeze features on November first.'],
  ['me', 'Agreed. Let us say launch is November twelfth, and the feature freeze is November first. I will write up the rollout plan and send it to everyone by Friday.'],
  ['them', 'Great. Priya, can you own the customer email announcement? We need a draft before the freeze.'],
  ['me', 'Priya said yes in the chat. She will have a draft ready by next Tuesday, but she needs the final screenshots from Jordan first.'],
  ['them', 'One more thing. We should budget about four thousand dollars for extra load testing. Does anyone object?'],
  ['me', 'No objection from me, but the load testing has to cover the checkout page and the reporting dashboard, not just the login page.'],
  ['them', 'Agreed. Also, someone should confirm the support team knows the launch date before we tell customers. I do not know who that should be.'],
  ['me', 'Let us leave that one open for now. I will ask in the leadership channel. Thanks everyone, I will send notes after the call.'],
]

const work = mkdtempSync(path.join(tmpdir(), 'osat-meeting-check-'))
const RATE = model.RATE
const voice = { me: 'Samantha', them: 'Daniel' }
const tracks = { me: [], them: [] }
const pieces = SCRIPT.map(([who, text], index) => {
  const aiff = path.join(work, `${index}.aiff`)
  const wav = path.join(work, `${index}.wav`)
  execFileSync('say', ['-v', voice[who], '-r', '175', '-o', aiff, text])
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav])
  const bytes = readFileSync(wav)
  return { who, pcm: new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length - ((bytes.length - 44) % 2))) }
})
for (const { who, pcm } of pieces) {
  const other = who === 'me' ? 'them' : 'me'
  tracks[who].push(pcm)
  tracks[other].push(new Int16Array(pcm.length + RATE / 2))
  tracks[who].push(new Int16Array(RATE / 2))
}
const join = (list) => { const out = new Int16Array(list.reduce((n, a) => n + a.length, 0)); let at = 0; for (const a of list) { out.set(a, at); at += a.length }; return out }
const sound = { me: join(tracks.me), them: join(tracks.them) }
console.log(`Meeting made: ${(sound.me.length / RATE / 60).toFixed(1)} minutes, two sounds.\n`)

const { initWhisper } = await import('@fugood/whisper.node')
const ears = await initWhisper({ filePath: earsPath, useGpu: true })
const heard = {}
for (const who of ['me', 'them']) {
  const lv = model.levels(sound[who])
  // As the app does: only the stretches with someone talking, one at a time (whisper makes words up in silence).
  const windows = model.speechWindows(lv)
  const started = Date.now()
  const segments = []
  for (const window of windows) {
    const { promise } = ears.transcribeData(sound[who].slice(window.start * 16, window.end * 16).buffer, { language: 'en' })
    for (const s of (await promise).segments) segments.push({ start: s.t0 + window.start, end: s.t1 + window.start, text: s.text })
  }
  heard[who] = model.cleanSegments(segments, lv)
  console.log(`${who}: ${windows.length} stretches, ${heard[who].length} segments in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}
await ears.release()

const turns = model.mergeTracks(heard)
const lines = model.transcriptLines(turns)
console.log(`\n--- Conversation (${turns.length} turns) ---\n${lines.join('\n')}\n`)

const { LlamaChat, getLlama, resolveChatWrapper } = await import('node-llama-cpp')
const llama = await getLlama({ build: 'never', logLevel: 'error' })
const loaded = await llama.loadModel({ modelPath })
const context = await loaded.createContext({ contextSize: { max: 8192 } })
const chatWrapper = resolveChatWrapper(loaded, { customWrapperSettings: { gemma4: { reasoning: false } } })
// One chat for every question, as the app's engine does (desktop/ai/runtime.cjs).
const chat = new LlamaChat({ contextSequence: context.getSequence(), chatWrapper })
const ask = async (messages, schema) => {
  const grammar = await llama.createGrammarForJsonSchema(schema)
  const history = messages.map((m) => (m.role === 'assistant' ? { type: 'model', response: [m.content] } : { type: m.role, text: m.content }))
  const started = Date.now()
  const { response } = await chat.generateResponse(history, { grammar, maxTokens: 2048, budgets: { thoughtTokens: 0 } })
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  return typeof response === 'string' ? response : response.join('')
}

const parts = model.chunkLines(lines, partWords)
console.log(`--- Reading in ${parts.length} part${parts.length === 1 ? '' : 's'} ---`)
const notes = []
for (const [index, text] of parts.entries()) {
  const answer = model.readNotes(await ask(model.notesMessages(text, { index, count: parts.length }), model.NOTES_SCHEMA))
  console.log(JSON.stringify(answer))
  if (answer) notes.push(answer)
}
const joined = model.joinNotes(notes)
const named = model.readTitle(await ask(model.titleMessages(notes.map((n) => n.summary).filter(Boolean)), model.TITLE_SCHEMA))
const done = model.meetingNotes({
  notes: { ...joined, title: named?.title || '', summary: parts.length > 1 && named?.summary ? named.summary : joined.summary },
  turns, startedAt: Date.now(), durationMs: (sound.me.length / RATE) * 1000,
})
console.log(`\n=== ${done.writeUp.title} ===\n${done.writeUp.markdown}\n`)
process.exit(0)
