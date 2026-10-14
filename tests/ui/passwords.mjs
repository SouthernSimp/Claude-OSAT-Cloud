// Tools → Passwords (Phase 58) in the built preview, with the Mac's bridge faked in the page: choosing a master password
// (the hint, asked twice, "can't be recovered"), one primary action on each screen, adding and making a password, Reveal
// (hides itself after ten seconds), Copy (the page never holds the password), Delete with Undo, Lock, a wrong password, a lock
// that comes from main (idle), and leaving the room locks. Light, then a look at dark. Screenshots land in test-results/ui/passwords/.
// Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const OUT = `${process.env.OSAT_SHOTS || 'test-results/ui'}/passwords`
const PORT = Number(process.env.OSAT_PORT || 4324)
const MASTER = 'a long master passphrase 2026'
const SECRET = 'Zq9-SECRET-site-password-Zq9'

function fakePasswords(master) {
  const state = { exists: false, unlocked: false, entries: [], deleted: [], minutes: 5, n: 0 }
  const listeners = []
  window.__calls = []
  window.__copied = []
  window.__generated = []
  const pub = () => state.entries.map(({ id, title, username, url }) => ({ id, title, username, url, updatedAt: '2026-10-13T10:00:00Z' })).sort((a, b) => a.title.localeCompare(b.title))
  const need = () => { if (!state.unlocked) throw new Error('Your passwords are locked. Unlock them first.') }
  const call = (name, value) => window.__calls.push(name)
  window.__lock = () => { state.unlocked = false; listeners.forEach((listener) => listener()) }
  window.osatPasswords = {
    status: async () => ({ exists: state.exists, unlocked: state.unlocked, waitMs: 0, autoLockMinutes: state.minutes }),
    create: async (password, again) => {
      if (password !== again) throw new Error('The two master passwords don’t match.')
      state.exists = true; state.unlocked = true; return []
    },
    unlock: async (password) => {
      if (password !== master) throw new Error('That didn’t unlock your passwords. Check the master password and try again.')
      state.unlocked = true; return pub()
    },
    lock: async () => { call('lock'); if (state.unlocked) { state.unlocked = false } return true },
    touch: async () => { call('touch'); return true },
    list: async () => { need(); return pub() },
    save: async (entry) => {
      need()
      const id = entry.id || `id-${(state.n += 1)}0000000`
      const old = state.entries.find((item) => item.id === id)
      state.entries = [...state.entries.filter((item) => item.id !== id), { id, title: entry.title, username: entry.username || '', url: entry.url || '', password: entry.password || old?.password }]
      return { id, list: pub() }
    },
    remove: async (id) => {
      need()
      const gone = state.entries.find((item) => item.id === id)
      state.entries = state.entries.filter((item) => item.id !== id); state.deleted.push(gone)
      return { id, title: gone.title, list: pub() }
    },
    restore: async (id) => { need(); state.entries.push(state.deleted.find((item) => item.id === id)); return pub() },
    reveal: async (id) => { need(); return state.entries.find((item) => item.id === id).password },
    copy: async (id) => { need(); window.__copied.push(id); return { clearsInSeconds: 30 } },
    generate: async (options) => { window.__generated.push(options); return 'Gen3rated!Pass-word' },
    setAutoLock: async (minutes) => { state.minutes = minutes; return minutes },
    changeMaster: async () => true,
    exportBackup: async () => 'OSAT passwords backup.json',
    pickBackup: async () => ({ name: 'backup.json' }),
    importBackup: async () => ({ added: 1, updated: 0, list: pub() }),
    onLocked: (listener) => { listeners.push(listener); return () => { listeners.splice(listeners.indexOf(listener), 1) } },
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
    await page.addInitScript(fakePasswords, MASTER)
    await page.addInitScript(() => { for (const key of ['osat.tour.v1', 'osat.sky.guide.v1']) localStorage.setItem(key, 'seen') })
    await page.goto(`${url}?fresh=1`)
    await page.waitForSelector('.workspace-content', { timeout: 15000 })
    await page.locator('.app-dock [data-space="tools"]').click()
    await page.getByRole('menuitem', { name: 'Passwords' }).click()
    const room = page.locator('.popout-body[data-view="Passwords"]')
    const words = async () => (await room.innerText())
    const primaries = () => room.locator('.primary-button:visible').count()

    // First time: the master password, asked twice, with a hint, and a plain word that it can't be recovered.
    await room.getByRole('heading', { name: 'Choose a master password' }).waitFor({ timeout: 5000 }).catch(() => problems.push(`${theme}: no first-time screen`))
    check(/can’t be recovered/.test(await words()), `${theme}: the setup screen doesn’t say a forgotten master password can’t be recovered`)
    await room.getByLabel('Master password').fill('short')
    check(await room.getByText(/Too short/).count() === 1, `${theme}: no hint for a short master password`)
    check(await room.getByRole('button', { name: 'Create' }).isDisabled(), `${theme}: Create was allowed with a short password`)
    await room.getByLabel('Master password').fill(MASTER)
    check(await room.getByText('Strong.').count() === 1, `${theme}: no strong hint for a long master password`)
    await room.getByLabel('Type it again').fill('not the same')
    check(await room.getByRole('button', { name: 'Create' }).isDisabled(), `${theme}: Create was allowed when the two differ`)
    check(await primaries() === 1, `${theme}: setup should have one primary action`)
    await sleep(600)
    await page.screenshot({ path: `${OUT}/${theme}-setup.png` })
    await room.getByLabel('Type it again').fill(MASTER)
    await room.getByRole('button', { name: 'Create' }).click()

    // Open and empty: one primary action, New password.
    await room.getByText('No passwords yet.').waitFor({ timeout: 5000 }).catch(() => problems.push(`${theme}: creating didn’t open the list`))
    check(await primaries() === 1 && await room.getByRole('button', { name: 'New password' }).evaluate((node) => node.classList.contains('primary-button')), `${theme}: the empty list should have New password as its one primary action`)
    await room.getByRole('button', { name: 'New password' }).click()
    await room.getByLabel('Name', { exact: true }).fill('Bank')
    await room.getByLabel('Username').fill('nate')
    await room.getByRole('button', { name: 'Make one' }).click()
    check((await room.getByLabel('Password', { exact: true }).inputValue()) === 'Gen3rated!Pass-word', `${theme}: Make one didn’t fill the password`)
    check(JSON.stringify(await page.evaluate(() => window.__generated)) === JSON.stringify([{ length: 20, symbols: true }]), `${theme}: Make one asked for the wrong kind`)
    await room.getByLabel('Password', { exact: true }).fill(SECRET)
    check(await primaries() === 1, `${theme}: the form should have one primary action (Save)`)
    await room.getByRole('button', { name: 'Save' }).click()

    // One password: Copy is the one primary action; the page holds no password until Reveal.
    await room.getByRole('heading', { name: 'Bank' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: the saved password didn’t show`))
    check(await primaries() === 1 && await room.getByRole('button', { name: 'Copy password' }).evaluate((node) => node.classList.contains('primary-button')), `${theme}: Copy password should be the one primary action`)
    check(!(await page.content()).includes(SECRET), `${theme}: the password was in the page before Reveal`)
    await sleep(500)
    await page.screenshot({ path: `${OUT}/${theme}-entry.png` })
    await room.getByRole('button', { name: 'Reveal password' }).click()
    check((await words()).includes(SECRET), `${theme}: Reveal didn’t show the password`)
    await room.getByRole('button', { name: 'Hide password' }).click()
    check(!(await page.content()).includes(SECRET), `${theme}: Hide left the password in the page`)
    await room.getByRole('button', { name: 'Copy password' }).click()
    await page.locator('.undo-toasts').getByText(/Copied\. It leaves the clipboard in 30 seconds/).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: Copy didn’t say what happens next`))
    check((await page.evaluate(() => window.__copied)).length === 1, `${theme}: Copy didn’t ask main to copy`)
    check(!(await page.content()).includes(SECRET), `${theme}: Copy brought the password into the page`)

    if (theme === 'dark') {
      await room.getByRole('button', { name: 'Lock', exact: true }).click()
      await room.getByRole('button', { name: 'Unlock' }).waitFor({ timeout: 3000 })
      await page.screenshot({ path: `${OUT}/dark-locked.png` })
      await page.close()
      continue
    }

    // A revealed password hides itself after ten seconds.
    await room.getByRole('button', { name: 'Reveal password' }).click()
    check((await words()).includes(SECRET), `${theme}: Reveal didn’t show the password again`)
    await sleep(10600)
    check(!(await page.content()).includes(SECRET), `${theme}: the password stayed on screen past ten seconds`)

    // Delete is at once, with Undo.
    await room.getByRole('button', { name: 'Delete' }).click()
    await page.locator('.undo-toasts').getByText('Deleted “Bank”').waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: Delete didn’t offer Undo`))
    check(await room.getByText('No passwords yet.').count() === 1, `${theme}: the deleted password stayed`)
    await page.locator('.undo-toasts').getByRole('button', { name: 'Undo' }).click()
    await room.getByRole('button', { name: /^Bank/ }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: Undo didn’t bring it back`))

    // The more panel: the lock time, a backup, a new master password.
    await room.getByRole('button', { name: 'More' }).click()
    await room.getByLabel('Lock after').selectOption('15')
    check(await room.getByText(/Nothing readable is ever saved/).count() === 1, `${theme}: the backup note is missing`)
    await sleep(400)
    await page.screenshot({ path: `${OUT}/${theme}-more.png` })

    // Lock: one field and Unlock; nothing of the list is left on the page.
    await room.getByRole('button', { name: 'Lock', exact: true }).click()
    await room.getByRole('button', { name: 'Unlock' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: Lock didn’t show the locked screen`))
    check(await room.locator('input').count() === 1 && await primaries() === 1, `${theme}: the locked screen should be one field and Unlock`)
    check(!/Bank|nate/.test(await words()) && !(await page.content()).includes(SECRET), `${theme}: the locked screen still shows passwords`)
    await room.getByLabel('Master password').fill('not it')
    await room.getByRole('button', { name: 'Unlock' }).click()
    await room.getByText(/didn’t unlock your passwords/).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: a wrong master password wasn’t said calmly`))
    await room.getByLabel('Master password').fill(MASTER)
    await room.getByRole('button', { name: 'Unlock' }).click()
    await room.getByRole('button', { name: /^Bank/ }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: the right master password didn’t unlock`))

    // A lock that comes from main (idle, sleep, the desk put away) closes the list at once.
    await page.evaluate(() => window.__lock())
    await room.getByRole('button', { name: 'Unlock' }).waitFor({ timeout: 3000 }).catch(() => problems.push(`${theme}: a lock from main didn’t reach the page`))
    check(!/Bank/.test(await words()), `${theme}: the list stayed after a lock from main`)
    check(!/vault|credential/i.test(await words()), `${theme}: a word Nate shouldn’t read`)

    // Leaving the room locks it.
    const before = (await page.evaluate(() => window.__calls)).filter((name) => name === 'lock').length
    await room.getByLabel('Master password').fill(MASTER)
    await room.getByRole('button', { name: 'Unlock' }).click()
    await room.getByRole('button', { name: /^Bank/ }).waitFor({ timeout: 3000 })
    await page.locator('.popouts').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {})
    await page.keyboard.press('Escape')
    await room.waitFor({ state: 'detached', timeout: 3000 }).catch(() => problems.push(`${theme}: Esc didn’t close the room`))
    check((await page.evaluate(() => window.__calls)).filter((name) => name === 'lock').length > before, `${theme}: closing the room didn’t lock`)
    await page.close()
  }
  await browser.close()
}

main()
  .catch((error) => problems.push(error.stack || error.message))
  .finally(() => {
    server?.kill()
    if (problems.length) { console.error(problems.join('\n')); process.exit(1) }
    console.log(`Passwords room checked. Screenshots in ${OUT}/`)
  })
