import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Broom, Detective, NotePencil, PaintBucket, ShareNetwork, Trash, TreeStructure } from '@phosphor-icons/react'

import { STICKY, StickyLayer, spotOn, useStickySurface } from '../field/DeskStickies.jsx'
import { useReducedMotion } from '../field/FieldChrome.jsx'
import { freeSpot } from '../field/field-model.js'
import { Line } from '../field/Line.jsx'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { PAPERS } from '../note-core.js'
import { folderChildren, isActiveNote, restoreNotes, trashNotes } from '../notes-model.js'
import { addFolder, addSticky, isScratch, moveSticky, nodeFrom, nodesOf } from '../nodes-model.js'

const day = () => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date())

/* Incognito: the scratch page under the desk, with the internet off. It's blank until you
   start; then your stickies wait here for whenever you come back. Double-click the page to
   write a sticky, or write in the line at the bottom (it lands on the page). When the
   thinking is done, the pill makes the page a node, or puts it in one (as its stickies to
   sort, or as a new branch), and the page is blank again; link that node to others in the
   Sky. Desk.jsx lifts the desk away and says when to arrive or leave; this plays the rest:
   the ink rises with its waterline, then the page, then the pill. Esc comes back up. In
   the browser preview there is no main process, so offline is the look only. */
export function Under({ workspace, commit, navigate, storage, status, arriving, leaving, visit, summon, onOpenNote, onComeUp, places = {}, onPlace }) {
  const reduced = useReducedMotion()
  // 0: the ink is rising, 1: the page, 2: the pill and the line.
  const [stage, setStage] = useState(arriving && !reduced ? 0 : 2)
  const [draft, setDraft] = useState(null)
  const [menu, openMenu] = useContextMenu()
  const [toast, showUndo] = useUndoToast()
  const page = useRef(null)
  useEffect(() => {
    if (stage === 2) return undefined
    const timers = [setTimeout(() => setStage(1), 480), setTimeout(() => setStage(2), 900)]
    return () => timers.forEach(clearTimeout)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const preview = !window.osatUnder

  const scratch = workspace.notes.filter((note) => isActiveNote(note) && isScratch(note))
  // A sticky with no spot yet (written on another Mac) takes one from a quiet grid.
  const stickies = scratch.map((note, index) => ({ note, spot: places[`scratch:${note.id}`] || { x: 0.08 + (index % 5) * 0.17, y: 0.16 + (Math.floor(index / 5) % 4) * 0.19 } }))
  const surface = useStickySurface({ id: 'scratch', surface: page, prefix: 'scratch', places, onPlace, snap: true })

  function land(noteId) {
    const element = page.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const taken = [...element.parentElement.querySelectorAll('.under-page .desk-sticky, .under-top, .home-composer-wrap')].map((item) => item.getBoundingClientRect())
    const near = { x: box.left + box.width / 2 - STICKY.w / 2, y: box.top + box.height * 0.3 }
    const at = freeSpot(taken, { left: box.left + 16, top: box.top + 90, right: box.right - 16, bottom: box.bottom - 150 }, { width: STICKY.w, height: STICKY.h }, near, 32)
    onPlace(`scratch:${noteId}`, spotOn(box, at.x, at.y, null, true))
  }

  function writeDraft(text) {
    const at = draft
    setDraft(null)
    if (!text.trim() || !at) return
    let made
    commit((state) => { const result = addSticky(state, text, null, { kind: 'scratch', source: 'Scratch' }); made = result.note; return result.state })
    const box = page.current.getBoundingClientRect()
    if (made) onPlace(`scratch:${made.id}`, spotOn(box, box.left + at.x, box.top + at.y, null, true))
  }

  /* The page, as it is now, into a node (or into one that's there): its spots are let go. */
  function settle(ids, move, message) {
    const before = workspace.notes.filter((note) => ids.includes(note.id))
    const spots = Object.fromEntries(ids.map((id) => [id, places[`scratch:${id}`]]))
    let folder = null
    commit((state) => { const result = move(state); folder = result.folder || null; return result.state })
    ids.forEach((id) => onPlace(`scratch:${id}`, null))
    showUndo(message, () => {
      commit((state) => ({
        ...state,
        folders: folder ? state.folders.filter((item) => item.id !== folder.id) : state.folders,
        notes: state.notes.map((note) => { const old = before.find((item) => item.id === note.id); return old || note }),
      }))
      ids.forEach((id) => { if (spots[id]) onPlace(`scratch:${id}`, spots[id]) })
    })
  }

  // In reading order on the page, and named after the first one written.
  const ids = [...stickies].sort((a, b) => a.spot.y - b.spot.y || a.spot.x - b.spot.x).map(({ note }) => note.id)
  const nameFor = () => {
    const first = [...scratch].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0]?.title || ''
    return first && first.length <= 40 ? first : `Incognito, ${day()}`
  }

  function makeNode() {
    const name = nameFor()
    settle(ids, (state) => nodeFrom(state, ids, name), `The page is a node now: “${name}”`)
  }

  function putIn(folderId, asBranch) {
    const target = workspace.folders.find((folder) => folder.id === folderId)
    if (!target) return
    if (asBranch) {
      const name = nameFor()
      settle(ids, (state) => {
        const made = addFolder(state, name, folderId)
        let next = made.state
        ids.forEach((id) => { next = moveSticky(next, id, made.folder.id) })
        return { state: next, folder: made.folder }
      }, `A new branch of ${target.name}: “${name}”`)
    } else {
      settle(ids, (state) => { let next = state; ids.forEach((id) => { next = moveSticky(next, id, folderId) }); return { state: next } }, `Put in ${target.name}`)
    }
  }

  function clear() {
    const spots = Object.fromEntries(ids.map((id) => [id, places[`scratch:${id}`]]))
    commit((state) => trashNotes(state, ids))
    ids.forEach((id) => onPlace(`scratch:${id}`, null))
    showUndo('The page is blank again', () => {
      commit((state) => restoreNotes(state, ids))
      ids.forEach((id) => { if (spots[id]) onPlace(`scratch:${id}`, spots[id]) })
    })
  }

  const nodeItems = (asBranch) => {
    const nodes = nodesOf(workspace.folders)
    return nodes.length ? nodes.map(({ folder, number }) => ({ label: `${number}. ${folder.name}`, onSelect: () => putIn(folder.id, asBranch) })) : [{ note: 'No nodes yet: make this page one.' }]
  }

  function putMenu(event) {
    openMenu(event, [
      { label: 'Make it a node', icon: TreeStructure, onSelect: makeNode },
      { label: 'Into a node, to sort', icon: ShareNetwork, items: nodeItems(false) },
      { label: 'Into a node, as a new branch', icon: ShareNetwork, items: nodeItems(true) },
      { divider: true },
      { label: 'Clear the page', icon: Broom, danger: true, onSelect: clear },
    ])
  }

  function stickyMenu(event, note) {
    const nodes = nodesOf(workspace.folders)
    openMenu(event, [
      { label: 'Open as a page', icon: NotePencil, onSelect: () => onOpenNote(note.id) },
      { label: 'Colour', icon: PaintBucket, items: [{ swatches: PAPERS, picked: note.color || 'canary', onPick: (paper) => commit((state) => ({ ...state, notes: state.notes.map((item) => (item.id === note.id ? { ...item, color: paper } : item)) })) }] },
      {
        label: 'Put in a node', icon: ShareNetwork, items: nodes.length
          ? nodes.flatMap(({ folder, number }) => [
            { label: `${number}. ${folder.name}`, onSelect: () => settle([note.id], (state) => ({ state: moveSticky(state, note.id, folder.id) }), `Put in ${folder.name}`) },
            ...folderChildren(workspace.folders, folder.id).map((branch) => ({ label: `↳ ${branch.name}`, onSelect: () => settle([note.id], (state) => ({ state: moveSticky(state, note.id, branch.id) }), `Put in ${branch.name}`) })),
          ])
          : [{ note: 'No nodes yet.' }],
      },
      { divider: true },
      { label: 'Toss', icon: Trash, danger: true, onSelect: () => toss(note) },
    ])
  }

  function toss(note) {
    const spot = places[`scratch:${note.id}`]
    commit((state) => trashNotes(state, [note.id]))
    onPlace(`scratch:${note.id}`, null)
    showUndo(`Tossed “${note.title.slice(0, 40)}”`, () => { commit((state) => restoreNotes(state, [note.id])); if (spot) onPlace(`scratch:${note.id}`, spot) })
  }

  const bare = (target) => !target.closest('button, textarea, input, .desk-sticky, .under-top, .under-line .home-center > *, .context-menu')

  return (
    <div className={`under ${arriving ? 'is-arriving' : ''} ${leaving ? 'is-leaving' : ''}`} inert={leaving || undefined}>
      <div className="under-ink" aria-hidden="true" />
      {stage >= 1 && (
        <div
          ref={page}
          className="under-page"
          {...surface}
          onDoubleClick={(event) => {
            if (!bare(event.target)) return
            const box = page.current.getBoundingClientRect()
            setDraft({ x: event.clientX - box.left - 24, y: event.clientY - box.top - 20 })
          }}
          onContextMenu={(event) => {
            if (!bare(event.target)) return
            const box = page.current.getBoundingClientRect()
            const at = { x: event.clientX - box.left - 24, y: event.clientY - box.top - 20 }
            openMenu(event, [
              { label: 'New sticky', icon: NotePencil, hint: 'Double-click', onSelect: () => setDraft(at) },
              ...(ids.length ? [{ label: 'Make it a node', icon: TreeStructure, onSelect: makeNode }, { label: 'Clear the page', icon: Broom, danger: true, onSelect: clear }] : []),
              { divider: true },
              { label: 'Come up', icon: ArrowUp, hint: 'Esc', onSelect: onComeUp },
            ])
          }}
        >
          {!stickies.length && !draft && stage >= 2 && (
            <p className="under-blank">A blank page, just for you. Double-click to put a sticky down, or write below.</p>
          )}
          <StickyLayer
            stickies={stickies}
            prefix="scratch"
            commit={commit}
            onPlace={onPlace}
            onAway={toss}
            onToss={toss}
            onMenu={stickyMenu}
            draft={draft}
            onDraft={writeDraft}
            snap
          />
        </div>
      )}
      {stage >= 2 && (
        <>
          <header className="under-top">
            <div className="under-pill">
              <Detective weight="fill" aria-hidden="true" />
              <p><strong>Incognito</strong> · {preview ? 'Preview' : 'offline · nothing leaves OSAT'}</p>
              {stickies.length > 0 && (
                <button type="button" onClick={putMenu}><TreeStructure weight="bold" /> Make it a node…</button>
              )}
              <button type="button" title={preview ? 'Esc' : 'Come up  Esc · ⇧⌘U'} onClick={onComeUp}>Come up <ArrowUp weight="bold" /></button>
            </div>
            <p className="under-detail">
              {preview ? 'The look only. In the Mac app, OSAT goes offline down here.' : 'Other apps, LM Studio too, keep their own connections.'}
              {status?.terminal && ' A terminal you started is still running.'}
            </p>
          </header>
          <div className="under-line">
            {/* Ready to type into on arrival, and again each time the desk is shown (⌥Space). */}
            <Line
              workspace={workspace}
              commit={commit}
              navigate={navigate}
              storage={storage}
              visit={visit + 1}
              summon={summon}
              under
              onOpenNote={onOpenNote}
              write={(state, text) => addSticky(state, text, null, { kind: 'scratch', source: 'Scratch' })}
              onSaved={land}
            />
          </div>
        </>
      )}
      {toast}
      {menu}
    </div>
  )
}
