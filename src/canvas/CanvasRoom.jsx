import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Kanban, Note, Plus } from '@phosphor-icons/react'
import { convertToExcalidrawElements, Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

import { boardsOf } from '../boards/boards-model.js'
import { addCanvas, boardOfLink, canvasesOf, middleOf, saveElements, stickySkeleton } from './canvas-model.js'

const LAST_KEY = 'osat.canvas.last.v1'
const SAVE_MS = 800
// A kanban put on a canvas before Phase 109 reads its board's name from here.
const Live = createContext(null)
const ARROWS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']

/* Canvases (Phase 85): a whiteboard each, drawn by Excalidraw. Shapes, text, arrows that hold on to what they point at,
   stickies (the Sticky button or N) and mind maps: pick a sticky and press Tab (or ⌘ and an arrow) for a new idea
   joined to it, ready to type in; Esc, then Tab again, keeps it growing; ⇧Tab adds a sibling instead (another idea off
   the same parent); ⌥ and an arrow walks between ideas.
   Kanbans are boards since Phase 109 (one list, two kinds), so a kanban put on a canvas earlier is a link to its board.
   What is drawn is saved a moment after it changes; Excalidraw's own ⌘Z undoes on the canvas.
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
        <p>A whiteboard for thinking things out: stickies, shapes, text and mind maps.</p>
        <button type="button" className="primary-button" onClick={first}><Plus weight="bold" /> New canvas</button>
      </section>
    )
  }
  return <Whiteboard key={canvas.id} canvas={canvas} workspace={workspace} commit={commit} navigate={navigate} />
}

function Whiteboard({ canvas, workspace, commit, navigate }) {
  const [api, setApi] = useState(null)
  const room = useRef(null)
  // A new idea is on its way (⌘ and an arrow): once ⌘ lets go, Excalidraw picks it and we start writing in it.
  const growing = useRef(null)
  const added = useRef(0)
  const pending = useRef(null)
  const timer = useRef(null)
  const latest = useRef(commit)
  latest.current = commit
  const live = useMemo(() => ({ workspace, navigate }), [workspace, navigate])
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
    writeIn()
  }

  const writeIn = () => requestAnimationFrame(() => room.current?.querySelector('.excalidraw')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  const pickedOne = () => {
    const ids = Object.keys(api?.getAppState().selectedElementIds || {})
    return ids.length === 1 ? ids[0] : null
  }

  // N writes a sticky; Tab grows a mind map from the one picked. Not while you are typing somewhere.
  function onKeyDown(event) {
    const typing = api?.getAppState().editingTextElement || /^(INPUT|TEXTAREA)$/.test(event.target.tagName) || event.target.isContentEditable
    if (ARROWS.includes(event.key) && (event.metaKey || event.ctrlKey) && !event.shiftKey && !typing && pickedOne()) growing.current = pickedOne()
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'n') { event.preventDefault(); event.stopPropagation(); sticky(); return }
    if (event.key === 'Tab' && pickedOne()) {
      event.preventDefault()
      event.stopPropagation()
      // ⇧Tab: a sibling, grown from the idea this one hangs off (the arrow pointing at it), when it has one.
      const from = event.shiftKey ? parentOf(api.getSceneElements(), pickedOne()) : pickedOne()
      if (!from) return
      if (from !== pickedOne()) api.updateScene({ appState: { selectedElementIds: { [from]: true } } })
      growing.current = from
      // Excalidraw's own mind-map key, ⌘→ then letting go of ⌘, so the new idea is joined and laid out its way.
      requestAnimationFrame(() => {
        const target = room.current?.querySelector('.excalidraw')
        target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', metaKey: true, ctrlKey: !/Mac/.test(navigator.platform), bubbles: true }))
        target?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft', bubbles: true }))
      })
    }
  }

  // ⌘ let go after an arrow: if a new idea is now the one picked, it opens for typing.
  useEffect(() => {
    const onKeyUp = (event) => {
      if (!growing.current || event.metaKey || event.ctrlKey) return
      const from = growing.current
      growing.current = null
      requestAnimationFrame(() => { const now = pickedOne(); if (now && now !== from) writeIn() })
    }
    window.addEventListener('keyup', onKeyUp)
    return () => window.removeEventListener('keyup', onKeyUp)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  return (
    <section className="canvas-room" ref={room} onKeyDownCapture={onKeyDown}>
      <header className="canvas-head">
        <h1>{canvas.name}</h1>
        <p className="canvas-hint">Pick a sticky, press <kbd>Tab</kbd> for an idea joined to it · <kbd>⇧Tab</kbd> for one beside it · <kbd>⌥</kbd> arrows move between them</p>
        <div className="canvas-actions">
          <button type="button" className="primary-button" onClick={sticky} title="A sticky in the middle of the canvas  N"><Note weight="fill" /> Sticky</button>
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
          renderEmbeddable={(element) => {
            const boardId = boardOfLink(element.link)
            return boardId ? <OldKanban boardId={boardId} /> : null
          }}
        />
        </Live.Provider>
      </div>
    </section>
  )
}

/* A kanban put on a canvas before Phase 109: the board it showed, a click away. */
function OldKanban({ boardId }) {
  const { workspace, navigate } = useContext(Live)
  const board = boardsOf(workspace).find(({ folder }) => folder.id === boardId)?.folder
  if (!board) return <div className="canvas-kanban is-gone">This board was deleted.</div>
  return (
    <div className="canvas-kanban is-gone">
      <Kanban weight="duotone" aria-hidden="true" />
      <p><strong>{board.name}</strong> is a kanban in Boards now.</p>
      <button type="button" className="ghost-button" onClick={() => navigate('Mindmap', { folderId: boardId, view: 'board' })}>Open {board.name}</button>
    </div>
  )
}

/* The idea an idea hangs off in a mind map: where the arrow that points at it starts. */
export function parentOf(elements, id) {
  const arrow = elements.find((element) => element.type === 'arrow' && !element.isDeleted && element.endBinding?.elementId === id && element.startBinding?.elementId)
  return arrow?.startBinding.elementId || null
}

function readLast() {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}
