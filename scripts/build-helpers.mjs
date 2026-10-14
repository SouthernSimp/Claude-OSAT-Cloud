/* Compiles every desktop/helpers/*.swift into build/helpers/<name> with swiftc (Mac only; anywhere else it does nothing).
   electron-builder ships that folder as Resources/helpers (package.json `extraResources`). It only compiles: nothing is run. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'desktop', 'helpers')
const to = path.join(root, 'build', 'helpers')

if (process.platform !== 'darwin') {
  console.log('Helpers are built on a Mac only; skipping.')
  process.exit(0)
}
mkdirSync(to, { recursive: true })
for (const file of readdirSync(from).filter((name) => name.endsWith('.swift'))) {
  const out = path.join(to, path.basename(file, '.swift'))
  console.log(`swiftc ${file} → build/helpers/${path.basename(out)}`)
  execFileSync('swiftc', ['-O', path.join(from, file), '-o', out], { stdio: 'inherit' })
}
