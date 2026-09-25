import { Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { createHabit, isHabitDone, toggleHabit } from "../daily-practice.js";

export function HabitsView({ workspace, commit, today }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("build");
  function add(event) {
    event.preventDefault();
    const habit = createHabit(name, type);
    if (!habit) return;
    commit((state) => ({ ...state, habits: [...state.habits, habit] }));
    setName("");
  }
  return (
    <section className="practice-layout">
      <div className="content-card stack">
        <div className="section-intro">
          <div>
            <p className="eyebrow">TODAY</p>
            <h2>Explicit practice, no streak pressure.</h2>
          </div>
          <span>
            {
              workspace.habits.filter((habit) => isHabitDone(habit, today))
                .length
            }{" "}
            checked
          </span>
        </div>
        <div className="habit-groups">
          {["build", "avoid"].map((kind) => (
            <section key={kind}>
              <h3>{kind === "build" ? "Build" : "Avoid"}</h3>
              {workspace.habits.filter((habit) => habit.type === kind)
                .length ? (
                workspace.habits
                  .filter((habit) => habit.type === kind)
                  .map((habit) => (
                    <label key={habit.id} className="habit-row">
                      <input
                        type="checkbox"
                        checked={isHabitDone(habit, today)}
                        onChange={() =>
                          commit((state) => ({
                            ...state,
                            habits: toggleHabit(state.habits, habit.id, today),
                          }))
                        }
                      />
                      <span>
                        <strong>{habit.name}</strong>
                        <small>Only today changes</small>
                      </span>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Delete ${habit.name}`}
                        onClick={() =>
                          commit((state) => ({
                            ...state,
                            habits: state.habits.filter(
                              (item) => item.id !== habit.id,
                            ),
                          }))
                        }
                      >
                        <Trash />
                      </button>
                    </label>
                  ))
              ) : (
                <p className="empty-copy">None yet.</p>
              )}
            </section>
          ))}
        </div>
      </div>
      <form className="side-form" onSubmit={add}>
        <p className="eyebrow">ADD HABIT</p>
        <h2>Name the behavior.</h2>
        <label>
          Habit
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="segmented">
          <button
            type="button"
            className={type === "build" ? "active" : ""}
            onClick={() => setType("build")}
          >
            Build
          </button>
          <button
            type="button"
            className={type === "avoid" ? "active" : ""}
            onClick={() => setType("avoid")}
          >
            Avoid
          </button>
        </div>
        <p className="form-note">
          Reflection never adds or completes a habit automatically.
        </p>
        <button className="primary-button" disabled={!name.trim()}>
          <Plus /> Add habit
        </button>
      </form>
    </section>
  );
}
