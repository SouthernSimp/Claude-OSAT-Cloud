/* The files used lately, for the quick search when nothing is typed yet (Phase 13). On the Mac that is
   Spotlight's "last used" date: one `mdfind` for what was opened in the last two weeks, one `mdls` for
   the dates, newest first. Where there is no Spotlight (the tests, Linux) the folders are walked and
   the newest changed come first. The folders it may look in are the ones files.cjs passes; it never
   picks its own. */
const { run } = require('../mac-files.cjs')

const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/* mdls prints the dates one after another, split by NUL ("2026-09-29 23:25:32 +0000", or "(null)"). */
function usedDates(stdout, count) {
  const values = String(stdout).split('\0')
  return Array.from({ length: count }, (_, index) => {
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec((values[index] || '').trim())
    return match ? Date.parse(`${match[1]}T${match[2]}${match[3]}:${match[4]}`) : 0
  })
}

async function recentPaths({ roots, days = 14, now = new Date(), platform = process.platform, exec = run, walk = async () => [], limit = 300 }) {
  const since = new Date(now.getTime() - days * 86400000)
  if (platform !== 'darwin') return walk(since)
  const found = (await exec('mdfind', [...roots.flatMap((root) => ['-onlyin', root]), `kMDItemLastUsedDate >= $time.iso(${iso(since)})`], { timeout: 4000 }).catch(() => ''))
    .split('\n').filter(Boolean).slice(0, limit)
  if (!found.length) return []
  const dates = usedDates(await exec('mdls', ['-name', 'kMDItemLastUsedDate', '-raw', ...found], { timeout: 4000 }).catch(() => ''), found.length)
  return found.map((file, index) => ({ file, at: dates[index] })).sort((a, b) => b.at - a.at).map(({ file }) => file)
}

module.exports = { recentPaths, usedDates }
