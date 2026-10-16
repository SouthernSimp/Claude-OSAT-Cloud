import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowsMerge, CalendarCheck, Camera, Kanban, ListBullets, MagnifyingGlass, NotePencil, Plus, Question, ShoppingCart, Sparkle, SquaresFour, Trash, Tray, X,
} from '@phosphor-icons/react'

import { photoMessages, readPhotoAnswer, readUnpackAnswer, unpackMessages } from '../../shared/ai-tasks.mjs'
import { WHAT_LABEL, WHAT_PAPER, WHATS, whatOf, whenOf } from '../../shared/what-model.mjs'
import { answeringLabel, askModel } from '../assistant/ask-model.js'
import { pictureProblem, readPicture, withPictures } from '../assistant/pictures.js'
import { cleanError, useAi } from '../assistant/useAi.js'
import { datesSettings, whenLine } from '../intake/dates.js'
import { putOnCalendar, takeOffCalendar } from '../intake/useDates.js'
import { carryable, useCarrying, useDrop } from '../lib/carry.js'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { connect, recordOf } from '../links-model.js'
import { PAPERS } from '../note-core.js'
import { getLocalModels, streamLocalMessage } from '../local-ai.js'
import { folderPath, isActiveNote, setDone, setWhat, trashNotes, updateNote } from '../notes-model.js'
import { addSticky, markOpened, pileOf, removeFolder, renameFolder } from '../nodes-model.js'
import { applyUnpackProposal, undoUnpackProposal } from '../sky/unpack-proposal.js'
import { useAutoFileStatus } from '../sky/useAutoFile.js'
import { useOvernight } from '../sky/useOvernight.js'
import '../styles/boards.css'
import {
  addBoard, boardsOf, COLUMN, findOn, JUST_IN, mapColumns, moveToBoard, onBoard, rankIn, setStage, stageColumns, stageOf, STAGES, stickiesOn, undoFrom,
} from './boards-model.js'
import { JustIn } from './JustIn.jsx'
import { mergeStickies, placeFrom, samePair } from './just-in.js'

const BOARD_KEY = 'osat.boards.board.v1'
const VIEW_KEY = 'osat.boards.view.v1'
// Pairs of stickies waved away with Keep both, so they aren't offered again.
const SAME_KEY = 'osat.boards.same.v1'
const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
const keep = (key, value) => { try { localStorage.setItem(key, value) } catch { /* only a convenience */ } }
const readList = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } }
// What two of a kind are called in "Two ideas say the same thing".
const PLURAL = { idea: 'ideas', question: 'questions', problem: 'problems', todo: 'to-dos', date: 'dates', buy: 'things to buy', note: 'notes' }

const VIEWS = [['map', 'Map', SquaresFour], ['board', 'Board', Kanban], ['list', 'List', ListBullets]]
const STARTER = ['Personal', 'Home', 'Work']
const KEPT = [['questions', 'Questions', Question], ['buy', 'To buy', ShoppingCart], ['coming', 'Coming up', CalendarCheck]]
const paperOf = (folder, index) => folder.color || PAPERS[index % PAPERS.length]

/* The canvas (Phase 68): the layer above the desk (⌘3, the dock's Canvas, ⌥⌘↑, or a sticky held at the
   top of the screen). Your boards down the side; the one open as a Map (a column per kind), a Board
   (Later, Next, Doing, Done) or a List. Write a sticky at the bottom and it goes in the right column.
   Every change has Undo. `target` says what to show on arriving ({ folderId }, { noteId }, or an
   action from the desk); Esc steps back (an edit, the search, a board being named) and then goes down
   (Desk.jsx asks `back()`). `onFiled` hears when a sticky from the desk went onto a board. */
export const Boards = forwardRef(function Boards({ workspace, commit, navigate, target, onClose, onFiled, onStackSent }, ref) {
  const [picked, setPicked] = useState(() => read(BOARD_KEY, JUST_IN))
  const [view, setViewState] = useState(() => read(VIEW_KEY, 'map'))
  const [query, setQuery] = useState('')
  const [naming, setNaming] = useState(null)
  const [editing, setEditing] = useState(null)
  const [lit, setLit] = useState(null)
  const [unpacking, setUnpacking] = useState(null)
  const [reading, setReading] = useState(null)
  const [keptPairs, setKeptPairs] = useState(() => readList(SAME_KEY))
  const photoField = useRef(null)
  const [menu, openMenu] = useContextMenu()
  const [toast, showUndo] = useUndoToast()
  const findField = useRef(null)
  const writeField = useRef(null)
  const latest = useRef(workspace)
  latest.current = workspace
  const overnight = useOvernight(workspace)
  const { models } = useAi()
  const answering = answeringLabel(models)

  const boards = useMemo(() => boardsOf(workspace), [workspace])
  const boardId = picked === JUST_IN || boards.some(({ folder }) => folder.id === picked) ? picked : (boards[0]?.folder.id || JUST_IN)
  const board = boards.find(({ folder }) => folder.id === boardId)?.folder || null
  const all = useMemo(() => stickiesOn(workspace, boardId), [workspace, boardId])
  const shown = useMemo(() => findOn(all, query), [all, query])
  const waiting = useMemo(() => stickiesOn(workspace, JUST_IN).length, [workspace])
  const same = useMemo(() => samePair(all, keptPairs), [all, keptPairs])
  const filing = useAutoFileStatus()

  const open = (id) => { setPicked(id); keep(BOARD_KEY, id); setQuery(''); setEditing(null) }
  const setView = (id) => { setViewState(id); keep(VIEW_KEY, id) }
  useEffect(() => { if (board?.fresh) commit((state) => markOpened(state, board.id)) }, [board?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /* One change, one line, one Undo that only takes back what this change touched. */
  function change(line, updater, after) {
    let before = null
    let next = null
    commit((state) => { before = state; next = updater(state); return next })
    if (!before || next === before) return
    const undo = undoFrom(before, next)
    showUndo(line, () => { commit(undo); after?.() })
  }
  const nameOf = (id) => (id === JUST_IN ? 'Just in' : boards.find(({ folder }) => folder.id === id)?.folder.name || 'the board')

  const actions = {
    moveTo(ids, toId) {
      const restores = ids.map((id) => onFiled?.(id)).filter((restore) => typeof restore === 'function')
      change(`Moved to ${nameOf(toId)}`, (state) => placeFrom(state, ids, toId), () => restores.forEach((restore) => restore()))
    },
    setKind(ids, what) {
      change(`Now ${ids.length === 1 ? 'it is' : 'they are'} ${COLUMN[what].toLowerCase()}`, (state) => setWhat(state, ids, what))
    },
    setStage(id, stage, list, index) {
      change(`Moved to ${STAGES.find(([key]) => key === stage)?.[1] || stage}`, (state) => {
        const staged = setStage(state, [id], stage)
        return Number.isFinite(index) ? rankIn(staged, id, list, index) : staged
      })
    },
    write(text) {
      const value = text.trim()
      if (!value) return
      let made = null
      commit((state) => { const result = addSticky(state, value, boardId === JUST_IN ? null : boardId, { source: 'Canvas' }); made = result.note; return result.state })
      if (made) setLit(made.id)
    },
    edit(id, text) {
      const value = text.trim()
      const note = latest.current.notes.find((item) => item.id === id)
      setEditing(null)
      if (!note || !value || value === note.markdown.trim()) return
      const title = value.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || note.title
      change('Changed the sticky', (state) => updateNote(state, id, { markdown: value, title }))
    },
    trash(id) {
      change('Moved to Trash', (state) => trashNotes(state, [id]))
    },
    startEdit(id) { setEditing(id) },
    /* Just in's Undo on one row: what the AI filed goes back to Just in; a date comes off the calendar. */
    undoRow(note) {
      if (note.filed && note.folderId === note.filed.into) { actions.moveTo([note.id], JUST_IN); return }
      const when = whenOf(note)
      takeOffCalendar(commit, note.id)
      showUndo('Took it off your calendar', when ? () => putOnCalendar(commit, note, when, datesSettings(latest.current.settings).calendar) : null)
    },
    tick(id) {
      change('Ticked off', (state) => setDone(state, [id], true))
    },
    merge(pair) {
      change('Merged into one sticky. Both sets of words are in it.', (state) => mergeStickies(state, pair.a.id, pair.b.id))
      setLit(pair.a.id)
    },
    keepBoth(key) {
      const next = [...keptPairs, key].slice(-500)
      setKeptPairs(next)
      keep(SAME_KEY, JSON.stringify(next))
    },
    moveMenu(event, note) {
      openMenu(event, boards.map(({ folder }) => ({ label: folder.name, onSelect: () => actions.moveTo([note.id], folder.id) })))
    },
    /* A photo of paper stickies: the AI on this Mac reads it (the photo never leaves the Mac and isn't
       kept), and each sticky it finds lands here on its own, filed like any other. One Undo takes them all. */
    async photo(file) {
      if (!file) return
      setReading('Reading the photo…')
      try {
        const own = (await getLocalModels()).filter((model) => model.runtime === 'osat')
        const model = own.find((item) => item.sees)
        if (!model) throw new Error(own.length ? pictureProblem(own[0]) : 'The AI on this Mac reads photos. Set it up in Settings → AI.')
        const picture = await readPicture(file)
        URL.revokeObjectURL(picture.url)
        const lines = readPhotoAnswer(await streamLocalMessage({ model: model.id, messages: withPictures(photoMessages(), [picture]) }))
        if (!lines.length) throw new Error('No writing was found in that photo.')
        const home = boardId === JUST_IN ? null : boardId
        change(`Read ${lines.length} ${lines.length === 1 ? 'sticky' : 'stickies'} from the photo`, (state) => lines.reduce((next, line) => addSticky(next, line, home, { source: 'Photo' }).state, state))
        setReading(null)
      } catch (error) {
        setReading(cleanError(error))
      }
    },
    newBoard(name) {
      const value = String(name || '').trim()
      setNaming(null)
      if (!value) return
      let made = null
      change(`Made the board “${value}”`, (state) => { const result = addBoard(state, value); made = result.folder; return result.state })
      if (made) open(made.id)
    },
    /* A first start: the three boards most lives have, in one go (one Undo). */
    starter() {
      change('Made Personal, Home and Work', (state) => STARTER.reduce((next, name) => addBoard(next, name).state, state))
    },
    renameBoard(id, name) {
      setNaming(null)
      const value = String(name || '').trim()
      if (value) change(`Renamed to “${value}”`, (state) => renameFolder(state, id, value))
    },
    /* Its stickies go back to Just in, nothing is lost, and Undo brings the board back as it was. */
    deleteBoard(folder) {
      change(`Deleted “${folder.name}”. Its stickies are in Just in.`, (state) => removeFolder(state, folder.id))
      if (folder.id === boardId) open(JUST_IN)
    },
    boardMenu(event, folder) {
      openMenu(event, [
        { label: 'Rename', icon: NotePencil, onSelect: () => setNaming({ id: folder.id }) },
        { divider: true },
        { label: 'Delete board', icon: Trash, hint: 'keeps its stickies', danger: true, onSelect: () => actions.deleteBoard(folder) },
      ])
    },
    /* While you sleep (Phase 53): a topic idea becomes a board with the stickies it is about on it (one
       Undo puts them back), and opens. A link idea connects the two. */
    keepIdea(idea) {
      if (idea.kind === 'link') change('Connected them', (state) => connect(state, idea.a, idea.b))
      else {
        let made = null
        change(`Made the board “${idea.name}”`, (state) => {
          const result = addBoard(state, idea.name)
          made = result.folder
          const live = new Set(state.notes.filter(isActiveNote).map((note) => note.id))
          return made ? moveToBoard(result.state, idea.notes.filter((id) => live.has(id)), made.id) : state
        })
        if (made) open(made.id)
      }
      overnight.done(idea, false)
    },
    async unpackWithAi(folder) {
      setUnpacking({ id: folder.id, line: `Asking ${answering}…` })
      try {
        const state = latest.current
        const answer = await askModel(unpackMessages({ title: folder.name, summary: pileOf(state.notes, folder.id).map((note) => note.markdown).join('\n\n'), branches: [] }))
        readUnpackAnswer(answer, folder.name)
        let made = null
        commit((current) => { made = applyUnpackProposal(current, folder.id, answer); return made.state })
        setUnpacking(null)
        if (made?.notes.length) showUndo(`Unpacked into ${made.notes.length} stickies`, () => commit((current) => undoUnpackProposal(current, made)))
      } catch (error) {
        setUnpacking({ id: folder.id, line: cleanError(error) })
      }
    },
    menuFor(event, note) {
      const here = note.folderId ? folderPath(latest.current.folders, note.folderId)[0] : null
      openMenu(event, [
        { label: 'What it is', items: WHATS.map((what) => ({ label: WHAT_LABEL[what], checked: whatOf(note) === what, onSelect: () => actions.setKind([note.id], what) })) },
        onBoard(note) ? { label: 'Stage', items: STAGES.map(([stage, label]) => ({ label, checked: stageOf(note) === stage, onSelect: () => actions.setStage(note.id, stage) })) } : null,
        {
          label: 'Move to',
          items: [
            ...boards.filter(({ folder }) => folder.name !== here).map(({ folder }) => ({ label: folder.name, onSelect: () => actions.moveTo([note.id], folder.id) })),
            note.folderId ? { label: 'Just in', onSelect: () => actions.moveTo([note.id], JUST_IN) } : null,
          ].filter(Boolean),
        },
        { label: 'Edit', icon: NotePencil, onSelect: () => setEditing(note.id) },
        { label: 'Open in Notes', onSelect: () => navigate('Notes', { noteId: note.id }) },
        { divider: true },
        { label: 'Delete', icon: Trash, danger: true, onSelect: () => actions.trash(note.id) },
      ])
    },
  }

  useImperativeHandle(ref, () => ({
    find() { findField.current?.focus(); findField.current?.select() },
    back() {
      if (editing) { setEditing(null); return true }
      if (query) { setQuery(''); return true }
      if (naming) { setNaming(null); return true }
      return false
    },
  }))

  // Arriving: a board or a note to show, or what the desk asked for.
  useEffect(() => {
    if (!target) return
    const state = latest.current
    // Sent with a view (Coming next opens its board as a Board).
    if (VIEWS.some(([id]) => id === target.view)) setView(target.view)
    if (target.action === 'new-node') { setNaming({}); return }
    if (target.action === 'new-sticky') { requestAnimationFrame(() => writeField.current?.focus()); return }
    if (target.action === 'sort') { open(JUST_IN); return }
    if (target.action === 'place-stack') {
      // A stack from the desk: with a name it becomes a board of that name; without one its stickies keep their homes.
      const name = String(target.name || '').trim()
      const restore = onStackSent?.(target.stackKey)
      if (!name) { open(JUST_IN); if (restore) showUndo('Off the desk', restore); return }
      let made = null
      change(`Made the board “${name}”`, (current) => {
        const result = addBoard(current, name)
        made = result.folder
        return result.folder ? moveToBoard(result.state, target.noteIds || [], result.folder.id) : current
      }, () => restore?.())
      if (made) open(made.id)
      return
    }
    const noteId = target.noteId || target.focusNoteId
    const note = noteId ? state.notes.find((item) => item.id === noteId) : null
    // A sticky sent up from the desk leaves the desk (Undo puts it back); it lives on its board.
    if (target.action === 'place-sticky' && note) {
      const restore = onFiled?.(note.id)
      if (restore) showUndo('Off the desk', restore)
    }
    const folderId = target.folderId || note?.folderId || null
    if (folderId) open(rootOf(state.folders, folderId) || JUST_IN)
    else if (note) open(JUST_IN)
    if (note) setLit(note.id)
  }, [target?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lit) return undefined
    const timer = setTimeout(() => setLit(null), 2400)
    requestAnimationFrame(() => document.querySelector(`[data-note="${lit}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
    return () => clearTimeout(timer)
  }, [lit])

  const ideas = overnight.ideas.slice(0, 1)
  const title = boardId === JUST_IN ? 'Just in' : board?.name || 'Just in'
  const count = `${all.length} ${all.length === 1 ? 'sticky' : 'stickies'}`
  const card = (note) => (
    <Card key={note.id} note={note} view={view} lit={lit === note.id} editing={editing === note.id} workspace={workspace} boardId={boardId} actions={actions} onEdit={() => setEditing(note.id)} />
  )

  return (
    <section className="boards" aria-label="Canvas">
      <nav className="boards-side" aria-label="Boards">
        <button type="button" className="ghost-button boards-down" onClick={onClose}><ArrowDown /> Desk</button>
        <BoardRow id={JUST_IN} name="Just in" icon={Tray} count={waiting} active={boardId === JUST_IN} onOpen={() => open(JUST_IN)} actions={actions} />
        <div className="boards-label"><span>Boards</span><button type="button" className="text-button" onClick={() => setNaming({})}>New</button></div>
        {boards.map(({ folder, count: n }, index) => (naming?.id === folder.id
          ? <NameForm key={folder.id} label={`Rename ${folder.name}`} initial={folder.name} onDone={(name) => actions.renameBoard(folder.id, name)} />
          : <BoardRow key={folder.id} id={folder.id} name={folder.name} paper={paperOf(folder, index)} count={n} active={boardId === folder.id} onOpen={() => open(folder.id)} onMenu={(event) => actions.boardMenu(event, folder)} actions={actions} fresh={folder.fresh} />
        ))}
        {naming && !naming.id && <NameForm label="New board’s name" placeholder="Name it: Fortis, Home…" onDone={(name) => actions.newBoard(name)} />}
        {!boards.length && !naming && <button type="button" className="boards-empty" onClick={() => actions.starter()}><Plus /> Start with {STARTER.join(', ')}</button>}
        <div className="boards-label"><span>Kept for you</span></div>
        {KEPT.map(([list, label, Icon]) => (
          <button key={list} type="button" className="boards-row" onClick={() => navigate('Notes', { list })}><Icon /> <span>{label}</span></button>
        ))}
      </nav>

      <main className="boards-main">
        <header className="boards-head">
          <div className="boards-title">
            <h1>{title}</h1>
            <p>{boardId === JUST_IN
              ? justInLine(filing)
              : (all.length ? count : `Nothing on ${title} yet. Write the first sticky below.`)}</p>
          </div>
          <label className="boards-find">
            <MagnifyingGlass aria-hidden="true" />
            <input ref={findField} value={query} placeholder={`Find on ${title}`} aria-label={`Find on ${title}`} onChange={(event) => setQuery(event.target.value)} />
            {query && <button type="button" aria-label="Clear" onClick={() => setQuery('')}><X /></button>}
          </label>
          {boardId !== JUST_IN && (
            <div className="segmented boards-views" role="tablist" aria-label="Show as">
              {VIEWS.map(([id, label, Icon]) => (
                <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}><Icon /> {label}</button>
              ))}
            </div>
          )}
          <button type="button" className="outline-button boards-ask" onClick={() => navigate('Assistant')}><Sparkle weight="fill" /> Ask</button>
        </header>

        {ideas.map((idea) => (
          <div key={idea.id} className="boards-note" role="note">
            <Sparkle aria-hidden="true" />
            <p><strong>{idea.kind === 'link' ? `${quoted(workspace, idea.a)} and ${quoted(workspace, idea.b)} look related.` : `“${idea.name}” could be a board.`}</strong> <span>{idea.why}</span></p>
            <button type="button" className="text-button" onClick={() => overnight.done(idea, true)}>Not this</button>
            <button type="button" className="primary-button" onClick={() => actions.keepIdea(idea)}>{idea.kind === 'link' ? 'Connect them' : 'Make the board'}</button>
          </div>
        ))}
        {same && (
          <div className="boards-note" role="note">
            <ArrowsMerge aria-hidden="true" />
            <p><strong>Two {PLURAL[whatOf(same.a)]} say the same thing.</strong> <span>{quoted(workspace, `note:${same.a.id}`)} and {quoted(workspace, `note:${same.b.id}`)}. Merge them into one?</span></p>
            <button type="button" className="text-button" onClick={() => actions.keepBoth(same.key)}>Keep both</button>
            <button type="button" className="primary-button" onClick={() => actions.merge(same)}>Merge</button>
          </div>
        )}
        {board?.packed && (
          <div className="boards-note" role="note">
            <Sparkle aria-hidden="true" />
            <p><strong>This came in as a summary.</strong> <span>{unpacking?.id === board.id ? unpacking.line : 'Unpack it into stickies, each in its column.'}</span></p>
            {answering && <button type="button" className="primary-button" disabled={unpacking?.id === board.id && !unpacking.line.startsWith('The')} onClick={() => actions.unpackWithAi(board)}>Unpack with AI</button>}
          </div>
        )}

        <div className={`boards-body is-${boardId === JUST_IN ? 'justin' : view}`}>
          {boardId === JUST_IN && <JustIn workspace={workspace} boards={boards} query={query} editing={editing} card={card} actions={actions} navigate={navigate} />}
          {boardId !== JUST_IN && view === 'map' && (
            <div className="boards-map">
              {mapColumns(shown).map((column) => <MapColumn key={column.what} column={column} boardId={boardId} actions={actions}>{column.notes.map(card)}</MapColumn>)}
            </div>
          )}
          {boardId !== JUST_IN && view === 'board' && (
            <div className="boards-kanban">
              {stageColumns(shown).map((column) => <StageColumn key={column.stage} column={column} actions={actions}>{column.notes.map(card)}</StageColumn>)}
            </div>
          )}
          {boardId !== JUST_IN && view === 'list' && <ListView notes={shown} actions={actions} onOpen={(id) => setEditing(id)} />}
        </div>

        <form className="boards-write" onSubmit={(event) => { event.preventDefault(); actions.write(writeField.current.value); writeField.current.value = '' }}>
          <label htmlFor="boards-write" className="visually-hidden">Write a sticky on {title}</label>
          <input id="boards-write" ref={writeField} autoComplete="off" placeholder={boardId === JUST_IN ? 'Write anything. OSAT works out what it is and where it goes.' : `Write a sticky on ${title}. OSAT puts it in the right column.`} />
          <button type="button" className="outline-button" aria-label="Add a photo of paper stickies" disabled={reading === 'Reading the photo…'} onClick={() => photoField.current?.click()}><Camera /> Photo</button>
          <input ref={photoField} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => { actions.photo(event.target.files?.[0]); event.target.value = '' }} />
          <button type="submit" className="primary-button">Add</button>
          {reading && <p className="boards-write-line" role="status">{reading}{reading !== 'Reading the photo…' && <button type="button" className="text-button" onClick={() => setReading(null)}>OK</button>}</p>}
        </form>
      </main>
      {menu}
      {toast}
    </section>
  )
})

/* What Just in says under its name: what filing is doing right now, else what the screen is. */
function justInLine(status) {
  const count = (n) => `${n} ${n === 1 ? 'sticky' : 'stickies'}`
  if (status.state === 'filing') return `Filing ${count(status.count)}…`
  if (status.state === 'no-ai') return `${count(status.count)} wait for the AI. Set it up in Settings → AI.`
  if (status.state === 'resting') return `The AI couldn’t file ${count(status.count)} just now (${status.message}). It tries again in a few minutes.`
  return 'Everything that came in and where OSAT put it. Every move can be undone.'
}

/* A sticky or board by its key ('note:<id>'), in quotes and short enough for one line. */
function quoted(state, key) {
  const record = recordOf(state, key)
  const words = record?.name || record?.title || 'a sticky'
  return `“${words.length > 48 ? `${words.slice(0, 47)}…` : words}”`
}

/* The board a topic or branch sits on: the one at the top of its path. */
function rootOf(folders, folderId) {
  let current = folders.find((folder) => folder.id === folderId)
  const seen = new Set()
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id)
    current = folders.find((folder) => folder.id === current.parentId)
  }
  return current?.id || null
}

/* A board's name, written in place: Return or leaving the field keeps it, Esc lets it go. */
function NameForm({ label, placeholder, initial = '', onDone }) {
  const [name, setName] = useState(initial)
  const done = useRef(false)
  const finish = (value) => { if (!done.current) { done.current = true; onDone(value) } }
  return (
    <form className="boards-naming" onSubmit={(event) => { event.preventDefault(); finish(name) }}>
      <input
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        value={name}
        maxLength={80}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => finish(name)}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish('') } }}
      />
    </form>
  )
}

function BoardRow({ id, name, icon: Icon, paper, count, active, onOpen, onMenu, actions, fresh }) {
  const drop = useDrop(`boards:${id}`, { accepts: (carried) => carried.kind === 'note', onDrop: (carried) => actions.moveTo([carried.id], id) })
  return (
    <button type="button" className={`boards-row ${active ? 'is-active' : ''}`} aria-current={active || undefined} onClick={onOpen} onContextMenu={onMenu} {...drop}>
      {Icon ? <Icon weight={active ? 'fill' : 'regular'} /> : <span className="boards-dot" data-paper={paper} aria-hidden="true" />}
      <span>{name}</span>
      {fresh && <em>New</em>}
      {count > 0 && <small>{count}</small>}
    </button>
  )
}

/* A column on the Map: dropping a sticky in it says that is what it is (and brings it onto this board). */
function MapColumn({ column, boardId, actions, children }) {
  const drop = useDrop(`map:${column.what}`, {
    accepts: (carried) => carried.kind === 'note',
    onDrop: (carried) => {
      const from = carried.data?.folderId ?? null
      if (boardId !== JUST_IN && from !== boardId && !carried.data?.onBoard) actions.moveTo([carried.id], boardId)
      actions.setKind([carried.id], column.what)
    },
  })
  return (
    <section className="map-column" data-paper={column.paper} aria-label={column.title} {...drop}>
      <h2><span className="boards-dot" data-paper={column.paper} aria-hidden="true" />{column.title}<small>{column.notes.length || ''}</small></h2>
      <div className="map-cards">{children}</div>
    </section>
  )
}

/* A stage on the Board: dropping a sticky moves it there, at the place it was dropped. */
function StageColumn({ column, actions, children }) {
  const drop = useDrop(`stage:${column.stage}`, {
    accepts: (carried) => carried.kind === 'note',
    axis: 'y',
    onDrop: (carried) => actions.setStage(carried.id, column.stage, column.notes, carried.index),
  })
  return (
    <section className="stage-column" aria-label={column.title} {...drop}>
      <h2>{column.title}<small>{column.notes.length || ''}</small></h2>
      <div className="map-cards">{children}</div>
    </section>
  )
}

function ListView({ notes, actions, onOpen }) {
  return (
    <div className="boards-list" role="table" aria-label="Stickies">
      <div role="row" className="boards-list-head"><span role="columnheader">Sticky</span><span role="columnheader">What it is</span><span role="columnheader">Came from</span><span role="columnheader">Added</span></div>
      {notes.map((note) => {
        const what = whatOf(note)
        return (
          <div role="row" key={note.id} className="boards-list-row" data-note={note.id} onContextMenu={(event) => actions.menuFor(event, note)} onDoubleClick={() => onOpen(note.id)}>
            <span role="cell" className="boards-list-words">{note.title}</span>
            <span role="cell"><span className="meta-kind" data-paper={WHAT_PAPER[what]}>{WHAT_LABEL[what]}</span></span>
            <span role="cell">{note.source || '—'}</span>
            <span role="cell">{new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        )
      })}
    </div>
  )
}

/* A sticky on a board: carried to another column, stage or board; clicked to write in it; right-click
   for what it is, its stage, where it goes, Notes, Delete. */
function Card({ note, view, lit, editing, workspace, boardId, actions, onEdit }) {
  const carrying = useCarrying()
  const field = useRef(null)
  useEffect(() => { if (editing) { field.current?.focus(); field.current?.select() } }, [editing])
  const what = whatOf(note)
  const when = what === 'date' ? whenOf(note) : null
  const branch = note.folderId && boardId !== JUST_IN ? folderPath(workspace.folders, note.folderId).slice(1).join(' / ') : ''
  // On the Board view the column already says the stage.
  const stage = view !== 'board' && onBoard(note) ? stageOf(note) : null
  if (editing) {
    return (
      <div className="boards-card is-editing" data-paper={WHAT_PAPER[what]} data-note={note.id}>
        <textarea
          ref={field}
          aria-label="Sticky"
          defaultValue={note.markdown}
          rows={Math.min(8, Math.max(3, note.markdown.split('\n').length + 1))}
          onBlur={(event) => actions.edit(note.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); actions.edit(note.id, note.markdown) }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.blur() }
          }}
        />
      </div>
    )
  }
  return (
    <article
      className={`boards-card ${lit ? 'is-lit' : ''} ${carrying?.id === note.id ? 'is-carried' : ''} ${note.doneAt ? 'is-done' : ''}`}
      data-paper={WHAT_PAPER[what]}
      data-note={note.id}
      tabIndex={0}
      aria-label={note.title}
      onClick={onEdit}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onEdit() } }}
      onContextMenu={(event) => actions.menuFor(event, note)}
      {...carryable({ kind: 'note', id: note.id, data: { folderId: note.folderId || null, onBoard: boardId !== JUST_IN } })}
    >
      <p>{note.gist || note.markdown}</p>
      <footer>
        {when && <span>{whenLine(when)}</span>}
        {branch && <span>{branch}</span>}
        {stage && stage !== 'later' && <span>{STAGES.find(([key]) => key === stage)[1]}</span>}
        {note.source && <span className="boards-card-from">{note.source}</span>}
      </footer>
    </article>
  )
}
