import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, MagnifyingGlass, Trash } from '@phosphor-icons/react'

import { forgetMemory, learnsFromChats, memoryOf, setLearnFromChats } from '../soul.js'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { brainGraph } from './brain-model.js'
import '../styles/brain.css'

const KINDS = [
  ['board', 'Boards', '--tint-teal'],
  ['note', 'Notes and stickies', '--tint-orange'],
  ['chat', 'Chats', '--tint-violet'],
  ['memory', 'Memories', '--tint-green'],
]
const SIZE = { board: 9, chat: 7, memory: 5, note: 4 }

/* The Brain (Phase 112): everything OSAT knows, drawn the way Obsidian draws a vault. Boards, notes and stickies, chats
   and what OSAT remembers from them are dots; a line joins two when one holds, names or read the other. Drag a dot,
   drag the space to move around, scroll to zoom, click to open. On the side: what OSAT has learned from your chats,
   each with Forget, and the switch that lets it keep learning. The layout is a small force simulation on a canvas.
   ponytail: every dot pushes every other (n²), fine for the few hundred the graph keeps (brainGraph's `most`). */
export function BrainRoom({ workspace, commit, navigate }) {
  const [toast, showUndo] = useUndoToast()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null)
  const memory = memoryOf(workspace.settings)
  const graph = useMemo(() => brainGraph(workspace, memory), [workspace]) // eslint-disable-line react-hooks/exhaustive-deps
  const learned = memory.filter((line) => line.chatId || /^Chat:/.test(line.from || '')).slice(-12).reverse()
  const learning = learnsFromChats(workspace.settings)

  function open(node) {
    if (node.kind === 'board') navigate('Mindmap', { folderId: node.ref.folderId })
    else if (node.kind === 'note') navigate('Notes', { noteId: node.ref.noteId })
    else if (node.kind === 'chat') navigate('Chat', { chatId: node.ref.chatId })
    else setPicked(node)
  }

  function forget(line) {
    commit((state) => forgetMemory(state, line.id))
    showUndo('Forgot it', () => commit((state) => ({ ...state, settings: { ...(state.settings || {}), memory: [...memoryOf(state.settings), line] } })))
  }

  return (
    <div className="brain">
      <section className="brain-stage" aria-label="Your brain, as a graph">
        <header className="brain-head">
          <h1><Brain weight="duotone" aria-hidden="true" /> Brain</h1>
          <p>{graph.nodes.length} {graph.nodes.length === 1 ? 'thing' : 'things'}, {graph.links.length} {graph.links.length === 1 ? 'link' : 'links'} between them</p>
          <label className="brain-find">
            <MagnifyingGlass aria-hidden="true" />
            <input type="search" placeholder="Light up…" aria-label="Light up what matches" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </header>
        <Graph graph={graph} query={query} onOpen={open} onPick={setPicked} />
        <ul className="brain-legend" aria-label="What the colours mean">
          {KINDS.map(([kind, label, tint]) => <li key={kind}><i style={{ background: `var(${tint})` }} aria-hidden="true" /> {label}</li>)}
        </ul>
        {picked && (
          <p className="brain-picked" role="status">
            <strong>{picked.label}</strong>
            {picked.kind !== 'memory' && <button type="button" className="text-button" onClick={() => open(picked)}>Open</button>}
          </p>
        )}
      </section>

      <aside className="brain-side" aria-label="What OSAT remembers">
        <h2>What OSAT remembers</h2>
        <p className="brain-quiet">Each chat with the AI on this Mac teaches OSAT the lasting things: your clients, people, plans and how you like to work. It reads the ones that fit before it answers.</p>
        <label className="brain-switch">
          <input type="checkbox" checked={learning} onChange={(event) => commit((state) => setLearnFromChats(state, event.target.checked))} />
          <span>Remember what we talk about</span>
        </label>
        <ul className="brain-memories">
          {learned.map((line) => (
            <li key={line.id}>
              <span>{line.text}<small>{line.from}</small></span>
              <button type="button" className="icon-button" aria-label={`Forget “${line.text}”`} title="Forget" onClick={() => forget(line)}><Trash /></button>
            </li>
          ))}
        </ul>
        {!learned.length && <p className="brain-quiet">Nothing learned from chats yet. Talk with OSAT in Chat and the lasting things show up here.</p>}
        <button type="button" className="text-button" onClick={() => navigate('Settings', { section: 'soul' })}>Everything OSAT knows about you…</button>
      </aside>
      {toast}
    </div>
  )
}

function Graph({ graph, query, onOpen, onPick }) {
  const canvas = useRef(null)
  const sim = useRef(null)
  const look = useRef({ query: '', hover: null })
  look.current.query = query.trim().toLowerCase()
  const hands = useRef(null)
  hands.current = { onOpen, onPick }

  // The simulation keeps where each dot was when the graph changes, so a new sticky doesn't shuffle everything.
  useEffect(() => {
    const old = new Map((sim.current?.nodes || []).map((node) => [node.id, node]))
    const nodes = graph.nodes.map((node, index) => {
      const was = old.get(node.id)
      const angle = index * 2.399963
      const radius = 40 + 9 * Math.sqrt(index)
      return { ...node, x: was?.x ?? Math.cos(angle) * radius, y: was?.y ?? Math.sin(angle) * radius, vx: 0, vy: 0, r: SIZE[node.kind] || 4 }
    })
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const links = graph.links.map((link) => ({ a: byId.get(link.source), b: byId.get(link.target) })).filter((link) => link.a && link.b)
    for (const link of links) { link.a.degree = (link.a.degree || 0) + 1; link.b.degree = (link.b.degree || 0) + 1 }
    sim.current = { nodes, links, heat: 1, view: sim.current?.view || { x: 0, y: 0, k: 1 } }
  }, [graph])

  useEffect(() => {
    const el = canvas.current
    const context = el.getContext('2d')
    const colors = {}
    let frame = 0
    let drag = null
    const readColors = () => {
      const style = getComputedStyle(el)
      for (const [kind, , tint] of KINDS) colors[kind] = style.getPropertyValue(tint).trim() || '#888'
      colors.line = style.getPropertyValue('--line-strong').trim() || 'rgba(128,128,128,.3)'
      colors.ink = style.getPropertyValue('--ink').trim() || '#222'
      colors.muted = style.getPropertyValue('--muted').trim() || '#777'
    }
    readColors()
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches

    function step() {
      const { nodes, links } = sim.current
      const heat = sim.current.heat
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j]
          let dx = a.x - b.x
          let dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) { dx = 0.1; dy = 0; d2 = 0.01 }
          if (d2 > 160000) continue
          const push = 900 / d2
          a.vx += dx * push; a.vy += dy * push; b.vx -= dx * push; b.vy -= dy * push
        }
      }
      for (const { a, b } of links) {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const pull = (d - 60) * 0.02
        a.vx += (dx / d) * pull; a.vy += (dy / d) * pull; b.vx -= (dx / d) * pull; b.vy -= (dy / d) * pull
      }
      for (const node of nodes) {
        if (node === drag?.node) continue
        node.vx = (node.vx - node.x * 0.004) * 0.82
        node.vy = (node.vy - node.y * 0.004) * 0.82
        node.x += node.vx * heat
        node.y += node.vy * heat
      }
      sim.current.heat = Math.max(0, heat - 0.004)
    }

    function draw() {
      const { nodes, links, view } = sim.current
      const ratio = devicePixelRatio || 1
      const width = el.clientWidth
      const height = el.clientHeight
      if (el.width !== width * ratio || el.height !== height * ratio) { el.width = width * ratio; el.height = height * ratio }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.translate(width / 2 + view.x, height / 2 + view.y)
      context.scale(view.k, view.k)
      const { query: words, hover } = look.current
      const lit = (node) => !words || node.label.toLowerCase().includes(words)
      const near = hover ? new Set(links.flatMap((link) => (link.a === hover ? [link.b] : link.b === hover ? [link.a] : []))) : null
      context.lineWidth = 1 / view.k
      for (const { a, b } of links) {
        const on = hover && (a === hover || b === hover)
        context.globalAlpha = hover ? (on ? 0.9 : 0.12) : words ? 0.15 : 0.5
        context.strokeStyle = on ? colors[hover.kind] : colors.line
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke()
      }
      for (const node of nodes) {
        const faded = (hover && node !== hover && !near.has(node)) || !lit(node)
        context.globalAlpha = faded ? 0.18 : 1
        context.fillStyle = colors[node.kind]
        context.beginPath(); context.arc(node.x, node.y, node.r + Math.min(4, (node.degree || 0) * 0.4), 0, Math.PI * 2); context.fill()
      }
      context.font = `${12 / view.k}px -apple-system, system-ui, sans-serif`
      context.textAlign = 'center'
      for (const node of nodes) {
        const show = node === hover || near?.has(node) || (words && lit(node)) || node.kind === 'board' || view.k > 1.6
        if (!show) continue
        context.globalAlpha = hover && node !== hover && !near.has(node) ? 0.25 : 1
        context.fillStyle = node === hover ? colors.ink : colors.muted
        const label = node.label.length > 42 ? `${node.label.slice(0, 41)}…` : node.label
        context.fillText(label, node.x, node.y + node.r + 14 / view.k)
      }
      context.globalAlpha = 1
    }

    function loop() {
      if (sim.current.heat > 0 && !still) step()
      else if (still && sim.current.heat > 0) { for (let n = 0; n < 250; n += 1) step(); sim.current.heat = 0 }
      draw()
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)

    const toWorld = (event) => {
      const box = el.getBoundingClientRect()
      const { view } = sim.current
      return { x: (event.clientX - box.left - box.width / 2 - view.x) / view.k, y: (event.clientY - box.top - box.height / 2 - view.y) / view.k }
    }
    const hit = (event) => {
      const at = toWorld(event)
      let best = null
      let bestD = Infinity
      for (const node of sim.current.nodes) {
        const d = Math.hypot(node.x - at.x, node.y - at.y)
        if (d < node.r + 6 / sim.current.view.k && d < bestD) { best = node; bestD = d }
      }
      return best
    }
    const down = (event) => {
      const node = hit(event)
      drag = { node, x: event.clientX, y: event.clientY, moved: false, view: { ...sim.current.view } }
      el.setPointerCapture(event.pointerId)
    }
    const move = (event) => {
      if (!drag) {
        const node = hit(event)
        if (look.current.hover !== node) { look.current.hover = node; el.style.cursor = node ? 'pointer' : 'grab' }
        return
      }
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) drag.moved = true
      if (drag.node) {
        const at = toWorld(event)
        drag.node.x = at.x; drag.node.y = at.y; drag.node.vx = 0; drag.node.vy = 0
        sim.current.heat = Math.max(sim.current.heat, 0.3)
      } else {
        sim.current.view.x = drag.view.x + event.clientX - drag.x
        sim.current.view.y = drag.view.y + event.clientY - drag.y
      }
    }
    const up = () => {
      if (drag && !drag.moved && drag.node) hands.current.onOpen(drag.node)
      else if (drag && !drag.moved) hands.current.onPick(null)
      drag = null
    }
    const wheel = (event) => {
      event.preventDefault()
      const { view } = sim.current
      const box = el.getBoundingClientRect()
      const px = event.clientX - box.left - box.width / 2
      const py = event.clientY - box.top - box.height / 2
      const k = Math.min(4, Math.max(0.2, view.k * Math.exp(-event.deltaY * 0.0015)))
      view.x = px - ((px - view.x) / view.k) * k
      view.y = py - ((py - view.y) / view.k) * k
      view.k = k
    }
    const leave = () => { look.current.hover = null }
    const theme = new MutationObserver(readColors)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      cancelAnimationFrame(frame)
      theme.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('wheel', wheel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvas} className="brain-canvas" role="img" aria-label={`A graph of ${graph.nodes.length} things and the links between them`} />
}
