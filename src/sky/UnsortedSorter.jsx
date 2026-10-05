import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowCounterClockwise, ArrowUpRight, CaretRight, Check, Folder, MagnifyingGlass, Note, Plus, Sparkle, Stack, Trash, X } from '@phosphor-icons/react'
import { folderChildren, folderPath, folderSubtree, searchNotes } from '../notes-model.js'
import { pileOf } from '../nodes-model.js'
import { edgePath } from '../links-model.js'
import { Markdown } from '../lib/markdown.jsx'
import { askLocalModel } from '../local-ai.js'
import { placementMessages, placementPlaces, placementSuggestion, readPlacement } from './sort-review.js'

const papers = ['canary', 'mint', 'canary', 'lilac', 'sky']
const bodyOf = (note) => note.markdown.trim().split('\n')[0] === note.title.trim() ? note.markdown.trim().split('\n').slice(1).join('\n') : note.markdown

export function UnsortedSorter({ workspace, notes, actions, history, notice, hidden, startIds, onBrowse, onClose }) {
  const [batchIds, setBatchIds] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [later, setLater] = useState(new Set())
  const [choice, setChoice] = useState(null)
  const [peek, setPeek] = useState(null)
  const [findPlace, setFindPlace] = useState(false)
  const [query, setQuery] = useState('')
  const [flight, setFlight] = useState(null)
  const [ai, setAi] = useState(null)
  const [readNote, setReadNote] = useState(null)
  const source = useRef(null)
  const landing = useRef(null)
  const primary = useRef(null)
  const request = useRef(null)
  const motion = useRef(null)
  const alive = useRef(true)
  const batch = batchIds.flatMap((id) => notes.find((note) => note.id === id) || [])
  const remaining = batch.filter((note) => !later.has(note.id))
  const note = flight?.note || remaining.find((note) => note.id === activeId) || remaining[0]
  const hint = useMemo(() => placementSuggestion(workspace, note, batch), [workspace, note, batchIds])
  const selected = flight?.home || (choice && choice.noteId === note?.id ? choice.value : hint)
  const folder = selected?.kind === 'move' ? workspace.folders.find((item) => item.id === selected.folderId) : null
  const ancestors = []
  for (let id = folder?.parentId; id;) { const parent = workspace.folders.find((item) => item.id === id); if (!parent) break; ancestors.unshift(parent); id = parent.parentId }
  const neighbors = folder ? pileOf(workspace.notes, folder.id).filter((item) => item.id !== note?.id) : []
  const places = useMemo(() => note ? placementPlaces(workspace, note) : [], [workspace, note])
  const recent = history.slice(-5).reverse()
  const scope = peek?.folderId && folderSubtree(workspace.folders, peek.folderId)
  const inside = scope ? workspace.notes.filter((item) => scope.has(item.folderId) && !item.archived && !item.trashedAt && !item.kind) : []
  const found = searchNotes(inside, query)
  const opened = readNote && workspace.notes.find((item) => item.id === readNote)

  useEffect(() => {
    if (!hidden && !batchIds.length && notes.length) setBatchIds(notes.slice(0, 5).map((note) => note.id))
  }, [hidden, notes, batchIds.length])
  useEffect(() => {
    if (!startIds) return
    setBatchIds(startIds); setActiveId(null); setLater(new Set()); setChoice(null); setPeek(null); setFindPlace(false); setReadNote(null)
  }, [startIds])
  useEffect(() => { request.current?.abort(); setAi(null) }, [note?.id])
  useEffect(() => {
    if (hidden) { request.current?.abort(); setAi(null) }
    else { setPeek(null); setFindPlace(false); setReadNote(null) }
  }, [hidden])
  useEffect(() => { if (!hidden) requestAnimationFrame(() => primary.current?.focus({ preventScroll: true })) }, [hidden, note?.id])
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); motion.current?.cancel() } }, [])

  function nextBatch() {
    let fresh = notes.filter((item) => !later.has(item.id))
    if (!fresh.length) { fresh = notes; setLater(new Set()) }
    setBatchIds(fresh.slice(0, 5).map((item) => item.id)); setActiveId(null); setChoice(null)
    setPeek(null); setFindPlace(false); setQuery(''); setReadNote(null)
  }
  function choose(value) { request.current?.abort(); setAi(null); setChoice({ noteId: note.id, value }); setPeek(null); setFindPlace(false); setQuery(''); setReadNote(null) }
  function openPlace(folderId, noteId = null) { setPeek({ folderId, noteId }); setQuery(''); setReadNote(noteId); setFindPlace(false) }
  function defer() {
    request.current?.abort()
    setLater((value) => new Set([...value, note.id]))
    setActiveId(remaining.find((item) => item.id !== note.id)?.id || null)
    setPeek(null); setFindPlace(false); setReadNote(null)
  }
  async function ask() {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setAi({ noteId: note.id, busy: true })
    // ponytail: bounded local prompt; word ranking puts relevant places first.
    const candidates = places.slice(0, 60)
    try {
      const text = await askLocalModel(placementMessages(note, candidates), { signal: controller.signal })
      if (controller.signal.aborted) return
      choose(readPlacement(text, candidates))
      setAi({ noteId: note.id, message: 'Local AI suggestion. You decide.' })
    } catch (error) {
      if (!controller.signal.aborted) setAi({ noteId: note.id, message: String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }
  async function place(kind = 'home') {
    if (!note || flight) return
    request.current?.abort()
    const home = kind === 'home' ? selected : { kind }
    if (kind === 'home' && (!home || (home.kind === 'make' && !home.name.trim()))) return
    const from = source.current?.getBoundingClientRect()
    let to = landing.current?.getBoundingClientRect()
    if (kind === 'trash') to = source.current?.parentElement.querySelector('[aria-label="Move sticky to Trash"]')?.getBoundingClientRect()
    const result = actions.fileUnsorted([note.id], home.folderId, home.kind === 'make' ? home.name : '', { sky: kind === 'sky', trash: kind === 'trash' })
    if (!result) return
    setFlight({ note, home })
    setPeek(null); setFindPlace(false); setReadNote(null)
    if (from && to && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await new Promise(requestAnimationFrame)
      if (kind !== 'trash') to = landing.current.getBoundingClientRect()
      const dx = to.left - from.left, dy = to.top - from.top
      const scale = Math.min(1, to.width / from.width)
      try {
        motion.current = source.current.animate([{ transform: 'translate(0, 0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 1 }], { duration: 440, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' })
        await motion.current.finished
        motion.current = source.current.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${scale})`, clipPath: 'inset(0 0 0 0)', opacity: 1 }, { transform: `translate(${dx}px, ${dy - (kind === 'home' ? 90 : 0)}px) scale(${scale})`, clipPath: kind === 'home' ? 'inset(0 0 100% 0)' : 'inset(0 0 0 0)', opacity: 0 }], { duration: 320, delay: 160, easing: 'ease-in-out', fill: 'forwards' })
        await motion.current.finished
      } catch { /* Closing Sky cancels presentation; the move is already saved. */ }
    }
    if (!alive.current) return
    source.current?.getAnimations().forEach((animation) => animation.cancel())
    setActiveId(remaining.find((item) => item.id !== note.id)?.id || null)
    setFlight(null); setChoice(null)
    requestAnimationFrame(() => primary.current?.focus({ preventScroll: true }))
  }
  function undo() {
    const ids = actions.undoUnsorted() || []
    if (ids.length) {
      setBatchIds((value) => [...new Set([ids[0], ...value])].slice(0, 5))
      setLater((value) => new Set([...value].filter((id) => !ids.includes(id))))
      setActiveId(ids[0]); setPeek(null); setFindPlace(false); setReadNote(null)
    }
  }

  return <section className="guided-sort" hidden={hidden} aria-label="Sort Unsorted stickies" onKeyDown={(event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (peek || findPlace) { setPeek(null); setFindPlace(false); setReadNote(null) } else onClose()
  }}>
    <header className="sort-session-bar"><span><Stack /> Unsorted <small>{notes.length} waiting</small></span><div><button type="button" onClick={onBrowse}>All stickies</button><button type="button" aria-label="Close Unsorted" onClick={onClose}><X /></button></div></header>
    <div className="sort-scene"><div className="sort-stage">
      {!peek && !findPlace && !flight && note && <SortConnections noteId={note.id} folderId={folder?.id} name={selected?.name} />}
      {note ? <section className="sort-current" aria-label="Current sticky">
        <span className="sort-eyebrow">One thought at a time</span>
        <article className="sort-paper" ref={source} data-sort-box="source" data-paper={note.color || papers[batchIds.indexOf(note.id) % 5] || 'canary'} data-moving={!!flight || undefined}>
          <h2>{note.title || 'Untitled'}</h2>{bodyOf(note) && <Markdown text={bodyOf(note)} />}
        </article>
        <div className="sort-actions">
          <button ref={primary} type="button" className="is-primary" disabled={!!flight || (!peek && !findPlace && selected?.kind === 'make' && !selected.name.trim())} onClick={() => {
            if (peek || findPlace) { setPeek(null); setFindPlace(false); setReadNote(null) } else place(selected ? 'home' : 'sky')
          }}>{peek || findPlace ? 'Back to sorting' : selected ? 'Place here' : 'Place on Sky'}</button>
          {selected && !peek && !findPlace && <button type="button" disabled={!!flight} onClick={() => place('sky')}>On Sky</button>}
          <button type="button" disabled={!!flight} onClick={defer}>Later</button>
          <button type="button" aria-label="Move sticky to Trash" title="Move to Trash · Undo available" disabled={!!flight} onClick={() => place('trash')}><Trash /></button>
        </div>
        <div className="sort-current-meta"><span>{batchIds.indexOf(note.id) + 1} of {batchIds.length}</span><button type="button" disabled={!!flight} onClick={() => actions.openNote(note.id)}>Open in Notes <ArrowUpRight /></button></div>
      </section> : <div className="sort-batch-done"><Check /><h2>{notes.length ? 'A little more space.' : 'All clear.'}</h2><p>{notes.length ? 'Five at a time. The rest can wait.' : 'Every thought has a place.'}</p>{notes.length > 0 && <button type="button" className="is-primary" onClick={nextBatch}>Next five</button>}<button type="button" onClick={onClose}>Back to Sky</button></div>}

      <section className="sort-destination" aria-label={peek ? 'Explore placement' : 'Suggested destination'} data-placing={!!flight || undefined}>
        {peek ? <div className="sort-inspector">
          <header><div><small>Stored in</small><h3>{folderPath(workspace.folders, peek.folderId).join(' / ')}</h3></div><button type="button" aria-label="Back to current suggestion" onClick={() => { setPeek(null); setReadNote(null) }}><X /></button></header>
          <label className="sort-search"><MagnifyingGlass /><input aria-label="Search this topic or branch" placeholder="Find a sticky here" value={query} onChange={(event) => { setQuery(event.target.value); setReadNote(null) }} /></label>
          {!query && <nav aria-label="Branches in this topic">{folderChildren(workspace.folders, peek.folderId).map((child) => <button key={child.id} type="button" onClick={() => openPlace(child.id)}><Folder /> {child.name}<CaretRight /></button>)}</nav>}
          <div className="sort-inspector-notes">{found.map((item) => <button type="button" key={item.id} aria-pressed={readNote === item.id} onClick={() => setReadNote(item.id)}><Note /><span>{item.title}<small>{folderPath(workspace.folders, item.folderId).join(' / ')}</small></span><CaretRight /></button>)}{!found.length && <p>{query ? 'No stickies match.' : 'No stickies here yet.'}</p>}</div>
          {opened && <article className="sort-read"><h4>{opened.title}</h4><Markdown text={bodyOf(opened)} /><button type="button" onClick={() => actions.openNote(opened.id)}>Open in Notes <ArrowUpRight /></button></article>}
          <footer><button type="button" onClick={() => actions.revealPlacement(peek)}>Open on Sky <ArrowUpRight /></button>{note && <button type="button" onClick={() => choose({ kind: 'move', folderId: peek.folderId, why: 'Chosen by you.' })}>Use this place</button>}</footer>
        </div> : findPlace ? <div className="sort-place-picker">
          <header><h3>Another place</h3><button type="button" aria-label="Back to current suggestion" onClick={() => setFindPlace(false)}><X /></button></header>
          <label className="sort-search"><MagnifyingGlass /><input autoFocus aria-label="Find another topic or branch" placeholder="Find a topic or branch" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          {places.filter((place) => place.path.toLowerCase().includes(query.toLowerCase())).slice(0, 6).map((place) => <button type="button" key={place.id} onClick={() => choose({ kind: 'move', folderId: place.id, why: 'Chosen by you.' })}><Folder /> {place.path}<CaretRight /></button>)}
          <button type="button" onClick={() => choose({ kind: 'make', name: (note.tags?.[0] || note.title).slice(0, 80), why: 'A new topic for this thought.' })}><Plus /> New topic</button>
        </div> : note && <>
          <div className="sort-match-heading"><span>{flight ? `Placing ${flight.home.kind === 'trash' ? 'in Trash' : flight.home.kind === 'sky' ? 'on Sky' : 'here'}` : selected?.why === 'Chosen by you.' ? 'Your chosen place' : selected ? 'Suggested match' : 'Room for a new thought'}</span><p>{flight?.home.kind === 'trash' ? 'Undo brings it back.' : selected?.why || 'This can stay free on Sky.'}</p></div>
          <div className="sort-map-preview">
            {ancestors.length > 0 && <div className="sort-parent-path">{ancestors.map((parent) => <button type="button" disabled={!!flight} data-sort-box="parent" key={parent.id} onClick={() => openPlace(parent.id)}><Folder /><span>{parent.name}</span><CaretRight /></button>)}</div>}
            <div className="sort-home-column">
              {folder ? <button type="button" data-sort-box="home" className="sort-home" disabled={!!flight} onClick={() => openPlace(folder.id)}><Folder /><strong>{folder.name}</strong><CaretRight /></button> : selected?.kind === 'make' ? <label data-sort-box="home" className="sort-home is-new"><Plus /><input aria-label="New sorting topic name" maxLength={80} value={selected.name} onChange={(event) => choose({ ...selected, name: event.target.value })} /></label> : <div className="sort-home" data-sort-box="home"><Stack /><strong>{flight?.home.kind === 'trash' ? 'Trash' : 'On Sky'}</strong></div>}
              <div className="sort-landing" data-sort-box="landing" ref={landing} aria-label="Placement preview"><span>{note.title}</span></div>
            </div>
            {folder && <div className="sort-neighbors" aria-label="Nearby stickies">{neighbors.slice(0, 2).map((item) => <button type="button" data-sort-box="neighbor" key={item.id} disabled={!!flight} onClick={() => openPlace(folder.id, item.id)}><Note /><span>{item.title}</span><CaretRight /></button>)}{!neighbors.length && <small>First sticky here</small>}</div>}
          </div>
          <div className="sort-assistance"><button type="button" disabled={!!flight || ai?.busy} onClick={ask}><Sparkle />{ai?.busy ? 'Thinking locally…' : 'Ask local AI'}</button><button type="button" disabled={!!flight} onClick={() => { setFindPlace(true); setQuery('') }}>Another place</button>{selected?.kind !== 'make' && <button type="button" disabled={!!flight} onClick={() => choose({ kind: 'make', name: (note.tags?.[0] || note.title).slice(0, 80), why: 'A new topic for this thought.' })}>New topic</button>}</div>
          {ai?.message && <p className="sort-ai-message" role="status">{ai.message}</p>}
        </>}
      </section>
    </div></div>
    <footer className="sort-session-footer">
      <div className="sort-tray"><span className="sort-eyebrow">Unsorted · five at a time</span><div role="group" aria-label="Five sticky batch">{batchIds.map((id, index) => {
        const item = notes.find((item) => item.id === id)
        return item && !later.has(id) ? <button type="button" key={id} className="sort-mini" data-paper={item.color || papers[index]} title={item.title} aria-label={`Sort ${item.title}`} aria-pressed={note?.id === id} disabled={!!flight} onClick={() => { setActiveId(id); setPeek(null); setFindPlace(false); setReadNote(null) }}><span>{item.title}</span></button> : <div key={id} className="sort-mini is-done"><Check /><small>{item ? 'Later' : 'Placed'}</small></div>
      })}</div></div>
      <div className="sort-trail"><div className="sort-announcement" role="status">{flight ? `Placing in ${history.at(-1)?.label}…` : notice}</div>{recent.length > 0 && <details><summary>Recently placed <span>{history.length}</span></summary><div>{recent.map((entry, index) => {
        const item = workspace.notes.find((item) => item.id === entry.noteId)
        return <button type="button" key={`${entry.noteId}:${index}`} disabled={!!flight || entry.trash || !item || item.trashedAt || item.archived} onClick={() => item.folderId ? openPlace(item.folderId, item.id) : actions.revealPlacement({ noteId: item.id })}><span>{item?.title || 'Sticky no longer available'}<small>{entry.trash ? 'Trash · Undo to restore' : item?.folderId ? folderPath(workspace.folders, item.folderId).join(' / ') : 'On Sky'}</small></span><CaretRight /></button>
      })}</div></details>}{history.at(-1) && !history.at(-1).trash && <button type="button" disabled={!!flight} className="sort-last-place" onClick={() => {
        const item = workspace.notes.find((item) => item.id === history.at(-1).noteId)
        if (!item || item.trashedAt || item.archived) return
        item.folderId ? openPlace(item.folderId, item.id) : actions.revealPlacement({ noteId: item.id })
      }}>Open {history.at(-1).label}<CaretRight /></button>}<button type="button" disabled={!history.length || !!flight} onClick={undo}><ArrowCounterClockwise /> Undo last placement</button></div>
    </footer>
  </section>
}

// The same wire geometry as Sky, measured from the actual responsive cards.
function SortConnections({ noteId, folderId, name }) {
  const ref = useRef(null)
  const [lines, setLines] = useState([])
  useEffect(() => {
    const stage = ref.current.parentElement
    const measure = () => {
      const origin = stage.getBoundingClientRect()
      const box = (element) => { const rect = element.getBoundingClientRect(); return { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height } }
      const source = stage.querySelector('[data-sort-box="source"]')
      const home = stage.querySelector('[data-sort-box="home"]')
      const parents = [...stage.querySelectorAll('[data-sort-box="parent"]')]
      if (!source || !home) { setLines([]); return }
      const edges = [{ from: source, to: parents[0] || home, proposal: true }, ...parents.map((parent, index) => ({ from: parent, to: parents[index + 1] || home })), ...[...stage.querySelectorAll('[data-sort-box="neighbor"], [data-sort-box="landing"]')].map((child) => ({ from: home, to: child }))]
      setLines(edges.map(({ from, to, proposal }) => ({ d: edgePath(box(from), box(to)).d, proposal })))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(stage); stage.querySelectorAll('[data-sort-box]').forEach((element) => observer.observe(element))
    measure()
    return () => observer.disconnect()
  }, [noteId, folderId, name])
  return <svg className="sort-wires" ref={ref} aria-hidden="true">{lines.map((line, index) => <path key={index} className={line.proposal ? 'is-proposal' : undefined} d={line.d} />)}</svg>
}
