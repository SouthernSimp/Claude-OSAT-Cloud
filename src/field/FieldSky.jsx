import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Minus, Plus } from '@phosphor-icons/react'

import { isActiveNote } from '../notes-model.js'
import { sampleNotes } from './field-sample.js'
import { FieldBanner, useReducedMotion } from './FieldChrome.jsx'
import { buildSkyGraph, constellationLabels, fitCamera, runSky, skyEnergy, stepSky } from './field-model.js'

function signatureOf(notes) {
  return notes.map((note) => `${note.id}:${note.updatedAt}:${note.title}`).join('|')
}

export function FieldSky({
  workspace,
  navigate,
  preview,
  sampled,
  onKeep,
  onBlank,
  onRemove,
}) {
  const viewport = useRef(null)
  const nodesRef = useRef([])
  const linksRef = useRef([])
  const loopRef = useRef(0)
  const reduced = useReducedMotion()
  const real = workspace.notes.filter(isActiveNote)
  const source = preview ? sampleNotes() : real
  const signature = signatureOf(source)
  const graph = useMemo(() => {
    const built = buildSkyGraph(preview ? sampleNotes() : workspace.notes)
    return { links: built.links, nodes: runSky(built.nodes, built.links, reduced ? 170 : 140) }
  }, [signature, preview, reduced])
  const [nodes, setNodes] = useState(graph.nodes)
  const [cam, setCam] = useState({ x: 80, y: 60, z: 0.7 })
  const [hover, setHover] = useState(null)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const intro = useRef(0)

  useEffect(() => {
    const seeded = reduced ? runSky(graph.nodes, graph.links, 170) : graph.nodes.map((node) => ({ ...node }))
    nodesRef.current = seeded
    linksRef.current = graph.links
    setNodes(seeded)
    setSelected(null)
  }, [graph, reduced])

  function wake() {
    if (reduced || loopRef.current) return
    let frames = 0
    const tick = () => {
      frames += 1
      const next = stepSky(nodesRef.current, linksRef.current)
      nodesRef.current = frames > 40 ? next.map((node) => ({ ...node, vx: 0, vy: 0 })) : next
      setNodes(nodesRef.current)
      if (frames < 40 && skyEnergy(next) > 1.5) loopRef.current = requestAnimationFrame(tick)
      else loopRef.current = 0
    }
    loopRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    const view = viewport.current
    if (!view) return undefined
    const fitted = fitCamera(nodesRef.current, view.clientWidth, view.clientHeight)
    if (reduced) {
      setCam(fitted)
      return undefined
    }
    const hot = [...nodesRef.current].sort((a, b) => b.heat - a.heat || b.degree - a.degree)[0]
    const z0 = Math.min(1.65, Math.max(fitted.z + 0.45, 1.05))
    const from = hot
      ? { x: view.clientWidth / 2 - hot.x * z0, y: view.clientHeight / 2 - hot.y * z0, z: z0 }
      : fitted
    const started = performance.now()
    setCam(from)
    const tick = (now) => {
      const t = Math.min(1, (now - started) / 1500)
      const eased = 1 - (1 - t) ** 3
      setCam({
        x: from.x + (fitted.x - from.x) * eased,
        y: from.y + (fitted.y - from.y) * eased,
        z: from.z + (fitted.z - from.z) * eased,
      })
      if (t < 1) intro.current = requestAnimationFrame(tick)
    }
    intro.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(intro.current)
  }, [signature, reduced])

  function stopIntro() {
    cancelAnimationFrame(intro.current)
  }

  function onWheel(event) {
    event.preventDefault()
    stopIntro()
    const rect = viewport.current.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    setCam((current) => {
      const worldX = (px - current.x) / current.z
      const worldY = (py - current.y) / current.z
      const nextZ = Math.max(0.32, Math.min(2.2, current.z * (event.deltaY < 0 ? 1.08 : 0.92)))
      return { z: nextZ, x: px - worldX * nextZ, y: py - worldY * nextZ }
    })
  }

  useEffect(() => {
    const node = viewport.current
    if (!node) return undefined
    const handler = (event) => onWheel(event)
    node.addEventListener('wheel', handler, { passive: false })
    return () => node.removeEventListener('wheel', handler)
  })

  function panFrom(event) {
    if (event.button !== 0 || event.target.closest('.sky-star, .sky-card, .sky-tools, .field-banner, .sky-search')) return
    stopIntro()
    const startX = event.clientX
    const startY = event.clientY
    const origin = { ...cam }
    const move = (ev) => setCam({ ...origin, x: origin.x + ev.clientX - startX, y: origin.y + ev.clientY - startY })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function dragStar(event, id) {
    if (event.button !== 0) return
    event.stopPropagation()
    stopIntro()
    const startX = event.clientX
    const startY = event.clientY
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node) return
    let moved = false
    const origin = { x: node.x, y: node.y }
    const move = (ev) => {
      const dx = (ev.clientX - startX) / cam.z
      const dy = (ev.clientY - startY) / cam.z
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) moved = true
      nodesRef.current = nodesRef.current.map((item) => item.id === id ? { ...item, x: origin.x + dx, y: origin.y + dy, pinned: true, vx: 0, vy: 0 } : item)
      setNodes(nodesRef.current)
      wake()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const star = event.currentTarget
      if (star) star.dataset.dragged = moved ? '1' : ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function fit() {
    const view = viewport.current
    if (!view) return
    stopIntro()
    setCam(fitCamera(nodesRef.current, view.clientWidth, view.clientHeight))
  }

  function openNote(id) {
    if (preview) onKeep(id)
    else navigate('Today', { noteId: id })
  }

  const q = query.trim().toLowerCase()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const focusId = hover || selected
  const labels = []
  for (const label of constellationLabels(nodes).sort((a, b) => b.count - a.count)) {
    if (labels.some((other) => Math.hypot(other.x - label.x, other.y - label.y) < 280)) continue
    labels.push(label)
  }
  const namedIds = new Set()
  const ranked = [...nodes].sort((a, b) => b.degree - a.degree || b.heat - a.heat)
  for (const node of ranked) {
    if (cam.z <= 1.65 && node.degree < 2 && node.heat < 0.9) continue
    if (cam.z <= 1.65 && namedIds.size && [...namedIds].some((id) => {
      const other = byId.get(id)
      return other && Math.hypot(other.x - node.x, other.y - node.y) < 168
    })) continue
    namedIds.add(node.id)
  }
  const selectedNode = byId.get(selected)

  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest('input, textarea')) return
      if (event.key === 'Escape') setSelected(null)
      if (event.key === '/' ) {
        event.preventDefault()
        viewport.current?.querySelector('.sky-search input')?.focus()
      }
      if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && nodesRef.current.length) {
        event.preventDefault()
        const list = nodesRef.current
        const index = Math.max(0, list.findIndex((node) => node.id === selected))
        const next = list[(index + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]
        setSelected(next.id)
      }
      if (event.key === 'Enter' && selected) openNote(selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="field-sky">
      <div
        className="sky-viewport"
        ref={viewport}
        onPointerDown={panFrom}
      >
        <div className="sky-world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
          <svg className="sky-svg" width="4000" height="3000" aria-hidden="true">
            {graph.links.map((link) => {
              const a = byId.get(link.a)
              const b = byId.get(link.b)
              if (!a || !b) return null
              const hot = focusId && (link.a === focusId || link.b === focusId)
              const dim = (focusId && !hot) || (q && !(a.title.toLowerCase().includes(q) && b.title.toLowerCase().includes(q)))
              return (
                <line
                  key={`${link.a}|${link.b}|${link.kind}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`sky-link ${link.kind === 'wiki' ? 'is-wiki' : ''} ${hot ? 'is-hot' : ''} ${dim ? 'is-dim' : ''}`}
                />
              )
            })}
          </svg>
          {labels.map((label) => (
            <span key={label.tag} className="sky-constellation" style={{ transform: `translate(${label.x}px, ${label.y}px)` }}>
              {label.tag}
            </span>
          ))}
          {nodes.map((node) => {
            const match = !q || node.title.toLowerCase().includes(q) || node.excerpt.toLowerCase().includes(q) || node.tags.some((tag) => tag.includes(q))
            const connected = !focusId || focusId === node.id || graph.links.some((link) => (link.a === focusId && link.b === node.id) || (link.b === focusId && link.a === node.id))
            return (
              <button
                key={node.id}
                type="button"
                className={`sky-star ${node.heat > 0.8 ? 'is-hot' : ''} ${selected === node.id ? 'is-selected' : ''} ${namedIds.has(node.id) ? 'is-named' : ''} ${!match || !connected ? 'is-dim' : ''}`}
                style={{ width: node.r * 2, height: node.r * 2, transform: `translate(${node.x}px, ${node.y}px) translate(-50%, -50%)` }}
                aria-label={node.title}
                aria-pressed={selected === node.id}
                onPointerEnter={() => setHover(node.id)}
                onPointerLeave={() => setHover((current) => current === node.id ? null : current)}
                onPointerDown={(event) => dragStar(event, node.id)}
                onClick={(event) => {
                  if (event.currentTarget.dataset.dragged === '1') return
                  setSelected(node.id)
                }}
                onDoubleClick={() => openNote(node.id)}
              >
                <span className="sky-name">{node.title}</span>
              </button>
            )
          })}
        </div>
      </div>
      <form className="sky-search" onSubmit={(event) => event.preventDefault()}>
        <label className="visually-hidden" htmlFor="sky-find">Find a thought</label>
        <input id="sky-find" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a thought" />
        <span>{nodes.length} {nodes.length === 1 ? 'thought' : 'thoughts'}</span>
      </form>
      <div className="sky-tools">
        <button type="button" aria-label="Zoom in" onClick={() => setCam((current) => ({ ...current, z: Math.min(2.2, current.z * 1.12) }))}><Plus /></button>
        <button type="button" aria-label="Zoom out" onClick={() => setCam((current) => ({ ...current, z: Math.max(0.32, current.z / 1.12) }))}><Minus /></button>
        <button type="button" onClick={fit}>Fit</button>
      </div>
      {selectedNode && (
        <aside className="sky-card">
          <p>{selectedNode.tags[0] ? `#${selectedNode.tags[0]}` : 'A thought'}</p>
          <h2>{selectedNode.title}</h2>
          <span>{selectedNode.excerpt}</span>
          <div>
            <button type="button" className="primary-button" onClick={() => openNote(selectedNode.id)}>
              {preview ? 'Keep and read it' : 'Lay it on the desk'} <ArrowRight />
            </button>
            {!preview && (
              <button type="button" onClick={() => navigate('Mindmap', { focusNoteId: selectedNode.id })}>On the mindmap</button>
            )}
          </div>
        </aside>
      )}
      {!nodes.length && (
        <div className="sky-empty">
          <h2>The sky is clear.</h2>
          <p>Write on the desk. Each note becomes a star, and links draw the lines between them.</p>
          <button type="button" className="primary-button" onClick={() => navigate('Today')}>Back to the desk</button>
        </div>
      )}
      <FieldBanner preview={preview} sampled={sampled} onKeep={() => onKeep()} onBlank={onBlank} onRemove={onRemove} />
    </div>
  )
}
