import { ArrowRight, CalendarBlank, CaretRight, Circle, NotePencil } from '@phosphor-icons/react'
import { useRef } from 'react'

import { WHAT_LABEL, WHAT_PAPER, whatOf } from '../../shared/what-model.mjs'
import { whenLine } from '../intake/dates.js'
import { boardOverview, cardWords, stageOf } from './boards-model.js'

/* A view of the same stickies, with the detailed Board and Map one click away. */
export function BoardOverview({ notes, onOpen, onTick, onShow, onWrite }) {
  const nextHeading = useRef(null)
  const { steps, done, total, upcoming, recent } = boardOverview(notes)
  if (!notes.length) return (
    <div className="board-overview-empty">
      <NotePencil aria-hidden="true" />
      <h2>Good work starts with a thought.</h2>
      <p>Keep the notes, next steps and dates for this board together.</p>
      <button type="button" className="primary-button" onClick={onWrite}>Write the first note <ArrowRight /></button>
    </div>
  )
  return (
    <div className="board-overview">
      {total > 0 && <div className="board-progress">
        <span role="status">{done} of {total} {total === 1 ? 'step' : 'steps'} done</span>
        <progress value={done} max={total} aria-label="Steps done" />
        <button type="button" className="text-button" onClick={() => onShow('board')}>See board <CaretRight /></button>
      </div>}

      <div className="board-overview-columns">
        <section className="board-next" aria-label="Next up">
          <h2 ref={nextHeading} tabIndex={-1}>Next up</h2>
          {steps.length ? <ul className="board-steps">{steps.slice(0, 5).map((note, index) => (
            <li key={note.id} className={index === 0 ? 'is-first' : ''}>
              <button type="button" className="board-step-tick" aria-label={`Mark done: ${note.title}`} onClick={() => { nextHeading.current?.focus(); onTick(note.id) }}><Circle aria-hidden="true" /></button>
              <button type="button" className="board-step-open" onClick={() => onOpen(note.id)}>
                <span>{stageOf(note) !== 'later' && <small className="board-step-stage">{stageOf(note) === 'doing' ? 'Doing' : 'Next'}</small>}<strong>{note.title}</strong></span>
                <CaretRight aria-hidden="true" />
              </button>
            </li>
          ))}</ul> : <p className="board-overview-quiet">{total ? 'All steps done. A little room to think.' : 'Nothing waiting. Write a to-do below when you need one.'}</p>}
          {steps.length > 5 && <button type="button" className="text-button board-see-all" onClick={() => onShow('board')}>See all {steps.length} steps <ArrowRight /></button>}
        </section>

        <section className="board-upcoming" aria-label="Coming up">
          <h2>Coming up</h2>
          {upcoming.length ? <ul>{upcoming.slice(0, 4).map(({ note, when }) => (
            <li key={note.id}><button type="button" onClick={() => onOpen(note.id)}>
              <time dateTime={when.date} className="board-date"><span>{when.start.toLocaleDateString(undefined, { month: 'short' })}</span><b>{when.start.getDate()}</b></time>
              <span><strong>{when.title}</strong><small>{whenLine(when)}</small></span>
              <CaretRight aria-hidden="true" />
            </button></li>
          ))}</ul> : <p className="board-overview-quiet"><CalendarBlank aria-hidden="true" />Dates written on this board will appear here.</p>}
          {upcoming.length > 4 && <button type="button" className="text-button board-see-all" onClick={() => onShow('map')}>See all dates <ArrowRight /></button>}
        </section>
      </div>

      <section className="board-recent" aria-label="Recent notes">
        <header><h2>Recent notes</h2><button type="button" className="text-button" onClick={() => onShow('map')}>See all {notes.length} {notes.length === 1 ? 'note' : 'notes'} <ArrowRight /></button></header>
        <div className="board-recent-notes">{recent.slice(0, 3).map((note) => {
          const what = whatOf(note)
          const preview = note.gist || cardWords(note.markdown).split('\n').slice(1).join('\n').trim()
          return <button key={note.id} type="button" className="board-recent-note" onClick={() => onOpen(note.id)}>
            <span className="meta-kind" data-paper={WHAT_PAPER[what]}>{WHAT_LABEL[what]}</span>
            <strong>{note.title}</strong>
            {preview && <p>{preview}</p>}
          </button>
        })}</div>
      </section>
    </div>
  )
}
