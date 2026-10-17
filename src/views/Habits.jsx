import { ArrowDown, ArrowUp, ArrowsLeftRight, CalendarDots, CaretLeft, CaretRight, DotsThree, Fire, Leaf, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState } from 'react'

import {
  calendarMonthDays, createHabit, habitFace, habitStreak, isHabitDone, keptWords, lastDays, localDateKey, moveHabit, renameHabit,
  shiftDay, streakWords, toggleHabit,
} from '../daily-practice.js'
import { menuEvent } from '../lib/ContextMenu.jsx'
import { carryable, useDrop } from '../lib/carry.js'
import { useContextMenu } from '../lib/ContextMenu.jsx'
import { useUndoToast } from '../lib/UndoToast.jsx'
import { NameField } from '../sky/Piles.jsx'
import '../styles/habits.css'

/* Habits (Tools → Habits): small things, kept daily. Today is the room: each habit is one big tap (kept, with a small
   spring) with its run in plain words and its last seven days, where a day missed can be marked. History is a month
   per habit; tap a day to change it. A new habit is named right here (Return). Each habit's ⋯ (or a right-click) has
   Rename, Build ↔ Avoid, Move and Delete (with Undo); dragging a habit, or ⌥↑ ⌥↓, reorders. Everything shown is worked
   out from the days each habit was kept (daily-practice.js): nothing new is stored. Esc steps back one thing at a time:
   out of a name being written, from History to Today, then the room closes (Desk.jsx). */

const IDEAS = [
  ['💧 Drink water', 'build'], ['🚶 Walk', 'build'], ['📖 Read 10 pages', 'build'], ['🧘 Stretch', 'build'],
  ['📵 No phone in bed', 'avoid'], ['🍬 No sweets', 'avoid'],
]
const KINDS = [['build', 'Build'], ['avoid', 'Avoid']]
const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const say = (key, options) => new Date(`${key}T12:00`).toLocaleDateString('en-US', options)
const longDay = (key) => say(key, { weekday: 'long', month: 'long', day: 'numeric' })
const nextMonth = (month, count) => localDateKey(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + count, 1, 12)).slice(0, 7)

/* Today's date, worked out on every render; a room left open past midnight looks again then. */
function useToday() {
  const today = localDateKey()
  const [, setTick] = useState(0)
  useEffect(() => {
    const now = new Date()
    const timer = setTimeout(() => setTick((tick) => tick + 1), new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now + 500)
    return () => clearTimeout(timer)
  }, [today])
  return today
}

/* ←→ (and ↑↓ a week, in a month) move between days in a strip or a month: one Tab stop each. */
function stepDays(event) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
  const day = event.target.dataset?.day
  if (!step || !day || event.altKey || event.metaKey) return
  const next = event.currentTarget.querySelector(`[data-day="${shiftDay(day, step)}"]:not(:disabled)`)
  if (!next) return
  event.preventDefault()
  next.focus()
}

export function HabitsView({ workspace, commit }) {
  const today = useToday()
  const habits = workspace.habits || []
  const [view, setView] = useState('today')
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [spot, setSpot] = useState(null)
  const [renaming, setRenaming] = useState(null)
  // The habit just kept (its circle springs) and the habit just added or brought back (it slides in).
  const [pop, setPop] = useState(null)
  const [fresh, setFresh] = useState(null)
  const [toast, showUndo] = useUndoToast()
  const [menu, openMenu] = useContextMenu()
  const room = useRef(null)
  const change = (update) => commit((state) => ({ ...state, habits: update(state.habits) }))

  function toggle(habit, day) {
    const keeping = !isHabitDone(habit, day)
    change((all) => toggleHabit(all, habit.id, day))
    if (day !== today) return
    // The last one kept today: the ring at the top fills, with a little cheer.
    setPop(keeping ? { id: habit.id, at: Date.now(), all: habits.every((item) => item.id === habit.id || isHabitDone(item, today)) } : null)
  }
  function add(name, type) {
    const habit = createHabit(name, type)
    if (!habit) return false
    change((all) => [...all, habit])
    setFresh(habit.id)
    return true
  }
  function remove(habit) {
    const index = habits.findIndex((item) => item.id === habit.id)
    change((all) => all.filter((item) => item.id !== habit.id))
    showUndo(`Deleted “${habit.name}”`, () => {
      change((all) => (all.some((item) => item.id === habit.id) ? all : [...all.slice(0, index), habit, ...all.slice(index)]))
      setFresh(habit.id)
    })
  }
  function move(id, index, byKeys = false) {
    change((all) => moveHabit(all, id, index))
    // Moved with the keys: the focus goes with it.
    if (byKeys) requestAnimationFrame(() => room.current?.querySelector(`[data-habit="${id}"] .habit-hit`)?.focus())
  }
  function rename(habit, name) {
    setRenaming(null)
    if (name) change((all) => renameHabit(all, habit.id, name))
    requestAnimationFrame(() => room.current?.querySelector(`[data-habit="${habit.id}"] .habit-hit`)?.focus())
  }
  function menuFor(event, habit) {
    const kind = habits.filter((item) => item.type === habit.type)
    const index = kind.findIndex((item) => item.id === habit.id)
    const other = habit.type === 'avoid' ? 'build' : 'avoid'
    openMenu(event, [
      { label: 'Rename', icon: PencilSimple, onSelect: () => setRenaming(habit.id) },
      { label: other === 'avoid' ? 'Make it an Avoid habit' : 'Make it a Build habit', icon: ArrowsLeftRight, onSelect: () => change((all) => all.map((item) => (item.id === habit.id ? { ...item, type: other } : item))) },
      { label: 'Move up', icon: ArrowUp, hint: '⌥↑', disabled: index < 1, onSelect: () => move(habit.id, index - 1, true) },
      { label: 'Move down', icon: ArrowDown, hint: '⌥↓', disabled: index === kind.length - 1, onSelect: () => move(habit.id, index + 1, true) },
      { label: 'See its history', icon: CalendarDots, onSelect: () => { setSpot(habit.id); setView('history') } },
      { divider: true },
      { label: 'Delete', icon: Trash, danger: true, onSelect: () => remove(habit) },
    ])
  }

  const groups = KINDS.map(([kind, label]) => ({ kind, label, habits: habits.filter((habit) => habit.type === kind) })).filter((group) => group.habits.length)
  const kept = habits.filter((habit) => isHabitDone(habit, today)).length
  const history = view === 'history' && habits.length > 0
  return (
    <div
      ref={room}
      className="habits"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !history) return
        event.preventDefault()
        setView('today')
      }}
    >
      {toast}
      {menu}
      <header className="habits-head">
        {!history && habits.length > 0 && <Ring kept={kept} total={habits.length} cheer={pop?.all ? pop.at : 0} />}
        <div className="habits-title">
          <h2>{history ? 'History' : 'Habits'}</h2>
          <p aria-live="polite">{history ? 'Tap a day to change it.' : [longDay(today), keptWords(habits, today)].filter(Boolean).join(' · ')}</p>
        </div>
        {habits.length > 0 && (
          <div className="segmented habits-views" role="tablist" aria-label="Habits">
            {[['today', 'Today'], ['history', 'History']].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => { setSpot(null); setView(id) }}>{label}</button>
            ))}
          </div>
        )}
      </header>

      {history ? (
        <History habits={habits} today={today} month={month} onMonth={setMonth} onToggle={toggle} spot={spot} />
      ) : (
        <div className="habits-today">
          {!habits.length && <Start onAdd={add} />}
          {groups.map((group) => (
            <Group
              key={group.kind}
              {...group}
              named={groups.length > 1 || group.kind === 'avoid'}
              today={today}
              pop={pop}
              fresh={fresh}
              renaming={renaming}
              onToggle={toggle}
              onMove={move}
              onMenu={menuFor}
              onRenamed={rename}
            />
          ))}
          <AddHabit onAdd={add} />
        </div>
      )}
    </div>
  )
}

/* How much of today is kept, as a ring; full, it shows a tick, and the moment it fills it gives a small cheer. */
function Ring({ kept, total, cheer }) {
  const round = 2 * Math.PI * 19
  return (
    <span className="habits-ring" data-full={kept === total ? '' : undefined} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="19" className="habits-ring-track" />
        <circle cx="24" cy="24" r="19" className="habits-ring-arc" data-none={kept ? undefined : ''} strokeDasharray={`${(round * kept) / total} ${round}`} />
      </svg>
      <Tick />
      {cheer > 0 && kept === total && (
        <span key={cheer} className="habits-cheer">{Array.from({ length: 8 }, (_, index) => <i key={index} style={{ '--a': `${index * 45}deg` }} />)}</span>
      )}
    </span>
  )
}

function Tick() {
  return <svg viewBox="0 0 24 24" className="habit-tick" aria-hidden="true"><path d="M6 12.5l4 4 8-9" /></svg>
}

/* The Build habits, or the Avoid ones: a list to drag within. */
function Group({ kind, label, named, habits, onMove, ...row }) {
  const drop = useDrop(`habits:${kind}`, {
    accepts: (carried) => carried.kind === 'habit' && carried.data?.type === kind,
    axis: 'y',
    onDrop: ({ id, index }) => onMove(id, index),
  })
  return (
    <section className="habit-group" aria-label={label}>
      {named && <h3>{label}{kind === 'avoid' && <small>Mark the days you stayed clear</small>}</h3>}
      <ul className="habit-list" {...drop}>
        {habits.map((habit, index) => <HabitRow key={habit.id} habit={habit} index={index} onMove={onMove} {...row} />)}
      </ul>
    </section>
  )
}

function HabitRow({ habit, index, today, pop, fresh, renaming, onToggle, onMove, onMenu, onRenamed }) {
  const line = useId()
  const kept = isHabitDone(habit, today)
  const { current } = habitStreak(habit, today)
  const words = streakWords(habit, today)
  const face = habitFace(habit.name)
  const popped = pop?.id === habit.id
  const Run = habit.type === 'avoid' ? Leaf : Fire
  const check = (
    <span key={popped ? pop.at : 'still'} className={`habit-check ${face.emoji ? 'has-emoji' : ''}`} aria-hidden="true">
      {face.emoji && <span className="habit-emoji">{face.emoji}</span>}
      <Tick />
    </span>
  )
  return (
    <li className="habit" data-slot="" data-habit={habit.id} data-fresh={fresh === habit.id ? '' : undefined} onContextMenu={(event) => { if (!event.target.closest('input')) onMenu(event, habit) }}>
      {renaming === habit.id ? (
        <div className="habit-hit is-renaming">
          {check}
          <NameField initial={habit.name} placeholder="Habit name" className="habit-name-field" onDone={(name) => onRenamed(habit, name)} />
        </div>
      ) : (
        <button
          type="button"
          className="habit-hit"
          aria-pressed={kept}
          aria-label={habit.name}
          aria-describedby={line}
          data-pop={popped ? '' : undefined}
          onClick={() => onToggle(habit, today)}
          onKeyDown={(event) => {
            if (!event.altKey || event.metaKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
            event.preventDefault()
            onMove(habit.id, index + (event.key === 'ArrowUp' ? -1 : 1), true)
          }}
          {...carryable({ kind: 'habit', id: habit.id, data: { type: habit.type } })}
        >
          {check}
          <span className="habit-words">
            <strong>{face.text}</strong>
            <small id={line}>{current > 0 && <Run weight="fill" className="habit-run" />}{words.run}{words.best && <em>{words.best}</em>}</small>
          </span>
        </button>
      )}
      <Week habit={habit} today={today} onToggle={onToggle} />
      <button type="button" className="habit-more" aria-label={`More for ${habit.name}`} aria-haspopup="menu" title="Rename, move, delete…" onClick={(event) => onMenu(menuEvent(event), habit)}>
        <DotsThree weight="bold" />
      </button>
    </li>
  )
}

/* The last seven days, today last: tap one to mark it, or to take it back. Days kept in a row are joined. */
function Week({ habit, today, onToggle }) {
  return (
    <div className="habit-week" role="group" aria-label={`${habit.name}, the last seven days`} onKeyDown={stepDays}>
      {lastDays(today).map((day) => (
        <button
          key={day}
          type="button"
          data-day={day}
          data-today={day === today ? '' : undefined}
          tabIndex={day === today ? 0 : -1}
          aria-pressed={isHabitDone(habit, day)}
          aria-label={day === today ? `Today, ${longDay(day)}` : longDay(day)}
          title={say(day, { weekday: 'long', month: 'short', day: 'numeric' })}
          onClick={() => onToggle(habit, day)}
        >
          {say(day, { weekday: 'narrow' })}
        </button>
      ))}
    </div>
  )
}

/* A new habit, named in place: Return adds it, and the field stays for the next one. */
function AddHabit({ onAdd }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('build')
  const field = useRef(null)
  return (
    <form className="habit-add" onSubmit={(event) => { event.preventDefault(); if (onAdd(name, type)) setName('') }}>
      <span className="habit-check is-new" aria-hidden="true"><Plus weight="bold" /></span>
      <input
        ref={field}
        type="text"
        value={name}
        maxLength={80}
        aria-label="New habit"
        placeholder={type === 'avoid' ? 'Something to stay away from' : 'New habit'}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !name) return
          event.preventDefault()
          setName('')
        }}
      />
      <div className="segmented habit-kind" role="radiogroup" aria-label="Build or avoid">
        {KINDS.map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={type === id} className={type === id ? 'active' : ''} title={id === 'avoid' ? 'Something to stay away from: mark the days you did' : 'Something to do: mark the days you did it'} onClick={() => { setType(id); field.current?.focus() }}>{label}</button>
        ))}
      </div>
      {name.trim() && <button type="submit" className="primary-button habit-add-go">Add</button>}
    </form>
  )
}

/* No habits yet: a few to start with, one tap each, or a name of your own below. */
function Start({ onAdd }) {
  return (
    <section className="habits-start" aria-label="Start a habit">
      <div className="habit-week habits-start-art" aria-hidden="true">
        {WEEK.map((letter, index) => <span key={index} data-on={index === 2 ? undefined : ''} style={{ '--i': index }}>{letter}</span>)}
      </div>
      <h3>Small things, kept daily</h3>
      <p>Start with one of these or name your own. Tap it on each day you keep it.</p>
      <div className="habits-ideas">
        {IDEAS.map(([name, type]) => (
          <button key={name} type="button" className="habits-idea" onClick={() => onAdd(name, type)}>
            {name}{type === 'avoid' && <small>Avoid</small>}
          </button>
        ))}
      </div>
    </section>
  )
}

/* A month at a time: every habit together (the more kept, the deeper), then each habit's own days to tap. */
function History({ habits, today, month, onMonth, onToggle, spot }) {
  const days = calendarMonthDays(Number(month.slice(0, 4)), Number(month.slice(5)) - 1)
  const weeks = days.slice(0, Math.ceil((days.findLastIndex((day) => day.inMonth) + 1) / 7) * 7)
  const name = say(`${month}-01`, { month: 'long' })
  const everything = weeks.filter((day) => day.inMonth && day.key <= today && habits.every((habit) => isHabitDone(habit, day.key))).length
  return (
    <div className="habits-history">
      <nav className="habits-month" aria-label="Month">
        <button type="button" className="icon-button" aria-label="The month before" onClick={() => onMonth(nextMonth(month, -1))}><CaretLeft weight="bold" /></button>
        <strong aria-live="polite">{say(`${month}-01`, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" className="icon-button" aria-label="The month after" disabled={month >= today.slice(0, 7)} onClick={() => onMonth(nextMonth(month, 1))}><CaretRight weight="bold" /></button>
      </nav>
      <div className="habits-months">
        <article className="habit-month is-all">
          <header><strong>Every habit</strong><small>The more kept, the deeper</small></header>
          <MonthGrid weeks={weeks} today={today} label={`Every habit in ${name}`} cell={(key) => {
            const count = habits.filter((habit) => isHabitDone(habit, key)).length
            return { level: key > today ? undefined : Math.ceil((count / habits.length) * 4), title: `${say(key, { month: 'short', day: 'numeric' })}: ${count} of ${habits.length} kept` }
          }} />
          <footer>{everything ? `${everything} ${everything === 1 ? 'day' : 'days'} with everything kept` : 'Each day fills in as habits are kept'}</footer>
        </article>
        {habits.map((habit) => <MonthCard key={habit.id} habit={habit} weeks={weeks} month={month} name={name} today={today} onToggle={onToggle} spot={spot === habit.id} />)}
      </div>
    </div>
  )
}

function MonthCard({ habit, weeks, month, name, today, onToggle, spot }) {
  const node = useRef(null)
  useEffect(() => { if (spot) node.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [spot])
  const face = habitFace(habit.name)
  const kept = habit.doneDates.filter((day) => day.startsWith(month) && day <= today).length
  const words = streakWords(habit, today)
  const avoid = habit.type === 'avoid'
  return (
    <article ref={node} className="habit-month" data-spot={spot ? '' : undefined} aria-label={habit.name}>
      <header>
        {face.emoji && <span className="habit-month-face" aria-hidden="true">{face.emoji}</span>}
        <strong>{face.text}</strong>
        <small>{kept ? `${kept} ${avoid ? 'clean ' : ''}${kept === 1 ? 'day' : 'days'}` : 'None yet'}</small>
      </header>
      <MonthGrid weeks={weeks} today={today} label={`${habit.name}, ${name}`} onPick={(key) => onToggle(habit, key)} kept={(key) => isHabitDone(habit, key)} />
      <footer>{words.run}{words.best && ` · ${words.best}`}</footer>
    </article>
  )
}

/* One month as weeks, Sunday first. With `onPick`, each day up to today is a button that marks it (`kept`); without,
   each is a shade (`cell(key)` → { level 0–4, title }) to look at. */
function MonthGrid({ weeks, today, label, onPick, kept, cell }) {
  const inMonth = weeks.filter((day) => day.inMonth)
  const stop = inMonth.some((day) => day.key === today) ? today : inMonth[0]?.key
  return (
    <div className="habit-month-grid" role={onPick ? 'group' : 'img'} aria-label={label} onKeyDown={onPick ? stepDays : undefined}>
      {WEEK.map((letter, index) => <span key={`w${index}`} className="habit-month-day" aria-hidden="true">{letter}</span>)}
      {weeks.map(({ key, inMonth: here, date }) => {
        if (!here) return <span key={key} className="is-out" aria-hidden="true" />
        if (!onPick) {
          const { level, title } = cell(key)
          return <span key={key} data-level={level} data-today={key === today ? '' : undefined} title={title}>{date.getDate()}</span>
        }
        const later = key > today
        return (
          <button
            key={key}
            type="button"
            data-day={key}
            data-today={key === today ? '' : undefined}
            disabled={later}
            tabIndex={key === stop ? 0 : -1}
            aria-pressed={later ? undefined : kept(key)}
            aria-label={key === today ? `Today, ${longDay(key)}` : longDay(key)}
            onClick={() => onPick(key)}
          >
            {date.getDate()}
          </button>
        )
      })}
    </div>
  )
}
