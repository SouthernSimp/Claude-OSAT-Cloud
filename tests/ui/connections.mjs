// Connections in an isolated browser, with every native bridge faked. Run in CI, never on Nate's Mac.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'
import { openRoom } from './window.mjs'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/connections`
const PORT = Number(process.env.OSAT_PORT || 4349)
let server
async function start() {
  if (process.env.OSAT_URL) return process.env.OSAT_URL
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
  const url = `http://127.0.0.1:${PORT}/`
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(url)).ok) return url } catch { /* starting */ } await sleep(250) }
  throw new Error('The isolated preview did not start.')
}

function fakeConnections() {
  const clone = (value) => structuredClone(value)
  const listeners = new Set()
  const offlineListeners = new Set()
  const state = {
    offline: false,
    cloud: { model: 'local', providers: [], leavesMac: '', lasting: true },
    askApps: [
      { id: 'granola', name: 'Granola', where: 'https://mcp.granola.ai/mcp', on: true, tools: 2, toolNames: ['list_meetings', 'get_meetings'], checkedAt: new Date().toISOString(), signIn: true, signedIn: true },
      { id: 'notion', name: 'Notion', where: 'https://mcp.notion.com/mcp', on: false, tools: null, toolNames: [], signIn: true, signedIn: false },
    ],
    connector: { on: false, running: false, url: 'http://127.0.0.1:3211/mcp', apps: [], recent: [] },
    nodes: { dir: '/isolated/example-boards', arrived: [], setAside: [] },
  }
  const calls = []
  const emit = () => listeners.forEach((listener) => listener(clone(state)))
  const app = (id) => state.askApps.find((item) => item.id === id)
  let removed
  let next = 0
  window.__connectionsTest = { state, calls, emit }
  window.osatBots = {
    status: async () => clone(state),
    onStatus: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    chooseModel: async (model) => { calls.push(['model', model]); state.cloud.model = model; state.cloud.leavesMac = model === 'local' ? '' : 'Example AI'; emit() },
    connect: async (input) => {
      calls.push(['provider', input])
      state.cloud.providers.push({ id: 'example', name: 'Example AI', model: 'example-chat', models: ['example-chat'] })
      state.cloud.model = 'cloud:example:example-chat'; state.cloud.leavesMac = 'Example AI'; emit()
      return clone(state.cloud.providers.at(-1))
    },
    connectorOn: async () => { calls.push(['connectorOn']); state.connector.on = true; state.connector.running = true; emit(); return clone(state.connector) },
    connectorOff: async () => { calls.push(['connectorOff']); state.connector.on = false; state.connector.running = false; emit() },
    addApp: async (input) => { calls.push(['shareApp', input]); state.connector.apps.push({ ...input, id: `share-${++next}` }); emit(); return clone(state.connector) },
    copyInstructions: async () => calls.push(['copyInstructions']),
    showNodes: async () => calls.push(['showNodes']),
  }
  window.osatAskApps = {
    toggle: async (id, on) => { calls.push(['toggle', id, on]); app(id).on = on; emit() },
    check: async (id) => { calls.push(['check', id]); app(id).checkedAt = new Date().toISOString(); emit(); return clone(app(id)) },
    add: async (input) => {
      calls.push(['add', input])
      const made = { id: `app-${++next}`, name: input.name || 'Custom app', where: input.url || input.command, on: false, tools: null, toolNames: [], signIn: input.kind === 'http' }
      state.askApps.push(made); emit(); return clone(made)
    },
    signIn: async (id) => { calls.push(['signIn', id]); Object.assign(app(id), { on: true, signedIn: true, tools: 1, toolNames: ['read_notes'], error: '' }); emit(); return clone(app(id)) },
    remove: async (id) => { calls.push(['remove', id]); removed = app(id); state.askApps = state.askApps.filter((item) => item.id !== id); emit() },
    undoRemove: async () => { calls.push(['undoRemove']); state.askApps.push(removed); removed = null; emit() },
    claudeConfig: async () => ({ apps: [{ name: 'Calendar', where: 'node example-calendar.mjs', added: false, withKey: false }, { name: 'Mail', where: 'node example-mail.mjs', added: false, withKey: false }] }),
    import: async (names) => {
      calls.push(['import', names])
      const added = names.map((name) => ({ id: `import-${++next}`, name, on: false, tools: null, toolNames: [], where: `node example-${name.toLowerCase()}.mjs` }))
      state.askApps.push(...added); emit(); return { added, skipped: [] }
    },
  }
  window.osatUnder = {
    status: async () => ({ on: state.offline }),
    onChange: (listener) => { offlineListeners.add(listener); return () => offlineListeners.delete(listener) },
    set: async (on) => { state.offline = on; emit(); offlineListeners.forEach((listener) => listener({ on })); return { on } },
  }
  localStorage.setItem('osat.tour.v1', 'seen')
}

const problems = []
const section = (page) => page.locator('.settings-section[data-page="bots"]')
const row = (page, name) => section(page).locator('.ask-apps > li').filter({ has: page.locator('.ask-app-name b', { hasText: new RegExp(`^${name}$`) }) })
const choosePage = (page, name) => page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name, exact: true }).click()

async function exercise(page) {
  const root = section(page)
  assert.equal(await page.evaluate(() => window.__connectionsTest.calls.length), 0, 'visiting Connections made a change')
  assert.equal(await root.locator('.ask-app-detail').count(), 0)
  assert.equal(await root.locator('input[type="password"]').count(), 0, 'AI keys were still in Connections')
  assert.equal(await root.getByRole('button', { name: 'Check connection', exact: true }).count(), 0)
  assert.equal(await root.getByRole('button', { name: 'Remove', exact: true }).count(), 0)
  await row(page, 'Notion').getByRole('switch').click()
  assert.equal(await row(page, 'Notion').getByRole('switch').isChecked(), true)
  await row(page, 'Notion').getByRole('switch').click()

  await row(page, 'Granola').getByRole('button', { name: /^Granola/ }).click()
  assert.equal(await row(page, 'Granola').locator('code').innerText(), 'https://mcp.granola.ai/mcp')
  await row(page, 'Granola').getByRole('button', { name: 'Check connection' }).click()
  await row(page, 'Granola').getByRole('button', { name: 'Sign in again' }).click()
  await row(page, 'Granola').locator('.ask-app-capabilities summary').click()
  assert.equal(await row(page, 'Granola').locator('.ask-app-tools li').count(), 1)
  await page.keyboard.press('Escape')
  assert.equal(await root.locator('.ask-app-detail').count(), 0)
  assert.equal(await row(page, 'Granola').getByRole('button', { name: /^Granola/ }).evaluate((element) => element === document.activeElement), true)

  await row(page, 'Granola').getByRole('button', { name: /^Granola/ }).click()
  await row(page, 'Granola').getByRole('button', { name: 'Remove', exact: true }).click()
  assert.equal(await row(page, 'Granola').count(), 0)
  await root.getByRole('button', { name: 'Undo', exact: true }).click()
  await row(page, 'Granola').waitFor()

  const connect = root.getByRole('button', { name: 'Connect an app', exact: true })
  await connect.click()
  const picker = root.getByRole('region', { name: 'Connect an app' })
  assert.equal(await picker.evaluate((element) => element === document.activeElement), true)
  await page.keyboard.press('Escape')
  assert.equal(await connect.evaluate((element) => element === document.activeElement), true)
  await connect.click()
  await picker.getByRole('button', { name: 'Use a web address or command' }).click()
  assert.equal(await picker.getByRole('button', { name: 'Add', exact: true }).isDisabled(), true)
  await picker.getByRole('radio', { name: 'A command on this Mac' }).click()
  await picker.getByRole('textbox', { name: 'Name', exact: true }).fill('Local helper')
  await picker.getByRole('textbox', { name: 'Command', exact: true }).fill('node example.mjs')
  await picker.getByRole('button', { name: 'Add', exact: true }).click()
  await row(page, 'Local helper').waitFor()
  assert.equal(await row(page, 'Local helper').getByRole('switch').isChecked(), false)

  await connect.click()
  await picker.getByRole('button', { name: 'Import from Claude Desktop' }).click()
  await picker.getByRole('checkbox', { name: /Calendar/ }).check()
  await picker.getByRole('button', { name: 'Add it', exact: true }).click()
  await row(page, 'Calendar').waitFor()
  assert.equal(await row(page, 'Calendar').getByRole('switch').isChecked(), false)
  assert.equal(await row(page, 'Mail').count(), 0, 'an unselected import was added')

  await page.evaluate(() => { const test = window.__connectionsTest; test.state.askApps = test.state.askApps.filter((app) => app.name !== 'Notion'); test.emit() })
  await connect.click()
  const find = picker.getByRole('searchbox', { name: 'Find an app' })
  await find.fill('payments')
  assert.equal(await picker.locator('.ask-apps-presets > div').count(), 2, 'Find an app should leave Stripe and PayPal')
  await find.fill('nothing like this')
  await picker.getByText('Not in the list yet.').waitFor()
  await find.fill('')
  await picker.screenshot({ path: `${OUT}/connect-an-app.png` })
  await picker.locator('.ask-apps-presets > div', { hasText: 'Notion' }).getByRole('button', { name: 'Connect', exact: true }).click()
  await row(page, 'Notion').waitFor()
  assert.equal(await row(page, 'Notion').getByRole('switch').isChecked(), true, 'sign-in did not show the backend’s enabled state')
  await page.evaluate(() => { const test = window.__connectionsTest; test.state.askApps.find((app) => app.name === 'Notion').error = 'Please sign in again.'; test.emit() })
  await row(page, 'Notion').getByRole('button', { name: /Needs attention/ }).click()
  await row(page, 'Notion').getByRole('status').filter({ hasText: 'Please sign in again.' }).waitFor()

  await root.getByRole('switch', { name: 'Offline', exact: true }).click()
  assert.equal(await row(page, 'Notion').getByRole('button', { name: 'Sign in again' }).isDisabled(), true)
  await root.getByRole('switch', { name: 'Offline', exact: true }).click()
  await root.locator('.connections-more > summary', { hasText: 'Let other apps use OSAT' }).click()
  const sharing = root.locator('.connections-more').first()
  await sharing.getByRole('button', { name: 'Turn on', exact: true }).click()
  assert.equal(await sharing.getByRole('radio', { name: 'Can look', exact: true }).getAttribute('aria-checked'), 'true', 'sharing no longer defaults to read access')
  await sharing.getByRole('textbox', { name: 'The app’s name' }).fill('Example reader')
  await sharing.getByRole('button', { name: 'Add', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.__connectionsTest.calls.find((call) => call[0] === 'shareApp')[1]), { name: 'Example reader', access: 'read' })
  await page.keyboard.press('Escape')
  assert.equal(await sharing.getAttribute('open'), null, 'Escape did not put sharing setup away')

  await root.getByRole('button', { name: 'Open AI settings', exact: true }).click()
  await page.getByRole('button', { name: 'Connect a provider' }).click()
  await page.getByLabel('API key', { exact: true }).fill('example-test-key-only')
  await page.locator('.bots-connect').getByRole('button', { name: 'Connect', exact: true }).click()
  await page.getByRole('heading', { name: 'Example AI answers.' }).waitFor()
  assert.equal(await page.locator('input[type="password"]').count(), 0, 'the provider key stayed in the form after connecting')
  await choosePage(page, 'Connections')
  assert.equal(await root.locator('.bots-models').count(), 0)
  await page.evaluate(() => { const test = window.__connectionsTest; test.state.askApps = []; test.emit() })
  await root.getByText('Your apps, working together.', { exact: true }).waitFor()
  assert.equal(await root.getByRole('button', { name: 'Connect an app', exact: true }).isEnabled(), true)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const url = await start()
  const browser = await chromium.launch()
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
      page.on('pageerror', (error) => problems.push(error.message))
      await page.addInitScript(fakeConnections)
      await page.goto(url)
      await page.waitForSelector('.workspace-content')
      await openRoom(page, 'Settings')
      await choosePage(page, 'Connections')
      await row(page, 'Granola').waitFor()
      await sleep(500) // Let the Settings entrance finish before taking its review image.
      await page.screenshot({ path: `${OUT}/${theme}-overview.png` })
      if (theme === 'dark') {
        try { await exercise(page) }
        catch (error) {
          await page.screenshot({ path: `${OUT}/failed.png` })
          console.error(await page.locator('.settings').innerText(), problems)
          throw error
        }
      }
      else {
        await page.setViewportSize({ width: 820, height: 760 })
        assert.equal(await section(page).evaluate((element) => element.scrollWidth <= element.clientWidth), true)
        await page.screenshot({ path: `${OUT}/light-narrow.png` })
      }
      await page.close()
    }
    assert.deepEqual(problems, [], 'browser errors')
    console.log(`Connections checked. Screenshots in ${OUT}/`)
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => server?.kill())
