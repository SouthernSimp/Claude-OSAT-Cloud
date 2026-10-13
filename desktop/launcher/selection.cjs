/* The text selected in the app you were in (Phase 51, AI on selected text, like Raycast's AI commands). First the
   Mac's Accessibility asks that app for its selection (no clipboard touched); apps that don't answer (Chrome and
   Electron apps often don't) get ⌘C, and the clipboard is put back as it was. Both need OSAT allowed in
   Accessibility, which window layouts and Paste already ask for. Never kept: the words go to the bar and no further. */
const crypto = require('node:crypto')
const { run } = require('../mac-files.cjs')

const ASK_APP = `tell application "System Events"
  set p to first application process whose frontmost is true
  try
    set f to value of attribute "AXFocusedUIElement" of p
    return value of attribute "AXSelectedText" of f
  on error
    return ""
  end try
end tell`
const COPY = 'tell application "System Events" to keystroke "c" using command down'
// What OSAT can put back exactly. Anything else on the clipboard (files from Finder, say) means no ⌘C: nothing is lost.
const PUT_BACK = new Set(['text/plain', 'text/html', 'text/rtf', 'image/png'])
const MAX = 20000

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* → { text } or { text: '', reason: 'access' | 'mac' | 'none' }. */
async function readSelection({ exec = run, platform = process.platform, trusted = () => false, clipboard, history } = {}) {
  if (platform !== 'darwin') return { text: '', reason: 'mac' }
  if (!trusted()) return { text: '', reason: 'access' }
  const asked = await exec('osascript', ['-e', ASK_APP], { timeout: 2000 }).catch(() => '')
  if (asked.trim()) return { text: asked.replace(/\n$/, '').slice(0, MAX) }

  if (!clipboard.availableFormats().every((format) => PUT_BACK.has(format))) return { text: '', reason: 'none' }
  const before = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() }
  const marker = `osat-${crypto.randomUUID()}`
  history?.borrow()
  try {
    clipboard.writeText(marker)
    await exec('osascript', ['-e', COPY], { timeout: 2000 })
    for (let waited = 0; waited < 800; waited += 50) {
      await wait(50)
      const now = clipboard.readText()
      if (now !== marker) return now.trim() ? { text: now.slice(0, MAX) } : { text: '', reason: 'none' }
    }
    return { text: '', reason: 'none' }
  } catch {
    return { text: '', reason: 'none' }
  } finally {
    const back = {}
    if (before.text) back.text = before.text
    if (before.html) back.html = before.html
    if (before.rtf) back.rtf = before.rtf
    if (!before.image.isEmpty()) back.image = before.image
    if (Object.keys(back).length) clipboard.write(back)
    else clipboard.clear()
    history?.giveBack()
  }
}

module.exports = { readSelection }
