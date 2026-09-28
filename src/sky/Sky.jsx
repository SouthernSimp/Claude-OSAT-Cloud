import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowsHorizontal, ArrowsIn, ArrowsVertical, CornersOut, LinkSimple, MagnifyingGlass, NotePencil, PaintBucket, PencilSimple, Plus,
  ShareNetwork, Sparkle, Trash, TreeStructure,
} from '@phosphor-icons/react'

import { useCarrying, useDrop } from '../lib/carry.js'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { getLocalModels, streamLocalMessage } from '../local-ai.js'
import { PAPERS } from '../note-core.js'
import { folderChildren, folderPath, folderSubtree, isActiveNote, restoreNotes, searchNotes, trashNotes } from '../notes-model.js'
import {
  addFolder, addSticky, applySuggestions, linkFolders, linkedWith, moveFolder, moveSticky, nodesOf, parseSortReply, pileOf, removeFolder,
  renameFolder, sortPrompt, suggestBranches, tidyBoard, unlinkFolders,
} from '../nodes-model.js'
import { seedDirection } from '../project-direction.js'
import { Board } from './Board.jsx'

const OPEN_KEY = 'osat.sky.open.v1'
function readOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || []) } catch { return new Set() }
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
  const [menu, openMenu] = useContextMenu()
  const [toast, showUndo] = useUndoToast()
  const latest = useRef(workspace)
  latest.current = workspace
  const findField = useRef(null)
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
      if (query) { setQuery(''); return true }
      return Boolean(board.current?.back())
    },
  }))

  function toggle(id, force) {
    setOpen((current) => {
      const next = new Set(current)
      if (force === true || (force === undefined && !next.has(id))) next.add(id)
      else next.delete(id)
      try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])) } catch { /* a convenience only */ }
      return next
    })
  }

  const nodesList = nodesOf(workspace.folders)
  const menuPlaces = (onPick, skip) => [
    { label: 'Unsorted', onSelect: () => onPick(null) },
    ...nodesList.flatMap(({ folder, number }) => [
      folder.id === skip ? null : { label: `${number}. ${folder.name}`, onSelect: () => onPick(folder.id) },
      ...folderChildren(workspace.folders, folder.id).filter((branch) => branch.id !== skip).map((branch) => ({ label: `↳ ${branch.name}`, onSelect: () => onPick(branch.id) })),
    ]),
  ]

  const suggestionMap = (list, state) => new Map(list.map((item) => [item.noteId, {
    ...item,
    label: item.folderId ? state.folders.find((folder) => folder.id === item.folderId)?.name || 'a branch' : `new: ${item.branch}`,
  }]))

  const actions = {
    commit,
    moveSticky(noteId, folderId, index) {
      commit((state) => moveSticky(state, noteId, folderId, index))
      setSorting((value) => (value?.map.has(noteId) ? { ...value, map: new Map([...value.map].filter(([id]) => id !== noteId)) } : value))
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
      commit((state) => { const result = addFolder(state, name, parentId); made = result.folder; return result.state })
      if (made) { toggle(made.id, true); toggle(parentId, true) }
    },
    addSticky(text, folderId) {
      commit((state) => addSticky(state, text, folderId, { source: 'Sky', index: Infinity }).state)
    },
    toss(note) {
      commit((state) => trashNotes(state, [note.id]))
      showUndo(`Tossed “${note.title.slice(0, 40)}”`, () => commit((state) => restoreNotes(state, [note.id])))
    },
    rename(id, name) {
      commit((state) => renameFolder(state, id, name))
    },
    setLayout(id, layout) {
      commit((state) => ({
        ...state,
        folders: state.folders.map((folder) => {
          if (folder.id !== id) return folder
          const { layout: _, ...rest } = folder
          return layout === 'down' ? { ...rest, layout: 'down' } : rest
        }),
      }))
    },
    openNote(noteId) { navigate('Notes', { noteId }) },
    renaming,
    startRename(id) { setRenaming(id) },
    endRename(id, name) {
      setRenaming(null)
      if (name) actions.rename(id, name)
    },
    remove(folder) {
      const before = latest.current
      const moved = new Set(before.notes.filter((note) => folderSubtree(before.folders, folder.id).has(note.folderId)).map((note) => note.id))
      commit((state) => removeFolder(state, folder.id))
      showUndo(`${folder.parentId ? 'Branch' : 'Node'} “${folder.name}” removed; its stickies are kept`, () => commit((state) => {
        const old = new Map(before.notes.filter((note) => moved.has(note.id)).map((note) => [note.id, note]))
        return { ...state, folders: before.folders, notes: state.notes.map((note) => (old.has(note.id) ? { ...note, folderId: old.get(note.id).folderId, unsorted: old.get(note.id).unsorted, rank: old.get(note.id).rank } : note)) }
      }))
    },
    nodeMenu(event, folder) {
      const others = nodesList.filter((item) => item.folder.id !== folder.id)
      const linked = linkedWith(workspace.folders, folder.id)
      const down = folder.layout === 'down'
      openMenu(event, [
        { label: 'Rename', icon: PencilSimple, onSelect: () => actions.startRename(folder.id) },
        { label: 'Help me sort', icon: Sparkle, onSelect: () => { toggle(folder.id, true); actions.sort(folder.id) } },
        { label: 'Lay it out', icon: down ? ArrowsVertical : ArrowsHorizontal, items: [
          { label: 'Across (branches as rows)', checked: !down, onSelect: () => actions.setLayout(folder.id, 'across') },
          { label: 'Down (branches as columns)', checked: down, onSelect: () => actions.setLayout(folder.id, 'down') },
        ] },
        { label: 'See it in Notes', icon: NotePencil, onSelect: () => navigate('Notes', { folderId: folder.id }) },
        { divider: true },
        { label: 'Colour', icon: PaintBucket, items: [{ swatches: PAPERS, picked: folder.color || 'canary', onPick: (paper) => actions.paint(folder.id, paper) }] },
        others.length ? {
          label: 'Link to', icon: LinkSimple,
          items: others.map(({ folder: other, number }) => ({ label: `${number}. ${other.name}`, checked: linked.includes(other.id), onSelect: () => actions.link(folder.id, other.id) })),
        } : null,
        others.length ? {
          label: 'Put inside', icon: ShareNetwork,
          items: others.map(({ folder: other, number }) => ({ label: `${number}. ${other.name}`, onSelect: () => actions.moveFolder(folder.id, other.id) })),
        } : null,
        { divider: true },
        { label: 'Remove node', icon: Trash, danger: true, onSelect: () => actions.remove(folder) },
      ])
    },
    /* Right-click the open board. */
    boardMenu(event, { fit, newNode }) {
      openMenu(event, [
        { label: 'New node here', icon: Plus, onSelect: newNode },
        { label: 'See everything', icon: CornersOut, onSelect: fit },
        { label: 'Line them up again', icon: ArrowsIn, onSelect: () => commit(tidyBoard) },
      ])
    },
    branchMenu(event, branch) {
      openMenu(event, [
        { label: 'Rename', icon: PencilSimple, onSelect: () => actions.startRename(branch.id) },
        { label: 'Colour', icon: PaintBucket, items: [{ swatches: PAPERS, picked: branch.color || 'bone', onPick: (paper) => actions.paint(branch.id, paper) }] },
        { label: 'Make it a node', icon: TreeStructure, onSelect: () => actions.moveFolder(branch.id, null) },
        { label: 'Move into', icon: ShareNetwork, items: nodesList.filter(({ folder }) => !folderSubtree(workspace.folders, branch.id).has(folder.id) && folder.id !== branch.parentId).map(({ folder, number }) => ({ label: `${number}. ${folder.name}`, onSelect: () => actions.moveFolder(branch.id, folder.id) })) },
        { divider: true },
        { label: 'Remove branch', icon: Trash, danger: true, onSelect: () => actions.remove(branch) },
      ])
    },
    stickyMenu(event, note) {
      openMenu(event, [
        { label: 'Open as a page', icon: NotePencil, onSelect: () => navigate('Notes', { noteId: note.id }) },
        { label: 'Colour', icon: PaintBucket, items: [{ swatches: PAPERS, picked: note.color || 'canary', onPick: (paper) => commit((state) => ({ ...state, notes: state.notes.map((item) => (item.id === note.id ? { ...item, color: paper } : item)) })) }] },
        { label: 'Move to', icon: ShareNetwork, items: menuPlaces((folderId) => actions.moveSticky(note.id, folderId), note.folderId) },
        { divider: true },
        { label: 'Toss', icon: Trash, danger: true, onSelect: () => actions.toss(note) },
      ])
    },
    linkMenu(event, folder) {
      const linked = linkedWith(workspace.folders, folder.id)
      const others = nodesList.filter((item) => item.folder.id !== folder.id)
      openMenu(event, others.length
        ? others.map(({ folder: other, number }) => ({ label: `${number}. ${other.name}`, checked: linked.includes(other.id), onSelect: () => actions.link(folder.id, other.id) }))
        : [{ note: 'Make another node first.' }])
    },
    link(a, b) {
      commit((state) => (linkedWith(state.folders, a).includes(b) ? unlinkFolders(state, a, b) : linkFolders(state, a, b)))
    },
    paint(id, paper) {
      commit((state) => ({ ...state, folders: state.folders.map((folder) => (folder.id === id ? { ...folder, color: paper } : folder)) }))
    },
    suggestionsFor(nodeId) {
      return sorting?.id === nodeId && sorting.map.size ? sorting.map : null
    },
    /* A branch for every sticky still to sort: matching #tags and shared words right away,
       then the AI on this Mac, when there is one. Nothing moves until Nate ticks it. */
    async sort(nodeId) {
      const state = latest.current
      const first = suggestBranches(state, nodeId)
      const loose = pileOf(state.notes, nodeId).slice(0, 40)
      if (!loose.length) { setSorting({ id: nodeId, busy: false, line: 'Nothing to sort', map: new Map() }); return }
      setSorting({ id: nodeId, busy: true, line: 'Thinking on this Mac…', map: suggestionMap(first, state) })
      const models = await getLocalModels().catch(() => [])
      let map = suggestionMap(first, state)
      if (models.length) {
        let text = ''
        try {
          await streamLocalMessage({ model: models[0].id, messages: sortPrompt(folderChildren(state.folders, nodeId), loose), onDelta: (delta) => { text += delta } })
          const ai = parseSortReply(text, folderChildren(latest.current.folders, nodeId), loose)
          map = new Map([...map, ...suggestionMap(ai, latest.current)])
        } catch {
          // The words-and-tags suggestions stand on their own.
        }
      }
      const branches = folderChildren(latest.current.folders, nodeId).length
      setSorting({ id: nodeId, busy: false, line: map.size ? 'Tick what fits' : branches || models.length ? 'No good fits yet' : 'Add a branch first', map })
    },
    acceptSuggestion(noteId) {
      const item = sorting?.map.get(noteId)
      if (!item) return
      commit((state) => applySuggestions(state, sorting.id, [item]))
      setSorting((value) => ({ ...value, map: new Map([...value.map].filter(([id]) => id !== noteId)) }))
    },
    declineSuggestion(noteId) {
      setSorting((value) => ({ ...value, map: new Map([...value.map].filter(([id]) => id !== noteId)) }))
    },
    acceptAll(nodeId) {
      if (sorting?.id !== nodeId) return
      commit((state) => applySuggestions(state, nodeId, [...sorting.map.values()]))
      setSorting((value) => ({ ...value, map: new Map(), line: 'Sorted' }))
    },
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
        <div className="sky-toss" {...toss}><Trash /> Toss</div>
      )}
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
