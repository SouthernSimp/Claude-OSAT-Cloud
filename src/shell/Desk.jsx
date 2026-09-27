import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, AppWindow, Database, MoonStars, Plus, ShareNetwork, X } from '@phosphor-icons/react'

import { LocalAssistant } from '../assistant/LocalAssistant.jsx'
import { BoardView } from '../board/BoardView.jsx'
import { localDateKey } from '../daily-practice.js'
import { FieldDesk } from '../field/FieldDesk.jsx'
import { FieldSheet } from '../field/FieldSheet.jsx'
import { FieldSky } from '../field/FieldSky.jsx'
import { clamp, inputActive } from '../lib/ui.js'
import { useFocusTrap } from '../lib/use-focus-trap.js'
import { SETTINGS, spaceForKey, titleFor } from '../lib/spaces.js'
import { NotesView } from '../notes/NotesView.jsx'
import { captureThought, relinkRenamedNote, updateNote } from '../notes-model.js'
import { storageFrom, useWorkspace } from '../store/useWorkspace.js'
import { BrowserView } from '../tools/Browser.jsx'
import { TerminalView } from '../tools/Terminal.jsx'
import { BudgetView } from '../views/Budget.jsx'
import { CalendarView } from '../views/Calendar.jsx'
import { CommandPalette } from '../views/CommandPalette.jsx'
import { FilesView } from '../views/Files.jsx'
import { HabitsView } from '../views/Habits.jsx'
import { InboxView } from '../views/Inbox.jsx'
import { JournalView } from '../views/Journal.jsx'
import { ProjectsView } from '../views/Projects.jsx'
import { ReflectionView } from '../views/Reflection.jsx'
import { SettingsView } from '../views/Settings.jsx'
import { GlassDefs, useAlive } from './glass.jsx'
import { covers, placeRoom } from './placement.js'
import { Dock } from './Shell.jsx'
import { Welcome } from './Welcome.jsx'

/* The desk: OSAT's one window, laid over the real desktop (see-through, blurred),
   with every room opening as a pop-out you can drag, resize and stack. ⌥Space brings
   it up and puts it away; Esc closes the top pop-out, then puts the desk away. */

const ROOMS = {
  Notes: [1100, 720],
  Mindmap: [1120, 740],
  Sky: [1120, 740],
  Assistant: [780, 720],
  Files: [1080, 700],
  Journal: [980, 780],
  Calendar: [1040, 720],
  Habits: [900, 680],
  Reflection: [820, 680],
  Budget: [980, 720],
  Projects: [980, 720],
  Inbox: [900, 700],
  Browser: [1120, 760],
  Terminal: [860, 540],
  Settings: [980, 760],
  note: [600, 640],
}

export function Desk() {
  const { workspace, status, commit, ready } = useWorkspace()
  const hydrated = Boolean(ready && workspace)
  const storage = storageFrom(status, hydrated)
  const bridge = window.osatDesk
  const [pops, setPops] = useState([])
  const [palette, setPalette] = useState(null)
  const [visit, setVisit] = useState(0)
  const [prefs, setPrefs] = useState({ launchers: [], places: {} })
  const [captureOpen, setCaptureOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [welcome, setWelcome] = useState(false)
  const [focusAt, setFocusAt] = useState(0)
  const [roomCommand, setRoomCommand] = useState(null)
  const [line, setLine] = useState(null)
  const modalRef = useRef(null)
  const closeCapture = useCallback(() => setCaptureOpen(false), [])
  useFocusTrap(modalRef, captureOpen, closeCapture)
  useAlive()

  /* Blur at zero means a clear desk: the Mac's frosting comes off entirely. */
  const clear = workspace?.settings?.blur === 0
  useEffect(() => {
    bridge?.setClear?.(clear)
  }, [bridge, clear])

  /* The first launch on this Mac starts with the welcome. */
  useEffect(() => {
    window.osatApp?.needsWelcome?.().then((need) => setWelcome(need === true)).catch(() => {})
  }, [])

  useEffect(() => {
    bridge?.prefs().then(setPrefs).catch(() => {})
    return bridge?.onShown(() => {
      setVisit((value) => value + 1)
      bridge.prefs().then(setPrefs).catch(() => {})
    })
  }, [bridge])

  /* The Mac menu bar, the Dock menu and the menu-bar icon send commands here. */
  const latest = useRef(null)
  useEffect(() => window.osatApp?.onCommand?.((detail) => {
    if (!detail || typeof detail !== 'object') return
    if (detail.action === 'search') { setPalette(''); return }
    if (typeof detail.view === 'string') latest.current?.navigate(detail.view, detail.detail || null)
    if (typeof detail.action === 'string') setRoomCommand({ action: detail.action, at: Date.now() })
  }), [])

  /* ⌘K finds anything, ⌘1–5 and ⌘, open rooms, ⇧⌘N a new thought. Esc backs out one
     step: out of a field in a pop-out, then the top pop-out, then the desk goes away. */
  useEffect(() => {
    const onKey = (event) => {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && key === 'k') {
        event.preventDefault()
        setPalette((value) => (value === null ? '' : null))
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
        setCaptureOpen(true)
        return
      }
      if (event.key !== 'Escape' || event.defaultPrevented || document.documentElement.dataset.menu === 'open') return
      const { pops: open, palette: finding, captureOpen: capturing, welcome: welcoming } = latest.current
      if (capturing || welcoming) return
      const active = document.activeElement
      event.preventDefault()
      if (finding !== null) setPalette(null)
      else if (open.length) {
        if (active?.closest?.('.popout') && active.closest('.xterm, .browser-view')) return
        if (active?.closest?.('.popout') && inputActive()) { active.blur(); return }
        close(open.at(-1).key)
      } else hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function hide() {
    bridge?.hide()
  }

  function open(view, detail = null) {
    const key = view === 'note' ? `note:${detail.noteId}` : view
    setPalette(null)
    setPops((list) => {
      const existing = list.find((pop) => pop.key === key)
      if (existing) return [...list.filter((pop) => pop !== existing), { ...existing, detail, at: Date.now() }]
      const spot = placeRoom({ width: innerWidth, height: innerHeight }, ROOMS[view], latest.current.line, list)
      return [...list, { key, view, detail, at: Date.now(), ...spot }]
    })
  }

  function close(key) {
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

  /* The map as a board or as a sky: the same pop-out, seen another way. */
  function swap(key, view) {
    setPops((list) => (list.some((pop) => pop.key === view)
      ? [...list.filter((pop) => pop.key !== key && pop.key !== view), { ...list.find((pop) => pop.key === view), at: Date.now() }]
      : list.map((pop) => (pop.key === key ? { ...pop, key: view, view, detail: null, at: Date.now() } : pop))))
  }

  function navigate(view, detail = null) {
    setPalette(null)
    if (view === 'Capture') setCaptureOpen(true)
    // The Obsidian export lives in Settings → Data.
    else if (view === 'Obsidian') open('Settings', { section: 'data' })
    else if ((view === 'Notes' || view === 'Today') && typeof detail === 'string') open('note', { noteId: detail })
    else if ((view === 'Notes' || view === 'Today') && typeof detail?.noteId === 'string') open('note', { noteId: detail.noteId })
    else if (view === 'Today') setVisit((value) => value + 1)
    else if (ROOMS[view]) open(view, detail)
  }
  latest.current = { navigate, pops, palette, captureOpen, welcome, line }

  async function launcher(action, ...args) {
    try {
      const result = await bridge?.[action](...args)
      if (Array.isArray(result)) setPrefs((value) => ({ ...value, launchers: result }))
    } catch {
      // The app may have moved; the dock simply stays as it was.
    }
  }

  /* Set down right away; the Mac app keeps the spot for next time. */
  function place(id, spot) {
    setPrefs((value) => ({ ...value, places: { ...value.places, [id]: spot } }))
    bridge?.place(id, spot).then((places) => setPrefs((value) => ({ ...value, places }))).catch(() => {})
  }

  function tidy() {
    setPrefs((value) => ({ ...value, places: {} }))
    bridge?.tidy().catch(() => {})
  }

  function saveCapture(event) {
    event.preventDefault()
    const title = draft.trim()
    if (!title) return
    let saved
    commit((current) => { const result = captureThought(current, title, 'Private note'); saved = result.note; return result.state })
    setDraft('')
    setCaptureOpen(false)
    if (saved) open('note', { noteId: saved.id })
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
  const top = pops.at(-1)
  const covered = palette !== null || captureOpen || welcome
  const hasPlaces = Object.keys(prefs.places || {}).length > 0

  return (
    <main className={`overlay-surface ${bridge ? '' : 'is-preview'}`}>
      <GlassDefs />
      <div className="workspace-content is-filled" inert={captureOpen || welcome || undefined}>
        <FieldDesk
          {...common}
          visit={visit}
          storage={storage}
          focusAt={focusAt}
          onSearch={(query) => setPalette(query)}
          onOpenNote={(noteId) => open('note', { noteId })}
          places={prefs.places || {}}
          onPlace={place}
          media={bridge?.nowPlaying ? bridge : null}
          raised={pops.some((pop) => covers(pop, line))}
          onLine={setLine}
          dock={(
            <Dock
              view={top?.view === 'note' ? 'Notes' : top?.view || 'Today'}
              navigate={navigate}
              storage={storage}
              workspace={workspace}
              commit={commit}
              onCapture={() => setCaptureOpen(true)}
              onFocus={() => setFocusAt(Date.now())}
              extra={hasPlaces ? [{ label: 'Put widgets and icons back', icon: ArrowCounterClockwise, onSelect: tidy }] : []}
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

      <div className="popouts" inert={captureOpen || welcome || undefined}>
        {pops.map((pop, index) => (
          <PopOut
            key={pop.key}
            pop={pop}
            z={index + 1}
            top={pop.key === top.key}
            title={pop.view === 'note' ? workspace.notes.find((note) => note.id === pop.detail.noteId)?.title || 'Note' : titleFor(pop.view)}
            onRaise={() => raise(pop.key)}
            onClose={() => close(pop.key)}
            onChange={(patch) => change(pop.key, patch)}
            onMode={(view) => swap(pop.key, view)}
          >
            <PopRoom pop={pop} common={common} storage={storage} command={roomCommand} covered={pop.key !== top.key || covered} onClose={() => close(pop.key)} open={open} />
          </PopOut>
        ))}
      </div>

      {palette !== null && <CommandPalette workspace={workspace} navigate={navigate} close={() => setPalette(null)} initialQuery={palette} />}

      {captureOpen && (
        <div className="modal-backdrop" onPointerDown={closeCapture}>
          <form ref={modalRef} className="capture-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-title" onSubmit={saveCapture} onPointerDown={(event) => event.stopPropagation()}>
            <button className="icon-button modal-close" type="button" aria-label="Close capture" onClick={closeCapture}><X /></button>
            <p className="eyebrow">MAKE A LITTLE ROOM</p>
            <h2 id="capture-title">Let it land here.</h2>
            <p>A thought, a loose end, a possibility. No need to organize it yet.</p>
            <textarea data-autofocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type the thought exactly as it is..." rows="7" />
            <div className="dialog-actions">
              <span>It waits in Unsorted until you give it a home.</span>
              <button className="primary-button" disabled={!draft.trim()}><Plus /> Capture</button>
            </div>
          </form>
        </div>
      )}
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
    case 'Inbox': return <InboxView {...room} />
    case 'Settings': return <SettingsView {...room} storage={storage} target={pop.detail?.section ? target : null} />
    default: return null
  }
}

/* A floating glass window on the desk: drag it by its bar, resize it from the corner. */
function PopOut({ pop, z, top, title, onRaise, onClose, onChange, onMode, children }) {
  const map = pop.view === 'Mindmap' || pop.view === 'Sky'
  const node = useRef(null)
  const drag = useRef(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    const element = node.current
    const observer = new ResizeObserver(() => changeRef.current({ w: element.offsetWidth, h: element.offsetHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <section
      ref={node}
      className={`popout ${top ? 'is-top' : ''}`}
      style={{ left: pop.x, top: pop.y, width: pop.w, height: pop.h, zIndex: z }}
      role="dialog"
      aria-label={title}
      onPointerDownCapture={onRaise}
    >
      <header
        className="popout-bar"
        onPointerDown={(event) => {
          if (event.button !== 0 || event.target.closest('button')) return
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
        {map && (
          <div className="segmented popout-modes" role="radiogroup" aria-label="How to see the map">
            <button type="button" role="radio" aria-checked={pop.view === 'Mindmap'} onClick={() => onMode('Mindmap')}><ShareNetwork weight={pop.view === 'Mindmap' ? 'fill' : 'regular'} />Board</button>
            <button type="button" role="radio" aria-checked={pop.view === 'Sky'} onClick={() => onMode('Sky')}><MoonStars weight={pop.view === 'Sky' ? 'fill' : 'regular'} />Sky</button>
          </div>
        )}
      </header>
      <div className="popout-body workspace-content is-filled" data-view={pop.view}>{children}</div>
    </section>
  )
}
