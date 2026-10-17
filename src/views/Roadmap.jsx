import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, ChatCircleText, CheckCircle, Circle, CircleHalf, DownloadSimple, GitMerge, GitPullRequest, Kanban, NotePencil, Package, ShieldCheck, XCircle,
} from '@phosphor-icons/react'

import changelog from '../../CHANGELOG.md?raw'
import roadmap from '../../docs/ROADMAP.md?raw'
import { stageColumns, stickiesOn, undoFrom } from '../boards/boards-model.js'
import { planBoard, setUpPlan, syncPlan, comingPhases } from '../boards/plan.js'
import { buildOf, changelogBuilds, isYours, pullUrl } from '../lib/changelog.js'
import { inline, Markdown } from '../lib/markdown.jsx'
import { phaseAnchor, roadmapPhases, timelineSummary } from '../lib/roadmap.js'
import { useUndoToast } from '../lib/UndoToast.jsx'
import '../styles/roadmap.css'

const VIEW_KEY = 'osat.roadmap.view.v1'
const HOW_KEY = 'osat.news.how.v1'
const VIEWS = [['news', 'What’s new'], ['coming', 'Coming next'], ['roadmap', 'Roadmap'], ['timeline', 'Timeline']]
const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
const keep = (key, value) => { try { localStorage.setItem(key, value) } catch { /* a convenience only */ } }
const readView = () => { const view = read(VIEW_KEY, 'news'); return VIEWS.some(([id]) => id === view) ? view : 'news' }

/* What changed, what's coming and where OSAT is going, built into the app and read-only except Coming next:
   What's new is CHANGELOG.md (every build, the one on this Mac marked, and how a change gets to you), Coming next
   is the Roadmap's plans as a board on the canvas Nate reranks and writes on (boards/plan.js), the Roadmap is
   docs/ROADMAP.md, and the Timeline is its Status table. Picking a phase on the Timeline opens its part of the
   Roadmap. `target.tab` opens a tab (⌘K → What's new, Settings → About). */
export function RoadmapView({ workspace, commit, navigate, target, onClose }) {
  const [view, setView] = useState(readView)
  const room = useRef(null)
  const phases = useMemo(() => roadmapPhases(roadmap), [])

  function pick(next) {
    setView(next)
    keep(VIEW_KEY, next)
    if (room.current) room.current.scrollTop = 0
  }
  useEffect(() => { if (VIEWS.some(([id]) => id === target?.tab)) pick(target.tab) }, [target?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  function open(phase) {
    pick('roadmap')
    requestAnimationFrame(() => {
      const box = room.current
      const heading = box?.querySelector(`[id^="${phaseAnchor(phase.id)}"]`)
      if (heading) box.scrollTop += heading.getBoundingClientRect().top - box.getBoundingClientRect().top - 12
    })
  }

  return (
    <div className="roadmap-room" ref={room}>
      <div className="roadmap-views segmented" role="tablist" aria-label="Roadmap view">
        {VIEWS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => pick(id)}>{label}</button>
        ))}
      </div>
      {view === 'news' && <WhatsNew navigate={navigate} />}
      {view === 'coming' && <ComingNext phases={phases} workspace={workspace} commit={commit} navigate={navigate} onClose={onClose} />}
      {view === 'roadmap' && <Markdown text={roadmap} headingOffset={1} headingIds />}
      {view === 'timeline' && <Timeline phases={phases} onOpen={open} />}
    </div>
  )
}

/* ---- What's new ---------------------------------------------------------------------------------------------- */

const SHOWN = 6

function WhatsNew({ navigate }) {
  const builds = useMemo(() => changelogBuilds(changelog), [])
  const [have, setHave] = useState(null)
  const [all, setAll] = useState(false)
  useEffect(() => { window.osatApp?.about?.().then((about) => setHave(buildOf(about?.version))).catch(() => {}) }, [])
  const shown = all ? builds : builds.slice(0, SHOWN)
  return (
    <section className="news" aria-label="What’s new">
      <header className="news-head">
        <div>
          <h2>What’s new</h2>
          <p>{have ? `You have build ${have}.` : 'Every change to OSAT, newest first.'} Each number is one version of the app.</p>
        </div>
        <button type="button" className="outline-button" onClick={() => navigate?.('Settings', { section: 'about' })}><DownloadSimple /> Check for updates</button>
      </header>
      <HowItGetsToYou />
      <ol className="news-builds">
        {shown.map((build) => <Build key={build.key} build={build} have={have} />)}
      </ol>
      {builds.length > SHOWN && (
        <button type="button" className="text-button news-more" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer' : `Show ${builds.length - SHOWN} older builds`}
        </button>
      )}
    </section>
  )
}

/* How a change gets from an idea to this Mac, step by step, in the words GitHub uses. Open until put away. */
const STEPS = [
  [ChatCircleText, 'You ask', 'An idea, a fix, a feature, in plain words. Ideas wait in Coming next, in the order you give them.'],
  [GitPullRequest, 'A pull request', 'Claude makes the change on a copy of the code (a branch) and offers it as a pull request: the change, ready to look at.'],
  [ShieldCheck, 'Checks', 'GitHub runs the tests and builds the Mac app as a DMG you can try, before anything changes for real.'],
  [GitMerge, 'Merge', 'When you say “merge”, the change joins main: the version of OSAT everyone gets.'],
  [Package, 'A new build', 'GitHub makes a numbered build from main, and it shows up on this page with what changed.'],
  [DownloadSimple, 'Update', 'Settings → About → Check for updates installs it. OSAT also looks by itself every few hours.'],
]

function HowItGetsToYou() {
  const [open, setOpen] = useState(() => read(HOW_KEY, 'open') === 'open')
  return (
    <details className="news-how" open={open} onToggle={(event) => { setOpen(event.currentTarget.open); keep(HOW_KEY, event.currentTarget.open ? 'open' : 'closed') }}>
      <summary>How a change gets to you</summary>
      <ol className="news-steps">
        {STEPS.map(([Icon, title, words], index) => (
          <li key={title}>
            <span className="news-step-icon" aria-hidden="true"><Icon weight="duotone" /></span>
            <strong><small>{index + 1}</small> {title}</strong>
            <p>{words}</p>
            {index < STEPS.length - 1 && <ArrowRight className="news-step-arrow" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </details>
  )
}

function Build({ build, have }) {
  const yours = isYours(build, have)
  const number = build.next ? (have ? `Build ${have}` : 'This build') : build.from ? build.key : 'Before numbered builds'
  return (
    <li className="news-build" data-yours={yours || undefined}>
      <span className="news-dot" aria-hidden="true" />
      <article aria-label={`${number}${build.name ? `: ${build.name}` : ''}`}>
        <header>
          <span className="news-number">{number}</span>
          <time>{build.date}</time>
          {yours && <span className="news-yours">On your Mac</span>}
        </header>
        {build.name && <h3>{build.name}</h3>}
        {build.intro && <p className="news-intro">{build.intro}</p>}
        <ul>
          {build.items.map((item, index) => (
            <li key={index}>
              <span>{inline(item.text, {}, `b${index}`)}</span>
              {item.pulls.map((pull) => <PullChip key={pull.label} pull={pull} />)}
            </li>
          ))}
        </ul>
      </article>
    </li>
  )
}

/* A pull request's number: it opens on GitHub (the change itself, the checks it passed, and the talk about it). */
function PullChip({ pull }) {
  const url = pullUrl(pull.number)
  const go = () => {
    if (window.osatSearch?.openLink) window.osatSearch.openLink(url).catch(() => {})
    else window.open(url, '_blank', 'noopener')
  }
  return (
    <button type="button" className="news-pull" onClick={go} aria-label={`Pull request ${pull.label} on GitHub`}
      title={`Pull request ${pull.label}: the change itself, the checks it passed and the talk about it, on GitHub`}>
      <GitPullRequest aria-hidden="true" /> {pull.label}
    </button>
  )
}

/* ---- Coming next ---------------------------------------------------------------------------------------------- */

const COLUMN_WORDS = { later: 'Someday, not yet planned in detail', next: 'What gets built next, top first', doing: 'Being built now', done: 'Built and merged' }

function ComingNext({ phases, workspace, commit, navigate, onClose }) {
  const [toast, showUndo] = useUndoToast()
  const [said, setSaid] = useState('')
  const board = planBoard(workspace)
  const coming = comingPhases(phases)

  // Each time it opens, the board catches up with this build's Roadmap (new plans in, finished ones ticked off).
  useEffect(() => {
    if (!board) return
    let result = null
    commit((state) => { result = syncPlan(state, phases); return result.state })
    const words = [result?.added.length && `${result.added.length} new ${result.added.length === 1 ? 'plan' : 'plans'} came in from the Roadmap`, result?.finished.length && `${result.finished.length} finished`].filter(Boolean)
    if (words.length) setSaid(`${words.join(', ')}.`)
  }, [board?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function setUp() {
    let before = null
    let after = null
    commit((state) => { before = state; after = setUpPlan(state, phases).state; return after })
    if (before && after !== before) showUndo('Put the plan on your boards', () => commit(undoFrom(before, after)))
  }
  // The canvas comes up over the desk; this room steps aside so it doesn't float over the board.
  const openBoard = (detail = {}) => { navigate?.('Mindmap', { folderId: board.id, view: 'board', ...detail }); onClose?.() }

  return (
    <section className="coming" aria-label="Coming next">
      <header className="news-head">
        <div>
          <h2>Coming next</h2>
          <p>What’s planned for OSAT, from the Roadmap. Among your boards it’s one you own: drag the plans into the order you want, click one to change what it says, and write your notes on it. Claude reads this board before building what’s next.</p>
        </div>
        {board && <button type="button" className="primary-button" onClick={() => openBoard()}><Kanban /> Open the board</button>}
      </header>
      {said && <p className="coming-said" role="status">{said}</p>}
      {board ? <PlanColumns board={board} workspace={workspace} onOpen={(noteId) => openBoard({ noteId })} /> : (
        <div className="coming-start">
          <ol className="coming-list">
            {coming.map((phase) => (
              <li key={phase.id}><span className="coming-phase">Phase {phase.id}</span><span>{phase.what}</span>{phase.state === 'now' && <em>Being built</em>}</li>
            ))}
          </ol>
          <button type="button" className="primary-button" onClick={setUp}><Kanban /> Add it to my boards</button>
          <p className="coming-hint">It becomes the board “Coming to OSAT”, with {coming.length} plans to rerank. Nothing else on your boards changes.</p>
        </div>
      )}
      {toast}
    </section>
  )
}

/* The board at a glance, as on the canvas: Later, Next, Doing, Done. A plan opens on the canvas, lit. */
function PlanColumns({ board, workspace, onOpen }) {
  const columns = stageColumns(stickiesOn(workspace, board.id))
  return (
    <div className="coming-board">
      {columns.map((column) => (
        <section key={column.stage} className="coming-column" aria-label={column.title}>
          <h3>{column.title}<small>{column.notes.length || ''}</small></h3>
          <p>{COLUMN_WORDS[column.stage]}</p>
          {(column.stage === 'done' ? column.notes.slice(-3) : column.notes).map((note) => {
            const lines = note.markdown.split('\n').filter((line) => line.trim())
            return (
              <button key={note.id} type="button" className="coming-card" onClick={() => onOpen(note.id)}>
                <span>{note.title}</span>
                {lines.length > 1 && <small><NotePencil aria-hidden="true" /> Your notes</small>}
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}

/* ---- Timeline ------------------------------------------------------------------------------------------------- */

const ICONS = { done: CheckCircle, now: CircleHalf, planned: Circle, dropped: XCircle }
const WORDS = { done: 'Done', now: 'In progress', planned: 'Planned', dropped: 'Dropped' }

/* Every phase, in order, at a glance. Nothing to drag, edit or keep up. */
function Timeline({ phases, onOpen }) {
  if (!phases.length) return <p className="timeline-empty">The roadmap has no Status table to show yet.</p>
  return (
    <section className="timeline" aria-label="Timeline">
      <p className="timeline-summary">{timelineSummary(phases)}</p>
      <ol className="timeline-strip" aria-hidden="true">
        {phases.map((phase) => <li key={phase.id} data-state={phase.state} title={`${phase.id}: ${phase.label}`}><span>{phase.id}</span></li>)}
      </ol>
      <ol className="timeline-list">
        {phases.map((phase) => {
          const Icon = ICONS[phase.state]
          return (
            <li key={phase.id} data-state={phase.state}>
              <Icon className="timeline-mark" weight={phase.state === 'planned' ? 'regular' : 'fill'} aria-label={WORDS[phase.state]} />
              <button type="button" onClick={() => onOpen(phase)}>
                <span className="timeline-phase">Phase {phase.id}</span>
                <span className="timeline-what">{phase.what}</span>
                <span className="timeline-state">{phase.label}{phase.date && !phase.label.includes(phase.date) ? ` · ${phase.date}` : ''}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
