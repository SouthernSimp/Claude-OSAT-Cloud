/* What Ask did while it acted (Phase 48): a short list of steps above the answer, and, before another
   app changes anything, a question in plain words: Allow, or Not now (Esc). */
import { Check, CircleNotch, MinusCircle, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import "../styles/ask-agent.css";

const ICONS = { running: CircleNotch, done: Check, failed: WarningCircle, skipped: MinusCircle };
const SAID = { running: "Working on it", done: "Done", failed: "Didn’t work", skipped: "Not done" };

export function AgentSteps({ steps }) {
  if (!steps?.length) return null;
  return (
    <ol className="agent-steps" aria-label="What Ask did">
      {steps.map((step, index) => {
        const Icon = ICONS[step.state] || Check;
        return (
          <li className={`agent-step is-${step.state || "done"}`} key={step.id || index}>
            <Icon className={step.state === "running" ? "spin" : undefined} aria-label={SAID[step.state] || "Done"} />
            <span className="agent-step-words">
              <span>{step.why}{step.app ? <em> · {step.app}</em> : null}</span>
              {step.summary && step.summary !== step.why && <small>{step.summary}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function AgentConfirm({ asking, onAnswer }) {
  const allow = useRef(null);
  const answer = useRef(onAnswer);
  answer.current = onAnswer;
  useEffect(() => {
    if (!asking) return undefined;
    allow.current?.focus();
    // Esc is Not now, before the desk or the quick bar can take it.
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      answer.current(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [asking]);
  if (!asking) return null;
  return (
    <div className="agent-confirm" role="alertdialog" aria-label="Ask wants to change something in another app">
      <p>{asking.text}</p>
      <span className="agent-confirm-buttons">
        <button ref={allow} className="primary-button" type="button" onClick={() => onAnswer(true)}>Allow</button>
        <button className="ghost-button" type="button" onClick={() => onAnswer(false)}>Not now</button>
      </span>
    </div>
  );
}
