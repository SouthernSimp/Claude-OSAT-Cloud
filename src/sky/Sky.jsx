import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  ArrowCounterClockwise, ArrowClockwise, ArrowDown, ArrowsIn, Broom, CaretRight, CornersOut, Crosshair, DotsThree, DownloadSimple, LineSegment, MagnifyingGlass, NotePencil, PaintBucket, PencilSimple, Plus, Question, ShareNetwork, Sparkle, Stack, Trash,
} from '@phosphor-icons/react'

import { useCarrying, useDrop } from '../lib/carry.js'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { inputActive } from '../lib/ui.js'
import { PAPERS } from '../note-core.js'
import { folderChildren, folderPath, folderSubtree, isBranch, purgeNotes, restoreNotes, trashNotes } from '../notes-model.js'
import {
  addAskedEvent, addFolder, addSticky, importNode, markOpened, markUnpacked, moveFolder, moveSticky, moveToItems, nodesOf, pileOf, placeSticky, removeFolder, renameFolder,
  skipAsk, splitMentions, stickiesIn, suggestionGroups,
} from '../nodes-model.js'
import { applyOps, diffDocs } from '../../shared/store-core.mjs'
import { isPacked, readNodeFile } from '../../shared/node-file.mjs'
import { readSortAnswer, readUnpackAnswer, readWhereAnswer, sortMessages, unpackMessages, whereMessages } from '../../shared/ai-tasks.mjs'
import { answeringLabel, askModel } from '../assistant/ask-model.js'
import { aiState } from '../assistant/ai-state.js'
import { cleanError, useAi } from '../assistant/useAi.js'
import { seedDirection } from '../project-direction.js'
import { Board } from './Board.jsx'
import { SkyAsk } from './SkyAsk.jsx'
import { findSky } from './find.js'
import { applyUnpackProposal, undoUnpackProposal } from './unpack-proposal.js'
import { UnsortedDrawer } from './UnsortedDrawer.jsx'
import { fileUnsorted, undoFiling } from './sort-review.js'
import { arrangeTopics } from './arrange.js'
import { canvasChange, replayCanvas } from './canvas-history.js'
import { branchWords, wherePlaces } from './where.js'
import { tidyTree } from './map-layout.js'
import { connect, disconnect, folderKey, linksAt, noteKey, recordOf } from '../links-model.js'

const OPEN_KEY = 'osat.sky.open.v1'
function readOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || []) } catch { return new Set() }
}
// What is folded (Unsorted, branches), per Mac.
const FOLD_KEY = 'osat.sky.folds.v1'
function readFolds() {
  try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY)) || []) } catch { return new Set() }
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
export const Sky = forwardRef(function Sky({ workspace, commit, history, navigate, target, onClose, onFiled, onStackSent }, ref) {
  const board = useRef(null)
  const [open, setOpen] = useState(readOpen)
  const [folds, setFolds] = useState(readFolds)
  const [asking, setAsking] = useState(false)
  const [query, setQuery] = useState('')
  const [findAt, setFindAt] = useState(0)
  // Sorting's placements this session, newest last; a ref too, so an Undo toast made a moment
  // ago always takes back what is newest now.
  const [sortHistory, setSortHistory] = useState([])
  const sortLog = useRef([])
  const logSort = (next) => { sortLog.current = next; setSortHistory(next) }
  const [unsortedOpen, setUnsortedOpen] = useState(false)
  // Where sorting begins when Unsorted opens: { target, mode: 'all', at }.
  const [unsortedStart, setUnsortedStart] = useState(null)
  const openSorting = (request = {}) => { setUnsortedStart({ ...request, at: Date.now() }); setUnsortedOpen(true) }
  const [sorting, setSorting] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [unpacking, setUnpacking] = useState(null)
  // Where does this belong?: { id, asking } while it thinks, then { id, place: { folderId, name, why } } or { id, line }.
  const [placing, setPlacing] = useState(null)
  const sortAsk = useRef(null)
  const placeAsk = useRef(null)
  const unpackAsk = useRef(null)
  useEffect(() => () => unpackAsk.current?.abort(), [])
  // The model chosen in Settings → Bots (or the AI on this Mac) does Unpack with AI and
  // helps Help me sort; with none, both work by hand and by matching words.
  const ai = useAi()
  const { models } = ai
  const answering = answeringLabel(models)
  // What the AI can do for Where does this belong? and Help me sort, said plainly.
  const aiNow = (job = null) => aiState({ status: ai.status, model: models?.[0] || null, models, offline: ai.offline, job, fallback: '' })
  // Where a new branch is being named: a node's id, or a branch's for one inside it.
  const [branching, setBranching] = useState(null)
  const [guide, setGuide] = useState(() => !guideSeen())
  // Focus: one node alone on the Sky (its id), until Done or Esc.
  const [focus, setFocus] = useState(null)
  const [menu, openMenu] = useContextMenu()
  const [toast, showUndo] = useUndoToast()
  const [, refreshHistory] = useState(0)
  const latest = useRef(workspace)
  latest.current = workspace
  const findField = useRef(null)
  const picker = useRef(null)
  const carrying = useCarrying()

  function canvasCommit(label, updater) {
    let entry
    commit((state) => { const next = updater(state); entry = canvasChange(state, next, label); return next })
    if (!entry) return null
    // ponytail: last 100 canvas changes in this window; persist checkpoints only
    // if Undo across reloads is needed. Leaving Sky keeps this session history.
    history.current.past = [...history.current.past.slice(-99), entry]
    history.current.future = []
    refreshHistory((value) => value + 1)
    showUndo(label, () => { if (history.current.past.at(-1) === entry) stepHistory('undo') })
    return entry
  }
  function stepHistory(direction) {
    const from = history.current[direction === 'undo' ? 'past' : 'future']
    const to = history.current[direction === 'undo' ? 'future' : 'past']
    const entry = from.at(-1)
    if (!entry) return
    let result, replayed
    commit((state) => {
      result = replayCanvas(state, entry, direction)
      replayed = direction === 'undo' ? canvasChange(result.state, state, entry.label) : canvasChange(state, result.state, entry.label)
      return result.state
    })
    from.pop()
    if (replayed) {
      if (direction === 'undo') {
        entry.desk?.filter((item) => result.placedNotes.includes(item.id)).forEach((item) => item.restore?.())
        replayed.desk = entry.desk
      } else replayed.desk = entry.desk?.filter((item) => result.placedNotes.includes(item.id)).map((item) => ({ id: item.id, restore: onFiled?.(item.id) }))
      to.push(replayed)
    }
    refreshHistory((value) => value + 1)
    showUndo(replayed ? `${direction === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}${result.skipped ? '. Newer changes were kept.' : ''}` : 'This changed since then. Your newer work was kept.', null)
  }

  // Examples are added only by the person's explicit action in the guide.

  /* Arriving with somewhere to go: a node, or the node a note is in. Each arrival is
     handled once (something it makes, like a stack's branch, is never made twice). */
  const arrived = useRef(null)
  useEffect(() => {
    if (!target || arrived.current === target.at) return
    arrived.current = target.at
    if (target.action === 'new-node') { board.current?.newNode(); return }
    if (target.action === 'new-sticky') { board.current?.newSticky(); return }
    if (target.action === 'place-sticky') { board.current?.placeSticky(target.noteId); return }
    if (target.action === 'place-stack') { board.current?.placeStack(target); return }
    // Notes' "Sort by hand": the sorter opens here, over the canvas.
    if (target.action === 'sort') { openSorting(target.mode ? { mode: target.mode } : {}); return }
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
      if (asking) { setAsking(false); return true }
      if (unsortedOpen) { setUnsortedOpen(false); return true }
      if (placing) { placeAsk.current = null; setPlacing(null); return true }
      if (board.current?.back()) return true
      if (focus) { setFocus(null); return true }
      return false
    },
  }))

  function endGuide() {
    setGuide(false)
    try { localStorage.setItem(GUIDE_KEY, 'seen') } catch { /* a convenience only */ }
  }

  function toggle(id, force) {
    // Open one topic at a time. This is a view change; board coordinates and the
    // legacy open preference remain intact.
    let root = latest.current.folders.find((folder) => folder.id === id)
    for (let guard = 0; root?.parentId && guard < 64; guard += 1) root = latest.current.folders.find((folder) => folder.id === root.parentId)
    if (root) {
      setUnsortedOpen(false)
      if (force !== false && focus !== root.id && stickiesIn(latest.current, root.id).length > 18) {
        // A large topic starts with branch summaries. Opening a search result
        // unfolds its path again below, without changing stored note geometry.
        const branches = folderChildren(latest.current.folders, root.id)
        setFolds((current) => new Set([...current, ...branches.map((branch) => branch.id)]))
      }
      setFocus((current) => force === false || (force === undefined && current === root.id) ? null : root.id)
    }
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

  /* Fold or open Unsorted ('unsorted') or a branch (its id); `force` says which way. */
  function fold(key, force) {
    setFolds((current) => {
      const next = new Set(current)
      if (force === true || (force === undefined && !next.has(key))) next.add(key)
      else next.delete(key)
      try { localStorage.setItem(FOLD_KEY, JSON.stringify([...next])) } catch { /* a convenience only */ }
      return next
    })
  }

  const nodesList = nodesOf(workspace.folders)
  /* One node (or a branch on its own) alone, open; Done or Esc brings the rest back. */
  function focusOn(id) {
    setUnsortedOpen(false)
    toggle(id, true)
  }
  // A suggestion goes once its stickies have gone somewhere else; with none left, so does the help.
  const unsuggest = (ids) => setSorting((value) => {
    if (!value) return value
    const groups = value.groups.map((group) => ({ ...group, noteIds: group.noteIds.filter((id) => !ids.includes(id)) })).filter((group) => group.noteIds.length)
    return groups.length || value.line || value.asking ? { ...value, groups } : null
  })

  const nameOf = (key) => {
    const record = recordOf(latest.current, key)
    return (record?.title || record?.name || 'something').slice(0, 40)
  }
  /* The menu items that connect `key` to a node or branch, and take its connections away. */
  function connectItems(key) {
    const state = latest.current
    const already = linksAt(state, key)
    // The same nodes and branches as every Move to menu, in its order, less itself and those already joined.
    const ids = nodesOf(state.folders).flatMap(({ folder }) => [folder.id, ...folderChildren(state.folders, folder.id).map((branch) => branch.id)])
    const items = moveToItems(state.folders, (folderId) => actions.link(key, folderKey(folderId)), { unsorted: false })
    const targets = items[0]?.note ? items : items.filter((item, index) => key !== folderKey(ids[index]) && !already.includes(folderKey(ids[index])))
    return [
      targets.length ? { label: 'Connect to', icon: LineSegment, items: targets } : null,
      already.length ? { label: 'Remove a connection', icon: Trash, items: already.map((other) => ({ label: nameOf(other), onSelect: () => actions.unlink(key, other) })) } : null,
    ]
  }

  const actions = {
    commit,
    canvasCommit,
    showUndo,
    /* Sorting: stickies out of Unsorted into a place, a new node (`name`), the Sky or the Trash.
       Returns the result, or null when they or the place changed meanwhile. */
    fileUnsorted(ids, folderId, name = '', options = {}) {
      let result
      const placement = options.sky ? { ...options, at: board.current?.freeSpot() } : options
      commit((state) => { result = fileUnsorted(state, ids, folderId, name, placement); return result.state })
      if (!result?.moved.length) return null
      const restores = result.moved.map((id) => ({ id, restore: onFiled?.(id) })).filter((item) => typeof item.restore === 'function')
      logSort([...sortLog.current, { changes: result.changes, restores, made: result.made ? [result.made] : [], noteId: result.moved[0], folderId: result.folderId }])
      unsuggest(result.moved)
      return result
    },
    /* Suggest homes for all: each group into its place (or a new node), one step to undo. */
    fileGroups(groups) {
      const all = { changes: [], moved: [], made: [] }
      commit((state) => groups.reduce((next, group) => {
        const result = fileUnsorted(next, group.noteIds, group.kind === 'make' ? null : group.folderId, group.kind === 'make' ? group.name : '')
        all.changes.push(...result.changes); all.moved.push(...result.moved)
        if (result.made) all.made.push(result.made)
        return result.state
      }, state))
      if (!all.moved.length) return null
      const restores = all.moved.map((id) => ({ id, restore: onFiled?.(id) })).filter((item) => typeof item.restore === 'function')
      logSort([...sortLog.current, { changes: all.changes, restores, made: all.made, noteId: all.moved[0], folderId: null }])
      unsuggest(all.moved)
      return all
    },
    /* Takes the newest sorting step back; returns the stickies that came back to Unsorted. */
    undoUnsorted() {
      const last = sortLog.current.at(-1)
      if (!last) return []
      let restoredIds = []
      commit((state) => { const result = undoFiling(state, last.changes, last.made); restoredIds = result.restoredIds; return result.state })
      last.restores.filter((item) => restoredIds.includes(item.id)).forEach((item) => item.restore())
      logSort(sortLog.current.slice(0, -1))
      return restoredIds
    },
    moveSticky(noteId, folderId, index) {
      const entry = canvasCommit('Moved a sticky', (state) => moveSticky(state, noteId, folderId, index))
      unsuggest([noteId])
      if (entry && folderId) entry.desk = [{ id: noteId, restore: onFiled?.(noteId) }]
    },
    placeSticky(noteId, at) {
      const entry = canvasCommit(at ? 'Set the sticky on the canvas' : 'Returned the sticky to Unsorted', (state) => placeSticky(state, noteId, at))
      if (!entry) return
      unsuggest([noteId])
      entry.desk = [{ id: noteId, restore: onFiled?.(noteId) }]
    },
    moveFolder(id, parentId, index, options) {
      canvasCommit('Moved a topic or branch', (state) => moveFolder(state, id, parentId, index, options))
    },
    /* Cards of a map set down where they are, still in their folders: [{ kind, id, at }],
       `at` from the folder's corner. */
    hang(cards) {
      const where = (kind) => new Map(cards.filter((card) => card.kind === kind).map((card) => [card.id, card.at]))
      const notes = where('note')
      const folders = where('folder')
      canvasCommit('Moved cards on the map', (state) => ({
        ...state,
        notes: notes.size ? state.notes.map((item) => (notes.has(item.id) ? { ...item, at: notes.get(item.id) } : item)) : state.notes,
        folders: folders.size ? state.folders.map((item) => (folders.has(item.id) ? { ...item, at: folders.get(item.id) } : item)) : state.folders,
      }))
    },
    /* Tidy: a node's (or a branch's) map laid out again in order, with Undo. */
    tidy(folder) {
      canvasCommit(`Tidied ${folder.name}`, (state) => tidyTree(state, folder.id))
    },
    /* Connections: a line between two things; removing one offers Undo. */
    link(a, b) {
      if (a !== b) canvasCommit('Added a connection', (state) => connect(state, a, b))
    },
    unlink(a, b) {
      canvasCommit(`Removed the connection to “${nameOf(b)}”`, (state) => disconnect(state, a, b))
    },
    lineMenu(event, line) {
      openMenu(event, [{ label: 'Remove the connection', icon: Trash, onSelect: () => actions.unlink(line.a, line.b) }])
    },
    /* Connect to (a node or branch; drag the dot for anything else) and Remove a connection. */
    connectMenu(event, key) {
      openMenu(event.clientX || event.clientY ? event : { preventDefault() {}, stopPropagation() {}, clientX: innerWidth / 2, clientY: innerHeight / 3 }, connectItems(key))
    },
    /* A stack sent up from the desk: its stickies become a branch on the Sky, on its own,
       where `place` sets it down. It leaves the desk; Undo brings both back. */
    sendStack({ noteIds, name, stackKey }, place) {
      let inverse = null
      let made = null
      commit((state) => {
        const created = addFolder(state, name || 'Untitled branch')
        if (!created.folder) return state
        made = created.folder
        let next = moveFolder(created.state, made.id, null, Infinity, { loose: true })
        noteIds.forEach((id) => { next = moveSticky(next, id, made.id) })
        next = place(next, made.id)
        inverse = applyOps(state, diffDocs(state, next)).inverse
        return next
      })
      if (!made) return null
      toggle(made.id, true)
      const restoreDesk = onStackSent?.(stackKey)
      showUndo(`Sent “${made.name}” up as a branch`, () => {
        commit((state) => applyOps(state, inverse).doc)
        restoreDesk?.()
      })
      return made
    },
    /* Where does this belong?: the model reads the branch and picks one place with a reason.
       Nothing moves until Move; Undo puts the branch back where it was. */
    placing: placing?.since ? { ...placing, asking: aiNow({ since: placing.since }).line } : placing,
    async askWhere(folder) {
      const state = latest.current
      const places = wherePlaces(state, folder.id)
      const token = {}
      placeAsk.current = token
      board.current?.goTo({ folderId: folder.id })
      if (!places.length) { setPlacing({ id: folder.id, line: 'There’s nowhere else to put it yet.' }); return }
      const now = aiNow()
      if (!models?.[0]) { setPlacing({ id: folder.id, line: now.line, ...(now.action === 'setup' || now.action === 'download' ? { action: { label: 'Set up the AI', run: () => { setPlacing(null); navigate('Settings', { section: 'ai' }) } } } : {}) }); return }
      setPlacing({ id: folder.id, since: Date.now() })
      try {
        const answer = await askModel(whereMessages({ branch: folder.name, peek: branchWords(state, folder.id), places }))
        if (placeAsk.current !== token) return
        const pick = readWhereAnswer(answer, places.map((place) => place.name))
        setPlacing(pick
          ? { id: folder.id, place: { folderId: places[pick.place].id, name: places[pick.place].name, why: pick.why } }
          : { id: folder.id, line: 'Nothing looks like a clear fit yet.' })
      } catch (error) {
        if (placeAsk.current === token) setPlacing({ id: folder.id, line: `${cleanError(error).replace(/\.?$/, '.')} Nothing moved.` })
      }
    },
    acceptPlace() {
      const { id, place } = placing || {}
      const state = latest.current
      const folder = state.folders.find((item) => item.id === id)
      const home = state.folders.find((item) => item.id === place?.folderId)
      // The notes may have changed while the model was thinking.
      if (!folder || !home || folderSubtree(state.folders, id).has(home.id)) { setPlacing({ id, line: 'That changed while the AI was thinking. Ask again.' }); return }
      placeAsk.current = null
      setPlacing(null)
      canvasCommit(`Moved “${folder.name}” into ${place.name}`, (current) => moveFolder(current, id, home.id))
      board.current?.goTo({ folderId: home.id })
    },
    dismissPlace() { placeAsk.current = null; setPlacing(null) },
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
      unpackAsk.current?.abort()
      const controller = new AbortController()
      unpackAsk.current = controller
      const state = latest.current
      setUnpacking({ id: folder.id, busy: true, line: `Asking ${answering}…` })
      try {
        const answer = await askModel(unpackMessages({
          title: folder.name,
          summary: pileOf(state.notes, folder.id).map((note) => note.markdown).join('\n\n'),
          branches: folderChildren(state.folders, folder.id).map((branch) => branch.name),
        }), { signal: controller.signal })
        if (unpackAsk.current !== controller) return
        readUnpackAnswer(answer, folder.name)
        setUnpacking({ id: folder.id, busy: false, proposal: answer, line: 'Review the branches and stickies. Edit the suggestion before adding it.' })
      } catch (error) {
        if (unpackAsk.current === controller && error?.name !== 'AbortError') setUnpacking({ id: folder.id, busy: false, line: cleanError(error) })
      }
    } : null,
    editUnpack(proposal) { setUnpacking((value) => value ? { ...value, proposal } : value) },
    dismissUnpack() { unpackAsk.current?.abort(); unpackAsk.current = null; setUnpacking(null) },
    acceptUnpack() {
      if (!unpacking?.proposal) return
      try {
        let made
        commit((state) => { made = applyUnpackProposal(state, unpacking.id, unpacking.proposal); return made.state })
        setUnpacking(null)
        if (!made?.notes.length && !made?.folders.length) return
        showUndo(`Added ${made.folders.length} branches and ${made.notes.length} stickies`, () => commit((state) => undoUnpackProposal(state, made)))
      } catch (error) { setUnpacking((value) => ({ ...value, line: cleanError(error) })) }
    },
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
    startBranch(parentId) { fold(parentId, false); setBranching(parentId) },
    folds,
    fold,
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
      showUndo(`Deleted ${isBranch(folder) ? 'branch' : 'node'} “${folder.name}”. ${folder.parentId ? 'Its stickies moved up a level.' : 'Its stickies are in Unsorted.'}`, () => commit((state) => {
        const old = new Map(before.notes.filter((note) => moved.has(note.id)).map((note) => [note.id, note]))
        return { ...state, folders: before.folders, notes: state.notes.map((note) => (old.has(note.id) ? { ...note, folderId: old.get(note.id).folderId, unsorted: old.get(note.id).unsorted, rank: old.get(note.id).rank } : note)) }
      }))
    },
    nodeMenu(event, folder) {
      // A branch set down on the Sky on its own has a branch's menu.
      if (isBranch(folder)) return actions.branchMenu(event, folder)
      const others = nodesList.filter((item) => item.folder.id !== folder.id)
      openMenu(event, [
        { label: 'Rename', icon: PencilSimple, onSelect: () => actions.startRename(folder.id) },
        { label: 'New branch', icon: Plus, onSelect: () => { toggle(folder.id, true); actions.startBranch(folder.id) } },
        { label: 'Help me sort', icon: Sparkle, onSelect: () => { toggle(folder.id, true); actions.sort(folder.id) } },
        focus === folder.id
          ? { label: 'Done focusing', icon: Crosshair, onSelect: () => setFocus(null) }
          : { label: 'Focus on it', icon: Crosshair, hint: 'Double-click', onSelect: () => focusOn(folder.id) },
        { label: 'Tidy', icon: Broom, onSelect: () => actions.tidy(folder) },
        { label: 'See it in Notes', icon: NotePencil, onSelect: () => navigate('Notes', { folderId: folder.id }) },
        ...connectItems(folderKey(folder.id)),
        { divider: true },
        { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: folder.color || 'canary', onPick: (paper) => actions.paint(folder.id, paper) }] },
        // Into another node, as one of its branches.
        others.length ? {
          label: 'Move to', icon: ShareNetwork,
          items: others.map(({ folder: other }) => ({ label: other.name, onSelect: () => actions.moveFolder(folder.id, other.id) })),
        } : null,
        { divider: true },
        { label: 'Delete topic', icon: Trash, danger: true, onSelect: () => actions.remove(folder) },
      ])
    },
    /* Right-click the open board. */
    boardMenu(event, { fit, newNode, newSticky }) {
      openMenu(event, [
        { label: 'New sticky here', icon: Plus, onSelect: newSticky },
        { label: 'New topic here', icon: Plus, onSelect: newNode },
        { label: 'See everything', icon: CornersOut, onSelect: fit },
        { label: 'Arrange topics', icon: ArrowsIn, onSelect: arrangeOverview },
        { divider: true },
        { label: 'How the canvas works', icon: Question, onSelect: () => setGuide(true) },
      ])
    },
    branchMenu(event, branch) {
      openMenu(event, [
        { label: 'Rename', icon: PencilSimple, onSelect: () => actions.startRename(branch.id) },
        { label: 'New branch inside', icon: Plus, onSelect: () => actions.startBranch(branch.id) },
        { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: branch.color || 'bone', onPick: (paper) => actions.paint(branch.id, paper) }] },
        actions.askWhere ? { label: 'Where does this belong?', icon: Sparkle, onSelect: () => actions.askWhere(branch) } : null,
        !branch.parentId ? { label: focus === branch.id ? 'Done focusing' : 'Focus on it', icon: Crosshair, onSelect: () => (focus === branch.id ? setFocus(null) : focusOn(branch.id)) } : null,
        { label: 'Tidy', icon: Broom, onSelect: () => actions.tidy(branch) },
        ...connectItems(folderKey(branch.id)),
        {
          label: 'Move to', icon: ShareNetwork, items: [
            ...(branch.parentId ? [{ label: 'On the canvas, as a branch', onSelect: () => actions.moveFolder(branch.id, null, Infinity, { loose: true }) }] : []),
            { label: 'Its own topic', onSelect: () => actions.moveFolder(branch.id, null) },
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
        note.at && !note.folderId ? { label: 'Back to Unsorted', icon: Stack, onSelect: () => actions.placeSticky(note.id, null) } : null,
        { label: 'Color', icon: PaintBucket, items: [{ swatches: PAPERS, picked: note.color || 'canary', onPick: (paper) => commit((state) => ({ ...state, notes: state.notes.map((item) => (item.id === note.id ? { ...item, color: paper } : item)) })) }] },
        { label: 'Move to', icon: ShareNetwork, items: moveToItems(workspace.folders, (folderId) => actions.moveSticky(note.id, folderId), { skip: note.folderId || null }) },
        ...connectItems(noteKey(note.id)),
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
      setSorting({ id: nodeId, line: ask ? '' : line, groups, asking: ask ? `${aiNow({ since: Date.now() }).line.replace(/…$/, '')} about the rest…` : '' })
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
        setSorting((value) => (value?.id === nodeId ? { ...value, asking: '', line: `${cleanError(error).replace(/\.?$/, '.')}${value.groups.length ? ' Matching words found these.' : ''}` } : value))
      })
    },
    acceptGroup(group) {
      canvasCommit('Moved stickies into a branch', (state) => group.noteIds.reduce((next, id) => moveSticky(next, id, group.folderId), state))
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
      why = error?.name === 'NodeFileError' && error.message !== 'That file isn’t a topic file.' ? ` ${error.message}` : ''
    }
    if (!made?.folder) {
      showUndo(`“${file.name}” isn’t a topic file.${why} Nothing changed.`, null)
      return
    }
    const { folder, branches } = made
    toggle(folder.id, true)
    setFocus(folder.id) // the new topic is not in latest.current until React renders
    requestAnimationFrame(() => requestAnimationFrame(() => board.current?.goTo({ folderId: folder.id })))
    showUndo(`Imported ${folder.name}${branches ? ` with ${branches} ${branches === 1 ? 'branch' : 'branches'}` : ''}`, () => commit((state) => {
      const ids = folderSubtree(state.folders, folder.id)
      return purgeNotes({ ...state, folders: state.folders.filter((item) => !ids.has(item.id)) }, state.notes.filter((note) => ids.has(note.folderId)).map((note) => note.id))
    }))
  }

  /* Finding a sticky: its words, or #tags. Picking one lays out its node. */
  const found = useMemo(() => findSky(workspace, query), [query, workspace.notes, workspace.folders])
  const unsorted = useMemo(() => pileOf(workspace.notes, null).filter((note) => !note.at), [workspace.notes])
  const focused = nodesList.find(({ folder }) => folder.id === focus)?.folder
  useEffect(() => { if (focus && !focused) setFocus(null) }, [focus, focused])

  function overview() {
    setFocus(null)
    setUnsortedOpen(false)
  }
  function newNode() {
    overview()
    requestAnimationFrame(() => requestAnimationFrame(() => board.current?.newNode()))
  }
  function arrangeOverview() {
    canvasCommit('Arranged the topics', (state) => arrangeTopics(state, board.current?.sizes()))
    requestAnimationFrame(() => requestAnimationFrame(() => board.current?.fit()))
  }
  function arrangeView() {
    if (!focused) { arrangeOverview(); return }
    actions.tidy(focused)
    requestAnimationFrame(() => requestAnimationFrame(() => board.current?.fit()))
  }
  function more(event) {
    openMenu(event, [
      { label: 'New topic', icon: Plus, onSelect: newNode },
      focused ? { label: 'New branch', icon: ShareNetwork, onSelect: () => actions.startBranch(focused.id) } : null,
      focused ? { label: 'Tidy this topic', icon: Broom, onSelect: () => actions.tidy(focused) } : null,
      { divider: true },
      { label: 'Import a topic file', icon: DownloadSimple, onSelect: () => picker.current?.click() },
      { label: 'Sort Unsorted by hand', icon: Stack, onSelect: () => openSorting() },
      { label: 'Sort a pile', icon: Stack, onSelect: () => navigate('Pile') },
      { label: 'How the canvas works', icon: Question, onSelect: () => setGuide(true) },
    ])
  }

  const toss = useDrop('sky:toss', {
    accepts: ['note'],
    onDrop: ({ id }) => { const note = latest.current.notes.find((item) => item.id === id); if (note) actions.toss(note) },
  })

  return (
    <div className="sky-layer sky-workspace" role="region" aria-label="Canvas" onKeyDown={(event) => {
      if (unsortedOpen || !(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z' || inputActive()) return
      event.preventDefault(); event.stopPropagation(); stepHistory(event.shiftKey ? 'redo' : 'undo')
    }}>
      <header className="sky-bar">
        <button type="button" className="sky-down" onClick={onClose} title="Back to the desk  Esc · ⌥⌘↓"><ArrowDown weight="bold" /> Desk</button>
        <span className="sky-wordmark"><ShareNetwork weight="bold" /> Canvas</span>
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
            placeholder="Find a topic, branch or sticky"
            aria-label="Find on the canvas"
            role="combobox"
            aria-expanded={Boolean(query.trim())}
            aria-controls="sky-search-results"
            aria-activedescendant={found[findAt] ? `sky-found-${findAt}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setFindAt(0) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (query) setQuery(''); else event.currentTarget.blur() }
              if (event.key === 'ArrowDown' && found.length) { event.preventDefault(); setFindAt((value) => (value + 1) % found.length) }
              if (event.key === 'ArrowUp' && found.length) { event.preventDefault(); setFindAt((value) => (value - 1 + found.length) % found.length) }
              if (event.key === 'Enter' && found[findAt]) { event.preventDefault(); pick(found[findAt]) }
            }}
          />
          {query.trim() && (
            <div id="sky-search-results" className="sky-found" role="listbox" aria-label="Canvas results">
              {!found.length && <p className="sky-find-empty" role="status">No nodes, branches or stickies match “{query}”.</p>}
              {found.map((row, index) => (
                <button id={`sky-found-${index}`} key={row.key} type="button" role="option" aria-selected={index === findAt} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(row)}>
                  <strong>{row.label}</strong>
                  <small>{row.type} · {row.hint || 'Unsorted'}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="sky-new" onClick={() => board.current?.newSticky()}><Plus weight="bold" /> New sticky</button>
        <button type="button" className="sky-icon-button" aria-label="Canvas actions" aria-haspopup="menu" onClick={more}><DotsThree weight="bold" /></button>
      </header>

      <div className="sky-workbench">
        <main className="sky-main">
          <div className="sky-location">
            <div className="sky-breadcrumb"><button type="button" onClick={overview} aria-current={!focus ? 'page' : undefined}>Everything</button>{focused && <><CaretRight /><strong>{focused.name}</strong></>}</div>
            {!unsortedOpen && sortHistory.length > 0 && <button type="button" className="sky-fit" onClick={() => setUnsortedOpen(true)}><Stack /> Back to sorting</button>}
            <span className="sky-view-label">{focused ? 'Topic map' : 'Overview'}</span>
            <button type="button" className="sky-icon-button" aria-label="Undo canvas change" disabled={!history.current.past.length || unsortedOpen} title={`Undo${history.current.past.length ? `: ${history.current.past.at(-1).label}` : ''} · ⌘Z`} onClick={() => stepHistory('undo')}><ArrowCounterClockwise /></button>
            <button type="button" className="sky-icon-button" aria-label="Redo canvas change" disabled={!history.current.future.length || unsortedOpen} title={`Redo${history.current.future.length ? `: ${history.current.future.at(-1).label}` : ''} · ⇧⌘Z`} onClick={() => stepHistory('redo')}><ArrowClockwise /></button>
            <button type="button" className="sky-fit sky-arrange" title="Arrange this view · offers Undo" onClick={arrangeView}><ArrowsIn /> Arrange</button>
            <button type="button" className="sky-fit" onClick={() => board.current?.fit()}><CornersOut /> Fit view</button>
          </div>
          <div className="sky-body">
        <Board ref={board} workspace={workspace} actions={actions} open={open} toggle={toggle} sorting={sorting} focus={focus} onOpenUnsorted={(noteId) => openSorting(noteId ? { target: noteId } : {})} onFocus={(id) => (id ? focusOn(id) : setFocus(null))} />
        <div id="sky-unsorted" hidden={!unsortedOpen}><UnsortedDrawer active={unsortedOpen} workspace={workspace} history={sortHistory} notes={unsorted} ai={ai} navigate={navigate} actions={{ ...actions, openUnsortedNotes: () => navigate('Notes', { list: 'unsorted' }) }} start={unsortedStart} onClose={() => setUnsortedOpen(false)} /></div>
        <SkyAsk workspace={workspace} commit={commit} models={models} ai={aiNow()} open={open} focus={focus} asking={asking} setAsking={setAsking} navigate={navigate} onSortAll={() => { setAsking(false); openSorting({ mode: 'all' }) }} />
          </div>
        </main>
      </div>

      {carrying?.kind === 'note' && (
        <div className="sky-toss" {...toss}><Trash /> Delete</div>
      )}
      {guide && <SkyGuide onDone={endGuide} onExample={() => { commit(seedDirection); endGuide() }} />}
      {toast}
      {menu}
    </div>
  )

  function pick(row) {
    setQuery('')
    findField.current?.blur()
    board.current?.goTo(row.go[1])
  }
})

/* How the Sky works: three things, each with a little picture, in plain words. Shown the
   first time the Sky opens on this Mac, and again from ? or the board's menu. */
function SkyGuide({ onDone, onExample }) {
  return (
    <section className="sky-guide" role="dialog" aria-label="How the canvas works">
      <h2>How the canvas works</h2>
      <ol>
        <li>
          <span className="guide-pic is-sticky" data-paper="canary" aria-hidden="true">Call mom</span>
          <p><strong>A sticky is one thought.</strong> Write one on the desk or here, or scan paper. The AI files it into its topic for you.</p>
        </li>
        <li>
          <span className="guide-pic is-node" data-paper="sky" aria-hidden="true">Trip</span>
          <p><strong>A topic gathers stickies,</strong> like a trip, a project or a person. Notes lists them; here you see them spread out.</p>
        </li>
        <li>
          <span className="guide-pic is-branch" aria-hidden="true"><i data-paper="mint">Packing</i><i data-paper="rose">Hotels</i></span>
          <p><strong>Branches group stickies.</strong> They can sit on their own or inside a topic, and hold smaller branches.</p>
        </li>
      </ol>
      <p className="sky-guide-foot">Click a topic to open it as a map: its branches and stickies spread out around it. Double-click the canvas to write a sticky anywhere, and drag the dot on any card to connect it to another. Nothing here needs sorting: think freely, and drop a sticky on a topic only when you want to.</p>
      <button type="button" className="is-primary" onClick={onDone}>Got it</button>
      <button type="button" onClick={onExample}>Add the example roadmap</button>
    </section>
  )
}
