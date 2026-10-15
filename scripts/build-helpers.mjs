// Builds OSAT's small native helpers: every desktop/helpers/*.swift becomes build/helpers/<name> (arm64 and x86_64 in
// one file when both can be built), and every desktop/helpers/*.m a Node-API module, build/helpers/<name>.node, that the
// main process loads itself (osat-blur). It also fetches llama.cpp's own server for pictures (Phase 37b): one pinned
// release, checked against its SHA-256, of which only the server and the libraries it loads go to build/helpers/llama.
// On anything but a Mac there is nothing to build and it ends quietly.
// `npm run dist:mac` and `npm run start:mac` run it first (it needs the Command Line Tools: `xcode-select --install`);
// package.json's build.extraResources puts the result inside the app.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

/* llama.cpp's own server, for pictures (desktop/ai/vision.cjs): a release from late September 2026 (two weeks old when
   it was chosen), Apple Silicon, with Metal built in. `files` are what llama-server loads (otool -L), each kept under
   the name it asks for (the release's symlinks resolved), next to it: its rpath is @loader_path. */
export const LLAMA = {
  tag: 'b11299',
  url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11299/llama-b11299-bin-macos-arm64.tar.gz',
  sha256: 'c26ef372be4f8f540335215b480c2567bb3c5e1ba150299a4f8a739a9b3911f4',
  files: ['llama-server', 'libllama-server-impl.dylib', 'libllama-common.0.dylib', 'libmtmd.0.dylib', 'libllama.0.dylib', 'libggml.0.dylib',
    'libggml-cpu.0.dylib', 'libggml-blas.0.dylib', 'libggml-metal.0.dylib', 'libggml-rpc.0.dylib', 'libggml-base.0.dylib'],
}

const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/* build/helpers/llama, unless the same release is already there. A download that doesn't match the pinned SHA-256
   stops the build: OSAT never ships a server it didn't check. */
export async function fetchLlama(base = root, { release = LLAMA, get = (url) => fetch(url) } = {}) {
  const out = join(base, 'build', 'helpers', 'llama')
  const stamp = join(out, '.release')
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === release.sha256 && release.files.every((name) => existsSync(join(out, name)))) return out
  const cache = join(base, 'build', 'cache')
  mkdirSync(cache, { recursive: true })
  const archive = join(cache, `llama-${release.tag}.tar.gz`)
  if (!existsSync(archive) || sha256Of(archive) !== release.sha256) {
    const response = await get(release.url)
    if (!response.ok) throw new Error(`Could not download llama.cpp ${release.tag} (${response.status}).`)
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
    if (sha256Of(archive) !== release.sha256) {
      rmSync(archive, { force: true })
      throw new Error(`llama.cpp ${release.tag} didn’t match its pinned SHA-256; nothing was used.`)
    }
  }
  const work = mkdtempSync(join(tmpdir(), 'osat-llama-'))
  try {
    execFileSync('tar', ['-xzf', archive, '-C', work], { stdio: 'inherit' })
    const unpacked = join(work, `llama-${release.tag}`)
    rmSync(out, { recursive: true, force: true })
    mkdirSync(out, { recursive: true })
    for (const name of release.files) copyFileSync(realpathSync(join(unpacked, name)), join(out, name))
    chmodSync(join(out, 'llama-server'), 0o755)
    writeFileSync(stamp, release.sha256)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.platform === 'darwin') {
  mkdirSync(join(root, 'build', 'helpers'), { recursive: true })
  try {
    for (const helper of listHelpers()) (helper.module ? buildModule : build)(helper)
  } catch (error) {
    console.error(`${error.message} Install the Command Line Tools (xcode-select --install) and try again.`)
    process.exit(1)
  }
  try {
    await fetchLlama()
  } catch (error) {
    console.error(`${error.message} Pictures need it; check the internet connection and run this again.`)
    process.exit(1)
  }
}
