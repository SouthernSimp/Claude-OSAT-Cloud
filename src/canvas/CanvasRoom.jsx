import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CaretLeft, CaretRight, Kanban, Note, Plus } from '@phosphor-icons/react'
import { convertToExcalidrawElements, Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

import { boardsOf, cardWords, setStage, stageColumns, stageOf, STAGES, stickiesOn } from '../boards/boards-model.js'
import { addSticky } from '../nodes-model.js'
import { addCanvas, boardOfLink, canvasesOf, KANBAN_SIZE, kanbanElement, middleOf, saveElements, stickySkeleton } from './canvas-model.js'

const LAST_KEY = 'osat.canvas.last.v1'
const SAVE_MS = 800
// The kanbans on a canvas read the workspace from here, so they change as the board does.
const Live = createContext(null)

/* Canvases (Phase 85): a whiteboard each, drawn by Excalidraw. Shapes, text, arrows that hold on to what they point at
   (a mind map: pick a shape and press ⌘→ for a new one joined to it), stickies (the Sticky button or N) and a live
   kanban of any board. What is drawn is saved a moment after it changes; Excalidraw's own ⌘Z undoes on the canvas.
   ponytail: the canvas reads the workspace when it opens; a change made on another Mac shows when it is opened again. */
export default function CanvasRoom({ workspace, commit, navigate, target }) {
  const canvases = canvasesOf(workspace)
  const wanted = target?.canvasId || readLast()
  const canvas = canvases.find((item) => item.id === wanted) || canvases[0] || null
  useEffect(() => { if (canvas) try { localStorage.setItem(LAST_KEY, canvas.id) } catch { /* a convenience */ } }, [canvas?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!canvas) {
    const first = () => {
      let made = null
      commit((state) => { const result = addCanvas(state, 'My canvas'); made = result.canvas; return result.state })
      if (made) navigate('Canvas', { canvasId: made.id })
    }
    return (
      <section className="canvas-empty">
        <h1>Canvases</h1>
        <p>A whiteboard for thinking things out: stickies, shapes, text, mind maps and a kanban of any board.</p>
        <button type="button" className="primary-button" onClick={first}><Plus weight="bold" /> New canvas</button>
      </section>
    )
  }
  return <Whiteboard key={canvas.id} canvas={canvas} workspace={workspace} commit={commit} navigate={navigate} />
}

function Whiteboard({ canvas, workspace, commit, navigate }) {
  const [api, setApi] = useState(null)
  const [picking, setPicking] = useState(false)
  const room = useRef(null)
  const added = useRef(0)
  const pending = useRef(null)
  const timer = useRef(null)
  const latest = useRef(commit)
  latest.current = commit
  const live = useMemo(() => ({ workspace, commit, navigate }), [workspace, commit, navigate])
  const boards = useMemo(() => boardsOf(workspace), [workspace])
  // Excalidraw keeps its own copy once open: it only reads this on the way in.
  const initial = useMemo(() => ({ elements: canvas.elements, appState: { viewBackgroundColor: 'transparent' }, scrollToContent: true }), [canvas.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const flush = () => {
    clearTimeout(timer.current)
    if (!pending.current) return
    const elements = pending.current
    pending.current = null
    latest.current((state) => saveElements(state, canvas.id, elements))
  }
  useEffect(() => flush, []) // eslint-disable-line react-hooks/exhaustive-deps

  function onChange(elements) {
    pending.current = elements
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_MS)
  }

  function place(skeletons, select = true) {
    if (!api) return []
    const made = convertToExcalidrawElements(skeletons, { regenerateIds: true })
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...made],
      appState: select ? { selectedElementIds: { [made[0].id]: true } } : undefined,
    })
    return made
  }

  /* A sticky in the middle of the screen, ready to type in. */
  function sticky() {
    if (!place([stickySkeleton(middleOf(api?.getAppState(), added.current++))]).length) return
    // Return on a selected shape starts writing in it, as in Excalidraw itself.
    requestAnimationFrame(() => room.current?.querySelector('.excalidraw')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  }

  function kanban(boardId) {
    setPicking(false)
    const { x, y } = middleOf(api?.getAppState())
    const [base] = convertToExcalidrawElements([{ type: 'rectangle', x: x - KANBAN_SIZE.width / 2, y: y - KANBAN_SIZE.height / 2, ...KANBAN_SIZE }], { regenerateIds: true })
    api?.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), kanbanElement(base, boardId)] })
  }

  // N writes a sticky, unless you are already typing somewhere.
  function onKeyDown(event) {
    if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return
    if (api?.getAppState().editingTextElement || /^(INPUT|TEXTAREA)$/.test(event.target.tagName) || event.target.isContentEditable) return
    event.preventDefault()
    event.stopPropagation()
    sticky()
  }

  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  return (
    <section className="canvas-room" ref={room} onKeyDownCapture={onKeyDown}>
      <header className="canvas-head">
        <h1>{canvas.name}</h1>
        <div className="canvas-actions">
          <button type="button" className="primary-button" onClick={sticky} title="A sticky in the middle of the canvas  N"><Note weight="fill" /> Sticky</button>
          <div className="canvas-pick">
            <button type="button" className="ghost-button" aria-expanded={picking} onClick={() => setPicking((open) => !open)} disabled={!boards.length} title={boards.length ? 'Put a board’s kanban on the canvas' : 'Make a board first'}>
              <Kanban /> Kanban
            </button>
            {picking && (
              <ul className="canvas-menu" role="menu">
                {boards.map(({ folder }) => <li key={folder.id}><button type="button" role="menuitem" onClick={() => kanban(folder.id)}>{folder.name}</button></li>)}
              </ul>
            )}
          </div>
        </div>
      </header>
      <div className="canvas-board">
        <Live.Provider value={live}>
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={initial}
          onChange={onChange}
          theme={theme}
          UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}
          validateEmbeddable={(link) => Boolean(boardOfLink(link))}
          renderEmbeddable={(element, appState) => {
            const boardId = boardOfLink(element.link)
            const active = appState.activeEmbeddable?.element?.id === element.id && appState.activeEmbeddable.state === 'active'
            return boardId ? <KanbanEmbed boardId={boardId} active={active} /> : null
          }}
        />
        </Live.Provider>
      </div>
    </section>
  )
}

/* A board's kanban on a canvas: the same stickies as its Kanban tab. ‹ › move a card a stage; the line under Later adds
   a to-do. Double-click it to use it (Excalidraw's way with anything embedded, so a single click and drag still moves it). */
function KanbanEmbed({ boardId, active }) {
  const { workspace, commit, navigate } = useContext(Live)
  const [words, setWords] = useState('')
  const board = boardsOf(workspace).find(({ folder }) => folder.id === boardId)?.folder
  if (!board) return <div className="canvas-kanban is-gone">This board was deleted.</div>
  const columns = stageColumns(stickiesOn(workspace, boardId))
  const move = (note, step) => {
    const at = STAGES.findIndex(([stage]) => stage === stageOf(note)) + step
    if (STAGES[at]) commit((state) => setStage(state, [note.id], STAGES[at][0]))
  }
  const add = (event) => {
    event.preventDefault()
    const value = words.trim()
    if (!value) return
    commit((state) => { const { state: next, note } = addSticky(state, value, boardId, { source: 'Canvas' }); return setStage({ ...next }, [note.id], 'later') })
    setWords('')
  }
  return (
    <div className="canvas-kanban">
      <header>
        <strong>{board.name}</strong>
        {!active && <small>Double-click to use</small>}
        <button type="button" className="ghost-button" onClick={() => navigate('Mindmap', { folderId: boardId, view: 'board' })}>Open board</button>
      </header>
      <div className="canvas-kanban-cols">
        {columns.map((column, index) => (
          <section key={column.stage}>
            <h2>{column.title} <small>{column.notes.length || ''}</small></h2>
            {column.notes.map((note) => (
              <article key={note.id}>
                <p>{note.gist || cardWords(note.markdown)}</p>
                <span>
                  {index > 0 && <button type="button" aria-label={`Back to ${STAGES[index - 1][1]}`} onClick={() => move(note, -1)}><CaretLeft /></button>}
                  {index < STAGES.length - 1 && <button type="button" aria-label={`On to ${STAGES[index + 1][1]}`} onClick={() => move(note, 1)}><CaretRight /></button>}
                </span>
              </article>
            ))}
            {index === 0 && (
              <form onSubmit={add}>
                <input aria-label={`Add a to-do to ${board.name}`} placeholder="Add a to-do…" value={words} onChange={(event) => setWords(event.target.value)} />
              </form>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

function readLast() {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}
