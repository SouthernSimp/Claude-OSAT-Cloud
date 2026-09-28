import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppWindow, ArrowsIn, ArrowsOut, Database, Plus, X } from '@phosphor-icons/react'

import { LocalAssistant } from '../assistant/LocalAssistant.jsx'
import { cleanError } from '../assistant/useAi.js'
import { localDateKey } from '../daily-practice.js'
import { FieldDesk } from '../field/FieldDesk.jsx'
import { FieldSheet } from '../field/FieldSheet.jsx'
import { onCarryEdge } from '../lib/carry.js'
import { clamp, inputActive } from '../lib/ui.js'
import { SETTINGS, spaceForKey, titleFor } from '../lib/spaces.js'
import { NotesView } from '../notes/NotesView.jsx'
import { Sky } from '../sky/Sky.jsx'
import { relinkRenamedNote, updateNote } from '../notes-model.js'
import { storageFrom, useWorkspace } from '../store/useWorkspace.js'
import { BrowserView } from '../tools/Browser.jsx'
import { TerminalView } from '../tools/Terminal.jsx'
import { BudgetView } from '../views/Budget.jsx'
import { CalendarView } from '../views/Calendar.jsx'
import { FilesView } from '../views/Files.jsx'
import { HabitsView } from '../views/Habits.jsx'
import { JournalView } from '../views/Journal.jsx'
import { NowPlayingView } from '../views/NowPlaying.jsx'
import { ProjectsView } from '../views/Projects.jsx'
import { ReflectionView } from '../views/Reflection.jsx'
import { SettingsView } from '../views/Settings.jsx'
import { GlassDefs, useAlive } from './glass.jsx'
import { covers, grow, placeRoom } from './placement.js'
import { Dock } from './Shell.jsx'
import { Under } from './Under.jsx'
import { Welcome } from './Welcome.jsx'

/* The desk: OSAT's one window, laid over the real desktop (see-through, blurred),
   with every room opening as a pop-out you can drag, resize and stack. A room opened
   from a widget or the dock grows out of it; one opened from a widget shrinks back into
   it. ⌥Space brings it up and puts it away (Esc never does). ⌘K, ⇧⌘N and Find in the
   menu all land in the desk's line. Esc backs out of the line first (see Line.jsx), then
   closes the top pop-out.
   Three layers: the Sky above the desk (Sky.jsx, your nodes: ⌘3, ⌥⌘↑, or a sticky held
   at the top of the screen), the desk, and Incognito under it (Under.jsx): going under
   lifts the desk away and the rooms open on it wait above; down there only a note or Ask
   opens. Esc comes back to the desk from either. */

const ROOMS = {
  Notes: [1100, 720],
  Assistant: [780, 720],
  Files: [1080, 700],
  Journal: [980, 780],
  Calendar: [1040, 720],
  Habits: [900, 680],
  Reflection: [820, 680],
  Budget: [980, 720],
  Projects: [980, 720],
  Browser: [1120, 760],
  Terminal: [860, 540],
  Settings: [980, 760],
  NowPlaying: [520, 660],
  note: [600, 640],
}

/* Which widgets are out, and where things were set down: saved per Mac by the app; the
   browser preview keeps them here. */
const WIDGETS_KEY = 'osat.widgets'
const PLACES_KEY = 'osat.places'
function readWidgets() {
  try {
    const list = JSON.parse(localStorage.getItem(WIDGETS_KEY))
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}
function readPlaces() {
  try {
    const places = JSON.parse(localStorage.getItem(PLACES_KEY))
    return places && typeof places === 'object' && !Array.isArray(places) ? places : {}
  } catch {
    return {}
  }
}

export function Desk() {
  const { workspace, status, commit, ready } = useWorkspace()
  const hydrated = Boolean(ready && workspace)
  const storage = storageFrom(status, hydrated)
  const bridge = window.osatDesk
  const [pops, setPops] = useState([])
  const [visit, setVisit] = useState(0)
  const [prefs, setPrefs] = useState(() => ({ launchers: [], places: bridge ? {} : readPlaces(), widgets: bridge ? null : readWidgets() }))
  const [welcome, setWelcome] = useState(false)
  const [focusAt, setFocusAt] = useState(0)
  const [summon, setSummon] = useState(0)
  const [trayAt, setTrayAt] = useState(0)
  const [roomCommand, setRoomCommand] = useState(null)
  const [line, setLine] = useState(null)
  // Incognito, as main says it is ({ on, terminal }); null until it has said. The preview has no main.
  const [under, setUnder] = useState(() => (window.osatUnder ? null : { on: false }))
  // 'going' or 'coming' while the desk changes places with the Sky.
  const [phase, setPhase] = useState(null)
  const [notice, setNotice] = useState('')
  const [summonUnder, setSummonUnder] = useState(0)
  // The Sky, above the desk: null (the desk), 'sky', or 'leaving' while it goes.
  const [sky, setSky] = useState(null)
  const [skyTarget, setSkyTarget] = useState(null)
  const skyRef = useRef(null)
  const stash = useRef([])
  const known = under !== null
  const on = under?.on === true
  // A change starts moving in the same render that hears it (a relaunch under simply starts there).
  const [was, setWas] = useState(null)
  if (known && was !== on) {
    setWas(on)
    if (was !== null) setPhase(on ? 'going' : 'coming')
    // Going under from the Sky: the Sky waits above too.
    if (on && sky) setSky(null)
  }
  const look = !known ? 'waiting' : phase || (on ? 'under' : null)
  useAlive()

  /* Blur at zero means a clear desk: the Mac's frosting comes off entirely. Under, the ink
     covers the desktop, so the frosting rests too. */
  const clear = workspace?.settings?.blur === 0 || look === 'under'
  useEffect(() => {
    bridge?.setClear?.(clear)
  }, [bridge, clear])

  /* Main decides; the page only shows it, whoever asked: the dock, the line, ⇧⌘U in the Go
     menu or the menu-bar icon. When one of those didn't work, the status says why. */
  useEffect(() => {
    const api = window.osatUnder
    if (!api) return undefined
    api.status().then(setUnder, () => setUnder({ on: false }))
    return api.onChange((status) => {
      if (status?.error) setNotice(cleanError(status.error))
      setUnder(status)
    })
  }, [])

  /* Going under (about 900 ms): the desk and its rooms lift off the top together while the
     ink rises; then the rooms wait above. Coming up (about 600 ms) plays it backwards and
     brings them back where they were. */
  useEffect(() => {
    if (!phase) return undefined
    const quick = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (phase === 'going') {
      setNotice('')
      const timer = setTimeout(() => {
        stash.current = latest.current.pops
        setPops([])
        setPhase(null)
      }, quick ? 150 : 900)
      return () => clearTimeout(timer)
    }
    const back = stash.current
    stash.current = []
    setPops((list) => [...back.filter((pop) => !list.some((item) => item.key === pop.key)), ...list])
    setSummonUnder(0)
    // The Desktop's icons look again, and the line is ready.
    setVisit((value) => value + 1)
    const timer = setTimeout(() => {
      setPhase(null)
      setNotice(window.osatUnder ? 'Back up. Nothing left OSAT while you were under.' : 'Back up.')
    }, quick ? 150 : 620)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  /* Main pauses (or wakes) everything first and only then answers, so the page moves only
     once it's true. If it can't, nothing moves and one calm line says why. */
  async function askUnder(next) {
    if (!window.osatUnder) { setUnder({ on: next }); return }
    try {
      setUnder(await window.osatUnder.set(next))
    } catch (error) {
      setNotice(cleanError(error))
    }
  }

  /* The first launch on this Mac starts with the welcome. */
  useEffect(() => {
    window.osatApp?.needsWelcome?.().then((need) => setWelcome(need === true)).catch(() => {})
  }, [])

  useEffect(() => {
    bridge?.prefs().then(setPrefs).catch(() => {})
    return bridge?.onShown(() => {
      setVisit((value) => value + 1)
      bridge.prefs().then(setPrefs).catch(() => {})
      // A terminal started before going under may have finished since.
      window.osatUnder?.status().then(setUnder).catch(() => {})
    })
  }, [bridge])

  /* The Mac menu bar, the Dock menu and the menu-bar icon send commands here. */
  const latest = useRef(null)
  useEffect(() => window.osatApp?.onCommand?.((detail) => {
    if (!detail || typeof detail !== 'object') return
    if (detail.action === 'search') { latest.current?.navigate('Capture'); return }
    if (typeof detail.view === 'string') latest.current?.navigate(detail.view, detail.detail || null)
    if (typeof detail.action === 'string') setRoomCommand({ action: detail.action, at: Date.now() })
  }), [])

  /* ⌘K and ⇧⌘N go to the line, ⌘1–5 and ⌘, open rooms, ⌥⌘↑ and ⌥⌘↓ move between the
     Sky, the desk and Incognito. Esc backs out one step: out of a field in a pop-out, then
     the top pop-out, then back to the desk from the Sky or Incognito. It never puts the
     desk away: only ⌥Space (or ⌘W) does. */
  useEffect(() => {
    const onKey = (event) => {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && event.altKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        latest.current?.step(event.key === 'ArrowUp' ? 'up' : 'down')
        return
      }
      if (mod && !event.shiftKey && !event.altKey && key === 'k') {
        event.preventDefault()
        // Up in the Sky, ⌘K finds a sticky there.
        if (latest.current?.sky === 'sky' && !latest.current.pops.some((pop) => !pop.closing)) skyRef.current?.find()
        else latest.current?.navigate('Capture')
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
      if (mod && event.shiftKey && key === 'n') {
        event.preventDefault()
        latest.current?.navigate('Capture')
        return
      }
      if (event.key !== 'Escape' || event.defaultPrevented || document.documentElement.dataset.menu === 'open') return
      const { pops: all, welcome: welcoming, sky: up, under: down } = latest.current
      if (welcoming) return
      const active = document.activeElement
      const open = all.filter((pop) => !pop.closing)
      if (open.length) {
        event.preventDefault()
        if (active?.closest?.('.popout') && active.closest('.xterm, .browser-view')) return
        if (active?.closest?.('.popout') && inputActive()) { active.blur(); return }
        close(open.at(-1).key)
      } else if (up === 'sky') {
        event.preventDefault()
        if (inputActive() && active?.closest?.('.sky-layer')) { active.blur(); return }
        if (!skyRef.current?.back()) latest.current.step('down')
      } else if (down) {
        event.preventDefault()
        latest.current.step('up')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Up to the Sky, or down: from the Sky to the desk, from the desk to Incognito. */
  function step(way) {
    const { sky: up, under: down } = latest.current
    if (way === 'up') {
      if (down) askUnder(false)
      else if (up !== 'sky') goUp()
    } else if (up === 'sky') goDown()
    else if (!down) askUnder(true)
  }

  function goUp(detail = null) {
    setSkyTarget(detail ? { ...detail, at: Date.now() } : null)
    setSky('sky')
  }

  function goDown() {
    if (latest.current.sky !== 'sky') return
    setSky('leaving')
    setTimeout(() => setSky((value) => (value === 'leaving' ? null : value)), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280)
    setVisit((value) => value + 1)
  }

  /* A sticky held at the top of the screen goes up to the Sky; at the bottom of the Sky, back down. */
  useEffect(() => onCarryEdge((side) => {
    if (side === 'up' && !latest.current.under) goUp()
    if (side === 'down' && latest.current.sky === 'sky') goDown()
  }), [])

  /* `from` is the rectangle the room grows out of; `widget` the widget it is the room of,
     which it opens beside (on its side of the line) and shrinks back into. */
  function open(view, detail = null, { from = null, widget = null } = {}) {
    // Under, only a note or Ask opens; every other room waits above.
    if (latest.current.under && view !== 'note' && view !== 'Assistant') return
    const key = view === 'note' ? `note:${detail.noteId}` : view
    setPops((list) => {
      const existing = list.find((pop) => pop.key === key)
      if (existing) return [...list.filter((pop) => pop !== existing), { ...existing, detail, at: Date.now(), closing: false }]
      const { line } = latest.current
      const prefer = widget && line && from ? (from.left + from.width / 2 < (line.left + line.right) / 2 ? 'left' : 'right') : undefined
      const spot = placeRoom({ width: innerWidth, height: innerHeight }, ROOMS[view], line, list.filter((pop) => !pop.closing), { prefer })
      return [...list, { key, view, detail, at: Date.now(), ...spot, from, widget }]
    })
  }

  /* A widget's room shrinks back into the widget while it is still on the desk (PopOut
     lets it go once it has); anything else simply closes. */
  function close(key) {
    const pop = latest.current.pops.find((item) => item.key === key)
    if (pop?.widget && document.querySelector(`[data-widget="${pop.widget}"]`)) setPops((list) => list.map((item) => (item.key === key ? { ...item, closing: true } : item)))
    else gone(key)
  }

  function gone(key) {
    setPops((list) => list.filter((pop) => pop.key !== key))
  }

  function raise(key) {
    setPops((list) => (list.at(-1)?.key === key ? list : [...list.filter((pop) => pop.key !== key), list.find((pop) => pop.key === key)]))
  }

  function change(key, patch) {
    setPops((list) => list.map((pop) => {
      if (pop.key !== key || Object.entries(patch).every(([name, value]) => pop[name] === value)) return pop
      return { ...pop, ...patch }
    }))
  }

  // `origin`: where it was opened from ({ from, widget }), so the room can grow out of it.
  function navigate(view, detail = null, origin) {
    const noteId = typeof detail === 'string' ? detail : detail?.noteId
    if (view === 'Under') askUnder(true)
    // Under: the line, a note, or Ask. Everything else says it waits above.
    else if (latest.current.under && view !== 'Capture' && view !== 'Assistant' && !((view === 'Notes' || view === 'Today') && typeof noteId === 'string')) {
      // "Set up the AI" in the line or in Ask would mean a download.
      setNotice(view === 'Settings' && detail?.section === 'ai' ? 'Setting up the AI downloads it, so that waits until you come up.' : `${titleFor(view)} opens again when you come up.`)
    }
    // A new thought, or a search: the line takes it (it rises if a room covers it).
    else if (view === 'Capture') {
      if (latest.current.welcome) return
      // A new thought from the Sky (⇧⌘N) comes back down to the line.
      if (latest.current.sky === 'sky') goDown()
      ;(latest.current.under ? setSummonUnder : setSummon)(Date.now())
    }
    // The Map is the Sky now: the layer above the desk.
    else if (view === 'Mindmap' || view === 'Sky') goUp(view === 'Sky' ? { ...(detail || {}), view: 'stars' } : detail)
    else if (view === 'Focus') setFocusAt(Date.now())
    else if (view === 'Widgets') setTrayAt(Date.now())
    // The Obsidian export lives in Settings → Data.
    else if (view === 'Obsidian') open('Settings', { section: 'data' })
    else if ((view === 'Notes' || view === 'Today') && typeof detail === 'string') open('note', { noteId: detail }, origin)
    else if ((view === 'Notes' || view === 'Today') && typeof detail?.noteId === 'string') open('note', { noteId: detail.noteId }, origin)
    // The desk: from the Sky, that means coming back down.
    else if (view === 'Today') { if (latest.current.sky === 'sky') goDown(); else setVisit((value) => value + 1) }
    else if (ROOMS[view]) open(view, detail, origin)
  }
  latest.current = { navigate, pops, welcome, line, under: on, sky, step }

  async function launcher(action, ...args) {
    try {
      const result = await bridge?.[action](...args)
      if (Array.isArray(result)) setPrefs((value) => ({ ...value, launchers: result }))
    } catch {
      // The app may have moved; the dock simply stays as it was.
    }
  }

  /* Set down right away (null picks it up); the Mac app keeps the spot for next time. */
  function place(id, spot) {
    setPrefs((value) => {
      const places = { ...value.places }
      if (spot === null) delete places[id]
      else places[id] = spot
      if (!bridge) try { localStorage.setItem(PLACES_KEY, JSON.stringify(places)) } catch { /* a convenience only */ }
      return { ...value, places }
    })
    bridge?.place(id, spot).then((places) => setPrefs((value) => ({ ...value, places }))).catch(() => {})
  }

  /* Widgets and icons go back where they were; stickies stay on the desk. */
  function tidy() {
    setPrefs((value) => ({ ...value, places: Object.fromEntries(Object.entries(value.places).filter(([key]) => key.startsWith('note:') || key.startsWith('scratch:'))) }))
    bridge?.tidy().catch(() => {})
  }

  function setWidgets(widgets) {
    setPrefs((value) => ({ ...value, widgets }))
    if (bridge) bridge.setWidgets(widgets).then((saved) => setPrefs((value) => ({ ...value, widgets: saved }))).catch(() => {})
    else try { localStorage.setItem(WIDGETS_KEY, JSON.stringify(widgets)) } catch { /* a convenience only */ }
  }

  if (!hydrated) {
    return (
      <main className="overlay-surface">
        <div className="loading-workspace">
          <section className="connection-gate" aria-live="polite">
            <div>
              <Database />
              <span>LOCAL STORAGE</span>
            </div>
            <h2>{storage.status === 'error' ? 'Your workspace could not be opened.' : 'Opening the room.'}</h2>
            <p>{storage.status === 'error' ? `${storage.message} Nothing has been changed.` : 'Your notes stay on this Mac.'}</p>
            {storage.status === 'error' && <button type="button" className="primary-button" onClick={() => window.location.reload()}>Try again</button>}
          </section>
        </div>
      </main>
    )
  }

  const common = { workspace, commit, navigate }
  const shown = pops.filter((pop) => !pop.closing)
  const top = shown.at(-1)
  const covered = welcome
  const hasPlaces = Object.keys(prefs.places || {}).some((key) => !key.startsWith('note:') && !key.startsWith('scratch:'))
  // While it lifts away and while it waits above, the desk stays put together but can't be used.
  const away = look === 'going' || look === 'under' || sky === 'sky'

  return (
    <main className={`overlay-surface ${bridge ? '' : 'is-preview'}`} data-under={look || undefined} data-sky={sky || undefined}>
      <GlassDefs />
      <div className="workspace-content is-filled" inert={welcome || away || undefined}>
        <FieldDesk
          {...common}
          visit={visit}
          storage={storage}
          focusAt={focusAt}
          summon={summon}
          onOpenNote={(noteId) => open('note', { noteId })}
          places={prefs.places || {}}
          onPlace={place}
          media={bridge?.nowPlaying && look !== 'under' ? bridge : null}
          raised={shown.some((pop) => covers(pop, line))}
          onLine={setLine}
          widgets={{
            list: prefs.widgets,
            onList: setWidgets,
            openIds: new Set(shown.map((pop) => pop.widget).filter(Boolean)),
            tray: trayAt,
            hasPlaces,
            onTidy: tidy,
          }}
          dock={(
            <Dock
              view={top?.view === 'note' ? 'Notes' : top?.view || 'Today'}
              navigate={navigate}
              onSendUp={(noteId) => { if (prefs.places?.[`note:${noteId}`]) place(`note:${noteId}`, null); goUp() }}
              storage={storage}
              workspace={workspace}
              commit={commit}
            >
              {bridge && (
                <>
                  <i className="dock-rule" />
                  <div className="dock-group dock-apps">
                    {prefs.launchers.map((item) => (
                      <button key={item.path} type="button" data-mag className="launcher" aria-label={`Open ${item.name}`} data-tip={item.name} onClick={() => launcher('launch', item.path)}
                        onContextMenu={(event) => { event.preventDefault(); launcher('removeLauncher', item.path) }}>
                        {item.icon ? <img src={item.icon} alt="" /> : <AppWindow />}
                      </button>
                    ))}
                    <button type="button" aria-label="Add an app to the dock" data-tip="Add an app" onClick={() => launcher('addLauncher')}><Plus /></button>
                  </div>
                </>
              )}
            </Dock>
          )}
        />
      </div>

      {sky && !on && (
        <div className={`sky-shell ${sky === 'leaving' ? 'is-leaving' : ''}`} inert={sky === 'leaving' || welcome || undefined}>
          <Sky
            ref={skyRef}
            workspace={workspace}
            commit={commit}
            navigate={navigate}
            target={skyTarget}
            onClose={goDown}
            onFiled={(noteId) => { if (prefs.places?.[`note:${noteId}`]) place(`note:${noteId}`, null) }}
          />
        </div>
      )}

      {(on || phase) && (
        <Under
          {...common}
          storage={storage}
          status={under}
          arriving={phase === 'going'}
          leaving={phase === 'coming'}
          visit={visit}
          summon={summonUnder}
          onOpenNote={(noteId) => open('note', { noteId })}
          onComeUp={() => askUnder(false)}
          places={prefs.places || {}}
          onPlace={place}
        />
      )}

      <div className="popouts" inert={welcome || look === 'going' || undefined}>
        {pops.map((pop, index) => (
          <PopOut
            key={pop.key}
            pop={pop}
            z={index + 1}
            top={pop.key === top?.key}
            title={pop.view === 'note' ? workspace.notes.find((note) => note.id === pop.detail.noteId)?.title || 'Note' : titleFor(pop.view)}
            onRaise={() => raise(pop.key)}
            onClose={() => close(pop.key)}
            onGone={() => gone(pop.key)}
            onChange={(patch) => change(pop.key, patch)}
          >
            <PopRoom pop={pop} common={common} storage={storage} command={roomCommand} covered={pop.key !== top?.key || covered} onClose={() => close(pop.key)} open={open} />
          </PopOut>
        ))}
      </div>

      {notice && <p className="under-note" role="status">{notice}</p>}
      {welcome && <Welcome onDone={() => setWelcome(false)} />}
    </main>
  )
}

function PopRoom({ pop, common, storage, command, covered, onClose, open }) {
  const { workspace, commit } = common
  // "Back to the desk" from inside a room closes its pop-out.
  const navigate = (view, detail = null) => (view === 'Today' && !detail ? onClose() : common.navigate(view, detail))
  const room = { ...common, navigate }
  const target = pop.detail ? { ...pop.detail, at: pop.at } : null
  const today = localDateKey()
  switch (pop.view) {
    case 'note': {
      const note = workspace.notes.find((item) => item.id === pop.detail.noteId)
      if (!note) return <p className="pop-gone">This note is no longer here.</p>
      return (
        <FieldSheet
          inline
          note={note}
          onClose={onClose}
          onCommit={(id, patch) => commit((state) => {
            const before = state.notes.find((item) => item.id === id)
            const next = updateNote(state, id, patch)
            return before && patch.title !== undefined && patch.title !== before.title ? relinkRenamedNote(next, before.title, patch.title) : next
          })}
          onOpenNotes={() => open('Notes', { noteId: note.id })}
        />
      )
    }
    case 'Notes': return <NotesView {...room} target={target} today={today} />
    case 'Mindmap': return <BoardView {...room} boardTarget={target} />
    case 'Sky': return <FieldSky {...room} target={typeof pop.detail?.noteId === 'string' ? target : null} />
    case 'Assistant': return <LocalAssistant {...room} initialPrompt={typeof pop.detail?.prompt === 'string' || typeof pop.detail?.chatId === 'string' || pop.detail?.file ? target : null} />
    case 'Files': return <FilesView {...room} target={typeof pop.detail?.rootId === 'string' ? target : null} />
    case 'Browser': return <BrowserView {...room} covered={covered} command={command} frame={`${pop.x},${pop.y},${pop.w},${pop.h}`} />
    case 'Terminal': return <TerminalView command={command} />
    case 'Journal': return <JournalView {...room} />
    case 'Calendar': return <CalendarView {...room} initialDate={pop.detail?.date || null} />
    case 'Habits': return <HabitsView {...room} today={today} />
    case 'Reflection': return <ReflectionView {...room} today={today} />
    case 'Budget': return <BudgetView {...room} />
    case 'Projects': return <ProjectsView {...room} />
    case 'Settings': return <SettingsView {...room} storage={storage} target={pop.detail?.section ? target : null} />
    case 'NowPlaying': return <NowPlayingView {...room} media={window.osatDesk?.nowPlaying ? window.osatDesk : null} />
    default: return null
  }
}

/* A floating window on the desk: drag it by its bar, resize it from the corner. It grows
   out of where it was opened from (`pop.from`) and, closing, shrinks into its widget. */
function PopOut({ pop, z, top, title, onRaise, onClose, onGone, onChange, children }) {
  const node = useRef(null)
  const drag = useRef(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const goneRef = useRef(onGone)
  goneRef.current = onGone

  useLayoutEffect(() => {
    if (pop.from) grow(node.current, pop.from)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pop.closing) return undefined
    const widget = document.querySelector(`[data-widget="${pop.widget}"]`)
    if (!widget) { goneRef.current(); return undefined }
    const shrink = grow(node.current, widget.getBoundingClientRect(), { back: true })
    shrink.finished.then(() => goneRef.current(), () => {})
    return () => shrink.cancel()
  }, [pop.closing, pop.widget])

  // Filling the screen doesn't change the size it goes back to.
  const full = useRef(pop.full)
  full.current = pop.full
  useEffect(() => {
    const element = node.current
    const observer = new ResizeObserver(() => { if (!full.current) changeRef.current({ w: element.offsetWidth, h: element.offsetHeight }) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <section
      ref={node}
      className={`popout ${top ? 'is-top' : ''} ${pop.from ? 'is-grown' : ''} ${pop.closing ? 'is-closing' : ''} ${pop.full ? 'is-full' : ''}`}
      style={pop.full ? { left: 12, top: 12, width: innerWidth - 24, height: innerHeight - 108, zIndex: z } : { left: pop.x, top: pop.y, width: pop.w, height: pop.h, zIndex: z }}
      role="dialog"
      aria-label={title}
      onPointerDownCapture={onRaise}
    >
      <header
        className="popout-bar"
        onDoubleClick={(event) => { if (!event.target.closest('button')) onChange({ full: !pop.full }) }}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.target.closest('button') || pop.full) return
          drag.current = { x: event.clientX, y: event.clientY, px: pop.x, py: pop.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start) return
          onChange({
            x: Math.round(clamp(start.px + event.clientX - start.x, 120 - pop.w, innerWidth - 120)),
            y: Math.round(clamp(start.py + event.clientY - start.y, 0, innerHeight - 60)),
          })
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
      >
        <button type="button" className="popout-close" aria-label={`Close ${title}`} onClick={onClose}><X weight="bold" /></button>
        <strong>{title}</strong>
        <button type="button" className="popout-fill" aria-label={pop.full ? `Put ${title} back` : `Fill the screen with ${title}`} title={pop.full ? 'Back to its size (double-click the bar)' : 'Fill the screen (double-click the bar)'} onClick={() => onChange({ full: !pop.full })}>
          {pop.full ? <ArrowsIn weight="bold" /> : <ArrowsOut weight="bold" />}
        </button>
      </header>
      <div className="popout-body workspace-content is-filled" data-view={pop.view}>{children}</div>
    </section>
  )
}
