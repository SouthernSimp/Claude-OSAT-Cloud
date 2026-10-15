// Builds OSAT's small native helpers: every desktop/helpers/*.swift becomes build/helpers/<name> (arm64 and x86_64 in
// one file when both can be built), and every desktop/helpers/*.m a Node-API module, build/helpers/<name>.node, that the
// main process loads itself (osat-blur). On anything but a Mac there is nothing to build and it ends quietly.
// `npm run dist:mac` and `npm run start:mac` run it first (it needs the Command Line Tools: `xcode-select --install`);
// package.json's build.extraResources puts the result inside the app.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const ARCHS = ['arm64', 'x86_64']

/* The helpers there are: [{ name, source, out }]. */
export function listHelpers(base = root) {
  const dir = join(base, 'desktop', 'helpers')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((file) => file.endsWith('.swift') || file.endsWith('.m')).sort().map((file) => {
    const name = basename(file).replace(/\.(swift|m)$/, '')
    const module = file.endsWith('.m')
    return { name, module, source: join(dir, file), out: join(base, 'build', 'helpers', module ? `${name}.node` : name) }
  })
}

/* A Node-API module: one bundle for both architectures; its napi_* calls are found in Electron when it is loaded. */
function buildModule({ source, out }) {
  execFileSync('clang', ['-bundle', '-fobjc-arc', '-O2', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=13.0',
    '-framework', 'Cocoa', '-framework', 'CoreGraphics', '-undefined', 'dynamic_lookup', source, '-o', out], { stdio: 'inherit' })
  execFileSync('codesign', ['--force', '--sign', '-', out], { stdio: 'inherit' })
}

function build({ source, out }) {
  const built = []
  for (const arch of ARCHS) {
    try {
      execFileSync('swiftc', ['-O', '-swift-version', '5', '-target', `${arch}-apple-macos13.0`, source, '-o', `${out}.${arch}`], { stdio: 'inherit' })
      built.push(`${out}.${arch}`)
    } catch {
      // The app is arm64 only; a Mac without the Intel tools still gets its own.
      if (arch === ARCHS[0]) throw new Error(`Could not build ${basename(source)}.`)
    }
  }
  if (built.length === 2) execFileSync('lipo', ['-create', ...built, '-output', out], { stdio: 'inherit' })
  else renameSync(built[0], out)
  for (const file of built) rmSync(file, { force: true })
  // lipo drops the signature and Apple Silicon runs nothing unsigned; the app's own signing replaces this one.
  execFileSync('codesign', ['--force', '--sign', '-', out], { stdio: 'inherit' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.platform === 'darwin') {
  mkdirSync(join(root, 'build', 'helpers'), { recursive: true })
  try {
    for (const helper of listHelpers()) (helper.module ? buildModule : build)(helper)
  } catch (error) {
    console.error(`${error.message} Install the Command Line Tools (xcode-select --install) and try again.`)
    process.exit(1)
  }
}
