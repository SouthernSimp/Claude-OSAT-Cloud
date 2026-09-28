import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Detective, NotePencil, PaintBucket, ShareNetwork, Trash } from '@phosphor-icons/react'

import { STICKY, StickyLayer, spotOn, useStickySurface } from '../field/DeskStickies.jsx'
import { useReducedMotion } from '../field/FieldChrome.jsx'
import { freeSpot } from '../field/field-model.js'
import { Line } from '../field/Line.jsx'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { PAPERS } from '../note-core.js'
import { folderPath, isActiveNote, restoreNotes, trashNotes } from '../notes-model.js'
import { addSticky, isScratch, moveSticky, moveToItems, nodeFrom } from '../nodes-model.js'

const day = () => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date())

/* Incognito: the scratch page under the desk, with the internet off. It's blank until you
   start; then your stickies wait here for whenever you come back. Double-click the page to
   write a sticky, or write in the line at the bottom (it lands on the page). When the
   thinking is done, the pill's Move to takes the page into a new node, or into one that's
   there (or a branch), and the page is blank again. Desk.jsx lifts the desk away and says when to arrive or leave; this plays the rest:
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
    commit((state) => {
      const result = addSticky(state, text, null, { kind: 'scratch', source: 'Scratch' })
      made = result.note
      return result.state
    })
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
    settle(ids, (state) => nodeFrom(state, ids, name), `Moved to a new node: “${name}”`)
  }

  const where = (folderId) => folderPath(workspace.folders, folderId).join(' › ') || 'Unsorted'

  function clear() {
    const spots = Object.fromEntries(ids.map((id) => [id, places[`scratch:${id}`]]))
    commit((state) => trashNotes(state, ids))
    ids.forEach((id) => onPlace(`scratch:${id}`, null))
    showUndo('The page is blank again', () => {
      commit((state) => restoreNotes(state, ids))
      ids.forEach((id) => { if (spots[id]) onPlace(`scratch:${id}`, spots[id]) })
    })
  }

  /* The page's one filing action: Move to a new node, or a node or branch that's there. */
  const pageItems = () => [
    {
      label: 'Move to', icon: ShareNetwork, items: [
        { label: 'New node', onSelect: makeNode },
        ...moveToItems(workspace.folders, (folderId) => settle(ids, (state) => ({ state: ids.reduce((next, id) => moveSticky(next, id, folderId), state) }), `Moved to ${where(folderId)}`), { unsorted: false })
          .filter((item) => !item.note),
      ],
    },
    { label: 'Delete all stickies', icon: Trash, danger: true, onSelect: clear },
  ]

  function stickyMenu(event, note) {
    openMenu(event, [
      { label: 'Open as a page', icon: NotePencil, onSelect: () => onOpenNote(note.id) },
      { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: note.color || 'canary', onPick: (paper) => commit((state) => ({ ...state, notes: state.notes.map((item) => (item.id === note.id ? { ...item, color: paper } : item)) })) }] },
      { label: 'Move to', icon: ShareNetwork, items: moveToItems(workspace.folders, (folderId) => settle([note.id], (state) => ({ state: moveSticky(state, note.id, folderId) }), `Moved to ${where(folderId)}`), { unsorted: false }) },
      { divider: true },
      { label: 'Delete', icon: Trash, danger: true, onSelect: () => toss(note) },
    ])
  }

  function toss(note) {
    const spot = places[`scratch:${note.id}`]
    commit((state) => trashNotes(state, [note.id]))
    onPlace(`scratch:${note.id}`, null)
    showUndo(`Deleted “${note.title.slice(0, 40)}”`, () => { commit((state) => restoreNotes(state, [note.id])); if (spot) onPlace(`scratch:${note.id}`, spot) })
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
              ...(ids.length ? pageItems() : []),
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
                <button type="button" onClick={(event) => openMenu(event, pageItems())}><ShareNetwork weight="bold" /> Move to…</button>
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
              onSaved={(id) => land(id)}
            />
          </div>
        </>
      )}
      {toast}
      {menu}
    </div>
  )
}
