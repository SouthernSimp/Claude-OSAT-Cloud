/* Starts and stops OSAT's listening helper (osat-listen.swift, built to build/helpers/osat-listen and
   shipped in the app's Resources): a small program that hears the microphone and the sound the Mac is
   playing and writes each to a file as 16 kHz mono 16-bit sound. It does nothing but that: no network,
   no notes. It says what happened, one line each, on its output:
     mic ok · mic denied · mic unavailable
     system ok · system unavailable: permission | <why>      (the Mac's own sound; the meeting goes on without it)
     system lost: <why>
   and ends when told to (SIGTERM) or when OSAT's end of its input closes (a quit or a crash of OSAT). */
const fs = require('node:fs')
const path = require('node:path')
const { spawn: spawnProcess } = require('node:child_process')

const READY_MS = 60 * 1000
const STOP_MS = 8 * 1000

const WORDS = {
  'mic denied': 'OSAT can’t use the microphone. Allow it in System Settings → Privacy & Security → Microphone, then try again.',
  'mic unavailable': 'OSAT couldn’t find a microphone to listen with.',
  permission: 'OSAT can hear you, but not the other people, until OSAT is allowed under System Settings → Privacy & Security → Screen & System Audio Recording. Allow it, then start the next meeting.',
}

function createCapture({ helperPath, spawn = spawnProcess, exists = fs.existsSync }) {
  let child = null
  let lost = () => {}

  /* → { ok: true, system, note } or { ok: false, message }. `system`: is the Mac's own sound being heard. */
  function begin({ dir, system = true }) {
    if (!helperPath || !exists(helperPath)) {
      return Promise.resolve({ ok: false, message: 'Meetings need OSAT’s listening helper, which this copy of OSAT doesn’t have. Install OSAT from its disk image.' })
    }
    return new Promise((resolve) => {
      const args = ['--mic', path.join(dir, 'me.pcm'), ...(system ? ['--system', path.join(dir, 'them.pcm')] : [])]
      let proc
      try {
        proc = spawn(helperPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (error) {
        resolve({ ok: false, message: `OSAT couldn’t start listening (${error.message}).` })
        return
      }
      child = proc
      let micOk = false
      let systemState = system ? 'wait' : 'off'
      let note = ''
      let ready = false
      let buffer = ''
      const settle = (result) => {
        if (ready) return
        ready = true
        clearTimeout(timer)
        if (!result.ok) { proc.kill('SIGKILL'); if (child === proc) child = null }
        resolve(result)
      }
      const timer = setTimeout(() => settle({ ok: false, message: 'OSAT waited a minute for the microphone and didn’t get it. Check System Settings → Privacy & Security → Microphone.' }), READY_MS)
      const line = (text) => {
        if (text === 'mic ok') micOk = true
        else if (text.startsWith('mic ')) return settle({ ok: false, message: WORDS[text] || WORDS['mic unavailable'] })
        else if (text === 'system ok') systemState = 'ok'
        else if (text.startsWith('system unavailable')) { note = WORDS[text.split(': ')[1]] || 'OSAT can hear you, but not the other people: the Mac’s own sound isn’t available.'; systemState = 'no' }
        else if (text.startsWith('system lost')) { if (ready) lost(text) }
        if (micOk && systemState !== 'wait') settle({ ok: true, system: systemState === 'ok', note })
      }
      proc.stdout.on('data', (data) => {
        buffer += data
        let at
        while ((at = buffer.indexOf('\n')) >= 0) {
          line(buffer.slice(0, at).trim())
          buffer = buffer.slice(at + 1)
        }
      })
      proc.stderr?.on('data', () => {})
      proc.on('error', (error) => settle({ ok: false, message: `OSAT couldn’t start listening (${error.message}).` }))
      proc.on('exit', () => {
        if (child === proc) child = null
        if (!ready) settle({ ok: false, message: 'OSAT’s listening helper stopped before it began. Try again.' })
        else if (!proc.ending) lost('exit')
      })
    })
  }

  /* Ends the helper and waits until it has written the last of the sound. */
  function end() {
    const proc = child
    if (!proc) return Promise.resolve()
    child = null
    proc.ending = true
    return new Promise((resolve) => {
      const kill = setTimeout(() => proc.kill('SIGKILL'), STOP_MS)
      proc.once('exit', () => { clearTimeout(kill); resolve() })
      proc.kill('SIGTERM')
    })
  }

  return {
    begin,
    end,
    kill: () => { if (child) child.ending = true; child?.kill('SIGKILL'); child = null },
    // Told when the helper ends or loses the Mac's sound without being asked to.
    onLost: (listener) => { lost = listener },
  }
}

module.exports = { createCapture, WORDS }
