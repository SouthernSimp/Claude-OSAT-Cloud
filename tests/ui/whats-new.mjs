// Tools → Roadmap (Phase 31) in the built preview, with the Mac app's version faked: What's new lists
// every build of CHANGELOG.md, marks the one on this Mac, explains how a change gets to you, and a pull request's
// number opens it on GitHub; Coming next puts the Roadmap's plans on the canvas as a board, which opens as a Board,
// where a plan is reranked and written in, and the room shows that order and the notes. Light, then dark.
// Fails on page errors or a step that didn't happen; screenshots land in test-results/ui/whats-new/.
// Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

import { changelogBuilds } from '../../src/lib/changelog.js'
import { roadmapPhases } from '../../src/lib/roadmap.js'
import { comingPhases } from '../../src/boards/plan.js'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/whats-new`
const PORT = Number(process.env.OSAT_PORT || 4333)

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

async function openRoom(browser, url, theme, version) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
  page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`))
  await page.addInitScript((version) => {
    for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen')
    window.osatApp = { about: async () => ({ version }), needsWelcome: async () => false, needsTour: async () => false }
    window.__opened = []
    window.open = (address) => { window.__opened.push(address); return null }
  }, version)
  await page.goto(`${url}?fresh=1`)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await page.locator('.app-dock [data-space="tools"]').click()
  await page.getByRole('menuitem', { name: 'Roadmap' }).click()
  await page.locator('.roadmap-room').waitFor({ timeout: 5000 })
  return page
}

const room = (page) => page.locator('.popout-body[data-view="Roadmap"]')

async function news(page, builds, have) {
  check(await room(page).getByRole('tab', { name: 'What’s new' }).getAttribute('aria-selected') === 'true', 'the room didn’t open on What’s new')
  await room(page).getByText(`You have build ${have}.`).waitFor({ timeout: 3000 }).catch(() => problems.push('it didn’t say which build is on this Mac'))
  check(await room(page).locator('.news-how[open] .news-steps li').count() === 6, 'How a change gets to you didn’t show its six steps')
  check(await room(page).locator('.news-build').count() === 6, 'more than the newest six builds showed at first')
  const yours = room(page).locator('.news-build[data-yours]')
  check(await yours.count() === 1 && (await yours.innerText()).includes(`Build ${have}`) && (await yours.innerText()).includes('On your Mac'), `build ${have} wasn’t marked as the one on this Mac`)
  check(await room(page).locator('.news-build').first().getAttribute('data-yours') !== null, 'the build on this Mac wasn’t the newest one listed')
  await sleep(400)
  await page.screenshot({ path: `${OUT}/light-news.png` })

  // A pull request's number opens it on GitHub.
  const first = builds[0].items[0].pulls[0]
  await room(page).locator('.news-build').first().getByRole('button', { name: `Pull request ${first.label} on GitHub` }).first().click()
  check((await page.evaluate(() => window.__opened)).includes(`https://github.com/SouthernSimp/Claude-OSAT-Cloud/pull/${first.number}`), 'a pull request’s number didn’t open it on GitHub')

  // Every build, and the steps put away for good.
  await room(page).getByRole('button', { name: `Show ${builds.length - 6} older builds` }).click()
  check(await room(page).locator('.news-build').count() === builds.length, `not every build showed (${await room(page).locator('.news-build').count()} of ${builds.length})`)
  check((await room(page).locator('.news-build').last().innerText()).includes('Before numbered builds'), 'the work before numbered builds wasn’t last')
  await room(page).locator('.news-how > summary').click()
  await sleep(150)
  check(await page.evaluate(() => localStorage.getItem('osat.news.how.v1')) === 'closed', 'putting the steps away wasn’t remembered')
}

async function coming(page, phases) {
  const plans = comingPhases(phases)
  await room(page).getByRole('tab', { name: 'Coming next' }).click()
  check(await room(page).locator('.coming-list li').count() === plans.length, `Coming next didn’t list the ${plans.length} plans`)
  await page.screenshot({ path: `${OUT}/light-coming-start.png` })
  await room(page).getByRole('button', { name: 'Put it on my canvas' }).click()
  await room(page).locator('.coming-board').waitFor({ timeout: 3000 }).catch(() => problems.push('the plan board wasn’t made'))
  const column = (name) => room(page).getByRole('region', { name, exact: true }).locator('.coming-card')
  // The phase in review (the Roadmap's "now"), whichever it is.
  const now = plans.find((plan) => plan.state === 'now')
  check(!now || (await column('Doing').allInnerTexts()).some((text) => text.startsWith(`Phase ${now.id}`)), 'the phase in review wasn’t in Doing')
  // The current plan: planned after the last phase done.
  const lastDone = phases.findLastIndex((phase) => phase.state === 'done')
  const current = phases.filter((phase, index) => phase.state === 'planned' && index > lastDone).map((phase) => `Phase ${phase.id}`)
  check(JSON.stringify((await column('Next').allInnerTexts()).map((text) => text.split(' ·')[0])) === JSON.stringify(current), 'the current plan wasn’t in Next, in order')
  await sleep(300)
  await page.screenshot({ path: `${OUT}/light-coming.png` })

  // On the canvas, as a Board: Later's second card (old plans, which stay put while phases come and go) goes to its top, and gets a note.
  const later = (await column('Later').allInnerTexts()).map((text) => text.split(' ·')[0])
  const [top, moved] = later
  await room(page).getByRole('button', { name: 'Open the board' }).click()
  await page.locator('.boards-title h1', { hasText: 'Coming to OSAT' }).waitFor({ timeout: 5000 }).catch(() => problems.push('Open the board didn’t open it on the canvas'))
  check(await page.getByRole('tab', { name: 'Board' }).getAttribute('aria-selected') === 'true', 'the plan board didn’t open as a Board')
  const card = (phase) => page.locator('.boards-card', { hasText: `${phase} ·` })
  const from = await card(moved).boundingBox()
  const to = await card(top).boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 12 })
  await sleep(120)
  await page.mouse.up()
  await sleep(250)
  await card(moved).click()
  const field = page.getByRole('textbox', { name: 'Sticky', exact: true })
  await field.fill(`${await field.inputValue()}\nMy note: this one first, it makes everything else easier.`)
  await field.press('Control+Enter')
  await sleep(200)
  await page.screenshot({ path: `${OUT}/light-plan-board.png` })
  await page.keyboard.press('Escape')
  await page.locator('.sky-shell').waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push('Esc didn’t come back down'))

  // The room stepped aside for the canvas; opened again (on Coming next), it shows that order and the note.
  check(await room(page).count() === 0, 'the room stayed open over the canvas')
  await page.locator('.app-dock [data-space="tools"]').click()
  await page.getByRole('menuitem', { name: 'Roadmap' }).click()
  await room(page).locator('.coming-board').waitFor({ timeout: 5000 }).catch(() => problems.push('the room didn’t open again on Coming next'))
  const after = await column('Later').allInnerTexts()
  check(after[0]?.startsWith(`${moved} ·`), `the new order didn’t show in Coming next: ${after.map((text) => text.split(' ·')[0]).join(', ')}`)
  check(after[0]?.includes('Your notes'), 'a plan with a note didn’t say so')
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const builds = changelogBuilds(await readFile('CHANGELOG.md', 'utf8'))
  const phases = roadmapPhases(await readFile('docs/ROADMAP.md', 'utf8'))
  const url = await start()
  const browser = await chromium.launch()

  // The build on this Mac: the newest entry. A Next build entry (written before the merge) is the build itself,
  // whatever its number; once it has one, that number.
  const have = builds[0].next ? 999 : builds[0].to
  const light = await openRoom(browser, url, 'light', `0.1.${have}`)
  await news(light, builds, have)
  await coming(light, phases)
  await light.close()

  const dark = await openRoom(browser, url, 'dark', `0.1.${have}`)
  await sleep(500)
  await dark.screenshot({ path: `${OUT}/dark-news.png` })
  await dark.close()

  const narrow = await browser.newPage({ viewport: { width: 760, height: 900 } })
  narrow.on('pageerror', (error) => problems.push(`narrow: ${error.message}`))
  await narrow.goto(`${url}?fresh=1`)
  await narrow.waitForSelector('.workspace-content', { timeout: 15000 })
  await narrow.keyboard.press('Control+k')
  await narrow.keyboard.type('whats new')
  // Return starts on Save (it never guesses); ↓ walks to the command.
  const picked = () => narrow.locator('.home-row[aria-selected="true"] .home-row-label').evaluate((node) => node.firstChild.textContent).catch(() => null)
  for (let step = 0; step < 8 && await picked() !== 'What’s new'; step += 1) await narrow.keyboard.press('ArrowDown')
  await narrow.keyboard.press('Enter')
  await narrow.locator('.news').waitFor({ timeout: 5000 }).catch(() => problems.push('⌘K → What’s new didn’t open it'))
  await sleep(400)
  await narrow.screenshot({ path: `${OUT}/light-narrow.png` })
  await narrow.close()

  await browser.close()
  server?.kill()
  if (problems.length) {
    console.error(problems.map((problem) => `✗ ${problem}`).join('\n'))
    process.exit(1)
  }
  console.log(`What’s new and Coming next checked. Screenshots in ${OUT}/`)
}

main().catch((error) => { console.error(error); server?.kill(); process.exit(1) })
