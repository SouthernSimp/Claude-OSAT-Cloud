import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowsIn, CornersOut, DownloadSimple, MagnifyingGlass, NotePencil, PaintBucket, PencilSimple, Plus, Question, ShareNetwork, Sparkle, Trash,
} from '@phosphor-icons/react'

import { useCarrying, useDrop } from '../lib/carry.js'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { PAPERS } from '../note-core.js'
import { folderChildren, folderPath, folderSubtree, isActiveNote, purgeNotes, restoreNotes, searchNotes, trashNotes } from '../notes-model.js'
import {
  addAskedEvent, addFolder, addSticky, importNode, markOpened, markUnpacked, moveFolder, moveSticky, moveToItems, nodesOf, pileOf, removeFolder, renameFolder,
  skipAsk, splitMentions, suggestionGroups, tidyBoard, unpackInto,
} from '../nodes-model.js'
import { isPacked, readNodeFile } from '../../shared/node-file.mjs'
import { readSortAnswer, readUnpackAnswer, sortMessages, unpackMessages } from '../../shared/ai-tasks.mjs'
import { answeringLabel, askModel } from '../assistant/ask-model.js'
import { cleanError, useAi } from '../assistant/useAi.js'
import { seedDirection } from '../project-direction.js'
import { Board } from './Board.jsx'

const OPEN_KEY = 'osat.sky.open.v1'
function readOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || []) } catch { return new Set() }
}
// The guide shows itself once on this Mac; ? and the board's menu bring it back.
const GUIDE_KEY = 'osat.sky.guide.v1'
function guideSeen() {
  try { return localStorage.getItem(GUIDE_KEY) === 'seen' } catch { return true }
}

/* The Sky: the layer above the desk (⌘3, the dock's Sky, ⌥⌘↑, or a sticky held at the top
   of the screen). Your nodes on one whiteboard (Board). `target` says where to fly on
   arriving ({ folderId } or { noteId }). Esc: a node being named, the search, then back
   down (Desk.jsx asks `back()`). `onFiled` hears when a sticky from the desk went into a node. */
export const Sky = forwardRef(function Sky({ workspace, commit, navigate, target, onClose, onFiled }, ref) {
  const board = useRef(null)
  const [open, setOpen] = useState(readOpen)
  const [query, setQuery] = useState('')
  const [sorting, setSorting] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [unpacking, setUnpacking] = useState(null)
  const sortAsk = useRef(null)
  // The model chosen in Settings → Bots (or the AI on this Mac) does Unpack with AI and
  // helps Help me sort; with none, both work by hand and by matching words.
  const { models } = useAi()
  const answering = answeringLabel(models)
  // Where a new branch is being named: a node's id, or a branch's for one inside it.
  const [branching, setBranching] = useState(null)
  const [guide, setGuide] = useState(() => !guideSeen())
  const [menu, openMenu] = useContextMenu()
  const [toast, showUndo] = useUndoToast()
  const latest = useRef(workspace)
  latest.current = workspace
  const findField = useRef(null)
  const picker = useRef(null)
  const carrying = useCarrying()

  /* The plan Nate asked for, once. */
  useEffect(() => {
    if (!workspace.settings?.seeded?.direction) commit(seedDirection)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* Arriving with somewhere to go: a node, or the node a note is in. */
  useEffect(() => {
    if (!target) return
    if (target.action === 'new-node') { board.current?.newNode(); return }
    const noteId = target.noteId || target.focusNoteId
    const folderId = target.folderId || (noteId && workspace.notes.find((note) => note.id === noteId)?.folderId)
    if (target.open && folderId) toggle(folderId, true)
    if (folderId || noteId) board.current?.goTo({ folderId: workspace.folders.some((folder) => folder.id === folderId) ? folderId : null, noteId })
  }, [target?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    /* ⌘K up here: find a sticky. */
    find() {
      findField.current?.focus()
      findField.current?.select()
    },
    /* Esc: true when it did something here, false when it's time to go back down. */
    back() {
      if (guide) { endGuide(); return true }
      if (query) { setQuery(''); return true }
      return Boolean(board.current?.back())
    },
  }))

  function endGuide() {
    setGuide(false)
    try { localStorage.setItem(GUIDE_KEY, 'seen') } catch { /* a convenience only */ }
  }

  function toggle(id, force) {
    // A node that arrived is New until it is first opened.
    if ((force === true || (force === undefined && !open.has(id))) && latest.current.folders.some((folder) => folder.id === id && folder.fresh)) {
      commit((state) => markOpened(state, id))
    }
    setOpen((current) => {
      const next = new Set(current)
      if (force === true || (force === undefined && !next.has(id))) next.add(id)
      else next.delete(id)
      try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])) } catch { /* a convenience only */ }
      return next
    })
  }

  const nodesList = nodesOf(workspace.folders)
  // A suggestion goes once its stickies have gone somewhere else; with none left, so does the help.
  const unsuggest = (ids) => setSorting((value) => {
    if (!value) return value
    const groups = value.groups.map((group) => ({ ...group, noteIds: group.noteIds.filter((id) => !ids.includes(id)) })).filter((group) => group.noteIds.length)
    return groups.length || value.line || value.asking ? { ...value, groups } : null
  })

  const actions = {
    commit,
    moveSticky(noteId, folderId, index) {
      commit((state) => moveSticky(state, noteId, folderId, index))
      unsuggest([noteId])
      if (folderId) onFiled?.(noteId)
    },
    moveFolder(id, parentId, index) {
      commit((state) => moveFolder(state, id, parentId, index))
    },
    addNode(name) {
      let made
      commit((state) => { const result = addFolder(state, name); made = result.folder; return result.state })
      if (made) toggle(made.id, true)
    },
    addBranch(name, parentId) {
      let made
      commit((state) => { const result = addFolder(markUnpacked(state, parentId), name, parentId); made = result.folder; return result.state })
      if (made) { toggle(made.id, true); toggle(parentId, true) }
    },
    addSticky(text, folderId) {
      commit((state) => addSticky(state, text, folderId, { source: 'Sky', index: Infinity }).state)
    },
    toss(note) {
      commit((state) => trashNotes(state, [note.id]))
      showUndo(`Deleted “${note.title.slice(0, 40)}”`, () => commit((state) => restoreNotes(state, [note.id])))
    },
    rename(id, name) {
      commit((state) => renameFolder(state, id, name))
    },
    /* A packed node (only a summary so far) opened up by hand: its summary stays. */
    unpack(id) {
      commit((state) => markUnpacked(state, id))
    },
    unpacking,
    answering,
    /* Or with the AI: it suggests branches and stickies from the summary; they go in after
       what's there, with Undo. The summary (and the file in Added) always stay. */
    unpackWithAi: answering ? async (folder) => {
      const state = latest.current
      setUnpacking({ id: folder.id, busy: true, line: `Asking ${answering}…` })
      try {
        const answer = await askModel(unpackMessages({
          title: folder.name,
          summary: pileOf(state.notes, folder.id).map((note) => note.markdown).join('\n\n'),
          branches: folderChildren(state.folders, folder.id).map((branch) => branch.name),
        }))
        const tree = readUnpackAnswer(answer, folder.name)
        let made = null
        commit((current) => { made = unpackInto(current, folder.id, tree); return made.state })
        setUnpacking(null)
        const count = made?.folders.length || 0
        showUndo(`Unpacked ${folder.name}${count ? ` into ${count} ${count === 1 ? 'branch' : 'branches'}` : ''}`, () => commit((current) => {
          const gone = new Set(made.folders)
          const folders = current.folders.filter((item) => !gone.has(item.id)).map((item) => (item.id === folder.id ? { ...item, packed: true } : item))
          return purgeNotes({ ...current, folders }, made.notes)
        }))
      } catch (error) {
        setUnpacking({ id: folder.id, busy: false, line: cleanError(error) })
      }
    } : null,
    openNote(noteId) { navigate('Notes', { noteId }) },
    /* A sticky's @s, as links that fly to their node. */
    mentions: {
      parts: (text, note) => (text.includes('@') ? splitMentions(text, latest.current.folders, note.refs) : [text]),
      open: (folderId) => board.current?.goTo({ folderId }),
    },
    renaming,
    startRename(id) { setRenaming(id) },
    /* New branch: named in place, at the end of the node's (or a branch's) branches. */
    branching,
    startBranch(parentId) { setBranching(parentId) },
    endBranch(parentId, name) {
      setBranching(null)
      if (name) actions.addBranch(name, parentId)
    },
    showGuide() { setGuide(true) },
    endRename(id, name) {
      setRenaming(null)
      if (name) actions.rename(id, name)
    },
    remove(folder) {
      const before = latest.current
      const moved = new Set(before.notes.filter((note) => folderSubtree(before.folders, folder.id).has(note.folderId)).map((note) => note.id))
      commit((state) => removeFolder(state, folder.id))
      showUndo(`Deleted ${folder.parentId ? 'branch' : 'node'} “${folder.name}”. ${folder.parentId ? 'Its stickies moved up a level.' : 'Its stickies are in Unsorted.'}`, () => commit((state) => {
        const old = new Map(before.notes.filter((note) => moved.has(note.id)).map((note) => [note.id, note]))
        return { ...state, folders: before.folders, notes: state.notes.map((note) => (old.has(note.id) ? { ...note, folderId: old.get(note.id).folderId, unsorted: old.get(note.id).unsorted, rank: old.get(note.id).rank } : note)) }
      }))
    },
    nodeMenu(event, folder) {
      const others = nodesList.filter((item) => item.folder.id !== folder.id)
      openMenu(event, [
        { label: 'Rename', icon: PencilSimple, onSelect: () => actions.startRename(folder.id) },
        { label: 'New branch', icon: Plus, onSelect: () => { toggle(folder.id, true); actions.startBranch(folder.id) } },
        { label: 'Help me sort', icon: Sparkle, onSelect: () => { toggle(folder.id, true); actions.sort(folder.id) } },
        { label: 'See it in Notes', icon: NotePencil, onSelect: () => navigate('Notes', { folderId: folder.id }) },
        { divider: true },
        { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: folder.color || 'canary', onPick: (paper) => actions.paint(folder.id, paper) }] },
        // Into another node, as one of its branches.
        others.length ? {
          label: 'Move to', icon: ShareNetwork,
          items: others.map(({ folder: other }) => ({ label: other.name, onSelect: () => actions.moveFolder(folder.id, other.id) })),
        } : null,
        { divider: true },
        { label: 'Delete node', icon: Trash, danger: true, onSelect: () => actions.remove(folder) },
      ])
    },
    /* Right-click the open board. */
    boardMenu(event, { fit, newNode }) {
      openMenu(event, [
        { label: 'New node here', icon: Plus, onSelect: newNode },
        { label: 'See everything', icon: CornersOut, onSelect: fit },
        { label: 'Line them up again', icon: ArrowsIn, onSelect: () => commit(tidyBoard) },
        { divider: true },
        { label: 'How the Sky works', icon: Question, onSelect: () => setGuide(true) },
      ])
    },
    branchMenu(event, branch) {
      openMenu(event, [
        { label: 'Rename', icon: PencilSimple, onSelect: () => actions.startRename(branch.id) },
        { label: 'New branch inside', icon: Plus, onSelect: () => actions.startBranch(branch.id) },
        { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: branch.color || 'bone', onPick: (paper) => actions.paint(branch.id, paper) }] },
        {
          label: 'Move to', icon: ShareNetwork, items: [
            { label: 'Its own node', onSelect: () => actions.moveFolder(branch.id, null) },
            ...nodesList.filter(({ folder }) => !folderSubtree(workspace.folders, branch.id).has(folder.id) && folder.id !== branch.parentId).map(({ folder }) => ({ label: folder.name, onSelect: () => actions.moveFolder(branch.id, folder.id) })),
          ],
        },
        { divider: true },
        { label: 'Delete branch', icon: Trash, danger: true, onSelect: () => actions.remove(branch) },
      ])
    },
    stickyMenu(event, note) {
      openMenu(event, [
        { label: 'Open as a page', icon: NotePencil, onSelect: () => navigate('Notes', { noteId: note.id }) },
        { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: note.color || 'canary', onPick: (paper) => commit((state) => ({ ...state, notes: state.notes.map((item) => (item.id === note.id ? { ...item, color: paper } : item)) })) }] },
        { label: 'Move to', icon: ShareNetwork, items: moveToItems(workspace.folders, (folderId) => actions.moveSticky(note.id, folderId), { skip: note.folderId || null }) },
        { divider: true },
        { label: 'Delete', icon: Trash, danger: true, onSelect: () => actions.toss(note) },
      ])
    },
    paint(id, paper) {
      commit((state) => ({ ...state, folders: state.folders.map((folder) => (folder.id === id ? { ...folder, color: paper } : folder)) }))
    },
    /* Help me sort: which branch each sticky still to sort looks like it belongs in (a
       matching #tag, or shared words), one line per branch. Nothing moves until Move. */
    sort(nodeId) {
      const state = latest.current
      const branches = folderChildren(state.folders, nodeId)
      const groups = suggestionGroups(state, nodeId)
      const pile = pileOf(state.notes, nodeId)
      const line = !pile.length ? 'Nothing here needs sorting.' : !branches.length ? 'Add a branch first.' : groups.length ? '' : 'Nothing here looks like a clear match yet.'
      // What matching words couldn't place, the model is asked about (still nothing moves until Move).
      const matched = new Set(groups.flatMap((group) => group.noteIds))
      const rest = pile.filter((note) => !matched.has(note.id))
      const ask = answering && branches.length > 0 && rest.length > 0
      const token = {}
      sortAsk.current = token
      setSorting({ id: nodeId, line: ask ? '' : line, groups, asking: ask ? `Asking ${answering} about the rest…` : '' })
      if (!ask) return
      const name = state.folders.find((folder) => folder.id === nodeId)?.name || ''
      askModel(sortMessages({ node: name, branches: branches.map((branch) => branch.name), stickies: rest.map((note) => `${note.title}\n${note.markdown}`) })).then((answer) => {
        if (sortAsk.current !== token) return
        const picks = readSortAnswer(answer, branches.length, rest.length)
        setSorting((value) => {
          if (value?.id !== nodeId) return value
          const merged = branches.map((branch, index) => ({
            folderId: branch.id,
            noteIds: [...(value.groups.find((group) => group.folderId === branch.id)?.noteIds || []), ...picks.filter((pick) => pick.branch === index).map((pick) => rest[pick.sticky].id)],
          })).filter((group) => group.noteIds.length)
          return { ...value, groups: merged, asking: '', line: merged.length ? '' : 'Nothing here looks like a clear match yet.' }
        })
      }, (error) => {
        if (sortAsk.current !== token) return
        setSorting((value) => (value?.id === nodeId ? { ...value, asking: '', line: value.groups.length ? '' : cleanError(error) } : value))
      })
    },
    acceptGroup(group) {
      commit((state) => group.noteIds.reduce((next, id) => moveSticky(next, id, group.folderId), state))
      unsuggest(group.noteIds)
    },
    dismissGroup(group) {
      unsuggest(group.noteIds)
    },
    endSort() { sortAsk.current = null; setSorting(null) },
    /* A day a sticky names: into the Calendar (with Undo), or Not now. */
    addEvent(note) {
      let event = null
      commit((state) => { const result = addAskedEvent(state, note.id); event = result.event; return result.state })
      if (!event) return
      showUndo(`Added “${event.title}” to your Calendar`, () => commit((state) => ({
        ...state,
        calendar: { ...state.calendar, events: state.calendar.events.filter((item) => item.id !== event.id) },
        notes: state.notes.map((item) => (item.id === note.id ? { ...item, ask: note.ask } : item)),
      })))
    },
    skipAsk(note) { commit((state) => skipAsk(state, note.id)) },
  }

  /* Import: one node file (JSON or Markdown, as bots write them) becomes one new node,
     never mixed into one that's there. */
  async function importFile(file) {
    if (!file) return
    let made = null
    let why = ''
    try {
      const tree = readNodeFile(await file.text(), file.name)
      // Only a summary: packed, ready to unpack (by hand or with the AI).
      commit((state) => { const result = importNode(state, tree, { node: isPacked(tree) ? { packed: true } : undefined }); made = result; return result.state })
    } catch (error) {
      made = null
      why = error?.name === 'NodeFileError' && error.message !== 'That file isn’t a node file.' ? ` ${error.message}` : ''
    }
    if (!made?.folder) {
      showUndo(`“${file.name}” isn’t a node file.${why} Nothing changed.`, null)
      return
    }
    const { folder, branches } = made
    toggle(folder.id, true)
    board.current?.goTo({ folderId: folder.id })
    showUndo(`Imported ${folder.name}${branches ? ` with ${branches} ${branches === 1 ? 'branch' : 'branches'}` : ''}`, () => commit((state) => {
      const ids = folderSubtree(state.folders, folder.id)
      return purgeNotes({ ...state, folders: state.folders.filter((item) => !ids.has(item.id)) }, state.notes.filter((note) => ids.has(note.folderId)).map((note) => note.id))
    }))
  }

  /* Finding a sticky: its words, or #tags. Picking one lays out its node. */
  const found = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    return searchNotes(workspace.notes.filter((note) => isActiveNote(note) && note.kind !== 'day'), q).slice(0, 8)
  }, [query, workspace.notes])

  const toss = useDrop('sky:toss', {
    accepts: ['note'],
    onDrop: ({ id }) => { const note = latest.current.notes.find((item) => item.id === id); if (note) actions.toss(note) },
  })

  return (
    <div className="sky-layer" role="region" aria-label="Sky">
      <header className="sky-bar">
        <button type="button" className="sky-down" onClick={onClose} title="Back to the desk  Esc · ⌥⌘↓"><ArrowDown weight="bold" /> Desk</button>
        <button type="button" className="sky-new" onClick={() => board.current?.newNode()}><Plus weight="bold" /> New node</button>
        <button type="button" className="sky-import" title="Import a node file (.json or .md) as a new node" onClick={() => picker.current?.click()}><DownloadSimple weight="bold" /> Import</button>
        <input
          ref={picker}
          type="file"
          accept=".json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
          hidden
          onChange={(event) => { importFile(event.target.files?.[0]); event.target.value = '' }}
        />
        <div className="sky-find">
          <MagnifyingGlass aria-hidden="true" />
          <input
            ref={findField}
            value={query}
            placeholder="Find a sticky"
            aria-label="Find a sticky"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (query) setQuery(''); else event.currentTarget.blur() }
              if (event.key === 'Enter' && found[0]) pick(found[0])
            }}
          />
          {found.length > 0 && (
            <div className="sky-found" role="listbox" aria-label="Stickies found">
              {found.map((note) => (
                <button key={note.id} type="button" role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(note)}>
                  <strong>{note.title}</strong>
                  <small>{note.folderId ? folderPath(workspace.folders, note.folderId).join(' › ') : 'Unsorted'}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="sky-body">
        <Board ref={board} workspace={workspace} actions={actions} open={open} toggle={toggle} sorting={sorting} />
      </div>

      {carrying?.kind === 'note' && (
        <div className="sky-toss" {...toss}><Trash /> Delete</div>
      )}
      {guide && <SkyGuide onDone={endGuide} />}
      {toast}
      {menu}
    </div>
  )

  function pick(note) {
    setQuery('')
    findField.current?.blur()
    board.current?.goTo({ folderId: note.folderId || null, noteId: note.id })
  }
})

/* How the Sky works: three things, each with a little picture, in plain words. Shown the
   first time the Sky opens on this Mac, and again from ? or the board's menu. */
function SkyGuide({ onDone }) {
  return (
    <section className="sky-guide" role="dialog" aria-label="How the Sky works">
      <h2>How the Sky works</h2>
      <ol>
        <li>
          <span className="guide-pic is-sticky" data-paper="canary" aria-hidden="true">Call mom</span>
          <p><strong>A sticky is one thought.</strong> Write one on the desk or here, or scan paper.</p>
        </li>
        <li>
          <span className="guide-pic is-node" data-paper="sky" aria-hidden="true">Trip</span>
          <p><strong>A node is a topic,</strong> like a trip, a project or a person. Drag stickies onto it to keep them there.</p>
        </li>
        <li>
          <span className="guide-pic is-branch" aria-hidden="true"><i data-paper="mint">Packing</i><i data-paper="rose">Hotels</i></span>
          <p><strong>Branches group the stickies in a node.</strong> A branch can have smaller branches inside it.</p>
        </li>
      </ol>
      <p className="sky-guide-foot">New stickies wait in <strong>Unsorted</strong> until you give them a node.</p>
      <button type="button" className="is-primary" onClick={onDone}>Got it</button>
    </section>
  )
}
