import { useMemo, useState } from 'react'
import { ArrowRight, CalendarBlank, Check, CheckCircle, ClockCounterClockwise, CurrencyDollar, EnvelopeSimple, Files, ListChecks, Microphone, Plus, Target, Tray } from '@phosphor-icons/react'

import { WHAT_LABEL, WHAT_PAPER, whatOf } from '../../shared/what-model.mjs'
import { sourceWords } from '../boards/boards-model.js'
import { cameIn, dayLabel, todaysBrief } from '../boards/just-in.js'
import { GoalsSummary } from '../goals/Goals.jsx'
import { habitFace, isHabitDone, localDateKey, streakWords, toggleHabit } from '../daily-practice.js'
import { Markdown } from '../lib/markdown.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { captureThought, comingUp, isActiveNote, setDone, setWhat } from '../notes-model.js'
import { formatMinor } from '../osat-data.js'
import { useMacCalendar } from '../views/MacCalendar.jsx'
import { dashboardBoards, dayLine, dayPlan, greeting, monthMoney, openTodos, recentWork } from './today-model.js'
import { bills, daysUntil } from '../money/money-model.js'
import { dueWords } from '../money/Bills.jsx'
import './dashboard.css'

const TICK_MS = 420
const time = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const shortDay = (date) => date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/* Ticking a to-do off: it shows ticked for a moment, then leaves, with Undo. */
function useTick(commit) {
  const [toast, showUndo] = useUndoToast()
  const [leaving, setLeaving] = useState(() => new Set())
  function tick(note) {
    setLeaving((set) => new Set(set).add(note.id))
    setTimeout(() => {
      commit((state) => setDone(state, [note.id], true))
      setLeaving((set) => { const next = new Set(set); next.delete(note.id); return next })
      showUndo('Done', () => commit((state) => setDone(state, [note.id], false)))
    }, TICK_MS)
  }
  return { toast, tick, leaving }
}

/* Today (Phase 73): the first screen. The greeting and the morning brief (or one line that says what the day holds),
   then what to do and what came in, beside the day, the habits and the month's money. Everything here is a door: each
   card opens the place it comes from. */
export function TodayView({ workspace, commit, navigate }) {
  const now = useMemo(() => new Date(), [])
  const today = localDateKey(now)
  const mac = useMacCalendar(now)
  const { toast, tick, leaving } = useTick(commit)
  const [allBoards, setAllBoards] = useState(false)
  const boards = useMemo(() => dashboardBoards(workspace), [workspace])
  const recent = useMemo(() => recentWork(workspace), [workspace])

  const todos = useMemo(() => openTodos(workspace, now.getTime()), [workspace, now])
  const waiting = useMemo(() => cameIn(workspace, now.getTime()).waiting, [workspace, now])
  const plan = useMemo(() => dayPlan({ mac: mac.events, hidden: mac.hidden, own: workspace.calendar.events, notes: workspace.notes }, now.getTime()), [mac.events, mac.hidden, workspace, now])
  const later = useMemo(() => {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    return comingUp(workspace.notes.filter(isActiveNote), now.getTime()).filter(({ when }) => when.start.getTime() >= end).slice(0, 3)
  }, [workspace, now])
  const habits = workspace.habits || []
  const kept = habits.filter((habit) => isHabitDone(habit, today)).length
  const money = monthMoney(workspace.budget, today.slice(0, 7))
  // The next bill due this week (Phase 88), so it never surprises.
  const bill = bills(workspace.budget.transactions, today, { ignore: workspace.budget.notBills || [], plans: workspace.budget.recurring }).find((item) => daysUntil(item.next, today) <= 7)
  const brief = todaysBrief(workspace, now)
  const line = dayLine({ todos: todos.length, late: todos.filter((item) => item.late).length, events: plan.length, waiting: waiting.length, habitsLeft: habits.length - kept })

  return (
    <div className="today today-dashboard">
      <header className="today-head">
        <p className="today-date">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1>{greeting(now)}</h1>
        {brief ? <Markdown className="today-brief" text={brief} /> : <p className="today-line">{line}</p>}
        <nav className="today-shortcuts" aria-label="Business shortcuts">
          <button type="button" onClick={() => navigate('Mail')}><EnvelopeSimple aria-hidden="true" />Mail</button>
          <button type="button" onClick={() => navigate('Meetings')}><Microphone aria-hidden="true" />Meetings</button>
          <button type="button" onClick={() => navigate('Files')}><Files aria-hidden="true" />Files</button>
        </nav>
      </header>

      <nav className="today-overview" aria-label="Your day at a glance">
        {[[CheckCircle, 'To do', todos.length, 'Todo'], [Tray, 'Just in', waiting.length, 'JustIn'], [CalendarBlank, 'Calendar', plan.length, 'Calendar']].map(([Icon, label, count, room]) => (
          <button type="button" key={room} onClick={() => navigate(room)}><Icon aria-hidden="true" /><span>{label}</span><strong>{count}</strong><ArrowRight aria-hidden="true" /></button>
        ))}
      </nav>

      {boards.length > 0 && <section className="today-boards" aria-label="Your boards">
        <header><h2>Your boards</h2>{boards.length > 3 && <button type="button" className="today-more" aria-expanded={allBoards} aria-controls="today-board-list" onClick={() => setAllBoards(!allBoards)}>{allBoards ? 'Show fewer' : `All ${boards.length}`}<ArrowRight aria-hidden="true" /></button>}</header>
        <div className="today-board-list" id="today-board-list">
          {(allBoards ? boards : boards.slice(0, 3)).map(({ folder, count, done, total }) => <button className="today-board" type="button" key={folder.id} onClick={() => navigate('Mindmap', { folderId: folder.id, open: true })}>
            <span className="today-board-name">{folder.name}<ArrowRight aria-hidden="true" /></span>
            <span className="today-board-progress">{total ? `${done} of ${total} steps done` : `${count} ${count === 1 ? 'note' : 'notes'}`}</span>
            {total > 0 && <progress max={total} value={done} aria-label={`${folder.name}: steps done`} />}
          </button>)}
        </div>
      </section>}

      <div className="today-grid">
        <div className="today-col">
          <Card tint="green" icon={CheckCircle} title="To do" more={todos.length > 6 ? `All ${todos.length}` : todos.length ? 'All' : ''} onMore={() => navigate('Todo')}>
            {todos.length
              ? <ul className="today-list">{todos.slice(0, 6).map((item) => <TodoRow key={item.note.id} item={item} ticked={leaving.has(item.note.id)} onTick={tick} navigate={navigate} />)}</ul>
              : <p className="today-empty">Nothing to do. Write “Call Sam back” in the bar above and it lands here.</p>}
          </Card>

          {waiting.length > 0 && (
            <Card tint="indigo" icon={Tray} title="Waiting in Just in" more="Open" onMore={() => navigate('JustIn')}>
              <ul className="today-list">
                {waiting.slice(0, 4).map((note) => (
                  <li key={note.id}>
                    <button type="button" className="today-item is-row" onClick={() => navigate('JustIn')}>
                      <span className="meta-kind" data-paper={WHAT_PAPER[whatOf(note)]}>{WHAT_LABEL[whatOf(note)]}</span>
                      <span className="today-item-text">{note.title || 'A sticky'}</span>
                      <small>{[sourceWords(note.source), dayLabel(note.createdAt, now.getTime()) === 'Today' ? time(note.createdAt) : dayLabel(note.createdAt, now.getTime())].filter(Boolean).join(' · ')}</small>
                    </button>
                  </li>
                ))}
              </ul>
              {waiting.length > 4 && <p className="today-more-line">And {waiting.length - 4} more.</p>}
            </Card>
          )}

          {recent.length > 0 && <Card tint="indigo" icon={ClockCounterClockwise} title="Recent work" more="Notes" onMore={() => navigate('Notes')}>
            <ul className="today-list">{recent.map((note) => <li key={note.id}>
              <button type="button" className="today-item" onClick={() => navigate('Notes', { noteId: note.id })}>
                <span className="today-item-text">{note.title || 'A sticky'}</span>
                <small>{[WHAT_LABEL[whatOf(note)], dayLabel(note.updatedAt || note.createdAt, now.getTime())].filter(Boolean).join(' · ')}</small>
              </button>
            </li>)}</ul>
          </Card>}

          <Card tint="violet" icon={Target} title="Goals" more="Open" onMore={() => navigate('Goals')}>
            <GoalsSummary workspace={workspace} />
          </Card>
        </div>

        <div className="today-col">
          <Card tint="red" icon={CalendarBlank} title="Your day" more="Calendar" onMore={() => navigate('Calendar')}>
            {mac.bridge && mac.access?.events === 'notAsked' && (
              <p className="today-ask">See your Mac’s calendars here. <button type="button" className="text-button" disabled={mac.busy} onClick={() => mac.allow('events')}>Allow</button></p>
            )}
            {plan.length
              ? (
                <ul className="today-agenda">
                  {plan.map((item) => (
                    <li key={item.id}>
                      <span className="today-time">{item.allDay ? 'All day' : time(item.start)}</span>
                      <i style={item.color ? { background: item.color } : undefined} aria-hidden="true" />
                      <button type="button" className="today-item today-item-text" onClick={() => item.noteId ? navigate('Notes', { noteId: item.noteId }) : navigate('Calendar', { date: item.start })}>{item.title}</button>
                    </li>
                  ))}
                </ul>
              )
              : <p className="today-empty">Nothing on your calendar today.</p>}
            {later.length > 0 && (
              <div className="today-later">
                <p className="today-sub">Coming up</p>
                <ul className="today-agenda">
                  {later.map(({ note, when }) => (
                    <li key={note.id}>
                      <span className="today-time">{shortDay(when.start)}</span>
                      <i aria-hidden="true" />
                      <button type="button" className="today-item today-item-text" onClick={() => navigate('Notes', { noteId: note.id })}>{note.title || when.title}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card tint="orange" icon={ListChecks} title="Habits" more={habits.length ? 'Open' : ''} onMore={() => navigate('Habits')}>
            {habits.length
              ? (
                <>
                  <div className="today-ring" style={{ '--kept': `${Math.round((kept / habits.length) * 100)}%` }}>
                    <span aria-hidden="true" />
                    <p><strong>{kept} of {habits.length}</strong> kept today</p>
                  </div>
                  <div className="today-habits">
                    {habits.map((habit) => {
                      const done = isHabitDone(habit, today)
                      const face = habitFace(habit.name)
                      return (
                        <button key={habit.id} type="button" className="today-habit" aria-pressed={done} title={streakWords(habit, today).run}
                          onClick={() => commit((state) => ({ ...state, habits: toggleHabit(state.habits, habit.id, today) }))}>
                          <i aria-hidden="true">{done ? <Check weight="bold" /> : face.emoji}</i>
                          <span>{face.text}</span>
                        </button>
                      )
                    })}
                  </div>
                </>
              )
              : (
                <p className="today-empty">Walk, read, drink water: small things, kept daily. <button type="button" className="text-button" onClick={() => navigate('Habits')}>Start one</button></p>
              )}
          </Card>

          <Card tint="teal" icon={CurrencyDollar} title={now.toLocaleDateString('en-US', { month: 'long' })} more="Money" onMore={() => navigate('Budget')}>
            {money.spent || money.income || bill
              ? (
                <div className="today-money">
                  <p><strong>{formatMinor(money.spent)}</strong> spent</p>
                  {money.income > 0 && <p className="today-sub">{formatMinor(money.income)} came in</p>}
                  {bill && <p className="today-sub">Next bill: {bill.label}, {formatMinor(bill.amountMinor)}, {dueWords(bill.next, today)}</p>}
                </div>
              )
              : <p className="today-empty">Nothing logged this month yet.</p>}
          </Card>
        </div>
      </div>
      {toast}
    </div>
  )
}

/* To do: every open to-do, by board, the ones being done first. One line at the foot adds another. */
export function TodoView({ workspace, commit, navigate }) {
  const { toast, tick, leaving } = useTick(commit)
  const [draft, setDraft] = useState('')
  const todos = useMemo(() => openTodos(workspace), [workspace])
  const groups = useMemo(() => {
    const out = []
    for (const item of todos) {
      const name = item.board || 'Not on a board yet'
      const group = out.find((entry) => entry.name === name)
      if (group) group.items.push(item)
      else out.push({ name, items: [item] })
    }
    return out.sort((a, b) => Number(a.name === 'Not on a board yet') - Number(b.name === 'Not on a board yet'))
  }, [todos])

  function add(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    commit((state) => {
      const made = captureThought(state, text.slice(0, 2000), 'To do')
      return made.note ? setWhat(made.state, [made.note.id], 'todo') : made.state
    })
    setDraft('')
  }

  return (
    <div className="today is-list">
      <header className="today-head">
        <h1>To do</h1>
        <p className="today-line">{todos.length ? `${todos.length} open, wherever they were filed. Doing and Next come first.` : 'Nothing to do. Add one below, or write it in the bar above.'}</p>
      </header>
      {groups.map((group) => (
        <section key={group.name} className="today-card" aria-label={group.name}>
          <h2 className="today-group">{group.name}</h2>
          <ul className="today-list">{group.items.map((item) => <TodoRow key={item.note.id} item={item} ticked={leaving.has(item.note.id)} onTick={tick} navigate={navigate} board={false} />)}</ul>
        </section>
      ))}
      <form className="today-add" onSubmit={add}>
        <Plus aria-hidden="true" />
        <label className="visually-hidden" htmlFor="todo-add">New to-do</label>
        <input id="todo-add" value={draft} maxLength={2000} placeholder="New to-do" autoComplete="off" onChange={(event) => setDraft(event.target.value)} />
      </form>
      {toast}
    </div>
  )
}

function Card({ tint, icon: Icon, title, more, onMore, children }) {
  return (
    <section className="today-card" data-tint={tint} aria-label={title}>
      <header>
        <h2 className="today-kicker"><Icon weight="fill" aria-hidden="true" />{title}</h2>
        {more && <button type="button" className="today-more" onClick={onMore}>{more}<ArrowRight weight="bold" aria-hidden="true" /></button>}
      </header>
      {children}
    </section>
  )
}

function TodoRow({ item, ticked, onTick, navigate, board = true }) {
  const { note, when, late } = item
  const meta = [board && item.board, when && (late ? `Since ${shortDay(when.start)}` : when.time ? `${shortDay(when.start)}, ${time(when.start.toISOString())}` : shortDay(when.start)), note.source === 'Meeting' ? 'From a meeting' : ''].filter(Boolean)
  return (
    <li className={ticked ? 'is-ticked' : undefined}>
      <button type="button" className="today-check" aria-label={`Done: ${note.title}`} aria-pressed={ticked} disabled={ticked} onClick={() => onTick(note)}>
        <Check weight="bold" aria-hidden="true" />
      </button>
      <button type="button" className="today-item" onClick={() => navigate('Notes', { noteId: note.id })}>
        <span className="today-item-text">{note.title || 'A to-do'}</span>
        {meta.length > 0 && <small>{meta.join(' · ')}</small>}
      </button>
    </li>
  )
}
