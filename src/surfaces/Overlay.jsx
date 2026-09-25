import { useEffect, useRef, useState } from 'react'
import {
  AppWindow, ArrowCounterClockwise, ArrowSquareOut, BookOpenText, CalendarBlank, GearSix, Globe, MagnifyingGlass, NotePencil, Plus,
  ShareNetwork, Sparkle, TerminalWindow, Toolbox, X,
} from '@phosphor-icons/react'

import { LocalAssistant } from '../assistant/LocalAssistant.jsx'
import { BoardView } from '../board/BoardView.jsx'
import { localDateKey } from '../daily-practice.js'
import { FieldDesk } from '../field/FieldDesk.jsx'
import { FieldSheet } from '../field/FieldSheet.jsx'
import { Menu } from '../lib/Menu.jsx'
import { clamp } from '../lib/ui.js'
import { NotesView } from '../notes/NotesView.jsx'
import { relinkRenamedNote, updateNote } from '../notes-model.js'
import { storageFrom, useWorkspace } from '../store/useWorkspace.js'
import { BrowserView } from '../tools/Browser.jsx'
import { TerminalView } from '../tools/Terminal.jsx'
import { CalendarView } from '../views/Calendar.jsx'
import { CommandPalette } from '../views/CommandPalette.jsx'
import { JournalView } from '../views/Journal.jsx'

/* The ⌥Space layer: the home desk laid over the real desktop, with rooms that
   open as floating pop-outs on top of it. Anything that isn't a pop-out opens
   in the main OSAT window. Nothing here talks to the network. */

const ROOMS = {
  Notes: { title: 'Notes', size: [1100, 720] },
  Mindmap: { title: 'Mindmap', size: [1120, 740] },
  Assistant: { title: 'Ask', size: [780, 720] },
  Browser: { title: 'Browser', size: [1120, 760] },
  Terminal: { title: 'Terminal', size: [860, 540] },
  Journal: { title: 'Today', size: [980, 780] },
  Calendar: { title: 'Calendar', size: [1040, 720] },
  note: { title: 'Note', size: [600, 640] },
}

export function OverlaySurface() {
  const { workspace, status, commit, ready } = useWorkspace()
  const bridge = window.osatOverlay
  const [pops, setPops] = useState([])
  const [palette, setPalette] = useState(null)
  const [visit, setVisit] = useState(0)
  const [prefs, setPrefs] = useState({ launchers: [], places: {} })
  const latest = useRef({ pops, palette })
  latest.current = { pops, palette }

  useEffect(() => {
    bridge?.prefs().then(setPrefs).catch(() => {})
    return bridge?.onShown(() => {
      setVisit((value) => value + 1)
      bridge.prefs().then(setPrefs).catch(() => {})
    })
  }, [bridge])

  /* Esc closes the top pop-out, then puts the layer away. ⌘K finds anything. */
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette((value) => (value === null ? '' : null))
        return
      }
      if (event.key !== 'Escape' || event.defaultPrevented || document.documentElement.dataset.menu === 'open') return
      const { pops: open, palette: finding } = latest.current
      event.preventDefault()
      if (finding !== null) setPalette(null)
      else if (open.length) close(open.at(-1).key)
      else hide()
    }
    window.addEventListener('keydown', onKey)
    // On the Mac, Esc arrives from the main process (the panel keeps it from the page).
    const stop = bridge?.onEscape(() => {
      const target = document.activeElement || document.body
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      stop?.()
    }
  }, [])

  function hide() {
    if (bridge) bridge.hide()
  }

  function open(view, detail = null) {
    const key = view === 'note' ? `note:${detail.noteId}` : view
    setPops((list) => {
      const existing = list.find((pop) => pop.key === key)
      if (existing) return [...list.filter((pop) => pop !== existing), { ...existing, detail, at: Date.now() }]
      const [w, h] = ROOMS[view].size
      const width = Math.min(w, innerWidth - 80)
      const height = Math.min(h, innerHeight - 160)
      const step = list.length * 28
      return [...list, {
        key, view, detail, at: Date.now(), w: width, h: height,
        x: clamp((innerWidth - width) / 2 + step, 20, innerWidth - width - 20),
        y: clamp((innerHeight - height) / 2 - 30 + step, 20, innerHeight - height - 90),
      }]
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

  /* Rooms the layer can hold open as pop-outs; everything else goes to the window. */
  function navigate(view, detail = null) {
    setPalette(null)
    if (view === 'Notes' && detail?.noteId) open('note', { noteId: detail.noteId })
    else if (view === 'Today') open('Journal')
    else if (ROOMS[view]) open(view, detail)
    else openInWindow(view, detail)
  }

  function openInWindow(view, detail = null) {
    if (bridge) bridge.openInWindow(view, detail)
    else window.location.href = window.location.pathname
  }

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

  if (!ready || !workspace) return <main className="overlay-surface" />

  const storage = storageFrom(status, true)
  const common = { workspace, commit, navigate }
  const top = pops.at(-1)?.key

  return (
    <main className={`overlay-surface ${bridge ? '' : 'is-preview'}`}>
      <div className="workspace-content is-filled">
        <FieldDesk
          {...common}
          layer
          visit={visit}
          storage={storage}
          onSearch={(query) => setPalette(query)}
          onOpenNote={(noteId) => open('note', { noteId })}
          places={prefs.places || {}}
          onPlace={place}
          media={bridge?.nowPlaying ? bridge : null}
          dock={<OverlayDock navigate={navigate} openInWindow={openInWindow} launchers={prefs.launchers} launcher={launcher} canLaunch={Boolean(bridge)} storage={storage} onFind={() => setPalette('')} onTidy={Object.keys(prefs.places || {}).length ? tidy : null} />}
        />
      </div>

      <div className="popouts">
        {pops.map((pop, index) => (
          <PopOut
            key={pop.key}
            pop={pop}
            z={index + 1}
            top={pop.key === top}
            title={pop.view === 'note' ? workspace.notes.find((note) => note.id === pop.detail.noteId)?.title || 'Note' : ROOMS[pop.view].title}
            onRaise={() => raise(pop.key)}
            onClose={() => close(pop.key)}
            onChange={(patch) => change(pop.key, patch)}
            onWindow={() => {
              close(pop.key)
              openInWindow(pop.view === 'note' ? 'Notes' : pop.view, pop.detail)
            }}
          >
            <PopRoom pop={pop} common={common} covered={pop.key !== top || palette !== null} onClose={() => close(pop.key)} open={open} />
          </PopOut>
        ))}
      </div>

      {palette !== null && <CommandPalette workspace={workspace} navigate={navigate} close={() => setPalette(null)} initialQuery={palette} />}
    </main>
  )
}

function PopRoom({ pop, common, covered, onClose, open }) {
  const { workspace, commit } = common
  const target = pop.detail ? { ...pop.detail, at: pop.at } : null
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
    case 'Notes': return <NotesView {...common} target={target} today={localDateKey()} />
    case 'Mindmap': return <BoardView {...common} boardTarget={target} />
    case 'Assistant': return <LocalAssistant {...common} initialPrompt={typeof pop.detail?.prompt === 'string' ? { prompt: pop.detail.prompt, at: pop.at } : null} />
    case 'Browser': return <BrowserView {...common} covered={covered} frame={`${pop.x},${pop.y}`} />
    case 'Terminal': return <TerminalView />
    case 'Journal': return <JournalView {...common} />
    case 'Calendar': return <CalendarView {...common} initialDate={pop.detail?.date || null} />
    default: return null
  }
}

/* A floating glass window on the layer: drag it by its bar, resize it from the corner. */
function PopOut({ pop, z, top, title, onRaise, onClose, onChange, onWindow, children }) {
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
      className={`glass popout ${top ? 'is-top' : ''}`}
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
        <button type="button" className="popout-window" onClick={onWindow}><ArrowSquareOut /> Open in window</button>
      </header>
      <div className="popout-body workspace-content is-filled" data-view={pop.view}>{children}</div>
    </section>
  )
}

function OverlayDock({ navigate, openInWindow, launchers, launcher, canLaunch, storage, onFind, onTidy }) {
  const room = (view, label, Icon, tip = label) => (
    <button key={view} type="button" aria-label={label} data-tip={tip} onClick={() => navigate(view)}><Icon /></button>
  )
  return (
    <nav className="glass dock" aria-label="OSAT dock">
      <div className="dock-group">
        {room('Notes', 'Notes', NotePencil)}
        {room('Mindmap', 'Map', ShareNetwork)}
        {room('Today', 'Today', BookOpenText)}
        {room('Assistant', 'Ask', Sparkle)}
        <Menu
          align="start"
          className="dock-more"
          ariaLabel="Tools"
          items={[
            { label: 'Browser', icon: Globe, onSelect: () => navigate('Browser') },
            { label: 'Terminal', icon: TerminalWindow, onSelect: () => navigate('Terminal') },
            { label: 'Calendar', icon: CalendarBlank, onSelect: () => navigate('Calendar') },
            { divider: true },
            { label: 'Open the OSAT window', icon: AppWindow, onSelect: () => openInWindow('Today') },
            { label: 'Settings', icon: GearSix, onSelect: () => openInWindow('Settings') },
            ...(onTidy ? [{ label: 'Put widgets and icons back', icon: ArrowCounterClockwise, onSelect: onTidy }] : []),
            ...(launchers.length ? [{ divider: true }, ...launchers.map((item) => ({ label: `Remove ${item.name} from the dock`, icon: X, onSelect: () => launcher('removeLauncher', item.path) }))] : []),
          ]}
          trigger={({ toggle, open }) => (
            <button type="button" aria-label="Tools" data-tip="Tools" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><Toolbox /></button>
          )}
        />
      </div>
      {canLaunch && (
        <>
          <i className="dock-rule" />
          <div className="dock-group dock-apps">
            {launchers.map((item) => (
              <button key={item.path} type="button" className="launcher" aria-label={`Open ${item.name}`} data-tip={item.name} onClick={() => launcher('launch', item.path)}>
                {item.icon ? <img src={item.icon} alt="" /> : <AppWindow />}
              </button>
            ))}
            <button type="button" aria-label="Add an app to the dock" data-tip="Add an app" onClick={() => launcher('addLauncher')}><Plus /></button>
          </div>
        </>
      )}
      <i className="dock-rule" />
      <div className="dock-group">
        <button type="button" aria-label="Find" data-tip="Find  ⌘K" onClick={onFind}><MagnifyingGlass /></button>
        <span className={`dock-status ${storage?.status || ''}`} role="status" data-tip={storage?.status === 'error' ? 'Check storage' : 'Saved on this Mac'}>
          <i />
          <span className="visually-hidden">{storage?.status === 'error' ? 'Check storage' : 'Saved on this Mac'}</span>
        </span>
      </div>
    </nav>
  )
}
