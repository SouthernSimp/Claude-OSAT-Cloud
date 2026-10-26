import { useEffect, useMemo, useState } from 'react'
import { CaretRight, NotePencil, Plus, Shapes, Star, Trash, WifiHigh, WifiSlash } from '@phosphor-icons/react'

import { clientItem } from '../boards/BoardOverview.jsx'
import { addBoard, boardsOf, isClient, isFavorite, JUST_IN, paperOf, setFavorite, stickiesOn, undoFrom } from '../boards/boards-model.js'
import { placeFrom } from '../boards/just-in.js'
import { addCanvas, canvasesOf, removeCanvas, renameCanvas } from '../canvas/canvas-model.js'
import { useDrop } from '../lib/carry.js'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { GROUPS, SETTINGS, SPACES, spaceFor } from '../lib/spaces.js'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { removeFolder, renameFolder } from '../nodes-model.js'
import { openTodos } from '../today/today-model.js'

const FOLD_KEY = 'osat.side.open.v1'
const STARTER = ['Personal', 'Home', 'Work']
const readOpen = () => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '[]') } catch { return [] } }

/* The sidebar (Phase 73), the way Apple's own apps are built: four tiles (Today, Just in, Calendar, To do), your
   boards, then Work, Life, Library and the power tools (folded until you open them), Settings and Online at the foot.
   `at` is where you are: { view, board }. A sticky dropped on a board moves there; right-click a board to rename or
   delete it (its stickies go back to Just in). Every change has Undo. */
export function Sidebar({ workspace, commit, navigate, at, offline, onOffline, newBoard = 0 }) {
  const [menu, openMenu] = useContextMenu()
  const [toast, showUndo] = useUndoToast()
  const [naming, setNaming] = useState(null)
  const [opened, setOpened] = useState(readOpen)
  const boards = useMemo(() => boardsOf(workspace), [workspace])
  const canvases = canvasesOf(workspace)
  // The canvas open now: the one named, else the one the room opened last.
  const openCanvas = at.detail?.canvasId || (() => { try { return localStorage.getItem('osat.canvas.last.v1') } catch { return null } })() || canvases[0]?.id
  // "New board" from ⌘K: the name is written right here.
  useEffect(() => { if (newBoard) setNaming({}) }, [newBoard])
  const counts = useMemo(() => ({
    JustIn: stickiesOn(workspace, JUST_IN).length || '',
    Calendar: new Date().getDate(),
    Todo: openTodos(workspace).length || '',
  }), [workspace])

  function change(line, updater) {
    let before = null
    let next = null
    commit((state) => { before = state; next = updater(state); return next })
    if (before && next !== before) showUndo(line, () => commit(undoFrom(before, next)))
  }
  const actions = {
    moveTo: (id, boardId, name) => change(`Moved to ${name}`, (state) => placeFrom(state, [id], boardId)),
    newBoard(name) {
      setNaming(null)
      const value = String(name || '').trim()
      if (!value) return
      let made = null
      change(`Made the board “${value}”`, (state) => { const result = addBoard(state, value); made = result.folder; return result.state })
      if (made) navigate('Mindmap', { folderId: made.id })
    },
    rename(id, name) {
      setNaming(null)
      const value = String(name || '').trim()
      if (value) change(`Renamed to “${value}”`, (state) => renameFolder(state, id, value))
    },
    starter: () => change('Made Personal, Home and Work', (state) => STARTER.reduce((next, name) => addBoard(next, name).state, state)),
    newCanvas(name) {
      setNaming(null)
      const value = String(name || '').trim()
      if (!value) return
      let made = null
      commit((state) => { const result = addCanvas(state, value); made = result.canvas; return result.state })
      if (!made) return
      navigate('Canvas', { canvasId: made.id })
      showUndo(`Made the canvas “${value}”`, () => commit((state) => removeCanvas(state, made.id)))
    },
    canvasMenu(event, canvas) {
      openMenu(event, [
        { label: 'Rename', icon: NotePencil, onSelect: () => setNaming({ canvasId: canvas.id }) },
        { divider: true },
        {
          label: 'Delete canvas', icon: Trash, danger: true,
          onSelect: () => {
            const spot = canvasesOf(workspace).findIndex((item) => item.id === canvas.id)
            commit((state) => removeCanvas(state, canvas.id))
            if (at.view === 'Canvas' && openCanvas === canvas.id) navigate('Today')
            // Undo puts it back where it was, with everything that was on it.
            showUndo(`Deleted “${canvas.name}”`, () => commit((state) => {
              const list = canvasesOf(state).filter((item) => item.id !== canvas.id)
              list.splice(spot, 0, canvas)
              return { ...state, canvases: list }
            }))
          },
        },
      ])
    },
    menu(event, folder) {
      const favorite = isFavorite(folder)
      openMenu(event, [
        { label: 'Rename', icon: NotePencil, onSelect: () => setNaming({ id: folder.id }) },
        // A favorite sits on top, in Favorites (Phase 99); the quick bar's own words for its favorites.
        {
          label: favorite ? 'Remove from favorites' : 'Add to favorites', icon: Star,
          onSelect: () => change(favorite ? `Took “${folder.name}” off your favorites` : `“${folder.name}” is in your favorites`, (state) => setFavorite(state, folder.id, !favorite)),
        },
        clientItem(folder, change),
        { divider: true },
        {
          label: 'Delete board', icon: Trash, hint: 'keeps its stickies', danger: true,
          onSelect: () => {
            change(`Deleted “${folder.name}”. Its stickies are in Just in.`, (state) => removeFolder(state, folder.id))
            if (at.view === 'Mindmap' && at.board === folder.id) navigate('JustIn')
          },
        },
      ])
    },
  }

  const fold = (name) => setOpened((list) => {
    const next = list.includes(name) ? list.filter((item) => item !== name) : [...list, name]
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)) } catch { /* a convenience */ }
    return next
  })
  const here = (id) => (id === 'Mindmap' ? false : at.view === id)
  // A board keeps its paper by its place among all boards, whichever group it shows in.
  const row = ({ folder, count }, index) => (naming?.id === folder.id
    ? <NameForm key={folder.id} label={`Rename ${folder.name}`} initial={folder.name} onDone={(name) => actions.rename(folder.id, name)} />
    : (
      <BoardRow
        key={folder.id}
        folder={folder}
        paper={paperOf(folder, index)}
        count={count}
        active={at.view === 'Mindmap' && at.board === folder.id}
        onOpen={() => navigate('Mindmap', { folderId: folder.id })}
        onMenu={(event) => actions.menu(event, folder)}
        onDropNote={(id) => actions.moveTo(id, folder.id, folder.name)}
      />
    ))
  // Each board shows once: a favorite on top, then a client, then the rest.
  const groupOf = (folder) => (isFavorite(folder) ? 'Favorites' : isClient(folder) ? 'Clients' : 'Boards')
  const rows = (group) => boards.map(row).filter((_, index) => groupOf(boards[index].folder) === group)

  return (
    <nav className="side" aria-label="OSAT">
      <div className="side-top" aria-hidden="true" />
      <div className="side-tiles">
        {SPACES.slice(0, 4).map((space) => (
          <SideTile key={space.id} space={space} count={counts[space.id] ?? ''} active={here(space.id)} navigate={navigate} onDropNote={space.id === 'JustIn' ? (id) => actions.moveTo(id, JUST_IN, 'Just in') : null} />
        ))}
      </div>

      <div className="side-scroll">
        {['Favorites', 'Clients'].map((group) => boards.some(({ folder }) => groupOf(folder) === group) && (
          <section key={group} className="side-group" aria-label={group}>
            <header className="side-head"><span>{group}</span></header>
            {rows(group)}
          </section>
        ))}
        <section className="side-group" aria-label="Boards">
          <header className="side-head">
            <span>Boards</span>
            <button type="button" className="side-add" aria-label="New board" title="New board" onClick={() => setNaming({})}><Plus weight="bold" /></button>
          </header>
          {rows('Boards')}
          {naming && !naming.id && !naming.canvas && !naming.canvasId && <NameForm label="New board’s name" placeholder="Name it: Fortis, Home…" onDone={actions.newBoard} />}
          {!boards.length && !naming && (
            <button type="button" className="side-row side-starter" onClick={actions.starter}><Plus /> <span>Add {STARTER.join(', ')}</span></button>
          )}
        </section>

        <section className="side-group" aria-label="Canvases">
          <header className="side-head">
            <span>Canvases</span>
            <button type="button" className="side-add" aria-label="New canvas" title="New canvas" onClick={() => setNaming({ canvas: true })}><Plus weight="bold" /></button>
          </header>
          {canvases.map((canvas) => (naming?.canvasId === canvas.id
            ? <NameForm key={canvas.id} label={`Rename ${canvas.name}`} initial={canvas.name} onDone={(name) => {
              setNaming(null)
              if (!String(name).trim() || String(name).trim() === canvas.name) return
              commit((state) => renameCanvas(state, canvas.id, name))
              showUndo(`Renamed to “${String(name).trim()}”`, () => commit((state) => renameCanvas(state, canvas.id, canvas.name)))
            }} />
            : (
              <button key={canvas.id} type="button" className="side-row" aria-current={at.view === 'Canvas' && openCanvas === canvas.id ? 'page' : undefined} onClick={() => navigate('Canvas', { canvasId: canvas.id })} onContextMenu={(event) => actions.canvasMenu(event, canvas)}>
                <Shapes aria-hidden="true" />
                <span>{canvas.name}</span>
              </button>
            )))}
          {naming?.canvas && <NameForm label="New canvas’s name" placeholder="Name it: Q4 plan, Ideas…" onDone={actions.newCanvas} />}
          {!canvases.length && !naming?.canvas && (
            <button type="button" className="side-row side-starter" onClick={() => actions.newCanvas('My canvas')}><Plus /> <span>New canvas</span></button>
          )}
        </section>

        {GROUPS.map((group) => {
          const open = !group.fold || opened.includes(group.name) || group.items.includes(at.view)
          return (
            <section key={group.name} className="side-group" aria-label={group.name}>
              {group.fold
                ? (
                  <button type="button" className="side-head is-fold" aria-expanded={open} onClick={() => fold(group.name)}>
                    <span>{group.name}</span><CaretRight weight="bold" aria-hidden="true" />
                  </button>
                )
                : <header className="side-head"><span>{group.name}</span></header>}
              {open && group.items.map((id) => <SideRow key={id} space={spaceFor(id)} active={here(id)} navigate={navigate} />)}
            </section>
          )
        })}
      </div>

      <footer className="side-foot">
        <SideRow space={SETTINGS} active={here(SETTINGS.id)} navigate={navigate} />
        <button
          type="button"
          className="side-net"
          aria-pressed={offline}
          title={offline ? 'Go back online  ⇧⌘U' : 'Go offline: nothing leaves OSAT  ⇧⌘U'}
          onClick={onOffline}
        >
          {offline ? <WifiSlash weight="bold" aria-hidden="true" /> : <WifiHigh weight="bold" aria-hidden="true" />}
          {offline ? 'Offline' : 'Online'}
        </button>
      </footer>
      {menu}
      {toast}
    </nav>
  )
}

function SideTile({ space, count, active, navigate, onDropNote }) {
  const drop = useDrop(`side:${space.id}`, { accepts: onDropNote ? (carried) => carried.kind === 'note' : [], onDrop: (carried) => onDropNote?.(carried.id) })
  return (
    <button type="button" className="side-tile" data-tint={space.tint} aria-current={active ? 'page' : undefined} title={space.hint} onClick={() => navigate(space.id)} {...(onDropNote ? drop : {})}>
      <span className="side-tile-icon"><space.icon weight="fill" aria-hidden="true" /></span>
      <span className="side-tile-count">{count}</span>
      <span className="side-tile-label">{space.label}</span>
    </button>
  )
}

function SideRow({ space, active, navigate }) {
  return (
    <button type="button" className="side-row" aria-current={active ? 'page' : undefined} title={space.hint} onClick={() => navigate(space.id)}>
      <space.icon weight={active ? 'fill' : 'regular'} aria-hidden="true" />
      <span>{space.label}</span>
    </button>
  )
}

function BoardRow({ folder, paper, count, active, onOpen, onMenu, onDropNote }) {
  const drop = useDrop(`side:board:${folder.id}`, { accepts: (carried) => carried.kind === 'note', onDrop: (carried) => onDropNote(carried.id) })
  return (
    <button type="button" className="side-row" aria-current={active ? 'page' : undefined} onClick={onOpen} onContextMenu={onMenu} {...drop}>
      <i className="side-dot" data-paper={paper} aria-hidden="true" />
      <span>{folder.name}</span>
      {folder.fresh && <em>New</em>}
      {count > 0 && <small>{count}</small>}
    </button>
  )
}

/* A board's name, written in place: Return or leaving the field keeps it, Esc lets it go. */
function NameForm({ label, placeholder, initial = '', onDone }) {
  const [name, setName] = useState(initial)
  const [done, setDone] = useState(false)
  const finish = (value) => { if (done) return; setDone(true); onDone(value) }
  return (
    <form className="side-naming" onSubmit={(event) => { event.preventDefault(); finish(name) }}>
      <input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        value={name}
        maxLength={80}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => finish(name)}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish('') } }}
      />
    </form>
  )
}
