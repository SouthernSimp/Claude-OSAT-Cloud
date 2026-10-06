// Unsorted's sorter in the built preview, with a pile of 91 stickies and the AI faked in each
// state it can be in (not set up, downloading, resting, waking, ready, offline, failed).
// Fails on page errors or a state that says nothing; screenshots land in test-results/ui/sorting/
// at 1440, 1100 and 600 px wide. Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/sorting`
const PORT = Number(process.env.OSAT_PORT || 4318)

const at = (day) => new Date(Date.UTC(2026, 9, day, 9)).toISOString()
const folders = [
  { id: 'osat', name: 'OSAT', rank: 1, at: { x: 0, y: 0 } },
  { id: 'ideas', name: 'Ideas', parentId: 'osat', rank: 1 },
  { id: 'polish', name: 'Sky polish', parentId: 'osat', rank: 2 },
  { id: 'home', name: 'Home', rank: 2, at: { x: 400, y: 0 } },
  { id: 'garden', name: 'Garden', parentId: 'home', rank: 1 },
  { id: 'work', name: 'Work', rank: 3, at: { x: 800, y: 0 } },
  { id: 'planning', name: 'Planning', parentId: 'work', rank: 1 },
  { id: 'health', name: 'Health', rank: 4, at: { x: 1200, y: 0 } },
]
const filed = [
  ['osat', 'OSAT on the iPhone'], ['ideas', 'A dock that magnifies'], ['ideas', 'Sky search finds branches'],
  ['polish', 'Sky toolbar spacing'], ['polish', 'Sky cards drift less'], ['garden', 'Tomatoes need water'], ['garden', 'Plant the garlic in October'],
  ['planning', 'Weekly planning on Sunday'], ['planning', 'Plan the quarter goals'], ['health', 'Dentist in November'], ['home', 'Fix the porch light'],
]
const loose = [
  'One thought at a time', 'Sky polish for the toolbar icons', 'Garden: order more garlic', 'Weekly planning template', 'Buy cat litter',
  'Cat vet on Friday', 'Cats need new toys', 'Call the landlord about the porch', 'Dentist reminder for Nate', 'OSAT idea: a quieter dock',
  'Sky search should find stickies inside branches', 'Plan the quarter with the team', 'Water the tomatoes twice', 'Renew the passport',
]
const notes = [
  ...filed.map(([folderId, title], index) => ({ id: `f${index}`, title, markdown: title, folderId, createdAt: at(1), updatedAt: at(1), rank: index })),
  ...Array.from({ length: 91 }, (_, index) => {
    const title = loose[index] || `Thought number ${index + 1} from the week`
    return { id: `u${index}`, title, markdown: index === 0 ? `${title}\n\nWhen the pile is big, only show one sticky and the places it could go. Return moves it.` : title, unsorted: true, source: index % 3 ? 'Desk' : 'iPhone', createdAt: at(3), updatedAt: at(3), rank: 1000 + index, tags: index === 2 ? ['garden'] : [] }
  }),
]

/* The Mac app's AI bridge, faked in the page: `scenario` picks its state. */
function fakeAi({ scenario }) {
  const total = 3_000_000_000
  const tier = (state, extra = {}) => ({ id: 'balanced', label: 'Balanced', model: 'Gemma 4', ready: true, state, busy: false, blocked: false, message: '', ...extra })
  const ready = ['ready', 'asleep', 'freed', 'waking', 'failed'].includes(scenario)
  let status = {
    chosen: 'balanced',
    tiers: [ready ? tier(scenario === 'ready' ? 'ready' : 'idle', { blocked: scenario === 'freed' }) : tier('idle', { ready: false })],
    download: scenario === 'downloading' ? { tier: 'balanced', received: total * 0.42, total, state: 'running' } : scenario === 'offline' ? { tier: 'balanced', received: total * 0.6, total, state: 'paused' } : null,
  }
  const listeners = new Set()
  const emit = (next) => { status = next; listeners.forEach((listener) => listener(status)) }
  const models = () => (ready ? [{ id: 'osat:balanced', name: 'Gemma 4 · Balanced', label: 'Balanced', runtime: 'osat', offline: true, state: status.tiers[0].state }] : [])
  window.osatLocalAI = {
    status: async () => status,
    onStatus: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    models: async () => ({ models: models() }),
    resume: async () => status,
    chatStream: (payload, onDelta) => {
      if (scenario === 'failed') return { done: Promise.reject(new Error("Error invoking remote method 'local-ai:chat-stream': Error: The model could not start (not enough memory).")), cancel() {} }
      if (scenario === 'waking') { emit({ ...status, tiers: [tier('loading')] }); return { done: new Promise(() => {}), cancel() {} } }
      const one = /place one sticky/.test(payload.messages[0].content)
      const text = one ? 'Place 1: it is about the Sky and how it looks' : '1: 1\n2: 3\n3: 5\n4: 6\n5: new: Cats\n6: new: Cats\n7: new: Cats'
      onDelta(text)
      return { done: Promise.resolve(text), cancel() {} }
    },
  }
  if (scenario === 'offline') window.osatUnder = { status: async () => ({ on: true }), set: async (on) => ({ on }), onChange: () => () => {} }
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
async function open(browser, url, scenario, width) {
  const page = await browser.newPage({ viewport: { width, height: width < 800 ? 820 : 900 } })
  page.on('pageerror', (error) => problems.push(`${scenario}@${width}: ${error.message}`))
  await page.addInitScript(fakeAi, { scenario })
  await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
  // Seed the preview's own database (never the Mac app's) from a blank page on the same origin, then load OSAT.
  await page.route('**/seed.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(`${url}seed.html`)
  await page.evaluate(async ({ notes, folders }) => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('osat-preview', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspace'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite')
      transaction.objectStore('workspace').put({ schema: 11, rev: 0, theme: 'system', notes, folders, habits: [], reflections: [], focus: { status: 'idle' }, projects: [], sorter: null, calendar: { events: [] }, budget: { currency: 'USD', transactions: [], recurring: [] }, settings: {}, chats: [] }, 'doc')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { notes, folders })
  await page.goto(url)
  await page.waitForSelector('.workspace-content', { timeout: 15000 })
  await sleep(500)
  await page.keyboard.press('Control+3')
  await page.locator('.sky-layer').waitFor({ timeout: 5000 })
  if (width < 800 && !(await page.locator('.sky-nav-views').count())) await page.getByRole('button', { name: 'Show Sky navigator' }).click()
  await page.locator('.sky-nav-views').getByRole('button', { name: /^Unsorted/ }).click()
  const sorter = page.getByRole('region', { name: 'Sort Unsorted stickies', exact: true })
  await sorter.waitFor({ timeout: 5000 })
  await sleep(400)
  return { page, sorter }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  const expect = {
    none: /isn’t set up yet/, downloading: /still downloading · 42%/, asleep: /resting/, freed: /memory was freed/,
    ready: /awake/, offline: /offline, so the AI download waits at 60%/, failed: /could not start/, waking: /Waking the AI/,
  }
  for (const [scenario, words] of Object.entries(expect)) {
    for (const width of scenario === 'none' || scenario === 'ready' ? [1440, 1100, 600] : [1100]) {
      const { page, sorter } = await open(browser, url, scenario, width)
      if (scenario === 'waking' || scenario === 'failed') { await page.keyboard.press('a'); await sleep(700) }
      if (scenario === 'ready') { await page.keyboard.press('a'); await sleep(500) }
      const line = await sorter.locator('.sorter-ai').first().textContent()
      if (!words.test(line)) problems.push(`${scenario}@${width}: the AI line said “${line}”`)
      await page.screenshot({ path: `${OUT}/${scenario}-${width}.png` })
      if (width === 1100 && scenario === 'ready') {
        // Suggest homes for all: one line per place, Do all of these, one Undo.
        await sorter.getByRole('button', { name: 'Suggest homes for all' }).click()
        await sorter.locator('.sorter-groups li').first().waitFor({ timeout: 5000 }).catch(() => problems.push('ready: Suggest homes for all showed no groups'))
        await page.screenshot({ path: `${OUT}/sort-all-${width}.png` })
      }
      if (width === 1100 && scenario === 'none') {
        // Keyboard: 2 picks the second home, Return moves it, Undo brings it back.
        const first = await sorter.locator('.sorter-paper h3').textContent()
        await page.keyboard.press('Enter')
        await sleep(300)
        if (await sorter.locator('.sorter-paper h3').textContent() === first) problems.push('keys: Return did not move the sticky')
        await page.keyboard.press('Meta+z')
        await sleep(300)
        if (await sorter.locator('.sorter-paper h3').textContent() !== first) problems.push('keys: ⌘Z did not bring the sticky back')
        await page.keyboard.press('l')
        await sleep(200)
        if (await sorter.locator('.sorter-paper h3').textContent() === first) problems.push('keys: L did not put it off for later')
        await page.keyboard.press('f')
        await page.keyboard.type('gard')
        await sleep(200)
        await page.screenshot({ path: `${OUT}/another-place-${width}.png` })
        await page.keyboard.press('Escape')
        await page.screenshot({ path: `${OUT}/after-keys-${width}.png` })
      }
      await page.close()
    }
  }
  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Sorting screen checked. Screenshots in ${OUT}/`)
  })
