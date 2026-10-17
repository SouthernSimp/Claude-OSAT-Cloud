import { useMemo, useState } from 'react'
import { Check, DotsThree, Plus, Trash } from '@phosphor-icons/react'

import { boardsOf } from '../boards/boards-model.js'
import { menuEvent, useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { byWords, createGoal, progressOf, sortGoals } from './goals-model.js'

/* Goals (Phase 75, Life → Goals): the few big things, each on a card with how far along it is. A goal can move with a
   board (its to-dos done) or a habit (its days kept), so it moves when you do. New goal at the foot; a card's … marks
   it done or deletes it, with Undo. */
export function GoalsView({ workspace, commit }) {
  const [menu, openMenu] = useContextMenu()
  const [toast, showUndo] = useUndoToast()
  const goals = useMemo(() => sortGoals(workspace.goals || []), [workspace.goals])

  const setGoals = (update) => commit((state) => ({ ...state, goals: update(state.goals || []) }))
  function add(goal) {
    setGoals((list) => [...list, goal])
    showUndo(`Set the goal “${goal.name}”`, () => setGoals((list) => list.filter((item) => item.id !== goal.id)))
  }
  function done(goal, yes) {
    setGoals((list) => list.map((item) => (item.id === goal.id ? { ...item, doneAt: yes ? new Date().toISOString() : '' } : item)))
    if (yes) showUndo(`Done: ${goal.name}`, () => setGoals((list) => list.map((item) => (item.id === goal.id ? { ...item, doneAt: '' } : item))))
  }
  function remove(goal) {
    const at = (workspace.goals || []).findIndex((item) => item.id === goal.id)
    setGoals((list) => list.filter((item) => item.id !== goal.id))
    showUndo(`Deleted “${goal.name}”`, () => setGoals((list) => { const next = list.filter((item) => item.id !== goal.id); next.splice(at, 0, goal); return next }))
  }

  return (
    <div className="today goals">
      <header className="today-head">
        <h1>Goals</h1>
        <p className="today-line">{goals.length ? 'The few big things. Each one moves when its board or habit does.' : 'The few big things: a client to win, a number to hit, a habit to keep. Set the first one below.'}</p>
      </header>
      {goals.length > 0 && (
        <div className="goals-grid">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} workspace={workspace} onMenu={(event) => openMenu(menuEvent(event), [
              goal.doneAt
                ? { label: 'Not done yet', onSelect: () => done(goal, false) }
                : { label: 'Mark it done', icon: Check, onSelect: () => done(goal, true) },
              { divider: true },
              { label: 'Delete', icon: Trash, danger: true, onSelect: () => remove(goal) },
            ])} />
          ))}
        </div>
      )}
      <NewGoal workspace={workspace} onAdd={add} />
      {menu}
      {toast}
    </div>
  )
}

function GoalCard({ goal, workspace, onMenu }) {
  const progress = progressOf(goal, workspace)
  const by = byWords(goal)
  return (
    <section className={`today-card goal-card ${goal.doneAt ? 'is-done' : ''}`} aria-label={goal.name}>
      <header>
        <span className="goal-by">{by || (goal.doneAt ? 'Done' : 'No date')}</span>
        <button type="button" className="goal-more" aria-label={`More for ${goal.name}`} aria-haspopup="menu" onClick={onMenu}><DotsThree weight="bold" /></button>
      </header>
      <h2>{goal.name}</h2>
      <div className="goal-bar" role="progressbar" aria-label={`${goal.name}: ${progress.words}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.pct * 100)}>
        <i style={{ width: `${Math.round(progress.pct * 100)}%` }} />
      </div>
      <p><strong>{progress.words}</strong>{progress.fed && <span>{progress.fed}</span>}</p>
    </section>
  )
}

/* A goal by name, with when it is for and what moves it. */
function NewGoal({ workspace, onAdd }) {
  const [name, setName] = useState('')
  const [by, setBy] = useState('')
  const [fed, setFed] = useState('')
  const [perWeek, setPerWeek] = useState(4)
  const boards = boardsOf(workspace)
  const habits = workspace.habits || []
  function submit(event) {
    event.preventDefault()
    const [kind, id] = fed.split(':')
    const goal = createGoal({ name, by, fed: kind && id ? { kind, id } : null, perWeek: kind === 'habit' ? perWeek : 7 })
    if (!goal) return
    onAdd(goal)
    setName('')
    setBy('')
    setFed('')
  }
  return (
    <form className="today-card goal-new" onSubmit={submit} aria-label="New goal">
      <div className="goal-new-name">
        <Plus aria-hidden="true" />
        <label className="visually-hidden" htmlFor="goal-name">New goal</label>
        <input id="goal-name" value={name} maxLength={120} placeholder="New goal: win three clients, read 12 books…" autoComplete="off" onChange={(event) => setName(event.target.value)} />
      </div>
      {name.trim() && (
        <div className="goal-new-more">
          <label>By <input type="date" value={by} onChange={(event) => setBy(event.target.value)} /></label>
          <label>Moves with
            <select value={fed} onChange={(event) => setFed(event.target.value)}>
              <option value="">Nothing: I’ll tick it off</option>
              {boards.length > 0 && <optgroup label="A board’s to-dos">{boards.map(({ folder }) => <option key={folder.id} value={`board:${folder.id}`}>{folder.name}</option>)}</optgroup>}
              {habits.length > 0 && <optgroup label="A habit">{habits.map((habit) => <option key={habit.id} value={`habit:${habit.id}`}>{habit.name}</option>)}</optgroup>}
            </select>
          </label>
          {fed.startsWith('habit:') && (
            <label>Days a week
              <select value={perWeek} onChange={(event) => setPerWeek(Number(event.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          <button type="submit" className="primary-button">Set the goal</button>
        </div>
      )}
    </form>
  )
}

/* Today's Goals card: the open goals, soonest first, each with its bar. */
export function GoalsSummary({ workspace }) {
  const open = sortGoals((workspace.goals || []).filter((goal) => !goal.doneAt)).slice(0, 3)
  if (!open.length) return <p className="today-empty">The few big things: a client to win, a habit to keep. Set one in Goals.</p>
  return (
    <ul className="today-goals">
      {open.map((goal) => {
        const progress = progressOf(goal, workspace)
        return (
          <li key={goal.id}>
            <span className="today-goal-name">{goal.name}</span>
            <small>{progress.words}</small>
            <div className="goal-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress.pct * 100)}%` }} /></div>
          </li>
        )
      })}
    </ul>
  )
}
