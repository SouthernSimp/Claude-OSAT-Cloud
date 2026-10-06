import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

import { addRecorded, cleanSkill, cleanSkills, cleanStep, needsYou, newSkill, skillForJob, stepWords } from '../shared/skill-model.mjs'

const require = createRequire(import.meta.url)
const { recorderSource, replaySource, stepPrefix } = require('../desktop/skill-pages.cjs')
const PREFIX = stepPrefix('n1')

const go = { do: 'go', url: 'https://example.com/rent' }
const click = (text) => ({ do: 'click', target: { text, label: '', selector: 'button' } })

test('steps are cleaned: only known steps, web addresses, short words', () => {
  assert.equal(cleanStep({ do: 'go', url: 'file:///etc/passwd' }), null)
  assert.equal(cleanStep({ do: 'go', url: 'javascript:alert(1)' }), null)
  assert.equal(cleanStep({ do: 'click', target: {} }), null)
  assert.equal(cleanStep({ do: 'run', cmd: 'rm' }), null)
  assert.equal(cleanStep({ do: 'press', key: 'F5' }), null)
  assert.deepEqual(cleanStep({ do: 'press', key: 'Enter' }), { do: 'press', key: 'Enter' })
  assert.equal(cleanStep({ do: 'click', target: { text: 'x'.repeat(500) } }).target.text.length, 80)
})

test('a skill needs a name and starts on a page; a password step keeps no words', () => {
  assert.equal(cleanSkill({ id: 'a', name: '', steps: [go] }), null)
  assert.equal(cleanSkill({ id: 'a', name: 'Pay', steps: [click('Pay')] }), null)
  const skill = newSkill('Pay rent', [go, { do: 'secret', target: { label: 'Password', selector: '#pw' }, value: 'hunter2' }, click('Pay')])
  assert.equal(needsYou(skill), true)
  assert.doesNotMatch(JSON.stringify(skill), /hunter2/)
  assert.equal(cleanSkills([skill, skill, null]).length, 1)
})

test('steps in plain words', () => {
  assert.equal(stepWords(go), 'Open example.com')
  assert.equal(stepWords(click('Sign in')), 'Click “Sign in”')
  assert.equal(stepWords({ do: 'type', target: { label: 'Date', selector: '#d' }, value: '2026-10-06' }), 'Type “2026-10-06” in “Date”')
  assert.equal(stepWords({ do: 'secret', target: { label: 'Password', selector: '#p' } }), 'You type the password in “Password”')
})

test('typing the same field again replaces it; a repeated key is one', () => {
  const type = (value) => ({ do: 'type', target: { label: 'Date', selector: '#d' }, value })
  let steps = addRecorded([go], type('2026'))
  steps = addRecorded(steps, type('2026-10'))
  assert.deepEqual(steps.map((step) => step.value || step.do), ['go', '2026-10'])
  steps = addRecorded(addRecorded(steps, { do: 'press', key: 'Enter' }), { do: 'press', key: 'Enter' })
  assert.equal(steps.length, 3)
})

test('a job on the line finds the skill by its name', () => {
  const skills = [newSkill('Pay rent', [go]), newSkill('Order paper', [go])]
  assert.equal(skillForJob(skills, 'pay rent').name, 'Pay rent')
  assert.equal(skillForJob(skills, 'order').name, 'Order paper')
  assert.equal(skillForJob(skills, 'rent').name, 'Pay rent')
  assert.equal(skillForJob(skills, 'dentist'), null)
})

/* The page scripts, in a real browser page (skipped where Chromium isn't installed). */
const PAGE = `<!doctype html><title>Rent</title><body>
<form id="f"><label for="who">Your name</label><input id="who" name="who">
<input type="password" id="pw" placeholder="Password">
<select id="how" aria-label="Pay with"><option>Card</option><option>Bank</option></select>
<button type="button" id="b1">Not this</button><button type="submit">Pay now</button></form>
<a href="#x">Details</a><p id="out"></p>
<script>f.addEventListener('submit', (e) => { e.preventDefault(); out.textContent = [who.value, pw.value, how.value].join('|') })</script>`

async function browser() {
  try {
    const { chromium } = await import('playwright')
    return await chromium.launch()
  } catch { return null }
}

test('watching a page writes steps; replaying them on a fresh page does the same', async (t) => {
  const chrome = await browser()
  if (!chrome) { t.skip('Chromium is not installed here'); return }
  try {
    const page = await chrome.newPage()
    const said = []
    page.on('console', (message) => { if (message.text().startsWith(PREFIX)) said.push(JSON.parse(message.text().slice(PREFIX.length))) })
    await page.setContent(PAGE)
    await page.evaluate(recorderSource('n1'))
    await page.evaluate(recorderSource('n1')) // twice is the same as once
    await page.fill('#who', 'Nate')
    await page.fill('#pw', 'hunter2')
    await page.focus('#how')
    await page.keyboard.type('Bank') // a real key, so the page's change is the person's, not a script's
    await page.click('text=Pay now')
    await page.waitForTimeout(100)
    const steps = said.reduce((list, step) => addRecorded(list, step), [go])
    assert.deepEqual(steps.map(stepWords), [
      'Open example.com', 'Type “Nate” in “Your name”', 'You type the password in “Password”', 'Choose “Bank” in “Pay with”', 'Click “Pay now”',
    ])
    assert.doesNotMatch(JSON.stringify(steps), /hunter2/)
    assert.equal(await page.textContent('#out'), 'Nate|hunter2|Bank')

    // Replay on a fresh copy, with a page whose ids have changed: the words still find each thing.
    const again = await chrome.newPage()
    await again.setContent(PAGE.replace('id="who"', 'id="who2"').replace('for="who"', 'for="who2"').replace(/who\.value/, 'who2.value').replace('id="b1"', 'id="b9"'))
    for (const step of steps.slice(1)) {
      const result = await again.evaluate(replaySource(step))
      assert.equal(result.ok, true, stepWords(step))
      if (step.do === 'secret') { assert.equal(result.secret, true); await again.fill('#pw', 'typed-by-person') }
    }
    assert.equal(await again.textContent('#out'), 'Nate|typed-by-person|Bank')

    // A step whose target is gone says so (after waiting) instead of clicking the wrong thing.
    const gone = await again.evaluate(replaySource({ do: 'click', target: { text: 'Cancel order', label: '', selector: '#nope' } }))
    assert.deepEqual(gone, { ok: false, reason: 'missing' })
  } finally { await chrome.close() }
})

/* The saved file and the recorder / player, on a stand-in browser. */
const { createSkills } = require('../desktop/skills.cjs')
const { mkdtemp, readFile, rm, stat } = await import('node:fs/promises')
const os = await import('node:os')
const nodePath = await import('node:path')
const { pathToFileURL } = await import('node:url')
const sharedModule = (name) => import(pathToFileURL(nodePath.join(process.cwd(), 'shared', name)).href)

async function rig(execute = async () => ({ ok: true })) {
  const dir = await mkdtemp(nodePath.join(os.tmpdir(), 'osat-skills-'))
  const store = createSkills({ dataDir: dir, sharedModule })
  const watchers = new Set()
  const log = { opened: [], ran: [], states: [] }
  const browser = {
    url: () => 'https://example.com/rent',
    activeId: () => 't1',
    openTab: (url) => { log.opened.push(url); return 't2' },
    exec: async (id, code) => { log.ran.push([id, code]); return execute(id, code) },
    loading: () => false,
    watch: (watcher) => { watchers.add(watcher); return () => watchers.delete(watcher) },
  }
  const tell = (tab, message) => watchers.forEach((watcher) => watcher.console?.(tab, message))
  const controller = store.controller({ browser, emit: (_channel, state) => log.states.push(state) })
  return { dir, store, controller, tell, log, watchers, done: () => rm(dir, { recursive: true, force: true }) }
}
const nonceOf = (log) => log.ran.map(([, code]) => code.match(/__osat_step_([0-9a-f]+)__/)?.[1]).find(Boolean)

test('skills are kept privately, one change at a time, and only ever read back cleaned', async () => {
  const t = await rig()
  try {
    const skill = newSkill('Pay rent', [go, click('Pay')])
    await Promise.all([t.store.put(skill), t.store.put(newSkill('Order paper', [go]))])
    assert.equal((await t.store.list()).length, 2)
    assert.equal(((await stat(nodePath.join(t.dir, 'skills.json'))).mode & 0o077), 0, 'only this Mac user can read it')
    assert.deepEqual(await t.store.remove(skill.id), skill)
    assert.equal((await t.store.list()).length, 1)
    await t.store.put(skill) // Undo
    assert.equal((await t.store.list())[0].id, skill.id)
    await assert.rejects(t.store.put({ id: 'x', name: 'Bad', steps: [{ do: 'go', url: 'file:///etc/passwd' }] }), /could not be saved/)
    await (await import('node:fs/promises')).writeFile(nodePath.join(t.dir, 'skills.json'), '{ broken')
    assert.deepEqual(await t.store.list(), [])
  } finally { await t.done() }
})

test('recording: only this tab, only the page script with the secret, saved by name; a password keeps no words', async () => {
  const t = await rig()
  try {
    await t.controller.recordStart()
    const prefix = `__osat_step_${nonceOf(t.log)}__`
    t.tell('t1', `${prefix}${JSON.stringify({ do: 'click', target: { text: 'Pay now', label: '', selector: 'button' } })}`)
    t.tell('t1', `${prefix}${JSON.stringify({ do: 'secret', target: { label: 'Password', selector: '#pw' }, value: 'hunter2' })}`)
    t.tell('t1', `__osat_step__${JSON.stringify({ do: 'click', target: { text: 'Forged', selector: 'a' } })}`) // a page can't guess the prefix
    t.tell('t9', `${prefix}${JSON.stringify({ do: 'click', target: { text: 'Other tab', selector: 'a' } })}`)
    assert.deepEqual(t.controller.state().recording.steps, ['Open example.com', 'Click “Pay now”', 'You type the password in “Password”'])
    await assert.rejects(t.controller.recordStart(), /Finish what is open/)
    const skill = await t.controller.recordStop('  Pay rent ')
    assert.equal(skill.name, 'Pay rent')
    assert.equal(t.controller.state().recording, null)
    assert.equal(t.watchers.size, 0, 'it stops watching')
    assert.doesNotMatch(await readFile(nodePath.join(t.dir, 'skills.json'), 'utf8'), /hunter2|Forged|Other tab/)
    await t.controller.recordStart()
    await assert.rejects(t.controller.recordStop('Empty'), /Nothing was recorded/)
    t.controller.recordCancel()
    assert.equal(t.watchers.size, 0)
  } finally { await t.done() }
})

test('playing: opens the page, does each step, says calmly where it stopped, pauses at a password and can continue', async () => {
  const t = await rig(async (_tab, code) => (code.includes('"Cancel order"') ? { ok: false, reason: 'missing' } : code.includes('"secret"') ? { ok: true, secret: true } : { ok: true }))
  try {
    const skill = newSkill('Pay rent', [go, click('Pay'), { do: 'secret', target: { label: 'Password', selector: '#pw' } }, click('Submit')])
    await t.store.put(skill)
    const paused = await t.controller.run(skill.id)
    assert.deepEqual(t.log.opened, ['https://example.com/rent'])
    assert.equal(paused.paused, true)
    assert.equal(paused.at, 3)
    assert.match(paused.message, /Type your password, then press Continue/)
    const rest = await t.controller.run(skill.id, paused.at)
    assert.equal(rest.ok, true)
    assert.equal(t.log.opened.length, 1, 'Continue uses the page that is open')

    const stuck = newSkill('Cancel it', [go, click('Cancel order')])
    await t.store.put(stuck)
    const failed = await t.controller.run(stuck.id)
    assert.equal(failed.ok, false)
    assert.equal(failed.message, 'Stopped at step 2: I couldn’t find “Cancel order” on the page. It may have changed.')
    assert.equal(t.controller.state().running, null)
    assert.equal(t.controller.state().result.at, 1)
    await assert.rejects(t.controller.run('nope'), /gone/)
  } finally { await t.done() }
})
