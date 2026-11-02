// Ask in the built preview, with the AI faked (one model on this Mac, one in the cloud): the line under the box says
// truly where a question goes; Try again replaces the last answer and Undo brings it back; Edit replaces the last
// question. Fails on page errors or a step that didn't happen; screenshots land in test-results/ui/ask/.
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

  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Ask checked. Screenshots in ${OUT}/`)
  })
