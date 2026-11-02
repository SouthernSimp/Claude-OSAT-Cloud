// Chat (Phase 111) in the built preview: Ask in a whole window, from the sidebar and from the panel's expand button;
// a question answered; a folder made from a chat's ⋯ menu, a chat pinned, renamed, a folder folded and deleted with Undo.
// Light, then dark. Fails on page errors or a step that didn't happen; screenshots land in test-results/ui/chat/.
// Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { sideButton } from './window.mjs'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/chat`
const PORT = Number(process.env.OSAT_PORT || 4362)
const problems = []
const check = (ok, message) => { if (!ok) problems.push(message) }

function fakeAi() {
  let answers = 0
  window.osatLocalAI = {
    status: async () => ({ chosen: 'balanced', tiers: [], download: null }),
    onStatus: () => () => {},
    models: async () => ({ models: [{ id: 'osat:balanced', name: 'Gemma 4 E4B · Balanced', label: 'Balanced', runtime: 'osat', offline: true, state: 'ready' }] }),
    chatStream: (payload, onDelta) => { answers += 1; const text = `Answer number ${answers}.`; onDelta(text); return { done: Promise.resolve(text), cancel() {} } },
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

async function ask(room, page, words, answer) {
  const box = room.getByRole('textbox', { name: 'Ask the AI on this Mac' })
  await box.fill(words)
  await box.press('Enter')
  await room.locator('.bubble.assistant', { hasText: answer }).waitFor({ timeout: 5000 }).catch(() => problems.push(`no answer to “${words}”`))
  await sleep(200)
}

async function run(browser, url, theme) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
  page.on('pageerror', (error) => problems.push(`${theme}: ${error.message}`))
  await page.addInitScript(fakeAi)
  await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
  await page.goto(`${url}?fresh=1`)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })

  // From the panel: a question, then the expand button carries the chat into the whole window.
  await page.locator('.app-ask-button').click()
  const panel = page.locator('.ask-panel')
  await panel.getByRole('textbox', { name: 'Ask the AI on this Mac' }).waitFor({ timeout: 5000 })
  await sleep(300)
  await ask(panel, page, 'Plan the Fortis launch', 'Answer number 1.')
  await panel.getByRole('button', { name: 'Open in a whole window' }).click()
  const room = page.locator('.app-room[data-view="Chat"]')
  await room.waitFor({ timeout: 5000 })
  check(!await page.locator('.ask-panel').count(), `${theme}: the panel stayed open beside the whole chat`)
  check(await room.locator('.bubble.user', { hasText: 'Plan the Fortis launch' }).count() === 1, `${theme}: the chat didn’t come along to the whole window`)
  check(await room.locator('.chat-rail').isVisible(), `${theme}: the whole chat has no chat list`)

  // Two more chats from the room itself.
  await room.getByRole('button', { name: 'New chat' }).click()
  await ask(room, page, 'Ideas for the garden', 'Answer number 2.')
  await room.getByRole('button', { name: 'New chat' }).click()
  await ask(room, page, 'What did Sam say about pricing?', 'Answer number 3.')

  // A folder from a chat's ⋯ menu: Move to → New folder…
  await room.getByRole('button', { name: 'More for Plan the Fortis launch' }).click()
  await page.getByRole('menuitem', { name: /Move to/ }).click()
  await page.getByRole('menuitem', { name: /New folder/ }).click()
  await room.getByRole('textbox', { name: 'New folder’s name' }).fill('Fortis')
  await room.getByRole('textbox', { name: 'New folder’s name' }).press('Enter')
  const fortis = room.locator('.rail-group[aria-label="Fortis"]')
  await fortis.waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: the folder wasn’t made`))
  check(await fortis.getByText('Plan the Fortis launch').count() === 1, `${theme}: the chat didn’t move into its new folder`)

  // Pin one, rename another.
  await room.getByRole('button', { name: 'More for Ideas for the garden' }).click()
  await page.getByRole('menuitem', { name: 'Pin to the top' }).click()
  check(await room.locator('.rail-group[aria-label="Pinned"]').getByText('Ideas for the garden').count() === 1, `${theme}: pinning didn’t put it under Pinned`)
  await room.getByRole('button', { name: 'More for What did Sam say about pricing?' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await room.getByRole('textbox', { name: /^Rename/ }).fill('Pricing notes')
  await room.getByRole('textbox', { name: /^Rename/ }).press('Enter')
  check(await room.locator('.rail-item').getByText('Pricing notes').count() === 1, `${theme}: Rename didn’t rename the chat`)
  await page.screenshot({ path: `${OUT}/${theme}.png` })

  // Fold the folder; delete it with Undo; its chat waits in Chats meanwhile.
  await fortis.locator('.rail-group-head').click()
  check(!await fortis.getByText('Plan the Fortis launch').count(), `${theme}: folding didn’t hide the folder’s chats`)
  await fortis.locator('.rail-group-head').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Delete folder/ }).click()
  check(await room.locator('.rail-group[aria-label="Chats"]').getByText('Plan the Fortis launch').count() === 1, `${theme}: deleting the folder lost its chat`)
  await page.getByRole('button', { name: 'Undo' }).last().click()
  await sleep(200)
  check(await room.locator('.rail-group[aria-label="Fortis"]').count() === 1, `${theme}: Undo didn’t bring the folder back`)

  // The sidebar's Chat row opens it too.
  await page.locator('.app-ask-button').click()
  await sideButton(page, 'Chat').click()
  await room.waitFor({ timeout: 5000 })
  await page.close()
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  try {
    for (const theme of ['light', 'dark']) await run(browser, url, theme)
  } finally {
    await browser.close()
    server?.kill()
  }
  if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
  console.log(`Chat checked. Screenshots in ${OUT}/`)
}

main().catch((error) => { console.error(error); server?.kill(); process.exit(1) })
