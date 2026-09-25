// Copies the freshly built OSAT Field.app into /Applications, quitting a running copy first.
// Your notes live in ~/Library/Application Support/OSAT Field and are never touched.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const release = join(process.cwd(), 'release')
const folder = readdirSync(release).find((name) => name.startsWith('mac') && existsSync(join(release, name, 'OSAT Field.app')))
if (!folder) throw new Error('No built app found. Run npm run dist:mac first.')
const app = join(release, folder, 'OSAT Field.app')
try { execFileSync('osascript', ['-e', 'tell application "OSAT Field" to quit']) } catch { /* not running */ }
execFileSync('ditto', [app, '/Applications/OSAT Field.app'])
console.log('Installed /Applications/OSAT Field.app')
