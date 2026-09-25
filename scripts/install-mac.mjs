// Copies the freshly built OSAT.app into /Applications, quitting a running copy first.
// Notes live in ~/Library/Application Support/OSAT and are never touched.
// An older app already called OSAT.app (a different bundle id) is renamed aside, never overwritten.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const APP_ID = 'ai.mccreery.osat'
const TARGET = '/Applications/OSAT.app'

const release = join(process.cwd(), 'release')
const folder = existsSync(release) && readdirSync(release).find((name) => name.startsWith('mac') && existsSync(join(release, name, 'OSAT.app')))
if (!folder) throw new Error('No built app found. Run npm run dist:mac first.')
const built = join(release, folder, 'OSAT.app')

function bundleId(app) {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function freeName(base) {
  let candidate = `${base}.app`
  for (let n = 2; existsSync(candidate); n += 1) candidate = `${base} ${n}.app`
  return candidate
}

try { execFileSync('osascript', ['-e', `tell application id "${APP_ID}" to quit`]) } catch { /* not running */ }

if (existsSync(TARGET)) {
  if (bundleId(TARGET) === APP_ID) {
    // Our own previous build: remove it so no stale files survive inside the bundle.
    rmSync(TARGET, { recursive: true, force: true })
  } else {
    const aside = freeName('/Applications/OSAT (old)')
    renameSync(TARGET, aside)
    console.log(`Moved the older OSAT app aside to ${aside}`)
  }
}

execFileSync('ditto', [built, TARGET])
console.log(`Installed ${TARGET}`)
