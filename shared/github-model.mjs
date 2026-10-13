/* The GitHub room (Phase 55): Nate's repos and pull requests in plain words. Pure: desktop/github.cjs
   asks GitHub through the `gh` already signed in on this Mac and reads its answers with these;
   src/views/GitHub.jsx shows them. */

// owner/name, as GitHub allows them. Checked in main before it goes into a command.
export const validRepo = (value) => typeof value === 'string' && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(value) && !value.includes('..')
export const validNumber = (value) => Number.isInteger(value) && value > 0 && value < 1e7

// A check that was skipped or said nothing (the iPhone job on a pull request) is neither good nor bad.
const QUIET = new Set(['SKIPPED', 'NEUTRAL', 'STALE'])
const GOOD = new Set(['SUCCESS'])

/* A pull request's checks in one word: passed, failed, running or none, with the names that failed. */
export function checksOf(rollup) {
  const out = { state: 'none', passed: 0, failed: 0, running: 0, failing: [] }
  for (const check of Array.isArray(rollup) ? rollup : []) {
    const name = String(check?.name || check?.context || 'A check')
    const done = check?.__typename === 'StatusContext' ? !['PENDING', 'EXPECTED'].includes(check.state) : check?.status === 'COMPLETED'
    const result = check?.__typename === 'StatusContext' ? check.state : check?.conclusion
    if (!done) out.running += 1
    else if (GOOD.has(result)) out.passed += 1
    else if (!QUIET.has(result)) { out.failed += 1; out.failing.push(name) }
  }
  out.state = out.failed ? 'failed' : out.running ? 'running' : out.passed ? 'passed' : 'none'
  return out
}

export function checksWords(checks) {
  if (checks.state === 'failed') return checks.failing.length === 1 ? `“${checks.failing[0]}” failed` : `${checks.failed} checks failed`
  if (checks.state === 'running') return checks.passed ? `Checking… ${checks.passed} of ${checks.passed + checks.running} done` : 'Checking…'
  if (checks.state === 'passed') return 'Checks passed'
  return 'No checks'
}

/* What a pull request does, in its own words: the part under "What this does" (or the first
   paragraph), without headings, checklists or the "Generated with" line. */
export function summaryOf(body) {
  const text = String(body || '').replace(/\r/g, '')
  const section = /^#{1,3}\s*(what this does|summary)\s*\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im.exec(text)?.[2]
  const source = section || text
  const lines = source.split('\n').filter((line) => !/^#{1,6}\s|^\s*-\s*\[[ x]\]|generated with|^🤖/i.test(line))
  const paragraph = lines.map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '')).join('\n').split(/\n\s*\n/).map((part) => part.trim()).find(Boolean) || ''
  const plain = paragraph.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim()
  return plain.length > 420 ? `${plain.slice(0, 417).replace(/\s+\S*$/, '')}…` : plain
}

export function pullOf(pr) {
  return {
    number: pr.number,
    title: String(pr.title || ''),
    branch: String(pr.headRefName || ''),
    draft: pr.isDraft === true,
    url: String(pr.url || ''),
    updatedAt: pr.updatedAt || null,
    author: pr.author?.login || '',
    conflict: pr.mergeable === 'CONFLICTING',
    summary: summaryOf(pr.body),
    checks: checksOf(pr.statusCheckRollup),
  }
}

/* A change on the main branch in a line: a merge says what it merged ("A quick bar… (#78)"). */
export function changeOf(item) {
  const message = String(item?.commit?.message || '')
  const [first, ...rest] = message.split('\n')
  const merged = /^Merge pull request #(\d+) from /.exec(first)
  const words = merged ? `${rest.find((line) => line.trim())?.trim() || first} (#${merged[1]})` : first
  return {
    sha: String(item?.sha || '').slice(0, 7),
    title: words.slice(0, 160),
    author: item?.author?.login || item?.commit?.author?.name || '',
    at: item?.commit?.author?.date || null,
  }
}

export function repoOf(repo) {
  return {
    name: String(repo.nameWithOwner || ''),
    description: String(repo.description || ''),
    private: repo.isPrivate === true,
    updatedAt: repo.updatedAt || null,
    url: String(repo.url || ''),
  }
}

/* "5 minutes ago", "yesterday", "Oct 3". */
export function ago(iso, now = Date.now()) {
  const then = Date.parse(iso)
  if (!then) return ''
  const seconds = Math.round((new Date(now).getTime() - then) / 1000)
  const say = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return say.format(-Math.round(seconds / 60), 'minute')
  if (seconds < 86400) return say.format(-Math.round(seconds / 3600), 'hour')
  if (seconds < 7 * 86400) return say.format(-Math.round(seconds / 86400), 'day')
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(then))
}

/* What gh said when it failed, in one calm line. */
export function explainGh(stderr) {
  const text = String(stderr || '')
  if (/auth login|not logged|authentication/i.test(text)) return 'GitHub needs you to sign in: in Terminal, run gh auth login.'
  if (/not mergeable|merge conflict/i.test(text)) return 'GitHub can’t merge it: it has changes that clash with main. Ask Claude to fix the conflict.'
  if (/Could not resolve to a Repository|not found/i.test(text)) return 'GitHub couldn’t find that repository.'
  const line = text.split('\n').map((part) => part.trim()).find((part) => part && !/^(warning|hint)/i.test(part))
  return line ? `GitHub said: ${line.slice(0, 200)}` : 'GitHub didn’t answer. Try again in a moment.'
}
