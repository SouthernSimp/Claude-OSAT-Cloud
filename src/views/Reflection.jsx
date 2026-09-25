import { Check } from "@phosphor-icons/react";
import { useState } from "react";
import { upsertReflection } from "../daily-practice.js";

export const REFLECTION_PROMPTS = [
  ["win", "What moved forward?"],
  ["hard", "What felt difficult?"],
  ["tomorrow", "What is the next honest step?"],
];

export function ReflectionView({ workspace, commit, today }) {
  const existing = workspace.reflections.find((reflection) => reflection.date === today);
  const [answers, setAnswers] = useState(existing?.answers || { win: "", hard: "", tomorrow: "" });
  const [showPrior, setShowPrior] = useState(false);
  const prior = workspace.reflections
    .filter((reflection) => reflection.date !== today)
    .sort((a, b) => b.date.localeCompare(a.date));

  function save(event) {
    event.preventDefault();
    commit((state) => ({
      ...state,
      reflections: upsertReflection(state.reflections, today, answers),
    }));
  }

  const pretty = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${today}T12:00:00`));

  return (
    <section className="journal-page">
      <header className="journal-hero">
        <p>{pretty}</p>
        <h1>Evening notes</h1>
        <p className="journal-lede">Three quiet questions. Write only what feels true.</p>
        {existing ? <span className="journal-saved">Saved for today</span> : null}
      </header>

      <form className="journal-form" onSubmit={save}>
        {REFLECTION_PROMPTS.map(([key, prompt]) => (
          <label className="journal-prompt" key={key}>
            <span className="journal-q">{prompt}</span>
            <textarea
              rows="4"
              value={answers[key]}
              placeholder="…"
              onChange={(event) => setAnswers({ ...answers, [key]: event.target.value })}
            />
          </label>
        ))}
        <div className="journal-actions">
          <button
            className="primary-button"
            disabled={!Object.values(answers).some((answer) => answer.trim())}
          >
            <Check /> Save
          </button>
          {prior.length > 0 ? (
            <button type="button" className="text-button" onClick={() => setShowPrior((v) => !v)}>
              {showPrior ? "Hide earlier days" : `Earlier days (${prior.length})`}
            </button>
          ) : null}
        </div>
      </form>

      {showPrior ? (
        <div className="journal-prior">
          {prior.map((reflection) => (
            <article key={reflection.date}>
              <h2>{reflection.date}</h2>
              {REFLECTION_PROMPTS.map(([key, prompt]) => (
                <div key={key}>
                  <strong>{prompt}</strong>
                  <p>{reflection.answers[key] || "—"}</p>
                </div>
              ))}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
