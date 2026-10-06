/* "Check for updates" (Settings → About). CI publishes every build of main as a GitHub
   release (`v0.1.<build>`, the app's zip and its SHA-256). This looks at the newest one;
   if it is newer than this app it downloads the zip, checks it is really OSAT, and a small
   script swaps /Applications/OSAT.app once OSAT has quit, then opens it again.
   The old app is kept in <data folder>/updates/previous, and notes are never touched. */
const fsp = require('node:fs/promises')
const path = require('node:path')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const { downloadFile } = require('./ai/download.cjs')

const run = promisify(execFile)
const REPO = 'SouthernSimp/Claude-OSAT-Cloud'
const APP_ID = 'ai.mccreery.osat'

const parts = (version) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim())
  return match ? match.slice(1).map(Number) : null
}

function isNewer(candidate, current) {
  const a = parts(candidate)
  const b = parts(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/* The newest release's update for `current`, or null: a newer version with an arm64 zip
   and its checksum file. Anything else on the release page is ignored. */
function pickUpdate(release, current) {
  const version = String(release?.tag_name || '').replace(/^v/, '')
  if (release?.draft || release?.prerelease || !isNewer(version, current)) return null
  const assets = Array.isArray(release.assets) ? release.assets : []
  const zip = assets.find((asset) => /^OSAT-[\d.]+-arm64-mac\.zip$/.test(asset?.name))
  const sha = zip && assets.find((asset) => asset?.name === `${zip.name}.sha256`)
  if (!zip || !sha || !(zip.size > 0) || !/^https:\/\//.test(zip.browser_download_url) || !/^https:\/\//.test(sha.browser_download_url)) return null
  return { version, name: zip.name, size: zip.size, url: zip.browser_download_url, shaUrl: sha.browser_download_url }
}

/* Waits for OSAT to quit, puts the new app where the old one was (the old one is kept),
   and opens it. If anything fails the old app goes back. Arguments: pid, app, new app, keep folder, opener. */
const SWAP = `
pid=$1; target=$2; fresh=$3; keep=$4; opener=$5
n=0; while kill -0 "$pid" 2>/dev/null && [ $n -lt 120 ]; do sleep 0.5; n=$((n+1)); done
[ -d "$fresh" ] || exit 1
rm -rf "$keep/OSAT.app"; mkdir -p "$keep"
if [ -d "$target" ]; then mv "$target" "$keep/OSAT.app" || exit 1; fi
if ! mv "$fresh" "$target"; then
  [ -d "$keep/OSAT.app" ] && mv "$keep/OSAT.app" "$target"
  "$opener" "$target"; exit 1
fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null
"$opener" "$target"
`

function createUpdater({ app, dataDir, quit, fetchImpl = (...args) => fetch(...args), execPath = process.execPath, platform = process.platform, spawnImpl = spawn }) {
  const dir = path.join(dataDir, 'updates')
  // …/OSAT.app/Contents/MacOS/OSAT → …/OSAT.app
  const appPath = path.resolve(execPath, '..', '..', '..')
  const installed = () => platform === 'darwin' && app.isPackaged && appPath.endsWith('.app')
  let found = null
  let busy = false

  async function check() {
    if (!installed()) return { state: 'unavailable', message: 'Updates are for the installed OSAT app.' }
    let release
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'OSAT' },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error(String(response.status))
      release = await response.json()
    } catch {
      throw new Error('OSAT couldn’t reach GitHub to look for an update. Try again when you’re online.')
    }
    found = pickUpdate(release, app.getVersion())
    return found ? { state: 'available', version: found.version, size: found.size } : { state: 'current', version: app.getVersion() }
  }

  async function install(onProgress = () => {}) {
    if (!installed() || !found) throw new Error('Check for updates first.')
    if (busy) throw new Error('An update is already on its way.')
    busy = true
    try {
      const update = found
      const sha = (await (await fetchImpl(update.shaUrl, { signal: AbortSignal.timeout(15000) })).text()).trim().split(/\s+/)[0].toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('The update’s checksum was unreadable, so nothing was changed.')
      await fsp.rm(dir, { recursive: true, force: true })
      const zip = path.join(dir, update.name)
      await downloadFile({ url: update.url, dest: zip, size: update.size, sha256: sha, onProgress: (have, size) => onProgress({ state: 'downloading', done: have, size }), fetchImpl })
      onProgress({ state: 'checking' })
      const fresh = path.join(dir, 'new')
      await run('ditto', ['-x', '-k', zip, fresh])
      const next = path.join(fresh, 'OSAT.app')
      const plist = path.join(next, 'Contents', 'Info.plist')
      const read = async (key) => (await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist])).stdout.trim()
      if ((await read('CFBundleIdentifier')) !== APP_ID || (await read('CFBundleShortVersionString')) !== update.version) throw new Error('The download wasn’t the OSAT it should be, so nothing was changed.')
      await run('codesign', ['--verify', '--deep', '--strict', next])
      await fsp.rm(zip, { force: true })
      spawnImpl('/bin/sh', ['-c', SWAP, 'sh', String(process.pid), appPath, next, path.join(dir, 'previous'), 'open'], { detached: true, stdio: 'ignore' }).unref()
      onProgress({ state: 'restarting' })
      setTimeout(quit, 300)
      return { state: 'restarting' }
    } finally {
      busy = false
    }
  }

  return { check, install }
}

module.exports = { REPO, SWAP, createUpdater, isNewer, pickUpdate }
