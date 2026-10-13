import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowClockwise, ArrowSquareOut, Check, CircleNotch, GitBranch, GitMerge, LockSimple, MagnifyingGlass, Warning } from '@phosphor-icons/react'

import { cleanError } from '../assistant/useAi.js'
import { ago, checksWords } from '../../shared/github-model.mjs'
import '../styles/github.css'

const PICKED_KEY = 'osat.github.repo.v1'
const OSAT_REPO = 'SouthernSimp/Claude-OSAT-Cloud'
const readPicked = () => { try { return localStorage.getItem(PICKED_KEY) || '' } catch { return '' } }
const keepPicked = (name) => { try { localStorage.setItem(PICKED_KEY, name) } catch { /* the next open starts at the newest */ } }

/* Tools → GitHub (Phase 55, desktop/github.cjs): your repos, and in each what waits for you (open pull
   requests: what each does, whether its checks passed, Merge, asked once more right there) and what
   changed lately on main. Through the gh signed in on this Mac; only in the Mac app. */
export function GitHubView() {
  const bridge = window.osatGitHub
  if (!bridge) return <p className="pop-gone">Your GitHub repositories show here in OSAT on your Mac.</p>
  return <GitHubRoom bridge={bridge} />
}

function GitHubRoom({ bridge }) {
  const [status, setStatus] = useState(null)
  const [repos, setRepos] = useState(null)
  const [picked, setPicked] = useState(readPicked)
  const [view, setView] = useState(null)
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState('')
  const [filter, setFilter] = useState('')
  const [asking, setAsking] = useState(null)
  const [merging, setMerging] = useState(null)
  const [said, setSaid] = useState('')

  useEffect(() => {
    bridge.status().then((next) => {
      setStatus(next)
      if (next.user) bridge.repos().then(setRepos, (error) => setProblem(cleanError(error)))
    }, (error) => setProblem(cleanError(error)))
  }, [bridge])

  // The repo shown: the one picked last, else OSAT's own, else the newest.
  const name = useMemo(() => {
    if (!repos?.length) return ''
    return [picked, OSAT_REPO].find((item) => repos.some((repo) => repo.name === item)) || repos[0].name
  }, [repos, picked])

  const load = useCallback((quiet = false) => {
    if (!name) return
    if (!quiet) setLoading(true)
    bridge.repo(name).then((next) => { setView(next); setProblem('') }, (error) => setProblem(cleanError(error))).finally(() => setLoading(false))
  }, [bridge, name])
  useEffect(() => { setView(null); setAsking(null); setSaid(''); load() }, [load])

  // While checks run, look again every minute (only while OSAT is showing).
  const running = view?.pulls.some((pull) => pull.checks.state === 'running')
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(true) }, 60000)
    return () => clearInterval(timer)
  }, [running, load])

  function pick(next) {
    setPicked(next)
    keepPicked(next)
  }
  async function merge(pull) {
    setMerging(pull.number)
    setProblem('')
    try {
      setView(await bridge.merge(name, pull.number))
      setSaid(name === OSAT_REPO
        ? `Merged #${pull.number}. GitHub builds the new OSAT in about 15 minutes; then Settings → About → Check for updates brings it in.`
        : `Merged #${pull.number} into main.`)
    } catch (error) {
      setProblem(cleanError(error))
    } finally {
      setMerging(null)
      setAsking(null)
    }
  }
  const open = (url) => bridge.open(url).catch((error) => setProblem(cleanError(error)))

  if (!status) return <p className="pop-gone">Looking for GitHub…</p>
  if (!status.user) {
    return (
      <div className="gh-setup">
        <GitBranch aria-hidden="true" />
        <h2>Connect GitHub</h2>
        <p>{status.problem || 'GitHub needs you to sign in.'}</p>
        <p className="gh-quiet">OSAT uses the gh tool already on your Mac, so it never keeps a GitHub password of its own.</p>
      </div>
    )
  }

  const shown = (repos || []).filter((repo) => repo.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const current = repos?.find((repo) => repo.name === name)
  return (
    <div className="gh-room">
      <aside className="gh-repos" aria-label="Your repositories">
        <label className="gh-find">
          <MagnifyingGlass aria-hidden="true" />
          <input value={filter} placeholder="Find a repository" aria-label="Find a repository" onChange={(event) => setFilter(event.target.value)} />
        </label>
        {!repos && <p className="gh-quiet">Loading your repositories…</p>}
        <ul>
          {shown.map((repo) => (
            <li key={repo.name}>
              <button type="button" aria-current={repo.name === name ? 'true' : undefined} onClick={() => pick(repo.name)}>
                <strong>{repo.name.split('/')[1]}</strong>
                <small>{repo.private && <LockSimple aria-label="Private" />}{repo.name.split('/')[0]} · {ago(repo.updatedAt)}</small>
              </button>
            </li>
          ))}
        </ul>
        <p className="gh-quiet">Signed in as {status.user}</p>
      </aside>

      <main className="gh-main">
        <header className="gh-head">
          <div>
            <h2>{name.split('/')[1] || 'GitHub'}</h2>
            {current?.description && <p>{current.description}</p>}
          </div>
          <button type="button" className="outline-button" disabled={loading} onClick={() => load()} aria-label="Look again"><ArrowClockwise className={loading ? 'is-spinning' : ''} /></button>
          {current && <button type="button" className="outline-button" onClick={() => open(current.url)}><ArrowSquareOut /> Open on GitHub</button>}
        </header>
        {problem && <p className="gh-said is-problem" role="alert"><Warning /> {problem}</p>}
        {said && <p className="gh-said" role="status"><GitMerge /> {said}</p>}

        <section aria-labelledby="gh-waiting">
          <h3 id="gh-waiting">Waiting for you</h3>
          {!view && !problem && <p className="gh-quiet">Loading…</p>}
          {view && !view.pulls.length && <p className="gh-quiet">Nothing waiting. Every pull request is merged or closed.</p>}
          {view?.pulls.map((pull) => {
            const ready = (pull.checks.state === 'passed' || pull.checks.state === 'none') && !pull.conflict
            return (
              <article key={pull.number} className="gh-pull">
                <header>
                  <h4>{pull.title}</h4>
                  <small>#{pull.number}{pull.draft ? ' · draft' : ''} · {ago(pull.updatedAt)}</small>
                </header>
                {pull.summary && <p>{pull.summary}</p>}
                <footer>
                  <span className={`gh-checks is-${pull.checks.state}`}>
                    {pull.checks.state === 'passed' ? <Check weight="bold" /> : pull.checks.state === 'running' ? <CircleNotch className="is-spinning" /> : pull.checks.state === 'failed' ? <Warning /> : null}
                    {checksWords(pull.checks)}
                  </span>
                  {pull.conflict && <span className="gh-checks is-failed"><Warning /> Clashes with main</span>}
                  <span className="gh-gap" />
                  <button type="button" className="outline-button" onClick={() => open(pull.url)}>Open on GitHub</button>
                  {asking === pull.number
                    ? (
                      <span className="gh-ask">
                        <span>Merge into main?</span>
                        <button type="button" className="primary-button" disabled={merging === pull.number} onClick={() => merge(pull)}>{merging === pull.number ? 'Merging…' : 'Merge now'}</button>
                        <button type="button" className="outline-button" disabled={merging === pull.number} onClick={() => setAsking(null)}>Not now</button>
                      </span>
                    )
                    : (
                      <button
                        type="button"
                        className="primary-button"
                        disabled={!ready || merging !== null}
                        title={ready ? 'Merge it into main' : pull.conflict ? 'It clashes with main' : pull.checks.state === 'running' ? 'Wait for the checks to finish' : 'Its checks failed'}
                        onClick={() => setAsking(pull.number)}
                      ><GitMerge /> Merge</button>
                    )}
                </footer>
              </article>
            )
          })}
        </section>

        {view?.changes.length > 0 && (
          <section aria-labelledby="gh-lately">
            <h3 id="gh-lately">Lately on main</h3>
            <ol className="gh-changes">
              {view.changes.map((change) => (
                <li key={change.sha}><span>{change.title}</span><small>{change.author} · {ago(change.at)}</small></li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </div>
  )
}
