/* Uninstall an app (shared/uninstall-model.mjs has the rules): `plan` says what would go and how big it is, changing
   nothing; `run` asks the app to quit if it is open, then moves it and its leftovers to the Bin (mac-files trashItem,
   as Files' Move to Bin does), and keeps how to put each back for Undo (`restoreItem`). Only an app the apps list holds
   can be planned, and `run` plans again itself, so a window can't name anything else. `exec`, `trash`, `restore` and
   `processes` are passed in, so the tests never touch the Mac. */
const fs = require('node:fs')
const os = require('node:os')
const crypto = require('node:crypto')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createUninstall({ model, apps, processes, exec, trash, restore, platform = process.platform, home = os.homedir(), exists = fs.existsSync, fail = (message) => { throw new Error(message) } }) {
  const undos = new Map()

  async function bundleId(appPath) {
    const id = await exec('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', `${appPath}/Contents/Info.plist`], { timeout: 4000 }).catch(() => '')
    return id.trim() || null
  }

  // Kilobytes each path takes (du -sk each, side by side: one unreadable folder can't hide the others); 0 if unread.
  const sizes = (paths) => Promise.all(paths.map((path) => exec('/usr/bin/du', ['-sk', path], { timeout: 20000 }).then((out) => Number(String(out).split('\t')[0]) || 0, () => 0)))

  /* → { name, path, id, running, size (KB), leftovers: [{ path, what, size }] } or { refused: 'why, in plain words' }. */
  async function plan(appPath) {
    if (platform !== 'darwin') return { refused: 'Uninstalling works in the Mac app.' }
    if (typeof appPath !== 'string' || !(await apps.has(appPath))) return { refused: 'That app isn’t on the list any more.' }
    const name = appPath.slice(appPath.lastIndexOf('/') + 1).replace(/\.app$/, '')
    const id = await bundleId(appPath)
    if (!model.canUninstall(appPath, { home, id })) return { refused: `${name} is part of the Mac (or OSAT), so it stays.` }
    const found = model.leftoverPlaces(home, { id, name }).filter((place) => exists(place.path))
    const [appSize, ...each] = await sizes([appPath, ...found.map((place) => place.path)])
    const leftovers = found.map((place, index) => ({ ...place, size: each[index] }))
    const running = (await processes.list()).some((item) => item.path === appPath)
    return { name, path: appPath, id, running, size: appSize + each.reduce((sum, size) => sum + size, 0), leftovers }
  }

  /* → { ok: true, token, moved } or { ok: false, reason }. */
  async function run(appPath) {
    const now = await plan(appPath)
    if (now.refused) return { ok: false, reason: now.refused }
    if (now.running) {
      await processes.end(appPath)
      for (let waited = 0; waited < 4000 && (await processes.list()).some((item) => item.path === appPath); waited += 250) await wait(250)
      if ((await processes.list()).some((item) => item.path === appPath)) return { ok: false, reason: `${now.name} didn’t quit. Quit it, then try again.` }
    }
    const moved = []
    for (const target of [now.path, ...now.leftovers.map((place) => place.path)]) {
      try {
        moved.push({ from: target, bin: await trash(target) })
      } catch {
        // The app itself couldn't go (an App Store app owned by the system asks for a password): nothing else goes.
        if (target === now.path) return { ok: false, reason: `macOS wants your password to remove ${now.name}. Drag it from Applications to the Bin in Finder.`, reveal: true }
      }
    }
    const token = crypto.randomUUID()
    undos.set(token, moved)
    return { ok: true, token, moved: moved.length }
  }

  /* Puts back everything one run moved, from the Bin to where it was. → how many came back. */
  async function undo(token) {
    const moved = undos.get(token)
    if (!moved) fail('That can’t be undone any more.')
    undos.delete(token)
    let back = 0
    for (const item of moved) {
      try { await restore(item.bin, item.from); back += 1 } catch { /* emptied from the Bin already */ }
    }
    return back
  }

  return { plan, run, undo }
}

module.exports = { createUninstall }
