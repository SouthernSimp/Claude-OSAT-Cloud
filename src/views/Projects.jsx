import { Folder } from "@phosphor-icons/react";
import { ArrowSquareOut, FolderOpen, Plus, ShareNetwork } from "@phosphor-icons/react";
import { useState } from "react";
import { makeId } from "../lib/ui.js";
import { safeHttpUrl } from "../osat-data.js";

export function ProjectsView({ workspace, commit, navigate }) {
  const [form, setForm] = useState({
    title: "",
    summary: "",
    url: "",
    folder: "",
    folderGrantId: "",
  });
  const [error, setError] = useState("");
  const fileApi = window.nateOSFiles;
  async function chooseFolder() {
    if (!fileApi) return;
    setError("");
    try {
      const roots = await fileApi.choose("folder");
      if (!roots) return;
      const folder = roots.at(-1);
      if (folder)
        setForm((current) => ({
          ...current,
          folder: folder.name,
          folderGrantId: folder.id,
        }));
    } catch (reason) {
      setError(reason.message || String(reason));
    }
  }
  function save(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
    const url = form.url.trim() ? safeHttpUrl(form.url) : "";
    if (form.url.trim() && !url) {
      setError("Use a complete http or https URL. Other schemes stay blocked.");
      return;
    }
    const project = {
      id: makeId("project"),
      title: form.title.trim(),
      summary: form.summary.trim(),
      status: "active",
      url: url || "",
      folder: form.folder,
      folderGrantId: form.folderGrantId,
      createdAt: new Date().toISOString(),
    };
    commit((state) => ({ ...state, projects: [...state.projects, project] }));
    setForm({
      title: "",
      summary: "",
      url: "",
      folder: "",
      folderGrantId: "",
    });
    setError("");
  }
  return (
    <section className="split-layout">
      <div className="content-card stack">
        <div className="section-intro">
          <div>
            <p className="eyebrow">ACTIVE WORK</p>
            <h2>Make room for what’s next.</h2>
          </div>
          <button
            className="outline-button"
            type="button"
            onClick={() => navigate("Mindmap")}
          >
            <ShareNetwork /> Mindmap
          </button>
        </div>
        {workspace.projects.map((project) => (
          <article className="project-row" key={project.id}>
            <div>
              <span className={`status-pill ${project.status}`}>
                {project.status}
              </span>
              <h3>{project.title}</h3>
              <p>{project.summary || "No summary yet."}</p>
              {project.folder && (
                <code>
                  {project.folderGrantId ? "Approved folder: " : "Folder label: "}
                  {project.folder}
                </code>
              )}
            </div>
            <div className="row-actions">
              {project.url && (
                <a href={project.url} target="_blank" rel="noreferrer">
                  Open site <ArrowSquareOut />
                </a>
              )}
              <select
                aria-label={`Status for ${project.title}`}
                value={project.status}
                onChange={(event) =>
                  commit((state) => ({
                    ...state,
                    projects: state.projects.map((item) =>
                      item.id === project.id
                        ? { ...item, status: event.target.value }
                        : item,
                    ),
                  }))
                }
              >
                <option>active</option>
                <option>paused</option>
                <option>done</option>
              </select>
            </div>
          </article>
        ))}
      </div>
      <form className="side-form" onSubmit={save}>
        <p className="eyebrow">NEW PROJECT</p>
        <h2>Start something meaningful.</h2>
        <label>
          Name
          <input
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
          />
        </label>
        <label>
          Summary
          <textarea
            rows="4"
            value={form.summary}
            onChange={(event) =>
              setForm({ ...form, summary: event.target.value })
            }
          />
        </label>
        <label>
          Website URL
          <input
            type="url"
            placeholder="https://"
            value={form.url}
            onChange={(event) => setForm({ ...form, url: event.target.value })}
          />
        </label>
        <label>
          Approved local folder
          <input
            readOnly
            placeholder="No folder selected"
            value={form.folder}
          />
        </label>
        <button
          className="outline-button"
          type="button"
          disabled={!fileApi}
          onClick={chooseFolder}
        >
          <FolderOpen /> {form.folder ? "Choose another folder" : "Choose folder"}
        </button>
        <p className="form-note">
          {fileApi
            ? "OSAT stores the approved grant, not a script command."
            : "Folder approval is available in the OSAT Mac app."}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={!form.title.trim()}>
          <Plus /> Add project
        </button>
      </form>
    </section>
  );
}
