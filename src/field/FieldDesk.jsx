import { useEffect, useMemo, useRef, useState } from 'react'
import { Broom, CaretDown, CaretUp, NotePencil, PaintBucket, PushPin, ShareNetwork, SquaresFour, Trash, TreeStructure } from '@phosphor-icons/react'

import { FocusEnvironment } from '../Experience.jsx'
import { cleanError } from '../assistant/useAi.js'
import { localDateKey } from '../daily-practice.js'
import { carryable, useDrop } from '../lib/carry.js'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { clamp } from '../lib/ui.js'
import { PAPERS } from '../note-core.js'
import { excerpt, isActiveNote, restoreNotes, trashNotes, wikilinkPairs } from '../notes-model.js'
import { addFolder, addSticky, moveSticky, moveToItems, splitMentions } from '../nodes-model.js'
import { NameField } from '../sky/Piles.jsx'
import { FileThumb, filesBridge, openEntry, useFolder, useFreshness } from '../views/Files.jsx'
import { GRID, STICKY, StickyLayer, spotOn, useStickySurface } from './DeskStickies.jsx'
import { useReducedMotion } from './FieldChrome.jsx'
import { dayPhase, fitCells, freeSpot, homeItems, paperFields, phaseCopy } from './field-model.js'
import { Line } from './Line.jsx'
import { Widgets } from './Widgets.jsx'
import { openSteps } from './widgets/NextWidget.jsx'

const ICONS_KEY = 'osat.home.icons.v1'
const SHELF_KEY = 'osat.home.shelf'
const SIZE_KEY = 'osat.home.icon-size'
// How tall a row of icons is, for each icon size.
const CELL = { s: 86, m: 103, l: 128 }

const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } }
const keep = (key, value) => { try { localStorage.setItem(key, value) } catch { /* a convenience only */ } }

/* Home is a quiet desktop over the real one (it shows through, blurred): widgets on the
   left (`Widgets`, which `widgets` configures), one line in the middle (`Line`: write it
   down, find it, or ask), the files on your Mac's Desktop (or your nodes and notes) as icons
   on the right, and a dock to the rooms. Stickies lie on the open desk: a sticky saved in
   the line lands there, a double-click writes a new one, and a note on the right can be
   dragged out. A sticky dropped on a node goes into it; held at the top of the screen, it
   goes up to the Sky. Right-click the desk for its menu. Widgets, icons and stickies can be
   picked up and set down anywhere (`places`, per Mac), on a grid. */
export function FieldDesk({
  workspace, commit, navigate,
  storage, focusAt, summon, dock, onOpenNote, visit = 0, places = {}, onPlace, media,
  raised = false, onLine, widgets, offline, onOffline,
}) {
  const home = useRef(null)
  const justMoved = useRef(false)
  const grid = useRef(null)
  const reduced = useReducedMotion()
  const [now, setNow] = useState(() => new Date())
  const [freshId, setFreshId] = useState(null)
  const [arrived] = useState(() => reduced || sessionStorage.getItem('osat.field.arrived') === '1')
  const [capacity, setCapacity] = useState(21)
  const [collapsed, setCollapsed] = useState(() => read(ICONS_KEY, 'open') === 'collapsed')
  const [shelf, setShelf] = useState(() => (read(SHELF_KEY, 'desktop') === 'osat' ? 'osat' : 'desktop'))
  const [iconSize, setIconSize] = useState(() => (['s', 'm', 'l'].includes(read(SIZE_KEY, 'm')) ? read(SIZE_KEY, 'm') : 'm'))
  const [picked, setPicked] = useState(null)
  const [fileNote, setFileNote] = useState('')
  const [draft, setDraft] = useState(null)
  const [nodeDraft, setNodeDraft] = useState(null)
  const onDesktop = Boolean(filesBridge()) && shelf === 'desktop'
  const fresh = useFreshness()
  const desktop = useFolder(onDesktop ? 'desktop' : null, '', fresh + visit)
  const [focusOpen, setFocusOpen] = useState(false)
  const [hoverId, setHoverId] = useState(null)
  const [menu, openMenu] = useContextMenu()
  const [toast, showUndo] = useUndoToast()

  const phase = dayPhase(now)
  const today = localDateKey(now)
  const [greeting] = phaseCopy(phase)
  const notes = workspace.notes.filter(isActiveNote)

  /* The stickies lying on the desk: notes Nate (or the line) set down here. */
  const byId = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const stickies = Object.entries(places)
    .filter(([key]) => key.startsWith('note:'))
    .map(([key, spot]) => ({ note: byId.get(key.slice(5)), spot }))
    .filter(({ note }) => note && note.kind !== 'day')
  const out = new Set(stickies.map(({ note }) => note.id))

  const allItems = homeItems({ notes, folders: workspace.folders }, Infinity, out)
  const placed = (item) => item.kind !== 'note' && Boolean(places[`${item.kind}:${item.id}`])
  const items = fitCells(allItems.filter((item) => !placed(item)), capacity)
  const placedItems = allItems.filter(placed)

  /* Resting on a note lights up the notes it links to, and their folders. */
  const pairs = useMemo(() => wikilinkPairs(notes), [notes])
  const linked = new Set(hoverId ? pairs.flatMap((pair) => (pair.a === hoverId ? [pair.b] : pair.b === hoverId ? [pair.a] : [])) : [])
  const linkedFolders = new Set(notes.filter((note) => linked.has(note.id) && note.folderId).map((note) => note.folderId))

  const surface = useStickySurface({ id: 'desk', surface: home, prefix: 'note', places, onPlace })
  const shelfDrop = useDrop('desk:shelf', {
    accepts: ['note'],
    onDrop: ({ id }) => onPlace(`note:${id}`, null),
  })

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
      const rows = Math.max(1, Math.floor(height / CELL[iconSize]))
      setCapacity(cols * rows)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [collapsed, onDesktop, iconSize])

  function openNote(id) {
    onOpenNote?.(id)
  }

  function openItem(item) {
    if (item.kind === 'note') openNote(item.id)
    // A folder is a node: it opens in the Sky.
    else if (item.kind === 'folder') navigate('Mindmap', { folderId: item.id })
    else if (item.kind === 'pile') navigate('Notes', { list: 'unsorted' })
    else navigate('Notes')
  }

  function pickShelf(value) {
    setShelf(value)
    setPicked(null)
    keep(SHELF_KEY, value)
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

  /* The desk's own rectangle, and what's already on it, for finding a free spot. */
  function deskBoxes() {
    const box = home.current.getBoundingClientRect()
    const taken = [...home.current.querySelectorAll('.home-widgets, .home-icons, .home-composer-wrap, .home-greeting, .dock, .desk-sticky')]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width && rect.height)
    return { box, taken }
  }

  /* A sticky saved in the line lands on the open desk, under the line, clear of the rest. */
  function landOnDesk(noteId) {
    if (!home.current || !onPlace) return
    const { box, taken } = deskBoxes()
    const line = home.current.querySelector('.home-composer-wrap')?.getBoundingClientRect()
    const near = line ? { x: line.left + line.width / 2 - STICKY.w / 2, y: line.bottom + 28 } : { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    const spot = freeSpot(taken, { left: box.left + 12, top: box.top + 12, right: box.right - 12, bottom: box.bottom - 96 }, { width: STICKY.w, height: STICKY.h }, near, GRID * 2)
    onPlace(`note:${noteId}`, spotOn(box, spot.x, spot.y, null))
  }

  function writeSticky(text) {
    const at = draft
    setDraft(null)
    if (!text.trim() || !at) return
    let made
    commit((state) => {
      const result = addSticky(state, text, null, { source: 'Desk' })
      made = result.note
      return result.state
    })
    const box = home.current.getBoundingClientRect()
    if (made) onPlace(`note:${made.id}`, spotOn(box, box.left + at.x, box.top + at.y, null))
  }

  function makeNode(name) {
    const at = nodeDraft
    setNodeDraft(null)
    if (!name || !at) return
    let made
    commit((state) => { const result = addFolder(state, name); made = result.folder; return result.state })
    const box = home.current.getBoundingClientRect()
    if (made) onPlace(`folder:${made.id}`, spotOn(box, box.left + at.x, box.top + at.y, null))
  }

  function toss(note) {
    commit((state) => trashNotes(state, [note.id]))
    showUndo(`Deleted “${note.title.slice(0, 40)}”`, () => commit((state) => restoreNotes(state, [note.id])))
  }

  /* A sticky dropped on a node goes into it (off the desk); on the loose pile, into Unsorted. */
  function fileSticky(noteId, folderId) {
    const before = workspace.notes.find((note) => note.id === noteId)
    const spot = places[`note:${noteId}`]
    commit((state) => moveSticky(state, noteId, folderId))
    if (spot) onPlace(`note:${noteId}`, null)
    const name = folderId ? workspace.folders.find((folder) => folder.id === folderId)?.name : 'Unsorted'
    if (before && name) {
      showUndo(`Moved to ${name}`, () => {
        commit((state) => ({ ...state, notes: state.notes.map((note) => (note.id === noteId ? { ...note, folderId: before.folderId, unsorted: before.unsorted, rank: before.rank, kind: before.kind } : note)) }))
        if (spot) onPlace(`note:${noteId}`, spot)
      })
    }
  }

  /* Clean up: the stickies on the desk set out neatly under the line, in reading order. */
  function cleanUp() {
    const box = home.current.getBoundingClientRect()
    const fixed = [...home.current.querySelectorAll('.home-widgets, .home-icons, .home-composer-wrap, .home-greeting, .dock')]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width && rect.height)
    const line = home.current.querySelector('.home-composer-wrap')?.getBoundingClientRect()
    const area = { left: box.left + 12, top: box.top + 12, right: box.right - 12, bottom: box.bottom - 96 }
    const near = line ? { x: line.left, y: line.bottom + 28 } : { x: area.left, y: area.top }
    const done = []
    ;[...stickies].sort((a, b) => a.spot.y - b.spot.y || a.spot.x - b.spot.x).forEach(({ note, spot }) => {
      const size = { width: spot.w || STICKY.w, height: spot.h || STICKY.h }
      const at = freeSpot([...fixed, ...done], area, size, near, GRID * 2)
      done.push({ left: at.x, top: at.y, right: at.x + size.width, bottom: at.y + size.height })
      onPlace(`note:${note.id}`, spotOn(box, at.x, at.y, spot.w ? { w: spot.w, h: spot.h } : null))
    })
  }

  function deskMenu(event) {
    const box = home.current.getBoundingClientRect()
    const at = { x: event.clientX - box.left, y: event.clientY - box.top }
    openMenu(event, [
      { label: 'New sticky', icon: NotePencil, hint: 'Double-click', onSelect: () => setDraft(at) },
      { label: 'New node', icon: TreeStructure, onSelect: () => setNodeDraft(at) },
      { divider: true },
      stickies.length ? { label: 'Clean up stickies', icon: Broom, onSelect: cleanUp } : null,
      {
        label: 'Icon size', icon: SquaresFour, items: [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([id, label]) => ({
          label, checked: iconSize === id, onSelect: () => { setIconSize(id); keep(SIZE_KEY, id) },
        })),
      },
    ])
  }

  function stickyMenu(event, note) {
    openMenu(event, [
      { label: 'Open as a page', icon: NotePencil, onSelect: () => openNote(note.id) },
      { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: note.color || 'canary', onPick: (paper) => commit((state) => ({ ...state, notes: state.notes.map((item) => (item.id === note.id ? { ...item, color: paper } : item)) })) }] },
      { label: 'Move to', icon: ShareNetwork, items: moveToItems(workspace.folders, (folderId) => fileSticky(note.id, folderId), { skip: note.folderId || null }) },
      { label: 'Send up to the Sky', icon: CaretUp, onSelect: () => onPlace(`note:${note.id}`, null) },
      { divider: true },
      { label: 'Delete', icon: Trash, danger: true, onSelect: () => toss(note) },
    ])
  }

  /* A sticky's @s are links: to the Sky, at that node. */
  const mentions = {
    parts: (text, note) => (text.includes('@') ? splitMentions(text, workspace.folders, note.refs) : [text]),
    open: (folderId) => navigate('Mindmap', { folderId }),
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
      keep(ICONS_KEY, value ? 'open' : 'collapsed')
      return !value
    })
  }

  /* Pick a widget or icon up and set it down anywhere, like a sticky. A press that barely
     moves is still a click. On the grid. */
  function movable(id, spot = places[id]) {
    if (!onPlace) return {}
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
          const { x, y } = spotOn(box, from.left + shift.x, from.top + shift.y, null)
          onPlace(id, { x, y })
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
      <DeskIcon
        key={key}
        item={item}
        fresh={(item.kind === 'note' && item.id === freshId) || (item.kind === 'pile' && item.notes.some((note) => note.id === freshId))}
        lit={linked.has(item.id) || (item.kind === 'folder' && linkedFolders.has(item.id))}
        onOpen={() => openItem(item)}
        onHover={item.kind === 'note' ? (on) => setHoverId((id) => (on ? item.id : id === item.id ? null : id)) : undefined}
        onFile={fileSticky}
        move={item.kind === 'more' || item.kind === 'note' ? {} : movable(key)}
      />
    )
  }

  return (
    <div
      ref={home}
      className={`home is-layer ${arrived ? '' : 'is-arriving'} ${collapsed ? 'icons-collapsed' : ''} ${raised ? 'is-raised' : ''}`}
      data-phase={phase}
      {...surface}
      onDoubleClick={(event) => {
        if (!bareDesk(event.target)) return
        const box = home.current.getBoundingClientRect()
        setDraft({ x: event.clientX - box.left - 24, y: event.clientY - box.top - 20 })
      }}
      onContextMenu={(event) => { if (bareDesk(event.target)) deskMenu(event) }}
    >
      <Widgets
        {...widgets}
        places={places}
        move={movable}
        props={{ workspace, commit, navigate, now, today, notes, media, visit, onOpenNote: openNote }}
      />

      <Line
        workspace={workspace}
        commit={commit}
        navigate={navigate}
        greeting={greeting}
        storage={storage}
        visit={visit}
        summon={summon}
        paused={focusOpen}
        offline={offline}
        onOffline={onOffline}
        raised={raised}
        onLine={onLine}
        onOpenNote={openNote}
        onSaved={(id) => { setFreshId(id); landOnDesk(id) }}
      />

      <nav className="home-icons" aria-label={onDesktop ? 'Your Desktop' : 'OSAT items'} data-size={iconSize}>
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
          <div className="icon-grid" ref={grid} {...(onDesktop ? {} : shelfDrop)} onPointerDown={(event) => { if (event.target === event.currentTarget) setPicked(null) }}>
            {onDesktop
              ? desktop.entries && (desktop.entries.length
                ? fitCells(desktop.entries.map((entry) => ({ kind: 'file', id: entry.relative, entry })), capacity).map(renderFile)
                : <div className="icons-empty"><p>{desktop.error || 'Your Desktop is empty.'}</p></div>)
              : items.map(renderIcon)}
            {!onDesktop && items.length === 0 && placedItems.length === 0 && (
              <div className="icons-empty"><p>Your nodes and notes will appear here.</p></div>
            )}
          </div>
        )}
        {onDesktop && fileNote && <p className="icons-note" role="status">{fileNote}</p>}
        {!onDesktop && placedItems.map(renderIcon)}
      </nav>

      <StickyLayer
        stickies={stickies}
        prefix="note"
        commit={commit}
        onPlace={onPlace}
        onToss={toss}
        onMenu={stickyMenu}
        mentions={mentions}
        draft={draft}
        onDraft={writeSticky}
        fresh={freshId}
      />
      {nodeDraft && (
        <div className="node-draft" style={{ left: nodeDraft.x, top: nodeDraft.y }}>
          <NameField placeholder="Name the node" onDone={makeNode} />
        </div>
      )}

      {dock}

      {focusOpen && (
        <FocusEnvironment
          session={workspace.focus}
          task={openSteps(notes, today).find((step) => !step.done)?.text}
          onChange={(focus) => commit((state) => ({ ...state, focus }))}
          close={() => setFocusOpen(false)}
        />
      )}
      {toast}
      {menu}
    </div>
  )
}

/* Empty desk: nothing there but the desk itself (the space around the icons counts). */
const bareDesk = (target) => !target.closest('button, a, input, textarea, select, .widget, .widgets-tray, .desk-sticky, .node-draft, .dock, .home-composer-wrap, .home-answer, .home-greeting, .icons-head, .icons-note, .context-menu, .focus-environment')

/* One icon on the desk's right side. A note can be carried out onto the desk (it becomes a
   sticky there) or into a node; a node takes stickies dropped on it, and the Unsorted pile
   takes them back. */
function DeskIcon({ item, fresh, lit, onOpen, onHover, onFile, move }) {
  const drop = useDrop(`desk:icon:${item.kind}:${item.id}`, {
    accepts: item.kind === 'folder' || item.kind === 'pile' ? ['note'] : [],
    onDrop: ({ id }) => onFile(id, item.kind === 'folder' ? item.id : null),
  })
  const label = item.kind === 'note' ? item.note.title : item.kind === 'folder' ? item.folder.name : item.kind === 'pile' ? 'Unsorted' : `${item.count} more`
  return (
    <button
      type="button"
      className={`icon is-${item.kind} ${fresh ? 'is-fresh' : ''} ${lit ? 'is-linked' : ''}`}
      aria-label={item.kind === 'note' ? `Open note ${item.note.title}` : item.kind === 'folder' ? `Open node ${item.folder.name}` : item.kind === 'pile' ? `Unsorted, ${item.count} ${item.count === 1 ? 'sticky' : 'stickies'}` : `See ${item.count} more notes`}
      title={item.kind === 'note' ? 'Drag it onto the desk, or into a node' : undefined}
      onClick={onOpen}
      onPointerEnter={onHover ? () => onHover(true) : undefined}
      onPointerLeave={onHover ? () => onHover(false) : undefined}
      {...(item.kind === 'folder' || item.kind === 'pile' ? drop : {})}
      {...move}
      {...(item.kind === 'note' ? carryable({ kind: 'note', id: item.id, data: { from: 'shelf' } }) : {})}
    >
      <IconArt item={item} />
      <span className="icon-label">{label}</span>
    </button>
  )
}

function IconArt({ item }) {
  if (item.kind === 'folder') {
    // A node looks like what it is on Nate's desk: a pile of stickies.
    return (
      <span className="art-node" data-paper={item.folder.color || 'canary'} aria-hidden="true">
        <b>{item.folder.name}</b>
      </span>
    )
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
    <span className={`art-note ${note.pinned ? 'is-pinned' : ''}`} aria-hidden="true">
      {note.pinned && <PushPin weight="fill" />}
      <b>{note.title}</b>
      {lines ? <small>{lines}</small> : <><em /><em /><em /></>}
    </span>
  )
}
