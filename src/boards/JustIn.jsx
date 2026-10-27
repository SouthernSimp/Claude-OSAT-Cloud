import { useMemo, useState } from 'react'
import { SunHorizon } from '@phosphor-icons/react'

import { WHAT_LABEL, WHAT_PAPER, whatOf, whenOf } from '../../shared/what-model.mjs'
import { whenLine } from '../intake/dates.js'
import { carryable, useCarrying } from '../lib/carry.js'
import { comingUp, isActiveNote, notesInList } from '../notes-model.js'
import { findOn, sourceWords } from './boards-model.js'
import { cameIn, guessBoards, todayFlow, todaysBrief, undoOf, whereTo } from './just-in.js'

const FIRST = 12
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const dayOf = (note) => { const when = whenOf(note); return when ? whenLine(when) : '' }

/* Just in (Phase 72), the screen: today's morning brief on top; what waits for a home, each with the two
   boards it most looks like; what OSAT put somewhere this week, by day, each with where it went and Undo;
   and beside them the lists OSAT keeps (To buy, Coming up, Questions). `editing` and `card` come from the
   canvas, so a row is written in the same way a sticky on a board is; `picked` (Phase 97) comes from there too. */
export function JustIn({ workspace, boards, query, editing, picked, card, actions, navigate }) {
  const [more, setMore] = useState(false)
  const { waiting, days } = useMemo(() => cameIn(workspace), [workspace])
  const shownWaiting = findOn(waiting, query)
  const shownDays = days.map((day) => ({ ...day, notes: findOn(day.notes, query) })).filter((day) => day.notes.length)
  const brief = query ? '' : todaysBrief(workspace)
  const flow = useMemo(() => todayFlow(workspace), [workspace])
  const nameOf = (id) => boards.find(({ folder }) => folder.id === id)?.folder.name
  const row = (note, guesses) => (editing === note.id
    ? card(note)
    : <Row key={note.id} note={note} workspace={workspace} guesses={guesses} nameOf={nameOf} picked={picked.includes(note.id)} actions={actions} />)

  return (
    <div className="justin">
      <div className="justin-main">
        {brief && (
          <section className="justin-brief" aria-label="Morning brief">
            <h2><SunHorizon aria-hidden="true" /> This morning</h2>
            <p>{brief}</p>
            <button type="button" className="text-button" onClick={() => navigate('Journal')}>Open today’s journal</button>
          </section>
        )}
        {flow.came > 0 && !query && (
          <p className="justin-flow" aria-label="Today’s intake">
            <b>{flow.came} came in today</b>
            {[['calendar', 'on the calendar'], ['questions', 'to Questions'], ['buy', 'to To buy'], ['board', 'on a board'], ['waiting', 'waiting']]
              .filter(([key]) => flow[key]).map(([key, label]) => <span key={key}>→ {flow[key]} {label}</span>)}
          </p>
        )}
        {shownWaiting.length > 0 && (
          <section className="justin-card" aria-label="Waiting for a home">
            <h2>Waiting for a home <small>{shownWaiting.length}</small></h2>
            <p className="justin-hint">{boards.length ? 'Pick where each one goes, or drag it onto a board.' : 'Make a board on the left, then pick where each one goes.'}</p>
            {(more ? shownWaiting : shownWaiting.slice(0, FIRST)).map((note) => row(note, boards.length ? guessBoards(workspace, note) : []))}
            {!more && shownWaiting.length > FIRST && <button type="button" className="text-button justin-more" onClick={() => setMore(true)}>Show {shownWaiting.length - FIRST} more</button>}
          </section>
        )}
        {shownDays.map((day) => (
          <section key={day.label} className="justin-card" aria-label={day.label}>
            <h2>{day.label} <small>{day.notes.length}</small></h2>
            {day.notes.map((note) => row(note, null))}
          </section>
        ))}
        {!shownWaiting.length && !shownDays.length && (
          <p className="justin-empty">{query ? 'Nothing that came in has those words.' : 'Nothing came in this week. Write a sticky below, or add a photo of paper ones.'}</p>
        )}
      </div>
      <Kept workspace={workspace} actions={actions} navigate={navigate} />
    </div>
  )
}

/* One sticky that came in: its kind, its words, where it went (or the boards it looks like), where it
   came from and when, and Undo. Click to write in it; ⌘- or ⇧-click (or Space) to pick it with others; drag it
   onto a board; right-click for the rest. */
function Row({ note, workspace, guesses, nameOf, picked, actions }) {
  const carrying = useCarrying()
  const what = whatOf(note)
  const to = whereTo(workspace, note, dayOf)
  const undo = undoOf(note)
  return (
    <article
      className={`justin-row ${carrying?.id === note.id || carrying?.data?.ids?.includes(note.id) ? 'is-carried' : ''} ${note.doneAt ? 'is-done' : ''} ${picked ? 'is-picked' : ''}`}
      data-note={note.id}
      tabIndex={0}
      aria-label={picked ? `${note.title}, picked` : note.title}
      onClick={(event) => (event.metaKey || event.ctrlKey || event.shiftKey ? actions.pick(event, note.id) : actions.startEdit(note.id))}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter') { event.preventDefault(); actions.startEdit(note.id) }
        if (event.key === ' ') { event.preventDefault(); actions.pick(event, note.id) }
      }}
      onContextMenu={(event) => actions.menuFor(event, note)}
      {...carryable({ kind: 'note', id: note.id, data: { folderId: note.folderId || null, onBoard: false, ids: actions.idsFor(note.id) } })}
    >
      <span className="meta-kind" data-paper={WHAT_PAPER[what]}>{WHAT_LABEL[what]}</span>
      <p className="justin-words">{note.gist || note.title}</p>
      {to.length > 0 && <span className="justin-to">→ {to.join(' + ')}</span>}
      {guesses && (
        <span className="justin-guess" onClick={(event) => event.stopPropagation()}>
          {guesses.map((id) => <button key={id} type="button" className="outline-button" onClick={() => actions.moveTo([note.id], id)}>{nameOf(id)}</button>)}
          <button type="button" className="text-button" onClick={(event) => actions.moveMenu(event, [note.id])}>{guesses.length ? 'Other…' : 'Move to…'}</button>
        </span>
      )}
      <span className="justin-from">{[sourceWords(note.source), timeOf(note.createdAt)].filter(Boolean).join(' · ')}</span>
      {undo && <button type="button" className="ghost-button justin-undo" onClick={(event) => { event.stopPropagation(); actions.undoRow(note) }}>{undo === 'board' ? 'Undo' : 'Take off calendar'}</button>}
    </article>
  )
}

/* The lists OSAT keeps for you, short, beside what came in. A heading opens the whole list in Notes. */
function Kept({ workspace, actions, navigate }) {
  const buy = notesInList(workspace, 'buy').slice(0, 8)
  const coming = comingUp(workspace.notes.filter(isActiveNote)).slice(0, 5)
  const questions = notesInList(workspace, 'questions').slice(0, 5)
  if (!buy.length && !coming.length && !questions.length) return null
  const head = (list, label, paper) => (
    <h2><button type="button" onClick={() => navigate('Notes', { list })}><span className="boards-dot" data-paper={paper} aria-hidden="true" /> {label}</button></h2>
  )
  return (
    <aside className="justin-kept" aria-label="Kept for you">
      {buy.length > 0 && (
        <section className="justin-card">
          {head('buy', 'To buy', WHAT_PAPER.buy)}
          {buy.map((note) => (
            <label key={note.id} className="justin-tick">
              <input type="checkbox" checked={false} onChange={() => actions.tick([note.id])} aria-label={`Bought: ${note.title}`} />
              <span>{note.gist || note.title}</span>
            </label>
          ))}
        </section>
      )}
      {coming.length > 0 && (
        <section className="justin-card">
          {head('coming', 'Coming up', WHAT_PAPER.date)}
          {coming.map(({ note, when }) => <p key={note.id} className="justin-line"><span>{when.title || note.title}</span><small>{whenLine(when)}</small></p>)}
        </section>
      )}
      {questions.length > 0 && (
        <section className="justin-card">
          {head('questions', 'Questions', WHAT_PAPER.question)}
          {questions.map((note) => <p key={note.id} className="justin-line"><span>{note.gist || note.title}</span></p>)}
        </section>
      )}
    </aside>
  )
}
