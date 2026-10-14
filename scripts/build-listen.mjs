// Builds OSAT's listening helper (desktop/meetings/osat-listen.swift) to build/helpers/osat-listen.
// Meetings need it on a Mac; anywhere else there is nothing to build. `npm run dist:mac` and
// `npm run start:mac` run it first (it needs the Command Line Tools: `xcode-select --install`).
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)
const root = fileURLToPath(new URL('..', import.meta.url))
mkdirSync(`${root}build/helpers`, { recursive: true })
try {
  execFileSync('swiftc', ['-O', '-swift-version', '5', '-target', 'arm64-apple-macos13.0', `${root}desktop/meetings/osat-listen.swift`, '-o', `${root}build/helpers/osat-listen`], { stdio: 'inherit' })
} catch {
  console.error('Could not build the listening helper. Install the Command Line Tools (xcode-select --install) and try again.')
  process.exit(1)
}
