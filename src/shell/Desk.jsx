import { useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from '../lib/ErrorBoundary.jsx'
import { Database, Sparkle } from '@phosphor-icons/react'

import { LocalAssistant } from '../assistant/LocalAssistant.jsx'
import { cleanError } from '../assistant/useAi.js'
import { localDateKey } from '../daily-practice.js'
import { ClipboardOffer } from './ClipboardOffer.jsx'
import { Line } from './Line.jsx'
import { MorningBriefNote } from './MorningBriefNote.jsx'
import { inputActive } from '../lib/ui.js'
import { SETTINGS, spaceForKey, titleFor } from '../lib/spaces.js'
import { NotesView } from '../notes/NotesView.jsx'
import { Boards } from '../boards/Boards.jsx'
import { boardsOf, JUST_IN } from '../boards/boards-model.js'
import { useAutoFile } from '../sky/useAutoFile.js'
import { useDates } from '../intake/useDates.js'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { importScan } from '../nodes-model.js'
import { storageFrom, useWorkspace } from '../store/useWorkspace.js'
import { SaveStatus } from '../store/SaveStatus.jsx'
import { TodayView, TodoView } from '../today/Today.jsx'
import { BrowserView } from '../tools/Browser.jsx'
import { TerminalView } from '../tools/Terminal.jsx'
import { BudgetView } from '../views/Budget.jsx'
import { CalendarView } from '../views/Calendar.jsx'
import { FilesView } from '../views/Files.jsx'
import { HabitsView } from '../views/Habits.jsx'
import { JournalView } from '../views/Journal.jsx'
import { NowPlayingView } from '../views/NowPlaying.jsx'
import { PileView } from '../views/Pile.jsx'
import { RoadmapView } from '../views/Roadmap.jsx'
import { GitHubView } from '../views/GitHub.jsx'
import { MailView } from '../views/Mail.jsx'
import { PasswordsView } from '../views/Passwords.jsx'
import { MeetingsView } from '../views/Meetings.jsx'
import { SettingsView } from '../views/Settings.jsx'
import { Sidebar } from './Sidebar.jsx'
import { Welcome } from './Welcome.jsx'
import { needsTour, Tour } from './Tour.jsx'

/* OSAT's one window (Phase 73), built the way Apple's own apps are: one sidebar, one room beside it, the bar to write,
   find or ask on top of every room, and Ask as a panel on the right. ⌘K and ⇧⌘N land in the bar, ⌘1–6 open the first
   six places, ⌘, Settings. Esc backs out one step (a room's own step first, then the Ask panel); it never hides the
   window: ⌥Space and ⌘W do. Offline is the switch at the foot of the sidebar (and ⇧⌘U, the menu-bar icon): main turns
   the internet off for OSAT and only the rooms that need it wait. */

// The rooms that can't do anything offline; they say so instead of opening.
const ONLINE_ONLY = new Set(['Browser', 'Terminal', 'NowPlaying', 'GitHub'])
const ROOMS = new Set(['Today', 'Todo', 'JustIn', 'Mindmap', 'Notes', 'Files', 'Journal', 'Calendar', 'Habits', 'Budget', 'Browser', 'Terminal', 'Settings', 'NowPlaying', 'Roadmap', 'GitHub', 'Mail', 'Passwords', 'Meetings', 'Pile'])
const BOARD_KEY = 'osat.boards.board.v1'

export function Desk() {
  const { workspace, status, commit, ready } = useWorkspace()
  const hydrated = Boolean(ready && workspace)
  const storage = storageFrom(status, hydrated)
  const [at, setAt] = useState({ view: 'Today', board: null, detail: null, stamp: 0 })
  const [ask, setAsk] = useState(null) // null, or { prompt?, chatId?, stamp }
  const [welcome, setWelcome] = useState(false)
  const [tour, setTour] = useState(false)
  const [summon, setSummon] = useState(0)
  const [visit, setVisit] = useState(0)
  const [roomCommand, setRoomCommand] = useState(null)
  // Offline, as main says it is ({ on, terminal }). The preview has no main: the look only.
  const [offline, setOffline] = useState({ on: false })
  const [notice, setNotice] = useState('')
  const [newBoard, setNewBoard] = useState(0)
  // Scans that came in: [{ name, folderId, noteId }]. Their line stays until looked at.
  const [arrived, setArrived] = useState([])
  const boardsRef = useRef(null)
  const on = offline.on === true
  // The AI files new stickies on its own once you stop writing (auto-file.js); one line says where, with Undo.
  const [filedToast, showFiled] = useUndoToast()
  useAutoFile({ workspace, commit, hydrated, onToast: showFiled })
  // A sticky that is a date goes on the calendar on its own (Phase 67), with its own line and Undo.
  const [datesToast, showDates] = useUndoToast()
  useDates({ workspace, commit, hydrated, onToast: showDates })

  /* Main decides; the page only shows it, whoever asked: the sidebar's switch, ⇧⌘U or the menu-bar icon. */
  useEffect(() => {
    const api = window.osatUnder
    if (!api) return undefined
    api.status().then(setOffline, () => {})
    return api.onChange((next) => {
      if (next?.error) setNotice(cleanError(next.error))
      setOffline(next)
    })
  }, [])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  async function askOffline(next) {
    if (!window.osatUnder) { setOffline({ on: next }); return }
    try {
      setOffline(await window.osatUnder.set(next))
    } catch (error) {
      setNotice(cleanError(error))
    }
  }

  /* Scans (Settings → Data): each one the AI has sorted comes in as a board, or as one sticky in Just in. */
  useEffect(() => {
    const api = window.osatScans
    if (!api || !hydrated) return undefined
    let busy = false
    let again = false
    const bringIn = async () => {
      if (busy) { again = true; return }
      busy = true
      try {
        do {
          again = false
          for (const item of await api.take()) {
            let made = null
            try {
              commit((state) => { made = importScan(state, item.node); return made.state })
            } catch {
              made = null
            }
            await api.done(item.id)
            if (made?.folder) setArrived((list) => [...list, { name: made.folder.name, folderId: made.folder.id }])
            else if (made?.note) setArrived((list) => [...list, { name: made.note.title, noteId: made.note.id }])
          }
        } while (again)
      } catch {
        // Main keeps what's waiting; the next scan brings it in.
      } finally {
        busy = false
      }
    }
    bringIn()
    return api.onReady(bringIn)
  }, [hydrated]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (at.view === 'Mindmap' || at.view === 'JustIn') setArrived([]) }, [at.view])

  /* The first launch on this Mac starts with the welcome, then the tour, once. */
  useEffect(() => {
    window.osatApp?.needsWelcome?.().then((need) => setWelcome(need === true)).catch(() => {})
  }, [])
  useEffect(() => {
    if (!hydrated || welcome) return undefined
    let cancelled = false
    const timer = setTimeout(() => needsTour().then((need) => { if (need && !cancelled) setTour(true) }), 1400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [hydrated, welcome])

  /* Each time the window comes up (⌥Space), the bar is ready to type into. */
  useEffect(() => window.osatDesk?.onShown(() => {
    setVisit((value) => value + 1)
    window.osatUnder?.status().then(setOffline).catch(() => {})
  }), [])

  /* The Mac menu bar, the Dock menu and the menu-bar icon send commands here. */
  const latest = useRef(null)
  useEffect(() => window.osatApp?.onCommand?.((detail) => {
    if (!detail || typeof detail !== 'object') return
    if (detail.action === 'search') { latest.current?.navigate('Capture'); return }
    if (typeof detail.view === 'string') latest.current?.navigate(detail.view, detail.detail || null)
    if (typeof detail.action === 'string') setRoomCommand({ action: detail.action, at: Date.now() })
  }), [])

  useEffect(() => {
    const onKey = (event) => {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && !event.altKey && ((!event.shiftKey && key === 'k') || (event.shiftKey && key === 'n'))) {
        event.preventDefault()
        latest.current?.navigate('Capture')
        return
      }
      if (mod && !event.shiftKey && !event.altKey && spaceForKey(event.key)) {
        event.preventDefault()
        latest.current?.navigate(spaceForKey(event.key))
        return
      }
      if (mod && event.key === ',') {
        event.preventDefault()
        latest.current?.navigate(SETTINGS.id)
        return
      }
      if (event.key !== 'Escape' || event.defaultPrevented || document.documentElement.dataset.menu === 'open') return
      const { welcome: welcoming, tour: touring, ask: asking, at: where } = latest.current
      if (welcoming || touring) return
      const active = document.activeElement
      // A room's own step first (an edit on a board, Find's words, a board being named).
      if ((where.view === 'Mindmap' || where.view === 'JustIn') && boardsRef.current?.back()) { event.preventDefault(); return }
      if (asking && active?.closest?.('.ask-panel')) { event.preventDefault(); setAsk(null); return }
      if (inputActive() && active?.closest?.('.app-room') && !active.closest('.xterm, .browser-view')) { event.preventDefault(); active.blur(); return }
      if (asking) { event.preventDefault(); setAsk(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function go(view, detail = null, board = null) {
    setAt({ view, detail, board, stamp: Date.now() })
  }

  /* Where a board link leads: the board named, else the last one open, else the first, else Just in. */
  function boardFor(detail) {
    const boards = boardsOf(latest.current.workspace)
    if (detail?.folderId) return detail.folderId
    let last = null
    try { last = localStorage.getItem(BOARD_KEY) } catch { /* a convenience */ }
    if (last && boards.some(({ folder }) => folder.id === last)) return last
    return boards[0]?.folder.id || null
  }

  function navigate(view, detail = null) {
    if (view === 'Tour') setTour(true)
    else if (view === 'Offline') askOffline(!latest.current.offline)
    else if (latest.current.offline && ONLINE_ONLY.has(view)) setNotice(`Offline: ${titleFor(view)} waits until you’re back online.`)
    else if (view === 'Capture') { if (!latest.current.welcome) setSummon(Date.now()) }
    // Ask is the panel on the right: a question, a chat, or a file to ask about.
    else if (view === 'Assistant') setAsk({ ...(detail || {}), stamp: Date.now() })
    else if (view === 'Clipboard') { if (window.osatSearch) window.osatSearch.show('clipboard'); else setNotice('The clipboard history is in the Mac app.') }
    else if (view === 'Obsidian') go('Settings', { section: 'data' })
    else if (view === 'Reflection') go('Journal', { tab: 'reflect' })
    // A new board is named in the sidebar.
    else if ((view === 'Mindmap' || view === 'Canvas') && detail?.action === 'new-node') setNewBoard(Date.now())
    else if (view === 'Mindmap' || view === 'Sky' || view === 'Canvas') {
      // A note sent to the boards opens the board it's on (Boards finds it); no board yet means Just in.
      const board = detail?.noteId ? null : boardFor(detail)
      if (!board && !detail?.noteId) go('JustIn', detail)
      else go('Mindmap', detail, board)
    }
    else if ((view === 'Notes' || view === 'Today') && typeof detail === 'string') go('Notes', { noteId: detail })
    else if (view === 'Desk') go('Today')
    else if (ROOMS.has(view)) go(view, detail)
  }
  latest.current = { navigate, welcome, tour, ask, at, offline: on, workspace }

  const common = useMemo(() => ({ workspace, commit, navigate }), [workspace]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!hydrated) {
    return (
      <main className="app is-loading">
        <section className="connection-gate" aria-live="polite">
          <div>
            <Database />
            <span>Local storage</span>
          </div>
          <h2>{storage.status === 'error' ? 'Your workspace could not be opened.' : 'Opening OSAT.'}</h2>
          <p>{storage.status === 'error' ? `${storage.message} Nothing has been changed.` : 'Your notes stay on this Mac.'}</p>
          {storage.status === 'error' && <button type="button" className="primary-button" onClick={() => window.location.reload()}>Try again</button>}
        </section>
      </main>
    )
  }

  const room = at.view === 'JustIn' ? 'Mindmap' : at.view
  return (
    <main className={`app ${ask ? 'has-ask' : ''}`} data-native={window.osatDesk ? '' : undefined}>
      <SaveStatus recovery />
      <div className="app-frame" inert={welcome || tour || undefined}>
        <Sidebar workspace={workspace} commit={commit} navigate={navigate} at={at} offline={on} onOffline={() => askOffline(!on)} newBoard={newBoard} />

        <section className="app-main">
          <header className="app-bar">
            <Line
              workspace={workspace}
              commit={commit}
              navigate={navigate}
              storage={storage}
              visit={visit}
              summon={summon}
              paused={welcome || tour}
              offline={offline}
              typeAnywhere={at.view === 'Today'}
              onAsk={(prompt) => setAsk({ prompt, send: true, stamp: Date.now() })}
              onNote={setNotice}
            />
            <button type="button" className={`app-ask-button ${ask ? 'is-on' : ''}`} aria-pressed={Boolean(ask)} title="Ask the AI on this Mac" onClick={() => setAsk((value) => (value ? null : { stamp: Date.now() }))}>
              <Sparkle weight="fill" aria-hidden="true" /> Ask
            </button>
          </header>

          <div className="app-room popout-body workspace-content is-filled" data-view={room} key={room}>
            <ErrorBoundary where={titleFor(at.view)}>
              <Room at={at} common={common} storage={storage} command={roomCommand} covered={welcome || tour} boardsRef={boardsRef} setBoard={(board) => setAt((value) => ({ ...value, view: board === JUST_IN ? 'JustIn' : 'Mindmap', board }))} />
            </ErrorBoundary>
          </div>
        </section>

        {ask && (
          <aside className="ask-panel" aria-label="Ask">
            <ErrorBoundary where="Ask">
              <LocalAssistant {...common} compact panel key={ask.chatId || 'ask'} initialPrompt={ask.prompt || ask.chatId || ask.file ? { ...ask, at: ask.stamp } : null} />
            </ErrorBoundary>
          </aside>
        )}
      </div>

      <div className="toasts-above">{datesToast}</div>
      {filedToast}
      {notice
        ? <p className="desk-note" role="status">{notice}</p>
        : arrived.length > 0 && (
          <p className="desk-note is-arrival" role="status">
            New from a scan: {arrived.slice(-3).map((item) => `“${item.name.slice(0, 40)}”`).join(', ')}
            <button type="button" onClick={() => { const last = arrived.at(-1); navigate('Mindmap', last.folderId ? { folderId: last.folderId } : { noteId: last.noteId }) }}>Show me</button>
          </p>
        )}
      <UpdateNote />
      <ClipboardOffer workspace={workspace} commit={commit} />
      <MorningBriefNote workspace={workspace} navigate={navigate} />
      {welcome && <Welcome onDone={() => setWelcome(false)} />}
      {tour && !welcome && <Tour onDone={() => setTour(false)} />}
    </main>
  )
}

function Room({ at, common, storage, command, covered, boardsRef, setBoard }) {
  const target = at.detail ? { ...at.detail, at: at.stamp } : null
  const today = localDateKey()
  switch (at.view) {
    case 'Today': return <TodayView {...common} />
    case 'Todo': return <TodoView {...common} />
    case 'JustIn':
    case 'Mindmap': return <Boards ref={boardsRef} {...common} board={at.view === 'JustIn' ? JUST_IN : at.board} onOpenBoard={setBoard} target={target} />
    case 'Notes': return <NotesView {...common} target={target} today={today} />
    case 'Files': return <FilesView {...common} target={typeof at.detail?.rootId === 'string' ? target : null} />
    case 'Browser': return <BrowserView {...common} covered={covered} command={command} />
    case 'Terminal': return <TerminalView command={command} />
    case 'Journal': return <JournalView {...common} target={target} />
    case 'Calendar': return <CalendarView {...common} initialDate={at.detail?.date || null} />
    case 'Habits': return <HabitsView {...common} />
    case 'Budget': return <BudgetView {...common} />
    case 'Settings': return <SettingsView {...common} storage={storage} target={at.detail?.section ? target : null} />
    case 'Roadmap': return <RoadmapView {...common} target={target} />
    case 'GitHub': return <GitHubView />
    case 'Mail': return <MailView {...common} />
    case 'Passwords': return <PasswordsView />
    case 'Meetings': return <MeetingsView {...common} />
    case 'Pile': return <PileView {...common} />
    case 'NowPlaying': return <NowPlayingView {...common} media={window.osatDesk?.nowPlaying ? window.osatDesk : null} />
    default: return null
  }
}

/* A newer OSAT is ready (main looks quietly a minute after start and every six hours): one calm line, with Update and
   restart, or Later until the next time OSAT starts. */
function UpdateNote() {
  const bridge = typeof window === 'undefined' ? null : window.osatUpdate
  const [ready, setReady] = useState(null)
  const [state, setState] = useState('idle')
  useEffect(() => bridge?.onAvailable?.((found) => setReady(found)), [bridge])
  useEffect(() => bridge?.onProgress?.((progress) => setState(progress?.state || 'idle')), [bridge])
  if (!ready) return null
  const install = async () => {
    setState('downloading')
    try { await bridge.install() } catch { setState('error') }
  }
  const busy = ['downloading', 'checking', 'restarting'].includes(state)
  return (
    <p className="desk-note is-update" role="status">
      <span className="update-dot" aria-hidden="true" />
      {state === 'error' ? 'The update didn’t finish. Try again from Settings → About.' : busy ? 'Updating OSAT… it restarts by itself.' : `OSAT ${ready.version} is ready.`}
      {!busy && state !== 'error' && <button type="button" onClick={install}>Update and restart</button>}
      {!busy && <button type="button" className="is-quiet" onClick={() => setReady(null)}>Later</button>}
    </p>
  )
}
