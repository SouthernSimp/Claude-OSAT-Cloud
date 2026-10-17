// Tools → GitHub (Phase 55) in the built preview, with the Mac's GitHub bridge faked: repos, what waits for you
// (checks in words, Merge only when ready, asked once more), Merge, and what changed lately. Light, then dark.
// Fails on page errors or a step that didn't happen; screenshots land in test-results/ui/github/.
// Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { openRoom } from './window.mjs'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/github`
const PORT = Number(process.env.OSAT_PORT || 4323)

function fakeGitHub() {
  const minutes = (n) => new Date(Date.now() - n * 60000).toISOString()
  const checks = (state, failing = []) => ({ state, passed: state === 'passed' ? 2 : 1, failed: failing.length, running: state === 'running' ? 1 : 0, failing })
  let pulls = [
    { number: 81, title: 'Phase 55: a GitHub room', branch: 'claude/github-room', draft: true, url: 'https://github.com/SouthernSimp/Claude-OSAT-Cloud/pull/81', updatedAt: minutes(3), author: 'SouthernSimp', conflict: false, summary: 'Your repos and pull requests in plain words, inside OSAT.', checks: checks('running') },
    { number: 80, title: 'Phase 54: trust fixes', branch: 'claude/trust-fixes', draft: true, url: 'https://github.com/SouthernSimp/Claude-OSAT-Cloud/pull/80', updatedAt: minutes(40), author: 'SouthernSimp', conflict: false, summary: 'Safer updates, and webhooks that survive a quit.', checks: checks('passed') },
    { number: 62, title: 'Sky: see what a connection connects', branch: 'claude/sky-see-connections', draft: true, url: 'https://github.com/SouthernSimp/Claude-OSAT-Cloud/pull/62', updatedAt: minutes(9000), author: 'SouthernSimp', conflict: true, summary: '', checks: checks('failed', ['Tests, build and screenshots']) },
  ]
  const changes = [
    { sha: 'ce4dcbf', title: 'A quick bar you can use instead of Raycast (Phase 52) (#78)', author: 'SouthernSimp', at: minutes(60) },
    { sha: 'd1bb2ec', title: 'Phase 52: a quick bar you can use instead of Raycast', author: 'Nate', at: minutes(95) },
  ]
  window.__merged = []
  window.__opened = []
  window.osatGitHub = {
    status: async () => ({ installed: true, user: 'SouthernSimp' }),
    repos: async () => [
      { name: 'SouthernSimp/Claude-OSAT-Cloud', description: 'A calm, private layer over your Mac', private: true, updatedAt: minutes(3), url: 'https://github.com/SouthernSimp/Claude-OSAT-Cloud' },
      { name: 'SouthernSimp/mccreery-ai', description: 'mccreery.ai', private: false, updatedAt: minutes(3000), url: 'https://github.com/SouthernSimp/mccreery-ai' },
    ],
    repo: async (name) => (name.endsWith('mccreery-ai') ? { name, pulls: [], changes: [] } : { name, pulls, changes }),
    merge: async (name, number) => {
      window.__merged.push([name, number])
      pulls = pulls.filter((pull) => pull.number !== number)
      return { name, pulls, changes: [{ sha: 'abc1234', title: `Merged #${number} (#${number})`, author: 'SouthernSimp', at: new Date().toISOString() }, ...changes] }
    },
    open: async (url) => { window.__opened.push(url); return true },
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
    await page.addInitScript(fakeGitHub)
    await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
    await page.goto(`${url}?fresh=1`)
    await page.waitForSelector('.workspace-content', { timeout: 15000 })
    await openRoom(page, 'GitHub')
    await page.locator('.gh-pull').first().waitFor({ timeout: 5000 }).catch(() => problems.push(`${theme}: no pull requests showed`))
    await sleep(500)
    await page.screenshot({ path: `${OUT}/${theme}-room.png` })
    if (theme === 'dark') { await page.close(); continue }

    const card = (number) => page.locator('.gh-pull', { hasText: `#${number}` })
    check(await card(81).getByText('Checking…').count() === 1, 'running checks didn’t say so')
    check(await card(81).getByRole('button', { name: 'Merge' }).isDisabled(), 'Merge was offered while checks run')
    check(await card(62).getByText('Clashes with main').count() === 1, 'a conflict wasn’t said')
    check(await card(62).getByRole('button', { name: 'Merge' }).isDisabled(), 'Merge was offered with failed checks')
    check(await card(80).getByText('Checks passed').count() === 1, 'passed checks didn’t say so')

    await card(80).getByRole('button', { name: 'Merge' }).click()
    check(await page.evaluate(() => window.__merged.length) === 0, 'one click merged without asking')
    await page.screenshot({ path: `${OUT}/ask.png` })
    await card(80).getByRole('button', { name: 'Not now' }).click()
    check(await card(80).getByRole('button', { name: 'Merge' }).count() === 1, 'Not now didn’t put Merge back')
    await card(80).getByRole('button', { name: 'Merge' }).click()
    await card(80).getByRole('button', { name: 'Merge now' }).click()
    await page.getByText(/Merged #80\. GitHub builds the new OSAT/).waitFor({ timeout: 3000 }).catch(() => problems.push('merging OSAT’s own repo didn’t say how the update arrives'))
    check(JSON.stringify(await page.evaluate(() => window.__merged)) === JSON.stringify([['SouthernSimp/Claude-OSAT-Cloud', 80]]), 'Merge now didn’t merge #80')
    check(await card(80).count() === 0, 'the merged pull request stayed')
    await page.screenshot({ path: `${OUT}/merged.png` })

    await card(81).getByRole('button', { name: 'Open on GitHub' }).click()
    check((await page.evaluate(() => window.__opened)).includes('https://github.com/SouthernSimp/Claude-OSAT-Cloud/pull/81'), 'Open on GitHub didn’t open the pull request')

    await page.getByRole('button', { name: /mccreery-ai/ }).click()
    await page.getByText('Nothing waiting. Every pull request is merged or closed.').waitFor({ timeout: 3000 }).catch(() => problems.push('another repo didn’t show'))
    await page.close()
  }
  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`GitHub room checked. Screenshots in ${OUT}/`)
  })
