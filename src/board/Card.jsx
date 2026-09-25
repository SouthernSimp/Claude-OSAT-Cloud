import { memo, useEffect, useRef, useState } from "react";
import { cardBody, tagRuns } from "./board-text.js";

function Runs({ text }) {
  return tagRuns(text).map((run, index) => run.tag ? <span key={index} className="hash">{run.text}</span> : run.text);
}

/* One sheet of paper. Memoized: during a drag only the moving cards re-render. */
export const Card = memo(function Card({ card, note, paper, ruled, selected, editing, dim, match, dragging, hit, flying, linkCount, onCommitText, onStopEdit }) {
  const body = cardBody(note);
  const fontSize = body.length > 420 ? 12 : body.length > 220 ? 13 : body.length > 90 ? 14 : 16;
  return (
    <div
      className={`card ${selected ? "is-sel" : ""} ${editing ? "is-edit" : ""} ${dim ? "is-dim" : ""} ${match ? "is-match" : ""} ${dragging ? "is-drag" : ""} ${hit ? "is-hit" : ""} ${flying ? "is-flying" : ""}`}
      data-id={card.id}
      data-paper={paper}
      data-stock={ruled ? "ruled" : "plain"}
      style={{ translate: `${card.x}px ${card.y}px`, width: card.w, height: card.h, rotate: `${editing || dragging ? 0 : card.rot}deg`, "--fs": `${fontSize}px` }}
    >
      <div className="card-margin" />
      <div className="card-title" title={note?.title}>{note?.title || "Untitled note"}</div>
      {editing ? (
        <CardEditor id={card.id} value={note?.markdown || ""} onCommit={onCommitText} onStop={onStopEdit} />
      ) : (
        <div className="card-body">{body ? <Runs text={body} /> : (!note?.title || note.title === "Untitled note") ? <span className="card-empty">Empty note</span> : null}</div>
      )}
      <div className="card-meta">
        <span className="card-tags">{(note?.tags || []).slice(0, 4).map((tag) => `#${tag}`).join(" ")}</span>
        {note?.pinned && <span title="Pinned">📌</span>}
        {linkCount > 0 && <span className="card-links" title={`${linkCount} connection${linkCount === 1 ? "" : "s"}`}>⟟ {linkCount}</span>}
      </div>
      <div className="card-curl" />
      {["t", "r", "b", "l"].map((side) => <div key={side} className="port" data-side={side} data-card={card.id} />)}
      <div className="grip" data-card={card.id} />
    </div>
  );
});

function CardEditor({ id, value, onCommit, onStop }) {
  const [text, setText] = useState(value);
  const ref = useRef(null);
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => {
    const element = ref.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
    return () => { if (latest.current !== value) onCommit(id, latest.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      ref={ref}
      className="card-editor"
      aria-label="Edit note text"
      value={text}
      spellCheck="true"
      onChange={(event) => setText(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key === "Enter")) { event.preventDefault(); onStop(); }
      }}
      onBlur={onStop}
    />
  );
}
