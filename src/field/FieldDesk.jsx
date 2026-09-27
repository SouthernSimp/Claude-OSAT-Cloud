import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, MoonStars, PushPin, ShareNetwork } from '@phosphor-icons/react'

import { FocusEnvironment } from '../Experience.jsx'
import { cleanError } from '../assistant/useAi.js'
import { localDateKey } from '../daily-practice.js'
import { excerpt, isActiveNote, wikilinkPairs } from '../notes-model.js'
import { clamp } from '../lib/ui.js'
import { FileThumb, filesBridge, openEntry, useFolder, useFreshness } from '../views/Files.jsx'
import { useReducedMotion } from './FieldChrome.jsx'
import { dayPhase, fitCells, homeItems, paperFields, phaseCopy } from './field-model.js'
import { Line } from './Line.jsx'
import { DayWidget } from './widgets/DayWidget.jsx'
import { MediaWidget } from './widgets/MediaWidget.jsx'
import { MonthWidget } from './widgets/MonthWidget.jsx'
import { NextWidget, openSteps } from './widgets/NextWidget.jsx'

const ICONS_KEY = 'osat.home.icons.v1'
const SHELF_KEY = 'osat.home.shelf'
const CELL = { h: 103 }

/* The evening invitation shows once a day, and never again that day once opened. */
function readEvening() {
  try { return localStorage.getItem('osat.evening') } catch { return null }
}
function markEvening(date) {
  try { localStorage.setItem('osat.evening', date) } catch { /* a convenience only */ }
}

/* The right side shows your Mac's Desktop, or OSAT's own notes and folders. */
function readShelf() {
  try { return localStorage.getItem(SHELF_KEY) === 'osat' ? 'osat' : 'desktop' } catch { return 'desktop' }
}

function readIconsCollapsed() {
  try {
    return localStorage.getItem(ICONS_KEY) === 'collapsed'
  } catch {
    return false
  }
}

/* Home is a quiet desktop over the real one (it shows through, blurred): small widgets
   on the left, one line in the middle (`Line`: write it down, find it, or ask), the files
   on your Mac's Desktop (or your notes) as icons on the right, and a dock to the rooms.
   It reads and writes the same records the rest of OSAT keeps. Notes open as pop-outs
   (`onOpenNote`); widgets and icons can be picked up and set down anywhere (`places`). */
export function FieldDesk({
  workspace, commit, navigate,
  storage, focusAt, summon, dock, onOpenNote, visit = 0, places = {}, onPlace, media,
  raised = false, onLine,
}) {
  const home = useRef(null)
  const justMoved = useRef(false)
  const grid = useRef(null)
  const reduced = useReducedMotion()
  const [now, setNow] = useState(() => new Date())
  const [freshId, setFreshId] = useState(null)
  const [arrived] = useState(() => reduced || sessionStorage.getItem('osat.field.arrived') === '1')
  const [capacity, setCapacity] = useState(21)
  const [collapsed, setCollapsed] = useState(readIconsCollapsed)
  const [shelf, setShelf] = useState(readShelf)
  const [picked, setPicked] = useState(null)
  const [fileNote, setFileNote] = useState('')
  const onDesktop = Boolean(filesBridge()) && shelf === 'desktop'
  const fresh = useFreshness()
  const desktop = useFolder(onDesktop ? 'desktop' : null, '', fresh + visit)
  const [focusOpen, setFocusOpen] = useState(false)
  const [hoverId, setHoverId] = useState(null)
  const [eveningSeenOn, setEveningSeenOn] = useState(readEvening)

  const phase = dayPhase(now)
  const today = localDateKey(now)
  const [greeting] = phaseCopy(phase)
  const notes = workspace.notes.filter(isActiveNote)
  const allEvents = workspace.calendar.events
  const events = allEvents
    .filter((event) => localDateKey(new Date(event.start)) === today)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const allItems = homeItems({ notes, folders: workspace.folders, boards: workspace.sorter?.boards || [] })
  const placed = (item) => Boolean(places[`${item.kind}:${item.id}`])
  const items = fitCells(allItems.filter((item) => !placed(item)), capacity)
  const placedItems = allItems.filter(placed)

  /* Resting on a note lights up the notes it links to, and their folders. */
  const pairs = useMemo(() => wikilinkPairs(notes), [notes])
  const linked = new Set(hoverId ? pairs.flatMap((pair) => (pair.a === hoverId ? [pair.b] : pair.b === hoverId ? [pair.a] : [])) : [])
  const linkedFolders = new Set(notes.filter((note) => linked.has(note.id) && note.folderId).map((note) => note.folderId))

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!arrived) sessionStorage.setItem('osat.field.arrived', '1')
  }, [arrived])

  useEffect(() => {
    if (focusAt) setFocusOpen(true)
  }, [focusAt])

  // ⌘K during Focus puts its screen away (the session keeps running) and lands in the line.
  useEffect(() => {
    if (summon) setFocusOpen(false)
  }, [summon])

  /* The icon grid shows as many cells as fit; it never scrolls. */
  useEffect(() => {
    const node = grid.current
    if (!node) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const { height } = entry.contentRect
      const cols = Math.max(1, getComputedStyle(node).gridTemplateColumns.split(' ').length)
      const rows = Math.max(1, Math.floor(height / CELL.h))
      setCapacity(cols * rows)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [collapsed, onDesktop])

  function openNote(id) {
    onOpenNote?.(id)
  }

  function openItem(item, event) {
    if (item.kind === 'note') openNote(item.id)
    else if (item.kind === 'folder') navigate('Notes', { folderId: item.id })
    else if (item.kind === 'board') navigate('Mindmap', { boardId: item.id })
    else if (item.kind === 'pile') navigate('Notes', { list: 'unsorted' })
    else navigate('Notes')
  }

  function pickShelf(value) {
    setShelf(value)
    setPicked(null)
    try { localStorage.setItem(SHELF_KEY, value) } catch { /* a convenience only */ }
  }

  /* Desktop icons behave like the Mac's: click to pick, double-click or Return to
     open, Space for Quick Look. A folder opens in Files. */
  async function openFile(entry) {
    setFileNote('')
    if (entry.kind === 'folder') {
      navigate('Files', { rootId: 'desktop', relative: entry.relative })
      return
    }
    try {
      if (await openEntry('desktop', entry) === 'shown') setFileNote('Shown in Finder: OSAT opens documents, pictures and media itself.')
    } catch (reason) {
      setFileNote(cleanError(reason))
    }
  }

  function renderFile(item) {
    if (item.kind === 'more') {
      return (
        <button key="more" type="button" className="icon is-more" aria-label={`See ${item.count} more on the Desktop`} onClick={() => navigate('Files', { rootId: 'desktop' })}>
          <IconArt item={item} />
          <span className="icon-label">{item.count} more</span>
        </button>
      )
    }
    const { entry } = item
    return (
      <button
        key={entry.relative}
        type="button"
        className={`icon is-file ${picked === entry.relative ? 'is-picked' : ''}`}
        aria-label={`${entry.name}${entry.kind === 'folder' ? ', folder' : ''}`}
        aria-pressed={picked === entry.relative}
        title={entry.name}
        onClick={() => setPicked(entry.relative)}
        onDoubleClick={() => openFile(entry)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); openFile(entry) }
          if (event.key === ' ' && entry.kind === 'file') { event.preventDefault(); filesBridge()?.quickLook('desktop', entry.relative).catch(() => {}) }
        }}
      >
        <FileThumb rootId="desktop" entry={entry} className="art-file" />
        <span className="icon-label">{entry.name}</span>
      </button>
    )
  }

  function toggleIcons() {
    setCollapsed((value) => {
      try { localStorage.setItem(ICONS_KEY, value ? 'open' : 'collapsed') } catch { /* a convenience only */ }
      return !value
    })
  }

  /* Pick a widget or icon up and set it down anywhere, like a sticky. A press
     that barely moves is still a click. */
  function movable(id) {
    if (!onPlace) return {}
    const spot = places[id]
    return {
      'data-placed': spot ? '' : undefined,
      style: spot ? { position: 'absolute', left: `${spot.x * 100}%`, top: `${spot.y * 100}%` } : undefined,
      onClickCapture: (event) => {
        if (!justMoved.current) return
        event.preventDefault()
        event.stopPropagation()
      },
      onPointerDown: (event) => {
        if (event.button !== 0 || event.target.closest('textarea, input')) return
        const element = event.currentTarget
        const box = home.current.getBoundingClientRect()
        const from = element.getBoundingClientRect()
        const start = { x: event.clientX, y: event.clientY }
        let shift = null
        const move = (next) => {
          const dx = next.clientX - start.x
          const dy = next.clientY - start.y
          if (!shift && Math.hypot(dx, dy) < 5) return
          shift = { x: clamp(dx, box.left - from.left, box.right - from.right), y: clamp(dy, box.top - from.top, box.bottom - from.bottom) }
          element.classList.add('is-moving')
          element.style.translate = `${shift.x}px ${shift.y}px`
        }
        const end = (last) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('pointercancel', end)
          element.classList.remove('is-moving')
          element.style.translate = ''
          if (!shift || last.type === 'pointercancel') return
          justMoved.current = true
          window.setTimeout(() => { justMoved.current = false })
          onPlace(id, { x: (from.left + shift.x - box.left) / box.width, y: (from.top + shift.y - box.top) / box.height })
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        window.addEventListener('pointercancel', end)
      },
    }
  }

  function renderIcon(item) {
    const key = `${item.kind}:${item.id}`
    return (
      <button
        key={key}
        type="button"
        className={`icon is-${item.kind} ${(item.kind === 'note' && item.id === freshId) || (item.kind === 'pile' && item.notes.some((note) => note.id === freshId)) ? 'is-fresh' : ''} ${linked.has(item.id) || (item.kind === 'folder' && linkedFolders.has(item.id)) ? 'is-linked' : ''}`}
        aria-label={item.kind === 'note' ? `Open note ${item.note.title}` : item.kind === 'folder' ? `Open folder ${item.folder.name}` : item.kind === 'board' ? 'Open the Map' : item.kind === 'pile' ? `${item.count} loose thoughts. Open Unsorted` : `See ${item.count} more notes`}
        onClick={(event) => openItem(item, event)}
        onPointerEnter={item.kind === 'note' ? () => setHoverId(item.id) : undefined}
        onPointerLeave={item.kind === 'note' ? () => setHoverId((id) => (id === item.id ? null : id)) : undefined}
        {...(item.kind === 'more' ? {} : movable(key))}
      >
        <IconArt item={item} />
        <span className="icon-label">{item.kind === 'note' ? item.note.title : item.kind === 'folder' ? item.folder.name : item.kind === 'board' ? 'Map' : item.kind === 'pile' ? `${item.count} loose thoughts` : `${item.count} more`}</span>
      </button>
    )
  }

  return (
    <div ref={home} className={`home is-layer ${arrived ? '' : 'is-arriving'} ${collapsed ? 'icons-collapsed' : ''} ${raised ? 'is-raised' : ''}`} data-phase={phase}>
      <aside className="home-widgets" aria-label="Today at a glance">
        <DayWidget now={now} events={events} onOpen={() => navigate('Calendar', { date: today })} move={movable('widget:day')} />
        <MonthWidget now={now} today={today} events={allEvents} onOpen={() => navigate('Calendar', { date: today })} move={movable('widget:month')} />
        <NextWidget notes={notes} today={today} commit={commit} navigate={navigate} onOpen={openNote} move={movable('widget:next')} />
        {media && <MediaWidget media={media} visit={visit} move={movable('widget:media')} />}
      </aside>

      <Line
        workspace={workspace}
        commit={commit}
        navigate={navigate}
        greeting={greeting}
        storage={storage}
        visit={visit}
        summon={summon}
        paused={focusOpen}
        raised={raised}
        onLine={onLine}
        onOpenNote={openNote}
        onSaved={setFreshId}
        foot={(phase === 'evening' || phase === 'night') && eveningSeenOn !== today && (
          <button type="button" className="glass evening-pill" onClick={() => { markEvening(today); setEveningSeenOn(today); navigate('Reflection') }}>
            <MoonStars weight="fill" /> Close the day <span>three quiet questions</span>
          </button>
        )}
      />

      <nav className="home-icons" aria-label={onDesktop ? 'Your Desktop' : 'OSAT items'}>
        <div className="icons-head">
          {filesBridge() && !collapsed && (
            <div className="icons-switch" role="radiogroup" aria-label="What the desk shows">
              <button type="button" role="radio" aria-checked={onDesktop} onClick={() => pickShelf('desktop')}>Desktop</button>
              <button type="button" role="radio" aria-checked={!onDesktop} onClick={() => pickShelf('osat')}>OSAT</button>
            </div>
          )}
          <button type="button" className="icons-toggle" aria-expanded={!collapsed} aria-label={collapsed ? 'Show the icons' : 'Hide the icons'} onClick={toggleIcons}>
            <CaretDown weight="bold" />
          </button>
        </div>
        {!collapsed && (
          <div className="icon-grid" ref={grid} onPointerDown={(event) => { if (event.target === event.currentTarget) setPicked(null) }}>
            {onDesktop
              ? desktop.entries && (desktop.entries.length
                ? fitCells(desktop.entries.map((entry) => ({ kind: 'file', id: entry.relative, entry })), capacity).map(renderFile)
                : <div className="icons-empty"><p>{desktop.error || 'Your Desktop is empty.'}</p></div>)
              : items.map(renderIcon)}
            {!onDesktop && items.every((item) => item.kind === 'board') && (
              <div className="icons-empty"><p>Your notes will appear here.</p></div>
            )}
          </div>
        )}
        {onDesktop && fileNote && <p className="icons-note" role="status">{fileNote}</p>}
        {!onDesktop && placedItems.map(renderIcon)}
      </nav>

      {dock}

      {focusOpen && (
        <FocusEnvironment
          session={workspace.focus}
          task={openSteps(notes, today).find((step) => !step.done)?.text}
          onChange={(focus) => commit((state) => ({ ...state, focus }))}
          close={() => setFocusOpen(false)}
        />
      )}
    </div>
  )
}

function IconArt({ item }) {
  if (item.kind === 'folder') {
    return (
      <svg className="art-folder" viewBox="0 0 56 46" aria-hidden="true">
        <path d="M4 9.5A4.5 4.5 0 0 1 8.5 5h12.2c1.2 0 2.3.5 3.2 1.3L27.6 10H48a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor" opacity=".7" />
        <path d="M4 16.5a4 4 0 0 1 4-4h40a4 4 0 0 1 4 4V38a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor" />
        <path d="M8 13.4h40" stroke="#fff" strokeOpacity=".5" strokeWidth="1" />
      </svg>
    )
  }
  if (item.kind === 'board') {
    return <span className="art-board" aria-hidden="true"><ShareNetwork weight="bold" /></span>
  }
  if (item.kind === 'more') return <span className="art-more" aria-hidden="true">+{item.count}</span>
  if (item.kind === 'pile') {
    return (
      <span className="art-pile" aria-hidden="true">
        {item.notes.slice(0, 3).reverse().map((note, index) => (
          <span key={note.id} className="art-note" style={{ '--i': index }}><b>{note.title}</b><em /><em /></span>
        ))}
      </span>
    )
  }
  const { note } = item
  const lines = excerpt(paperFields(note).body, 70)
  return (
    <span className={`art-note ${note.pinned ? 'is-pinned' : ''}`} data-paper={note.id} aria-hidden="true">
      {note.pinned && <PushPin weight="fill" />}
      <b>{note.title}</b>
      {lines ? <small>{lines}</small> : <><em /><em /><em /></>}
    </span>
  )
}
