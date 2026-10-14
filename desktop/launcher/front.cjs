/* Two things the launcher asks the Mac about the app you were in (Phase 13), neither of which
   changes a setting:
   - which app is in front (`frontApp`: LaunchServices' own `lsappinfo`, no permission needed), so a
     copy can say where it came from;
   - paste into it (`pasteInto`: ⌘V pressed by the osat-keys helper, `keys`). That needs OSAT to be allowed in
     Accessibility; without it nothing is sent, and the copy simply waits on the clipboard for ⌘V. */
const { run } = require('../mac-files.cjs')

async function frontApp({ exec = run, platform = process.platform } = {}) {
  if (platform !== 'darwin') return ''
  try {
    const asn = (await exec('lsappinfo', ['front'], { timeout: 1500 })).trim()
    if (!/^ASN:\S+$/.test(asn)) return ''
    return /^"([^"]{1,80})"/.exec((await exec('lsappinfo', ['info', '-only', 'name', asn], { timeout: 1500 })).trim())?.[1] || ''
  } catch {
    return ''
  }
}

/* → { pasted: true } or { pasted: false, reason: 'access' | 'mac' | 'failed' }. `trusted` says whether OSAT is
   allowed in Accessibility (electron's isTrustedAccessibilityClient(false): it never asks). */
async function pasteInto({ exec = run, keys = 'osat-keys', platform = process.platform, trusted = () => false } = {}) {
  if (platform !== 'darwin') return { pasted: false, reason: 'mac' }
  if (!trusted()) return { pasted: false, reason: 'access' }
  try {
    await exec(keys, ['cmd+v'], { timeout: 4000 })
    return { pasted: true }
  } catch {
    return { pasted: false, reason: 'failed' }
  }
}

module.exports = { frontApp, pasteInto }
