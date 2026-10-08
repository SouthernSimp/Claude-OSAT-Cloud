/* On a Mac: every ready-made shortcut (Settings → Bots → Siri and Shortcuts) is a property list
   macOS reads (`plutil -lint`), and Apple's `shortcuts sign` signs it the way OSAT does, with a
   made-up key and port. Nothing is opened, added to Shortcuts or run.
   Signing uses the Mac's iCloud account. CI's Mac isn't signed in to one, so there (CI is set)
   a signing failure is reported and the check passes on the property lists alone.
     node scripts/shortcuts-check.cjs */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createShortcuts } = require('../desktop/bots/shortcuts.cjs')

async function main() {
  if (process.platform !== 'darwin') throw new Error('This check needs a Mac.')
  const { SHORTCUTS, shortcutFile } = await import(pathToFileURL(path.join(__dirname, '..', 'shared', 'shortcut-file.mjs')).href)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osat-shortcuts-'))
  const where = { api: 'http://127.0.0.1:47823/api', key: 'ci-not-a-real-key-0123456789' }
  try {
    for (const { id } of SHORTCUTS) {
      const plist = path.join(dir, `${id}.plist`)
      await fs.writeFile(plist, shortcutFile(id, where).text)
      execFileSync('/usr/bin/plutil', ['-lint', '-s', plist])
    }
    const shortcuts = createShortcuts({ dir: path.join(dir, 'signed'), build: shortcutFile })
    for (const { id, name } of SHORTCUTS) {
      let signed
      try {
        signed = await shortcuts.make(id, where)
      } catch (error) {
        if (!process.env.CI) throw error
        console.log(`Shortcuts check: ${SHORTCUTS.length} shortcuts read as property lists. Signing was skipped here: ${error.message}`)
        return
      }
      const head = (await fs.readFile(signed)).subarray(0, 4).toString('latin1')
      if (path.basename(signed) !== `${name}.shortcut` || head !== 'AEA1') throw new Error(`“${name}” wasn’t signed.`)
    }
    if ((await fs.readdir(path.join(dir, 'signed'))).some((file) => file.includes('.unsigned.'))) throw new Error('An unsigned file was left behind.')
    console.log(`Shortcuts check: ${SHORTCUTS.length} shortcuts read as property lists and were signed.`)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`Shortcuts check failed: ${error.message}`)
  process.exit(1)
})
