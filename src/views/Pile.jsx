import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp, CornersOut, Crosshair, DotsThree, Image, PaintBucket, PencilSimple, Plus, Scissors, Sparkle, Stack, Trash, X,
} from '@phosphor-icons/react'

import { answeringLabel, askModel } from '../assistant/ask-model.js'
import { cleanError, useAi } from '../assistant/useAi.js'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { PAPERS } from '../note-core.js'
import { purgeNotes } from '../notes-model.js'
import {
  addCards, branchName, CARD, dropCard, editCard, groupBox, groupMessages, memberSpot, membersOf, MIDDLE, moveGroup, newPile, paintCard, pileName,
  pilesOf, readGroupAnswer, removeCards, renameGroup, sendToSky, setPiles, settle, splitCard, splitStickies, takeSuggestion, ungroup, updatePile, wordSuggestions,
} from '../pile-model.js'
import { NameField } from '../sky/Piles.jsx'
import '../styles/pile.css'

const CURRENT_KEY = 'osat.pile.current.v1'
const readCurrent = () => { try { return localStorage.getItem(CURRENT_KEY) } catch { return null } }
const keepCurrent = (id) => { try { if (id) localStorage.setItem(CURRENT_KEY, id); else localStorage.removeItem(CURRENT_KEY) } catch { /* a convenience only */ } }

/* Sort a pile: a table of its own for one pile of paper stickies (Nate's sketch: a quick
   input in the middle, stickies landing around it). Toss them down, drop one on another to
   start a branch, ask for help, then send the pile to the Sky once it's sorted. Until then
   it stays here, saved, apart from your nodes (pile-model.js). */
export function PileView({ workspace, commit, navigate, onClose }) {
  const piles = pilesOf(workspace)
  const [currentId, setCurrentId] = useState(readCurrent)
  // Right after a pile goes to the Sky the table is empty (blank) until the next sticky.
  const [blank, setBlank] = useState(false)
  const pile = blank ? null : piles.find((item) => item.id === currentId) || piles.at(-1) || null
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 })
  const [drag, setDrag] = useState(null)
  const [editing, setEditing] = useState(null)
  const [naming, setNaming] = useState(null)
  const [help, setHelp] = useState(null)
  const [sending, setSending] = useState(null)
  const [sent, setSent] = useState(null)
  const [reading, setReading] = useState('')
  const [dropping, setDropping] = useState(false)
  const [menu, openMenu] = useContextMenu()
  const [toast, showUndo] = useUndoToast()
  const { models } = useAi()
  const answering = answeringLabel(models)
  const table = useRef(null)
  const input = useRef(null)
  const latest = useRef({ pile, cam })
  const pending = useRef(null)
  latest.current = { pile, cam }
  const files = typeof window === 'undefined' ? null : window.nateOSFiles

  function choose(id) {
    setCurrentId(id)
    keepCurrent(id)
    setBlank(false)
    pending.current = id
    setHelp(null)
    setSending(null)
  }

  /* Changes the pile on the table, making one first when there is none yet. */
  function change(update) {
    let made = null
    let after = null
    commit((state) => {
      let next = state
      // A pile made a moment ago counts before the table has drawn it.
      let id = [latest.current.pile?.id, pending.current].find((value) => value && pilesOf(next).some((item) => item.id === value))
      if (!id) {
        const fresh = newPile(next)
        next = fresh.state
        id = fresh.pile.id
        made = id
        pending.current = id
      }
      return updatePile(next, id, (p) => { after = settle(update(p)); return after })
    })
    if (made) choose(made)
    setSent(null)
    return after
  }

  /* ---------- the camera ---------- */

  const toWorld = (clientX, clientY) => {
    const box = table.current.getBoundingClientRect()
    const { cam: c } = latest.current
    return { x: (clientX - box.left - box.width / 2 - c.x) / c.z, y: (clientY - box.top - box.height / 2 - c.y) / c.z }
  }

  function bounds(of = latest.current.pile) {
    const boxes = [{ x: -MIDDLE.w / 2, y: -MIDDLE.h / 2, w: MIDDLE.w, h: MIDDLE.h }]
    of?.cards.forEach((card) => { if (!card.group) boxes.push({ x: card.x, y: card.y, w: CARD.w, h: CARD.h }) })
    of?.groups.forEach((group) => boxes.push(groupBox(group, membersOf(of, group.id).length)))
    const left = Math.min(...boxes.map((box) => box.x))
    const top = Math.min(...boxes.map((box) => box.y))
    return { left, top, right: Math.max(...boxes.map((box) => box.x + box.w)), bottom: Math.max(...boxes.map((box) => box.y + box.h)) }
  }

  /* See everything (never closer than 100%, never smaller than 30%). */
  function fit(of) {
    const box = table.current?.getBoundingClientRect()
    if (!box) return
    const b = bounds(of)
    const z = Math.max(0.3, Math.min(1, (box.width - 60) / (b.right - b.left), (box.height - 60) / (b.bottom - b.top)))
    setCam({ z, x: -((b.left + b.right) / 2) * z, y: -((b.top + b.bottom) / 2) * z })
  }

  /* After new stickies land: if any fell outside the view, step back to see them all. */
  function reveal(of) {
    const box = table.current?.getBoundingClientRect()
    if (!box || !of) return
    const { cam: c } = latest.current
    const b = bounds(of)
    const inside = (x, y) => Math.abs(x * c.z + c.x) < box.width / 2 && Math.abs(y * c.z + c.y) < box.height / 2
    if (!inside(b.left, b.top) || !inside(b.right, b.bottom)) fit(of)
  }

  useEffect(() => {
    const node = table.current
    if (!node) return undefined
    const onWheel = (event) => {
      if (event.target.closest?.('textarea, .pile-help')) return
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const box = node.getBoundingClientRect()
        const px = event.clientX - box.left - box.width / 2
        const py = event.clientY - box.top - box.height / 2
        setCam((c) => {
          const z = Math.max(0.3, Math.min(1.6, c.z * Math.exp(-event.deltaY * 0.01)))
          return { z, x: px - ((px - c.x) / c.z) * z, y: py - ((py - c.y) / c.z) * z }
        })
      } else {
        setCam((c) => ({ ...c, x: c.x - event.deltaX, y: c.y - event.deltaY }))
      }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => { input.current?.focus() }, [pile?.id])

  /* ---------- carrying things across the table ---------- */

  function hit(clientX, clientY, skip) {
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      if (!table.current?.contains(element)) continue
      const card = element.closest('[data-pile-card]')
      if (card && card.dataset.pileCard !== skip) return { kind: 'card', id: card.dataset.pileCard }
      const group = element.closest('[data-pile-group]')
      if (group && group.dataset.pileGroup !== skip) return { kind: 'group', id: group.dataset.pileGroup }
    }
    return null
  }

  /* One press: a sticky (or a branch's name) is picked up after it moves 4 px; on the open
     table, the table moves. */
  function press(event, what) {
    if (event.button !== 0 || event.target.closest('button, textarea, input, .no-carry')) return
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY }
    const grab = toWorld(event.clientX, event.clientY)
    const camAt = latest.current.cam
    let moved = false
    let last = null
    const move = (e) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return
      moved = true
      if (what.kind === 'table') {
        setCam({ ...camAt, x: camAt.x + e.clientX - start.x, y: camAt.y + e.clientY - start.y })
        return
      }
      const at = toWorld(e.clientX, e.clientY)
      last = { ...what, x: what.x + at.x - grab.x, y: what.y + at.y - grab.y, over: what.kind === 'card' ? hit(e.clientX, e.clientY, what.id) : null, clientX: e.clientX, clientY: e.clientY }
      setDrag(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key, true)
      setDrag(null)
      if (!moved || !last) return
      if (what.kind === 'group') { change((p) => moveGroup(p, what.id, last.x, last.y)); return }
      let started = null
      const target = last.over || { kind: 'table', x: last.x, y: last.y }
      change((p) => { const result = dropCard(p, what.id, target); started = result.started; return result.pile })
      if (started) setNaming(started)
    }
    // Esc puts it back where it was.
    const key = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      last = null
      moved = false
      up()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key, true)
  }

  /* ---------- writing ---------- */

  function add(texts) {
    const list = texts.filter((value) => value.trim())
    if (!list.length) return []
    let ids = []
    const after = change((p) => { const result = addCards(p, list); ids = result.ids; return result.pile })
    requestAnimationFrame(() => reveal(after))
    return ids
  }

  function addMany(texts, what) {
    const ids = add(texts)
    if (ids.length > 1) showUndo(`Added ${ids.length} stickies${what ? ` from ${what}` : ''}`, () => change((p) => removeCards(p, ids)))
  }

  function onKey(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      const value = event.currentTarget.value.trim()
      if (value) add([value])
      event.currentTarget.value = ''
    }
  }

  function onPaste(event) {
    const parts = splitStickies(event.clipboardData?.getData('text/plain'))
    if (parts.length < 2) return
    event.preventDefault()
    addMany(parts)
  }

  /* Photos of a pile (or a scan, a PDF, a text file): the Mac reads the words (Vision, on
     this Mac) and each line becomes a sticky, ready to fix and sort. */
  async function readFiles(list) {
    for (const load of list) {
      setReading('Reading…')
      try {
        const result = await load()
        if (!result) continue
        setReading(`Reading “${result.name}”…`)
        const parts = splitStickies(result.text)
        if (parts.length) addMany(parts, `“${result.name}”`)
        else showUndo(`OSAT found no words in “${result.name}”.`, null)
      } catch (error) {
        showUndo(`That file couldn’t be read: ${cleanError(error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, null)
      }
    }
    setReading('')
    input.current?.focus()
  }

  function onDrop(event) {
    setDropping(false)
    if (!files?.attachDropped || !event.dataTransfer?.files?.length) return
    event.preventDefault()
    readFiles([...event.dataTransfer.files].slice(0, 12).map((file) => () => files.attachDropped(file)))
  }

  /* ---------- a sticky's and a branch's menus ---------- */

  function tossCards(ids, line) {
    const before = latest.current.pile
    change((p) => removeCards(p, ids))
    showUndo(line, () => commit((state) => updatePile(state, before.id, () => before)))
  }

  function cardMenu(event, card) {
    openMenu(event, [
      { label: 'Edit', icon: PencilSimple, onSelect: () => setEditing(card.id) },
      card.text.includes('\n') ? { label: 'Split into stickies', icon: Scissors, onSelect: () => change((p) => splitCard(p, card.id)) } : null,
      { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: card.color || 'canary', onPick: (paper) => change((p) => paintCard(p, card.id, paper)) }] },
      card.group ? { label: 'Take out of the branch', icon: ArrowUp, onSelect: () => change((p) => dropCard(p, card.id, { kind: 'table', ...outside(p) }).pile) } : null,
      { divider: true },
      { label: 'Delete', icon: Trash, danger: true, onSelect: () => tossCards([card.id], `Deleted “${card.text.slice(0, 40)}”`) },
    ])
  }

  const outside = (p) => { const b = bounds(p); return { x: Math.round(b.right + 40), y: Math.round(b.top) } }

  function groupMenu(event, group) {
    openMenu(event, [
      { label: 'Rename', icon: PencilSimple, onSelect: () => setNaming(group.id) },
      { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: group.color || 'bone', onPick: (paper) => change((p) => ({ ...p, groups: p.groups.map((item) => (item.id === group.id ? { ...item, color: paper } : item)) })) }] },
      { divider: true },
      { label: 'Let go of the branch', icon: X, onSelect: () => change((p) => ungroup(p, group.id)) },
    ])
  }

  function pilesMenu(event) {
    openMenu(event, [
      ...piles.map((item) => ({ label: `${pileName(item)} · ${item.cards.length} ${item.cards.length === 1 ? 'sticky' : 'stickies'}`, checked: item.id === pile?.id, onSelect: () => choose(item.id) })),
      piles.length ? { divider: true } : null,
      { label: 'New pile', icon: Plus, onSelect: startPile },
      pile ? { label: 'Delete this pile', icon: Trash, danger: true, onSelect: () => deletePile(pile) } : null,
    ])
  }

  function startPile() {
    let id = null
    commit((state) => { const made = newPile(state); id = made.pile.id; return made.state })
    choose(id)
    setSent(null)
    setCam({ x: 0, y: 0, z: 1 })
  }

  function deletePile(which) {
    commit((state) => setPiles(state, pilesOf(state).filter((item) => item.id !== which.id)))
    showUndo(`Deleted ${pileName(which)}`, () => commit((state) => setPiles(state, [...pilesOf(state), which])))
  }

  /* ---------- help ---------- */

  async function askHelp() {
    const now = latest.current.pile
    if (!now?.cards.some((card) => !card.group)) { setHelp({ line: 'Every sticky is in a branch already.', suggestions: [] }); return }
    if (!answering) { showWords(now, ''); return }
    setHelp({ busy: true, line: `Asking ${answering}…`, suggestions: [] })
    try {
      const found = readGroupAnswer(await askModel(groupMessages(now)), latest.current.pile)
      if (found.length) setHelp({ line: `${answering} suggests:`, suggestions: found })
      else showWords(latest.current.pile, 'The AI didn’t suggest anything clear. ')
    } catch (error) {
      showWords(latest.current.pile, `${cleanError(error)} `)
    }
  }

  function showWords(of, before) {
    const found = wordSuggestions(of)
    setHelp({ line: found.length ? `${before}These share words:` : `${before}Nothing clearly belongs together yet. Drop a sticky on another to start a branch.`, suggestions: found })
  }

  function take(list) {
    const before = latest.current.pile
    const after = change((p) => list.reduce(takeSuggestion, p))
    requestAnimationFrame(() => reveal(after))
    setHelp((value) => {
      const gone = new Set(list)
      const rest = value?.suggestions.filter((item) => !gone.has(item)) || []
      return rest.length ? { ...value, suggestions: rest } : null
    })
    showUndo(list.length === 1 ? `Made the branch “${list[0].name}”` : `Made ${list.length} branches`, () => commit((state) => updatePile(state, before.id, () => before)))
  }

  /* ---------- to the Sky ---------- */

  function send({ name, mode }) {
    const before = latest.current.pile
    let made = null
    commit((state) => { made = sendToSky(state, before.id, { name, mode }); return made.state })
    setSending(null)
    setHelp(null)
    if (!made?.nodes.length && !made?.notes.length) return
    const label = mode === 'one' ? (name.trim() || pileName(before)) : `${made.nodes.length} ${made.nodes.length === 1 ? 'node' : 'nodes'}`
    setSent({ label, nodeId: made.nodes[0] || null })
    setCurrentId(null)
    keepCurrent(null)
    setBlank(true)
    pending.current = null
    setCam({ x: 0, y: 0, z: 1 })
    showUndo(`Sent ${label} to the Sky`, () => {
      commit((state) => purgeNotes({
        ...setPiles(state, [...pilesOf(state), before]),
        folders: state.folders.filter((folder) => !made.folders.includes(folder.id)),
      }, made.notes))
      choose(before.id)
      setSent(null)
    })
  }

  /* ---------- drawing ---------- */

  const counts = useMemo(() => new Map(pile?.groups.map((group) => [group.id, membersOf(pile, group.id).length]) || []), [pile])
  const ghosts = useMemo(() => (pile?.cards.length || sent ? [] : ringOf(5)), [pile?.cards.length, sent])
  const spotOf = (card) => {
    if (drag?.kind === 'card' && drag.id === card.id) return { x: drag.x, y: drag.y }
    if (!card.group) return { x: card.x, y: card.y }
    const group = pile.groups.find((item) => item.id === card.group)
    const members = membersOf(pile, card.group)
    const at = members.findIndex((item) => item.id === card.id)
    const origin = drag?.kind === 'group' && drag.id === group.id ? { ...group, x: drag.x, y: drag.y } : group
    return memberSpot(origin, at, members.length)
  }
  const target = drag?.over
  const loose = pile?.cards.filter((card) => !card.group).length || 0

  return (
    <div className="pile-room">
      <header className="pile-bar">
        <button type="button" className="pile-which" onClick={pilesMenu} title="Your piles"><Stack weight="bold" /> {pile ? pileName(pile) : 'New pile'} <DotsThree weight="bold" /></button>
        {pile && (
          <input
            key={pile.id}
            className="pile-name"
            defaultValue={pile.name}
            placeholder="Name this pile"
            aria-label="Name this pile"
            maxLength={80}
            onBlur={(event) => { if (event.target.value.trim() !== pile.name) change((p) => ({ ...p, name: event.target.value.trim() })) }}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          />
        )}
        <span className="pile-bar-gap" />
        {files?.attachChosen && (
          <button type="button" className="pile-tool" onClick={() => readFiles([() => files.attachChosen()])} title="Read a photo, scan or PDF of a pile into stickies"><Image weight="bold" /> Photo</button>
        )}
        <button type="button" className="pile-tool" onClick={askHelp} disabled={!pile?.cards.length || help?.busy}><Sparkle weight="bold" /> Help me sort</button>
        <button type="button" className="pile-send" onClick={() => setSending({ name: pile?.name || '', mode: 'one' })} disabled={!pile?.cards.length}>Send to the Sky</button>
      </header>

      <div
        ref={table}
        className={`pile-table ${dropping ? 'is-dropping' : ''} ${drag ? 'is-carrying' : ''}`}
        onPointerDown={(event) => { if (event.target === event.currentTarget || event.target.classList.contains('pile-world')) press(event, { kind: 'table' }) }}
        onDoubleClick={(event) => { if (event.target === event.currentTarget || event.target.classList.contains('pile-world')) input.current?.focus() }}
        onDragOver={(event) => { if (files?.attachDropped && [...(event.dataTransfer?.types || [])].includes('Files')) { event.preventDefault(); setDropping(true) } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropping(false) }}
        onDrop={onDrop}
      >
        <div className="pile-world" style={{ translate: `${cam.x}px ${cam.y}px`, scale: String(cam.z) }}>
          {ghosts.map((spot, index) => <i key={index} className="pile-ghost" style={{ translate: `${spot.x}px ${spot.y}px` }} aria-hidden="true" />)}

          {pile?.groups.map((group) => {
            const origin = drag?.kind === 'group' && drag.id === group.id ? { ...group, x: drag.x, y: drag.y } : group
            const box = groupBox(origin, counts.get(group.id) || 1)
            return (
              <section
                key={group.id}
                className={`pile-group ${target?.kind === 'group' && target.id === group.id ? 'is-target' : ''}`}
                data-pile-group={group.id}
                style={{ translate: `${box.x}px ${box.y}px`, width: box.w, height: box.h }}
                aria-label={`Branch: ${branchName(pile, group)}`}
                onContextMenu={(event) => groupMenu(event, group)}
              >
                <div className="pile-group-head" data-paper={group.color || 'bone'} onPointerDown={(event) => press(event, { kind: 'group', id: group.id, x: group.x, y: group.y })} onDoubleClick={() => setNaming(group.id)}>
                  {naming === group.id
                    ? <NameField initial={group.name} placeholder="Name the branch" onDone={(name) => { setNaming(null); if (name) change((p) => renameGroup(p, group.id, name)); input.current?.focus() }} />
                    : <strong>{branchName(pile, group)}</strong>}
                  <small>{counts.get(group.id)}</small>
                  <button type="button" aria-label={`More for ${branchName(pile, group)}`} onClick={(event) => groupMenu(event, group)}><DotsThree weight="bold" /></button>
                </div>
              </section>
            )
          })}

          {pile?.cards.map((card) => {
            const spot = spotOf(card)
            const carried = drag?.kind === 'card' && drag.id === card.id
            return (
              <article
                key={card.id}
                className={`pile-card ${carried ? 'is-carried' : ''} ${target?.kind === 'card' && target.id === card.id ? 'is-target' : ''}`}
                data-pile-card={card.id}
                data-paper={card.color || 'canary'}
                style={{ translate: `${spot.x}px ${spot.y}px` }}
                onPointerDown={(event) => { if (editing !== card.id) press(event, { kind: 'card', id: card.id, x: spot.x, y: spot.y }) }}
                onDoubleClick={() => setEditing(card.id)}
                onContextMenu={(event) => cardMenu(event, card)}
              >
                {editing === card.id
                  ? <CardEditor card={card} onDone={(value) => { setEditing(null); if (value !== card.text) (value.trim() ? change((p) => editCard(p, card.id, value)) : tossCards([card.id], 'Deleted an empty sticky')); input.current?.focus() }} />
                  : <p>{card.text}</p>}
                {editing !== card.id && <button type="button" className="pile-card-x" aria-label="Delete this sticky" title="Delete" onClick={() => tossCards([card.id], `Deleted “${card.text.slice(0, 40)}”`)}><X weight="bold" /></button>}
                {carried && target?.kind === 'card' && !pile.cards.find((item) => item.id === target.id)?.group && <em className="pile-card-hint">Let go to start a branch</em>}
              </article>
            )
          })}

          <div className="pile-middle" style={{ width: MIDDLE.w }}>
            <textarea
              ref={input}
              className="pile-input no-carry"
              rows={1}
              placeholder="Quick input: write a sticky, then Return"
              aria-label="Write a sticky"
              maxLength={2000}
              onKeyDown={onKey}
              onPaste={onPaste}
            />
            <p className="pile-under">
              {reading || (pile?.cards.length
                ? `${loose ? `${loose} not in a branch yet` : 'Every sticky is in a branch'} · drop one sticky on another to start a branch`
                : 'Toss down a pile, one sticky at a time. Paste a list to add many at once.')}
            </p>
          </div>
        </div>

        {sent && !pile?.cards.length && (
          <div className="pile-sent" role="status">
            <p>Sent {sent.label} to the Sky.</p>
            {sent.nodeId && <button type="button" className="is-primary" onClick={() => { navigate('Mindmap', { folderId: sent.nodeId, open: true }); onClose?.() }}>See it in the Sky</button>}
            <button type="button" onClick={() => { setSent(null); input.current?.focus() }}>Start the next pile</button>
          </div>
        )}

        {help && (
          <aside className="pile-help" aria-label="Help me sort">
            <header>
              <strong>Help me sort</strong>
              <button type="button" aria-label="Close help" onClick={() => setHelp(null)}><X weight="bold" /></button>
            </header>
            <p>{help.line}</p>
            {help.suggestions.map((item) => (
              <div key={`${item.groupId || ''}${item.name}`} className="pile-suggestion">
                <p><strong>{item.name}</strong>{item.groupId ? ' (a branch)' : ''}: {item.cardIds.map((id) => pile?.cards.find((card) => card.id === id)?.text.split('\n')[0].slice(0, 36)).filter(Boolean).map((words) => `“${words}”`).join(', ')}</p>
                <div>
                  <button type="button" className="is-primary" onClick={() => take([item])}>{item.groupId ? 'Add to it' : 'Make the branch'}</button>
                  <button type="button" onClick={() => setHelp((value) => { const rest = value.suggestions.filter((other) => other !== item); return rest.length ? { ...value, suggestions: rest } : null })}>Dismiss</button>
                </div>
              </div>
            ))}
            {help.suggestions.length > 1 && <button type="button" className="pile-take-all" onClick={() => take(help.suggestions)}>Make them all</button>}
          </aside>
        )}

        <div className="pile-zoom" role="group" aria-label="Zoom">
          <button type="button" title="Back to the middle" aria-label="Back to the middle" onClick={() => { setCam({ x: 0, y: 0, z: 1 }); input.current?.focus() }}><Crosshair weight="bold" /></button>
          <button type="button" title="See everything" onClick={() => fit()}><CornersOut weight="bold" /> {Math.round(cam.z * 100)}%</button>
        </div>
        {dropping && <p className="pile-drop-line">Drop photos of a pile to read them into stickies</p>}
      </div>

      {sending && pile && <SendPanel pile={pile} initial={sending} onSend={send} onCancel={() => setSending(null)} />}
      {toast}
      {menu}
    </div>
  )
}

/* Where the five paper outlines of an empty table sit (Nate's sketch). */
function ringOf(count) {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
    return { x: Math.round(Math.cos(angle) * (MIDDLE.w / 2 + 150) - CARD.w / 2), y: Math.round(Math.sin(angle) * (MIDDLE.h / 2 + 120) - CARD.h / 2) }
  })
}

/* Writing on a sticky: Esc, ⌘Return or clicking away keeps it; emptying it deletes it. */
function CardEditor({ card, onDone }) {
  const field = useRef(null)
  const done = useRef(false)
  useLayoutEffect(() => { field.current?.focus(); field.current?.select() }, [])
  const finish = () => { if (!done.current) { done.current = true; onDone(field.current.value.replace(/\s+$/, '')) } }
  return (
    <textarea
      ref={field}
      className="pile-card-field"
      defaultValue={card.text}
      aria-label="Edit this sticky"
      maxLength={2000}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) { event.preventDefault(); event.stopPropagation(); finish() }
      }}
    />
  )
}

/* Send to the Sky: one node with its branches inside, or each branch its own node. */
function SendPanel({ pile, initial, onSend, onCancel }) {
  const [name, setName] = useState(initial.name || '')
  const [mode, setMode] = useState(initial.mode)
  const field = useRef(null)
  useEffect(() => { field.current?.focus(); field.current?.select() }, [])
  const branches = pile.groups.filter((group) => membersOf(pile, group.id).length).length
  const loose = pile.cards.filter((card) => !card.group).length
  return (
    <div className="pile-send-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <form
        className="pile-send-panel"
        role="dialog"
        aria-label="Send to the Sky"
        onSubmit={(event) => { event.preventDefault(); onSend({ name, mode }) }}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() } }}
      >
        <h2>Send to the Sky</h2>
        <label className="pile-field">
          <span>Name of the node</span>
          <input ref={field} value={name} placeholder={pileName(pile)} maxLength={80} onChange={(event) => setName(event.target.value)} disabled={mode === 'each'} />
        </label>
        <div className="pile-modes" role="radiogroup" aria-label="How it goes up">
          <label><input type="radio" name="mode" checked={mode === 'one'} onChange={() => setMode('one')} /> <span><strong>One node</strong>{branches ? `, with its ${branches} ${branches === 1 ? 'branch' : 'branches'} inside` : ''}{loose ? `; ${loose} ${loose === 1 ? 'sticky' : 'stickies'} not in a branch yet stay in the node` : ''}</span></label>
          <label className={branches ? '' : 'is-off'}><input type="radio" name="mode" checked={mode === 'each'} disabled={!branches} onChange={() => setMode('each')} /> <span><strong>Each branch its own node</strong>{loose ? `; ${loose} ${loose === 1 ? 'sticky goes' : 'stickies go'} to Unsorted` : ''}</span></label>
        </div>
        <div className="pile-send-actions">
          <button type="button" onClick={onCancel}>Not yet</button>
          <button type="submit" className="is-primary">Send</button>
        </div>
      </form>
    </div>
  )
}
