/* Skills (Phase 19, "Record a skill"): do something once in OSAT's own browser, and it is written down in plain words and
   saved under a name; one button does it again. This file keeps the skills (`skills.json` in the data folder: on this Mac
   only, never in the workspace, so never synced) and drives a browser (desktop/browser.cjs) to record and replay them.
   The page scripts are desktop/skill-pages.cjs and the rules shared/skill-model.mjs. A skill only ever opens web
   addresses, clicks and types what it was shown; a password is never kept (you type it, then Continue). */
const crypto = require('node:crypto')
const fsp = require('node:fs/promises')
const path = require('node:path')
const pages = require('./skill-pages.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createSkills({ dataDir, sharedModule, fail = (message) => { throw new Error(message) } }) {
  const file = path.join(dataDir, 'skills.json')
  let modelPromise = null
  const model = () => (modelPromise ||= sharedModule('skill-model.mjs'))
  let queue = Promise.resolve()

  async function list() {
    const { cleanSkills } = await model()
    try { return cleanSkills(JSON.parse(await fsp.readFile(file, 'utf8')).skills) } catch { return [] }
  }
  /* One change at a time, written whole and moved into place, so a quit never leaves half a file. */
  function change(update) {
    const run = queue.then(async () => {
      const next = await update(await list())
      await fsp.mkdir(dataDir, { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      await fsp.writeFile(temporary, JSON.stringify({ version: 1, skills: next }), { mode: 0o600 })
      await fsp.rename(temporary, file)
      return next
    })
    queue = run.catch(() => {})
    return run
  }

  async function put(raw) {
    const { cleanSkill, MAX_SKILLS } = await model()
    const skill = cleanSkill(raw)
    if (!skill) fail('That skill could not be saved.')
    return change((skills) => {
      const others = skills.filter((item) => item.id !== skill.id)
      if (others.length >= MAX_SKILLS) fail(`Skills hold ${MAX_SKILLS} at most. Delete one first.`)
      const at = skills.findIndex((item) => item.id === skill.id)
      return at >= 0 ? skills.map((item) => (item.id === skill.id ? skill : item)) : [skill, ...skills]
    })
  }

  async function remove(id) {
    const gone = (await list()).find((skill) => skill.id === id) || null
    if (gone) await change((skills) => skills.filter((skill) => skill.id !== id))
    return gone
  }

  /* One window's recording and playing, on that window's browser. `emit('skills:state', state)` tells its room. */
  function controller({ browser, emit = () => {} }) {
    let recording = null // { id (tab), nonce, steps, off }
    let running = null // { skill, step, stop }
    let result = null // { ok, name, at, message?, paused? } after a run, until the next thing
    let words = []

    const state = () => ({
      recording: recording ? { steps: words, count: recording.steps.length - 1 } : null,
      running: running ? { id: running.skill.id, name: running.skill.name, step: running.step, total: running.skill.steps.length, words: running.words } : null,
      result,
    })
    const push = () => emit('skills:state', state())
    const inject = () => (recording ? browser.exec(recording.id, pages.recorderSource(recording.nonce)).catch(() => {}) : null)

    async function recordStart() {
      const { addRecorded, stepWords } = await model()
      if (recording || running) fail('Finish what is open first.')
      const url = browser.url()
      if (!/^https?:\/\//i.test(url)) fail('Open the page where the skill starts, then press Record a skill.')
      recording = { id: browser.activeId(), nonce: crypto.randomBytes(12).toString('hex'), steps: [{ do: 'go', url }] }
      words = [stepWords(recording.steps[0])]
      result = null
      const prefix = pages.stepPrefix(recording.nonce)
      recording.off = browser.watch({
        console(tab, message) {
          if (!recording || tab !== recording.id || typeof message !== 'string' || !message.startsWith(prefix)) return
          try { recording.steps = addRecorded(recording.steps, JSON.parse(message.slice(prefix.length))) } catch { return }
          words = recording.steps.map(stepWords)
          push()
        },
        ready(tab) { if (recording && tab === recording.id) inject() },
        closed(tab) { if (recording && tab === recording.id) recordCancel() },
      })
      await inject()
      push()
      return state()
    }

    function recordCancel() {
      recording?.off?.()
      recording = null
      words = []
      push()
      return state()
    }

    async function recordStop(name) {
      const { newSkill } = await model()
      if (!recording) fail('Nothing is being recorded.')
      if (recording.steps.length < 2) fail('Nothing was recorded yet. Click or type on the page first.')
      const skill = newSkill(String(name || '').trim(), recording.steps)
      if (!skill) fail('Give the skill a name.')
      await put(skill)
      recordCancel()
      return skill
    }

    /* Wait out a page loading (a click that goes to another page), at most `limit` ms. */
    async function settle(tab, delay, limit = 10000) {
      await sleep(delay)
      let quiet = 0
      for (let waited = 0; waited < limit && quiet < 2; waited += 100) {
        quiet = browser.loading(tab) ? 0 : quiet + 1
        await sleep(100)
      }
    }

    const MISSING = (step) => `I couldn’t find “${step.target?.text || step.target?.label || 'it'}” on the page. It may have changed.`

    async function run(id, from = 0) {
      const { stepWords } = await model()
      if (recording || running) fail('Finish what is open first.')
      const skill = (await list()).find((item) => item.id === id)
      if (!skill) fail('That skill is gone.')
      const start = Math.max(0, Math.min(Number(from) || 0, skill.steps.length))
      const tab = { id: start > 0 ? browser.activeId() : null }
      running = { skill, step: start, stop: false, words: '' }
      result = null
      let outcome = { ok: true, name: skill.name }
      try {
        for (let at = start; at < skill.steps.length; at += 1) {
          if (running.stop) { outcome = { ok: false, name: skill.name, at, message: 'Stopped.' }; break }
          const step = skill.steps[at]
          running.step = at
          running.words = stepWords(step)
          push()
          if (step.do === 'go') {
            tab.id = browser.openTab(step.url)
            await settle(tab.id, 200)
            continue
          }
          if (!tab.id) { outcome = { ok: false, name: skill.name, at, message: 'The page it was using is closed. Run it again from the start.' }; break }
          const done = await browser.exec(tab.id, pages.replaySource(step)).catch(() => ({ ok: false, reason: 'error' }))
          if (!done?.ok) {
            const message = done?.reason === 'missing' ? MISSING(step) : done?.reason === 'option' ? 'That choice is no longer in the list.' : 'The page stopped answering.'
            outcome = { ok: false, name: skill.name, at, message: `Stopped at step ${at + 1}: ${message}` }
            break
          }
          if (done.secret) { outcome = { ok: true, paused: true, name: skill.name, at: at + 1, message: `Type your password, then press Continue. (${stepWords(step)})` }; break }
          await settle(tab.id, 300)
        }
      } finally {
        running = null
        result = outcome
        push()
      }
      return outcome
    }

    return {
      state,
      recordStart,
      recordStop,
      recordCancel,
      run,
      stop() { if (running) running.stop = true; return true },
      clear() { result = null; push(); return state() },
      destroy() { recording?.off?.(); recording = null; if (running) running.stop = true },
    }
  }

  return { list, put, remove, controller }
}

module.exports = { createSkills }
