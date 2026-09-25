import { useState } from "react";
import { NotePencil } from "@phosphor-icons/react";
import { formatRelativeTime } from "../lib/ui.js";
import { noteFromCapture } from "../notes-model.js";

export function InboxView({ workspace, commit, navigate }) {
  const [filter, setFilter] = useState("inbox");
  const captures = workspace.records
    .filter((record) => record.type === "capture" && (filter === "all" || record.status === filter))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <section className="content-card stack">
      <div className="section-intro">
        <div>
          <p className="eyebrow">RAW AND REVIEWABLE</p>
          <h2>Nothing moves without you.</h2>
        </div>
        <p>
          Keep, park, or turn a capture into an idea. The original remains
          editable.
        </p>
      </div>
      <div className="segmented">{[["inbox","To review"],["parked","Parked"],["all","All captures"]].map(([id,label])=><button key={id} className={filter===id?"active":""} onClick={()=>setFilter(id)}>{label}</button>)}</div>
      {!captures.length && <p className="quiet-empty">All clear here. Capture a thought whenever you’re ready.</p>}
      {captures.map((capture) => (
        <article className="review-row" key={capture.id}>
          <div>
            <span className={`status-pill ${capture.status}`}>
              {capture.status}
            </span>
            <h3>{capture.title}</h3>
            <p>
              {capture.source} · {formatRelativeTime(capture.createdAt)}
            </p>
          </div>
          <div className="row-actions">
            <button
              type="button"
              onClick={() =>
                commit((state) => ({
                  ...state,
                  records: state.records.map((item) =>
                    item.id === capture.id
                      ? { ...item, status: "parked" }
                      : item,
                  ),
                }))
              }
            >
              Park
            </button>
            <button
              type="button"
              onClick={() => {
                let created;
                commit((state) => {
                  const result = noteFromCapture(state, capture);
                  created = result.note;
                  return { ...result.state, records: result.state.records.map((item) => item.id === capture.id ? { ...item, status: "parked" } : item) };
                });
                if (created) navigate("Notes", { noteId: created.id });
              }}
            >
              <NotePencil /> {workspace.notes.some((note) => note.originCaptureId === capture.id) ? 'Open note' : 'Make a note'}
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
