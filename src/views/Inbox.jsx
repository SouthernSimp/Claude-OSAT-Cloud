import { Check, NotePencil, Trash } from "@phosphor-icons/react";
import { formatRelativeTime } from "../lib/ui.js";
import { excerpt, keepNotes, notesInList, trashNotes } from "../notes-model.js";

/* The words after the first line, when the first line is already the title. */
function bodyOf(note) {
  const [first, ...rest] = note.markdown.split("\n");
  return first.replace(/^#+\s*/, "").trim() === note.title.trim() ? rest.join("\n").trim() : note.markdown;
}

/* Thoughts that arrived without a home. Filing, pinning or keeping one takes it off this list. */
export function InboxView({ workspace, commit, navigate }) {
  const unsorted = notesInList(workspace, "unsorted")
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return (
    <section className="content-card stack">
      <div className="section-intro">
        <div>
          <p className="eyebrow">UNSORTED</p>
          <h2>{unsorted.length ? "Ready when you are." : "All sorted."}</h2>
        </div>
        <p>
          Thoughts you dropped in from anywhere land here as notes. Open one to
          file it, or keep it where it is.
        </p>
      </div>
      {!unsorted.length && <p className="quiet-empty">Nothing waiting. Press ⌥Space anywhere to drop a thought in.</p>}
      {unsorted.map((note) => (
        <article className="review-row" key={note.id}>
          <div>
            <h3>{note.title}</h3>
            {bodyOf(note) && <p>{excerpt(bodyOf(note), 140)}</p>}
            <p>{[note.source, formatRelativeTime(note.createdAt)].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="row-actions">
            <button type="button" onClick={() => navigate("Notes", { noteId: note.id })}>
              <NotePencil /> Open
            </button>
            <button type="button" onClick={() => commit((state) => keepNotes(state, [note.id]))}>
              <Check /> Keep
            </button>
            <button type="button" aria-label={`Move ${note.title} to Trash`} onClick={() => commit((state) => trashNotes(state, [note.id]))}>
              <Trash />
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
