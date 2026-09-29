/* Folders OSAT takes things in from: the iPhone's Inbox (phone.cjs), the drop folder for
   node files and the scan folder (bots/). Each looks the same way: a file counts once it
   has settled (nothing written to it for a few seconds: iCloud, Google Drive and a bot
   saving in pieces all need the moment), one look at a time, soon after the folder
   changes and every half minute anyway (fs.watch misses changes in synced folders).
   What happens to a file afterwards is up to each: moved to Added, set aside, or left
   exactly where it is. The file system and the clock are passed in, for the tests. */
const path = require('node:path')
const nodeFs = require('node:fs/promises')

const SETTLE_MS = 3000

/* The files in `dir` ready to take, oldest first: not hidden, of a kind `accept(name)`
   wants, and settled. One bigger than `maxBytes` comes back with `tooBig`. Throws when
   the folder can't be read. */
async function settledFiles(dir, { fs = nodeFs, now = () => Date.now(), accept = () => true, settleMs = SETTLE_MS, maxBytes = Infinity } = {}) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const ready = []
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.') || !accept(entry.name)) continue
    const file = path.join(dir, entry.name)
    try {
      const stat = await fs.stat(file)
      if (now() - stat.mtimeMs < settleMs) continue
      ready.push({ name: entry.name, file, size: stat.size, mtimeMs: stat.mtimeMs, ...(stat.size > maxBytes ? { tooBig: true } : {}) })
    } catch {
      // Gone or not downloaded yet: the next look finds it.
    }
  }
  return ready.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
}

/* A free path for `name` in `dir`: the name itself, then "stem 2.ext", "stem 3.ext"… */
async function uniqueTarget(fs, dir, name) {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let n = 1; ; n += 1) {
    const candidate = path.join(dir, n === 1 ? name : `${stem} ${n}${ext}`)
    try { await fs.access(candidate) } catch { return candidate }
  }
}

/* Moves `file` into `dir` (made if missing) under a free name; returns where it went. */
async function moveInto(fs, file, dir) {
  await fs.mkdir(dir, { recursive: true })
  const target = await uniqueTarget(fs, dir, path.basename(file))
  await fs.rename(file, target)
  return target
}

/* `run` one at a time: asking while it runs gets the run already under way. */
function oneAtATime(run) {
  let running = null
  return () => {
    running ??= Promise.resolve().then(run).finally(() => { running = null })
    return running
  }
}

/* Looks at `dir` a moment after it changes (`delay`) and every `poll` ms, while `live()`
   says so. `soon()` asks for a look; `stop()` ends it all. */
function watchFolder({ dir, look, live = () => true, delay = 800, poll = 30000, watch = require('node:fs').watch, timers = { set: setTimeout, clear: clearTimeout, every: setInterval, stop: clearInterval } }) {
  let timer = null
  let watcher = null
  const soon = () => {
    if (timer) timers.clear(timer)
    timer = null
    if (live()) timer = timers.set(() => { timer = null; if (live()) look() }, delay)
  }
  try {
    watcher = watch(dir, soon)
    watcher.on?.('error', () => {}) // the folder went away; the poll carries on
  } catch {
    // The poll below still finds new files.
  }
  const interval = timers.every(soon, poll)
  return {
    soon,
    stop() {
      watcher?.close()
      timers.stop(interval)
      if (timer) timers.clear(timer)
      watcher = null
      timer = null
    },
  }
}

module.exports = { SETTLE_MS, moveInto, oneAtATime, settledFiles, uniqueTarget, watchFolder }
