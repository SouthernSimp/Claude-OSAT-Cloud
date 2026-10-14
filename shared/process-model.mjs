/* Kill Process in the quick bar (Raycast's command): the apps running on this Mac, each with its memory, to quit
   (Kill: the polite signal) or Force Kill. Only apps, grouped as Activity Monitor groups them (an app and its
   helpers are one row), only Nate's own, never OSAT, and never the Mac's own parts that would log him out.
   desktop/launcher/processes.cjs reads and ends them. Pure. */

/* The words that offer it, typed in the bar. */
export const wantsKill = (query) => /^(kill|quit|force|process|processes|task|activity)/i.test(String(query || '').trim())

/* `ps -axo pid=,uid=,rss=,pcpu=,comm=` → one { path, name, pids, count, kb, cpu } per .app, biggest memory first. */
export function groupApps(text, { uid, selfPid }) {
  const groups = new Map()
  for (const line of String(text || '').split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+?)\s*$/.exec(line)
    if (!match || Number(match[2]) !== uid) continue
    const path = /^(.*?\.app)\//.exec(match[5])?.[1]
    if (!path || !killable(path)) continue
    const group = groups.get(path) || { path, name: path.split('/').pop().replace(/\.app$/, ''), pids: [], count: 0, kb: 0, cpu: 0 }
    group.pids.push(Number(match[1]))
    group.count += 1
    group.kb += Number(match[3])
    group.cpu += Number(match[4])
    groups.set(path, group)
  }
  return [...groups.values()].filter((group) => !group.pids.includes(selfPid)).sort((a, b) => b.kb - a.kb)
}

/* The Mac's own parts under /System (the login window, the Dock, Spotlight's helpers) stay out; its apps (/System/Applications)
   and the Finder are fine. */
export const killable = (path) => !path.startsWith('/System/') || path.startsWith('/System/Applications/') || path === '/System/Library/CoreServices/Finder.app'

export function sizeOf(kb) {
  const mib = kb / 1024
  return mib >= 1024 ? `${(mib / 1024).toFixed(2)} GiB` : `${Math.round(mib)} MiB`
}

export const matchApps = (list, query) => {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  return list.filter((item) => words.every((word) => item.name.toLowerCase().includes(word)))
}

export const processRow = (item) => ({
  key: `process:${item.path}`, source: 'processes', kind: 'process', title: item.name,
  subtitle: `${item.count} ${item.count === 1 ? 'process' : 'processes'} · ${sizeOf(item.kb)}`, section: 'Running apps',
  data: { path: item.path, name: item.name, count: item.count },
})
