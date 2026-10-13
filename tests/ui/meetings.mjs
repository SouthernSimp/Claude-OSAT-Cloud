// Tools → Meetings (Phase 57) in the built preview, with the Mac's listening bridge faked: get the listening model,
// start, the clock and the Mac-sound note, stop, the "writing it up" wait, the finished notes with Open and Undo,
// and a meeting that was never written up. Light, then dark. Fails on page errors or a step that didn't happen;
// screenshots land in test-results/ui/meetings/. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/meetings`
const PORT = Number(process.env.OSAT_PORT || 4324)

function fakeMeetings() {
  const listeners = new Set()
  let status = {
    ears: { ready: false, size: 574041195, download: null }, ai: true, state: 'idle', startedAt: null, system: true, note: '',
    stage: '', percent: 0, last: null, problem: '', unfinished: [],
  }
  const set = (patch) => { status = { ...status, ...patch }; for (const listener of listeners) listener(status); return status }
  window.__calls = []
  window.__set = set
  window.osatMeetings = {
    status: async () => status,
    getEars: async () => { window.__calls.push('getEars'); return set({ ears: { ...status.ears, download: { received: 200e6, total: 574041195, state: 'running', message: '' } } }) },
    cancelEars: async () => { window.__calls.push('cancelEars'); return set({ ears: { ...status.ears, download: null } }) },
    start: async (options) => { window.__calls.push(`start system=${options.system}`); return set({ state: 'recording', startedAt: Date.now() - 65000, system: options.system }) },
    stop: async () => { window.__calls.push('stop'); return set({ state: 'working', stage: 'listening', percent: 40 }) },
    finish: async (id) => { window.__calls.push(`finish ${id}`); return set({ state: 'working', stage: 'writing', unfinished: [] }) },
    discard: async (id) => { window.__calls.push(`discard ${id}`); return set({ unfinished: [] }) },
    undo: async () => { window.__calls.push('undo'); return set({ last: null }) },
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
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
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
    page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`))
    await page.addInitScript(fakeMeetings)
    await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
    await page.goto(`${url}?fresh=1`)
    await page.waitForSelector('.workspace-content', { timeout: 15000 })
    await page.locator('.app-dock [data-space="tools"]').click()
    await page.getByRole('menuitem', { name: 'Meetings' }).click()
    await page.getByRole('button', { name: /Get the listening model/ }).waitFor({ timeout: 5000 }).catch(() => problems.push(`${theme}: the room didn’t offer the listening model first`))
    await page.screenshot({ path: `${OUT}/${theme}-1-get-model.png` })

    await page.getByRole('button', { name: /Get the listening model/ }).click()
    await page.getByRole('progressbar').waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: no progress while downloading`))
    check(await page.getByText('200 MB of 574 MB').count() === 1, `${theme}: the download didn’t say how far it was`)
    await page.screenshot({ path: `${OUT}/${theme}-2-downloading.png` })

    await page.evaluate(() => window.__set({ ears: { ready: true, size: 574041195, download: null } }))
    await page.getByRole('button', { name: 'Start listening' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: Start listening didn’t appear`))
    check(await page.getByRole('checkbox', { name: /hear the other people/ }).isChecked(), `${theme}: the Mac’s sound wasn’t on by default`)
    await page.screenshot({ path: `${OUT}/${theme}-3-ready.png` })

    await page.getByRole('checkbox', { name: /hear the other people/ }).uncheck()
    await page.getByRole('button', { name: 'Start listening' }).click()
    await page.getByRole('heading', { name: /Listening… 1:0\d/ }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: the clock didn’t run from the start time`))
    check((await page.evaluate(() => window.__calls)).includes('start system=false'), `${theme}: the unticked box wasn’t passed on`)
    check(await page.getByText('Hearing you.', { exact: false }).count() === 1, `${theme}: it didn’t say it hears only you`)
    await page.evaluate(() => window.__set({ note: 'OSAT lost the Mac’s sound partway through, so from here it can only hear you.' }))
    await page.getByText('OSAT lost the Mac’s sound').waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: the note about the Mac’s sound didn’t show`))
    await page.screenshot({ path: `${OUT}/${theme}-4-listening.png` })

    await page.getByRole('button', { name: 'Stop and write it up' }).click()
    await page.getByRole('heading', { name: 'Listening back… 40%' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: no progress while listening back`))
    await page.evaluate(() => window.__set({ stage: 'writing' }))
    await page.getByRole('heading', { name: 'Writing it up…' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: no “writing it up” step`))
    await page.screenshot({ path: `${OUT}/${theme}-5-working.png` })

    await page.evaluate(() => window.__set({
      state: 'idle', stage: '', percent: 0,
      last: { title: 'Launch date and owners · Oct 13', writeUpId: 'note-1', ids: ['note-1', 'note-2'], at: Date.now(), full: true },
      unfinished: [{ id: '2026-10-12-abcd1234', startedAt: Date.now() - 86400000, seconds: 1500 }],
    }))
    await page.getByText('Launch date and owners · Oct 13').waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: the finished meeting didn’t show`))
    check(await page.getByText('A meeting that was not written up').count() === 1, `${theme}: the unfinished meeting didn’t show`)
    check(await page.getByText('25 minutes heard').count() === 1, `${theme}: the unfinished meeting didn’t say how much was heard`)
    await page.screenshot({ path: `${OUT}/${theme}-6-done.png` })
    if (theme === 'dark') { await page.close(); continue }

    await page.getByRole('button', { name: 'Write it up' }).click()
    check((await page.evaluate(() => window.__calls)).includes('finish 2026-10-12-abcd1234'), 'Write it up didn’t finish that meeting')
    await page.evaluate(() => window.__set({ state: 'idle', stage: '' }))
    await page.getByRole('button', { name: 'Undo' }).click()
    check((await page.evaluate(() => window.__calls)).includes('undo'), 'Undo didn’t undo')
    await page.getByRole('button', { name: 'Start listening' }).waitFor({ timeout: 3000 }).catch(() => problems.push('the room didn’t come back to ready'))
    await page.close()
  }
  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Meetings room checked. Screenshots in ${OUT}/`)
  })
