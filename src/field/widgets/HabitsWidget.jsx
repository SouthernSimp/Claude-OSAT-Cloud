import { Check } from '@phosphor-icons/react'

import { isHabitDone, toggleHabit } from '../../daily-practice.js'

/* Habits: today's habits as chips; a tap keeps one for today (and a second tap lets it go
   again). Opens Habits. */
export function HabitsWidget({ workspace, commit, today, open, room = 0 }) {
  const habits = workspace.habits || []
  return (
    <>
      <button type="button" className="widget-kicker widget-title" aria-label="Habits. Open Habits" onClick={() => open('Habits')}>Habits</button>
      {habits.length ? (
        <div className="habit-chips">
          {habits.slice(0, 8 + room * 3).map((habit) => {
            const kept = isHabitDone(habit, today)
            return (
              <button
                key={habit.id}
                type="button"
                className="habit-chip"
                aria-pressed={kept}
                onClick={() => commit((state) => ({ ...state, habits: toggleHabit(state.habits, habit.id, today) }))}
              >
                {kept && <Check weight="bold" />}{habit.name}
              </button>
            )
          })}
        </div>
      ) : <p className="widget-empty">No habits yet. Open Habits to start one.</p>}
    </>
  )
}
