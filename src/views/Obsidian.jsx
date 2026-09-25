import { Check, DownloadSimple, Eye, FolderOpen, UploadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { downloadFile } from "../lib/ui.js";
import { localDateKey } from "../daily-practice.js";
import { createNote, isVisibleNote } from "../notes-model.js";

export function ObsidianView({ workspace, commit }) {
  const api = window.nateOSFiles;
  const sources = [
    ...workspace.notes.filter(isVisibleNote).map((note) => ({
      id: `note:${note.id}`,
      title: note.title,
      markdown: `# ${note.title}\n\n${note.markdown}`,
    })),
  ];
  const [chosen, setChosen] = useState([]);
  const [reviewed, setReviewed] = useState(false);
  const [folder, setFolder] = useState(null);
  const [target, setTarget] = useState("OSAT Export.md");
  const [targetReview, setTargetReview] = useState(null);
  const [writeApproved, setWriteApproved] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [importApproved, setImportApproved] = useState(false);
  const [status, setStatus] = useState("");
  const preview = sources
    .filter((source) => chosen.includes(source.id))
    .map((source) => source.markdown)
    .join("\n\n---\n\n");

  async function chooseVaultFolder() {
    setStatus("");
    try {
      const roots = await api.choose("folder");
      if (!roots) return;
      const next = roots.at(-1);
      if (next) setFolder(next);
      setTargetReview(null);
      setWriteApproved(false);
    } catch (reason) {
      setStatus(reason.message || String(reason));
    }
  }

  async function reviewWrite() {
    const filename = target.trim();
    if (!folder || !preview || !/^[^/\\]+\.(md|markdown)$/i.test(filename)) {
      setStatus("Choose a folder, select content, and use a Markdown filename.");
      return;
    }
    setStatus("");
    try {
      const entries = await api.list(folder.id, "");
      const existing = entries.find(
        (entry) => entry.kind === "file" && entry.name === filename,
      );
      const current = existing
        ? await api.readText(folder.id, existing.relative)
        : { content: "", hash: null };
      setTargetReview({
        filename,
        before: current.content,
        after: preview,
        hash: current.hash,
      });
      setWriteApproved(false);
    } catch (reason) {
      setStatus(reason.message || String(reason));
    }
  }

  async function writeReviewed() {
    if (!targetReview || !writeApproved) return;
    setStatus("");
    try {
      const result = await api.writeText(
        folder.id,
        targetReview.filename,
        targetReview.after,
        targetReview.hash,
      );
      setTargetReview((current) => ({
        ...current,
        before: current.after,
        hash: result.hash,
      }));
      setWriteApproved(false);
      setStatus(`Saved ${targetReview.filename} after your review.`);
    } catch (reason) {
      setWriteApproved(false);
      setStatus(reason.message || String(reason));
    }
  }

  async function chooseImport() {
    setStatus("");
    try {
      const roots = await api.choose("files");
      if (!roots) return;
      const file = [...roots].reverse().find((root) => root.kind === "file");
      if (!file) return;
      const result = await api.readText(file.id, "");
      setIncoming({ name: file.name, content: result.content });
      setImportApproved(false);
    } catch (reason) {
      setStatus(reason.message || String(reason));
    }
  }

  function importReviewed() {
    if (!incoming || !importApproved) return;
    const title =
      incoming.content
        .split("\n")
        .find((line) => line.trim())
        ?.replace(/^#+\s*/, "") || incoming.name.replace(/\.(md|markdown)$/i, "");
    commit((state) => createNote(state, { title, markdown: incoming.content, unsorted: true, source: "Obsidian" }).state);
    setIncoming(null);
    setImportApproved(false);
    setStatus(`Imported ${incoming.name} as an editable note.`);
  }

  return (
    <section className="obsidian-layout">
      <div className="content-card stack">
        <div className="section-intro">
          <div>
            <p className="eyebrow">MANUAL BRIDGE</p>
            <h2>Move Markdown only after review.</h2>
          </div>
          <span className={`status-pill ${api ? "active" : "parked"}`}>
            {api ? "Mac bridge" : "export only"}
          </span>
        </div>
        <div className="bridge-steps">
          <span>
            <b>1</b> Choose local items
          </span>
          <span>
            <b>2</b> Read the exact Markdown
          </span>
          <span>
            <b>3</b> Review the current file
          </span>
          <span>
            <b>4</b> Approve one write
          </span>
        </div>
        <div className="bridge-source-list">
          {sources.map((source) => (
            <label key={source.id}>
              <input
                type="checkbox"
                checked={chosen.includes(source.id)}
                onChange={() => {
                  setChosen((current) =>
                    current.includes(source.id)
                      ? current.filter((id) => id !== source.id)
                      : [...current, source.id],
                  );
                  setReviewed(false);
                  setTargetReview(null);
                  setWriteApproved(false);
                }}
              />
              <span>{source.title}</span>
            </label>
          ))}
        </div>
      </div>
      <aside className="bridge-preview">
        <p className="eyebrow">EXACT MARKDOWN</p>
        <textarea
          readOnly
          rows="20"
          value={preview}
          placeholder="Choose notes or captures to preview them."
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={!preview}
            onChange={(event) => setReviewed(event.target.checked)}
          />{" "}
          I reviewed this copy.
        </label>
        {api ? (
          <>
            <div className="row-actions">
              <button type="button" onClick={chooseVaultFolder}>
                <FolderOpen /> {folder ? folder.name : "Choose vault folder"}
              </button>
              <button type="button" onClick={chooseImport}>
                <UploadSimple /> Choose Markdown to import
              </button>
            </div>
            <label>
              Target filename
              <input
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setTargetReview(null);
                  setWriteApproved(false);
                }}
              />
            </label>
            <button
              className="outline-button"
              type="button"
              disabled={!folder || !preview || !reviewed}
              onClick={reviewWrite}
            >
              <Eye /> Review target difference
            </button>
            {targetReview && (
              <div className="bridge-diff">
                <label>
                  Current file
                  <textarea readOnly value={targetReview.before} />
                </label>
                <label>
                  Proposed file
                  <textarea readOnly value={targetReview.after} />
                </label>
              </div>
            )}
            {targetReview && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={writeApproved}
                  onChange={(event) => setWriteApproved(event.target.checked)}
                />{" "}
                I approve this exact write.
              </label>
            )}
            <button
              className="primary-button"
              type="button"
              disabled={!targetReview || !writeApproved}
              onClick={writeReviewed}
            >
              <Check /> Write reviewed Markdown
            </button>
            {incoming && (
              <div className="bridge-import-review">
                <strong>Import preview: {incoming.name}</strong>
                <textarea readOnly value={incoming.content} />
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={importApproved}
                    onChange={(event) =>
                      setImportApproved(event.target.checked)
                    }
                  />{" "}
                  Import this exact file as a new note.
                </label>
                <button
                  className="primary-button"
                  type="button"
                  disabled={!importApproved}
                  onClick={importReviewed}
                >
                  Import reviewed note
                </button>
              </div>
            )}
          </>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={!preview || !reviewed}
            onClick={() =>
              downloadFile(
                `osat-obsidian-review-${localDateKey()}.md`,
                preview,
                "text/markdown;charset=utf-8",
              )
            }
          >
            <DownloadSimple /> Export reviewed Markdown
          </button>
        )}
        {status && <p role="status">{status}</p>}
        <p>No vault scan or silent synchronization occurs.</p>
      </aside>
    </section>
  );
}
