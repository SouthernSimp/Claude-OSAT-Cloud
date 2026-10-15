import { Check } from '@phosphor-icons/react'

import { habitFace, habitStreak, isHabitDone, streakWords, toggleHabit } from '../../daily-practice.js'

/* Habits: today's habits as chips, the room's circles in small; a tap keeps one for today (a second tap lets it go
   again), and a run of two days or more shows its count. Opens Habits. */
export function HabitsWidget({ workspace, commit, today, open, room = 0 }) {
  const habits = workspace.habits || []
  const kept = habits.filter((habit) => isHabitDone(habit, today)).length
  return (
    <>
      <button type="button" className="widget-kicker widget-title" aria-label="Habits. Open Habits" onClick={() => open('Habits')}>
        Habits{kept > 0 && <small>{kept === habits.length ? 'All kept' : `${kept} of ${habits.length}`}</small>}
      </button>
      {habits.length ? (
        <div className="habit-chips">
          {habits.slice(0, 8 + room * 3).map((habit) => {
            const done = isHabitDone(habit, today)
            const { current } = habitStreak(habit, today)
            const face = habitFace(habit.name)
            return (
              <button
                key={habit.id}
                type="button"
                className="habit-chip"
                aria-pressed={done}
                aria-label={habit.name}
                title={streakWords(habit, today).run}
                onClick={() => commit((state) => ({ ...state, habits: toggleHabit(state.habits, habit.id, today) }))}
              >
                <i aria-hidden="true">{done ? <Check weight="bold" /> : face.emoji}</i>
                {face.text}
                {current > 1 && <small aria-hidden="true">{current}</small>}
              </button>
            )
          })}
        </div>
      ) : <p className="widget-empty">No habits yet. Open Habits to start one.</p>}
    </>
  )
}
