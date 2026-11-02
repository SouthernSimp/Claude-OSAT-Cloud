/* Snippets (shared/snippets.mjs): text with a word, pasted from the quick bar or, once turned on, typed in any app.
   - From the bar, main fills in the placeholders ({clipboard} is what is on the clipboard now) and pastes it into the
     app you were in, as Return on a copy does.
   - Typed in any app: a small helper, `osascript -l JavaScript` running AppKit's global monitor for keys (it needs
     Accessibility, like pasting does), keeps the last 16 letters typed in its own memory and nothing else, writes no
     letters anywhere, and says only `hit <n>` when the n-th snippet's word was just typed after a space or a new line.
     macOS never shows it what is typed in a password field (Secure Input). OSAT then presses ⌫ once per letter of
     the word and pastes the text; the clipboard is put back as it was a moment later, and the history keeps neither.
   - It runs only on a Mac, while "Turn words into text in any app" is on, OSAT is allowed in Accessibility, and a
     snippet has a word; it stops with OSAT, and leaves if OSAT dies (its parent changed). Nothing goes on the network.
   `spawn` and `exec` are passed in, so the tests never start a process. */
const { run } = require('../mac-files.cjs')

/* The helper, for the OSAT process `owner`, watching `words` (lowercase). 1024 is NSEventMaskKeyDown. A key with ⌘ or ⌃
   held, Return, Tab, Escape or an arrow starts the buffer again; ⌫ (51) takes one letter off. Its rules are
   shared/snippets.mjs `typedStep`, written out here because the helper can't import it. */
const script = (owner, words) => `ObjC.import('Cocoa')
ObjC.import('stdlib')
ObjC.import('unistd')
const out = $.NSFileHandle.fileHandleWithStandardOutput
const say = (line) => out.writeData($(line + '\\n').dataUsingEncoding($.NSUTF8StringEncoding))
const words = ${JSON.stringify(words)}
const RESET = [36, 48, 53, 76, 123, 124, 125, 126]
let buffer = ''
$.NSApplication.sharedApplication
$.NSApp.setActivationPolicy(1)
$.NSEvent.addGlobalMonitorForEventsMatchingMaskHandler(1024, (event) => {
  const code = Number(event.keyCode)
  const flags = Number(event.modifierFlags)
  if (code === 51) { buffer = buffer.slice(0, -1); return }
  if (RESET.includes(code) || (flags & ((1 << 20) | (1 << 18)))) { buffer = ''; return }
  const typed = ObjC.unwrap(event.characters) || ''
  if (typed.length !== 1) { buffer = ''; return }
  buffer = (buffer + typed.toLowerCase()).slice(-16)
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (buffer.endsWith(word) && (buffer.length === word.length || /\\s/.test(buffer[buffer.length - word.length - 1]))) { buffer = ''; say('hit ' + index); return }
  }
})
$.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(2, true, () => { if ($.getppid() !== ${Number(owner) || 0}) $.exit(0) })
say('ready')
$.NSApp.run`

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createSnippets({ spawn = null, exec = run, platform = process.platform, owner = process.pid, model, list = () => [], typedOn = () => false, trusted = () => false, clipboard, quiet = (target) => target, paste, log = () => {} }) {
  let child = null
  let words = []
  // 'unavailable' (not a Mac), 'off', 'access' (waiting for Accessibility), 'starting', 'listening', or 'failed'.
  let state = platform === 'darwin' && typeof spawn === 'function' ? 'off' : 'unavailable'
  let triggers = []

  const fill = (snippet) => model.fillSnippet(snippet.text, { now: new Date(), clipboard: clipboard.readText() })

  /* Turns the n-th trigger just typed into its text: ⌫ for each letter of the word, then the text, through the
     clipboard, which is put back as it was. */
  async function expand(index) {
    const trigger = triggers[index]
    const snippet = trigger && list().find((item) => item.id === trigger.id)
    if (!snippet || !trusted()) return
    const text = fill(snippet)
    const before = clipboard.readText()
    const quietly = quiet(clipboard)
    try {
      await exec('osascript', ['-e', `tell application "System Events" to repeat ${trigger.keyword.length} times\nkey code 51\nend repeat`], { timeout: 4000 })
      quietly.writeText(text)
      await paste()
      await wait(400)
    } catch (error) {
      log(String(error?.message || error))
    } finally {
      if (before) quietly.writeText(before)
    }
  }

  function start() {
    state = 'starting'
    let proc
    try {
      proc = spawn('osascript', ['-l', 'JavaScript', '-e', script(owner, words)], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      state = 'failed'
      log(error.message)
      return
    }
    child = proc
    let pending = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop()
      for (const line of lines) {
        const said = model.readSnippetLine(line)
        if (said?.kind === 'ready') state = 'listening'
        else if (said?.kind === 'hit') expand(said.index).catch(() => {})
      }
    })
    proc.stderr.on('data', (chunk) => log(String(chunk).trim().split('\n')[0]))
    proc.on('error', (error) => { if (child === proc) { child = null; state = 'failed'; log(error.message) } })
    proc.on('exit', () => { if (child === proc) { child = null; state = 'failed' } })
  }

  function stop(next = 'off') {
    const proc = child
    child = null
    if (state !== 'unavailable') state = next
    proc?.kill()
  }

  return {
    state: () => state,
    /* Listen while it is wanted, allowed and has words to watch for; a new list of words starts it again. */
    sync() {
      if (state === 'unavailable') return
      triggers = model.triggersOf(list())
      const next = triggers.map((trigger) => trigger.keyword)
      if (!typedOn() || !next.length) { stop(); return }
      if (!trusted()) { stop('access'); return }
      if (child && JSON.stringify(next) === JSON.stringify(words)) return
      stop()
      words = next
      start()
    },
    /* From the bar: the snippet, filled in, pasted into the app you were in (or copied). */
    text: (id) => { const snippet = list().find((item) => item.id === id); return snippet ? fill(snippet) : null },
    stop: () => stop(),
  }
}

module.exports = { createSnippets, script }
