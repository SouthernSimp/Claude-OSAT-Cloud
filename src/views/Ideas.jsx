import { Lightbulb, NotePencil, ShareNetwork } from "@phosphor-icons/react";
import { createNote } from "../notes-model.js";
import { EmptyPanel } from "./Empty.jsx";

export function IdeasView({ workspace, commit, navigate }) {
  const ideas = workspace.records.filter(
    (record) => record.type === "capture" && record.status === "idea",
  );
  return (
    <section className="content-card stack">
      <div className="section-intro">
        <div>
          <p className="eyebrow">REVIEWED CAPTURES</p>
          <h2>Ideas you chose to keep.</h2>
        </div>
        <button
          className="outline-button"
          type="button"
          onClick={() => navigate("Mindmap")}
        >
          <ShareNetwork /> Open Mindmap
        </button>
      </div>
      {ideas.length ? (
        ideas.map((idea) => (
          <article className="review-row" key={idea.id}>
            <div>
              <span className="status-pill idea">idea</span>
              <h3>{idea.title}</h3>
              <p>{idea.summary}</p>
            </div>
            <div className="row-actions">
              <button
                type="button"
                onClick={() => {
                  let created;
                  commit((state) => {
                    const result = createNote(state, { title: idea.title.slice(0, 120), markdown: idea.summary && idea.summary !== idea.title ? `${idea.title}\n\n${idea.summary}` : idea.title });
                    created = result.note;
                    return result.state;
                  });
                  if (created) navigate("Notes", { noteId: created.id });
                }}
              >
                <NotePencil /> Grow it as a note
              </button>
            </div>
          </article>
        ))
      ) : (
        <EmptyPanel
          icon={Lightbulb}
          title="No reviewed ideas yet."
          copy="Keep a capture as an idea when it earns a place here."
          action="Review inbox"
          onClick={() => navigate("Inbox")}
        />
      )}
    </section>
  );
}
