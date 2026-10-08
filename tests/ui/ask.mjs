// Ask in the built preview, with the AI faked (one model on this Mac, one in the cloud): the line under the box says
// truly where a question goes; Try again replaces the last answer and Undo brings it back; Edit replaces the last
// question; a question that asks to do something shows its steps, asks before another app changes anything, and
// offers one Undo, unless "Can use tools" is off. Fails on page errors or a step that didn't happen; screenshots land in test-results/ui/ask/.
// Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/ask`
const PORT = Number(process.env.OSAT_PORT || 4320)

function fakeAi() {
  let answers = 0
  window.osatLocalAI = {
    status: async () => ({ chosen: 'balanced', tiers: [], download: null }),
    onStatus: () => () => {},
    models: async () => ({ models: [
      { id: 'osat:balanced', name: 'Gemma 4 E4B · Balanced', runtime: 'osat', offline: true, state: 'ready' },
      { id: 'cloud:deepseek:deepseek-chat', name: 'deepseek-chat · DeepSeek', runtime: 'cloud', offline: false, where: 'DeepSeek' },
    ] }),
    chatStream: (payload, onDelta) => {
      answers += 1
      const text = `Answer number ${answers}.`
      onDelta(text)
      return { done: Promise.resolve(text), cancel() {} }
    },
  }
}

/* Ask can act (desktop/agent.cjs), faked: a question naming Google Calendar files a sticky, then waits for Allow
   before Google Calendar changes; any other ("Plan my week" acts too) takes no steps and is answered as usual. */
function fakeAgent() {
  window.__agentRuns = 0
  window.osatAgent = {
    apps: async () => ['Google Calendar'],
    run(id, payload, onEvent) {
      window.__agentRuns += 1
      if (!/Google Calendar/.test(payload.messages.at(-1).content)) {
        const plain = window.osatLocalAI.chatStream(payload, (text) => onEvent({ type: 'delta', text }))
        return { done: plain.done.then((answer) => ({ answer, steps: [], undo: null })), cancel() {} }
      }
      let finish
      const done = new Promise((resolve) => { finish = resolve })
      const filed = { id: 'step-1', tool: 'move_sticky', app: '', why: 'Filing Buy seeds', state: 'done', summary: 'Moved “Buy seeds” to Garden.' }
      const dentist = { id: 'step-2', tool: 'google_calendar.create_event', app: 'Google Calendar', why: 'Adding the dentist', state: 'running', summary: '' }
      setTimeout(() => {
        onEvent({ type: 'step', ...filed, state: 'running', summary: '' })
        onEvent({ type: 'step', ...filed })
        onEvent({ type: 'step', ...dentist })
        onEvent({ type: 'confirm', stepId: 'step-2', text: 'Ask wants to change something in Google Calendar: Adding the dentist. (title: Dentist)' })
      }, 100)
      window.__agentAnswer = (yes) => {
        const last = { ...dentist, state: yes ? 'done' : 'skipped', summary: yes ? 'Added Dentist.' : 'Not now' }
        onEvent({ type: 'step', ...last })
        const answer = 'I moved “Buy seeds” to Garden and added the dentist.'
        onEvent({ type: 'delta', text: answer })
        finish({ answer, steps: [filed, last], undo: 'undo-1' })
      }
      return { done, cancel() { finish({ answer: '', steps: [], undo: null }) } }
    },
    confirm: async (id, stepId, yes) => { window.__agentAnswer(yes); return true },
    undo: async (undoId) => { window.__agentUndone = undoId; return true },
  }
}

let server
async function start() {
  if (process.env.OSAT_URL) return process.env.OSAT_URL
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
  const url = `http://127.0.0.1:${PORT}/`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(url)).ok) return url } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('The preview server did not start. Did you run npm run build?')
}

const problems = []
const check = (ok, what) => { if (!ok) problems.push(what) }

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => problems.push(error.message))
  await page.addInitScript(fakeAi)
  await page.addInitScript(fakeAgent)
  await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
  await page.goto(`${url}?fresh=1`)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await page.keyboard.press('Control+4')
  const ask = page.getByRole('region', { name: 'Ask' }).last()
  await ask.waitFor({ timeout: 5000 })
  const box = ask.getByRole('textbox', { name: 'Ask the AI on this Mac' })
  await box.waitFor({ timeout: 5000 })
  await sleep(400)
  check(/On this Mac/.test(await ask.locator('.composer-note').innerText()), 'a model on this Mac did not say so')

  await box.fill('Plan my week')
  await box.press('Enter')
  await ask.locator('.bubble.assistant', { hasText: 'Answer number 1.' }).waitFor({ timeout: 5000 }).catch(() => problems.push('no first answer'))
  await ask.getByRole('button', { name: 'Try again' }).click()
  await ask.locator('.bubble.assistant', { hasText: 'Answer number 2.' }).waitFor({ timeout: 5000 }).catch(() => problems.push('Try again did not answer again'))
  check(await ask.locator('.bubble.assistant').count() === 1, 'Try again kept two answers')
  check(await ask.locator('.bubble.user').count() === 1, 'Try again asked twice')
  await sleep(600)
  await page.screenshot({ path: `${OUT}/try-again.png` })
  await page.locator('.undo-toasts').getByRole('button', { name: 'Undo' }).click()
  await ask.locator('.bubble.assistant', { hasText: 'Answer number 1.' }).waitFor({ timeout: 3000 }).catch(() => problems.push('Undo did not bring the first answer back'))

  await ask.locator('.bubble.user').last().hover()
  await ask.getByRole('button', { name: 'Edit' }).click()
  check(await box.inputValue() === 'Plan my week', 'Edit did not put the question back in the box')
  await page.screenshot({ path: `${OUT}/editing.png` })
  await box.fill('Plan my weekend')
  await box.press('Enter')
  await ask.locator('.bubble.user', { hasText: 'Plan my weekend' }).waitFor({ timeout: 5000 }).catch(() => problems.push('the edited question was not asked'))
  check(await ask.locator('.bubble.user').count() === 1, 'Edit kept the old question too')

  // A cloud model: the line says where the question goes.
  await ask.getByRole('button', { name: /^Model:/ }).click()
  await page.getByRole('menuitemradio', { name: /deepseek-chat/ }).click()
  await ask.locator('.composer-note.is-cloud', { hasText: 'To DeepSeek' }).waitFor({ timeout: 3000 }).catch(() => problems.push('a cloud model did not say where questions go'))
  await page.screenshot({ path: `${OUT}/cloud.png` })

  // Ask can act: the steps show while it works, another app's change waits for Allow, and one Undo is offered.
  await ask.getByRole('button', { name: 'New chat', exact: true }).click()
  await box.fill('Move Buy seeds to Garden and put the dentist in Google Calendar')
  await box.press('Enter')
  await ask.locator('.agent-confirm').waitFor({ timeout: 5000 }).catch(() => problems.push('no question before another app changed something'))
  check(await ask.locator('.agent-step', { hasText: 'Filing Buy seeds' }).count() === 1, 'the steps did not show while Ask worked')
  await page.screenshot({ path: `${OUT}/acting.png` })
  await ask.getByRole('button', { name: 'Allow' }).click()
  const acted = ask.locator('.bubble.assistant', { hasText: 'added the dentist' })
  await acted.waitFor({ timeout: 5000 }).catch(() => problems.push('no answer after Allow'))
  check(await acted.locator('.agent-step').count() === 2, 'the answer did not keep its steps')
  await page.screenshot({ path: `${OUT}/acted.png` })
  await acted.getByRole('button', { name: 'Undo what Ask changed' }).click()
  await page.locator('.undo-toasts', { hasText: 'Put back what Ask changed' }).waitFor({ timeout: 3000 }).catch(() => problems.push('Undo what Ask changed said nothing'))
  check(await page.evaluate(() => window.__agentUndone) === 'undo-1', 'Undo did not ask main to put things back')
  check(await acted.getByRole('button', { name: 'Undo what Ask changed' }).count() === 0, 'Undo stayed after it was used')

  // Turned off for this chat, the same kind of question is only answered.
  const runs = await page.evaluate(() => window.__agentRuns)
  await ask.getByRole('switch', { name: 'Can use tools' }).click()
  await box.fill('Move the seeds again')
  await box.press('Enter')
  await ask.locator('.bubble.assistant', { hasText: /Answer number \d+\./ }).waitFor({ timeout: 5000 }).catch(() => problems.push('with tools off there was no plain answer'))
  check(await page.evaluate(() => window.__agentRuns) === runs, 'with tools off Ask still acted')
  await page.screenshot({ path: `${OUT}/tools-off.png` })

  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Ask checked. Screenshots in ${OUT}/`)
  })
