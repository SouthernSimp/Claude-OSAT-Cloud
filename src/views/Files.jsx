import { ArrowSquareOut, CaretRight, File, FileText, FolderOpen, House, Monitor, Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { formatBytes } from "../lib/ui.js";
import { EmptyInline } from "./Empty.jsx";
import { FileShelf } from "./FileShelf.jsx";

export function FilesView() {
  const api = window.nateOSFiles;
  const [roots, setRoots] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [relative, setRelative] = useState("");
  const [entries, setEntries] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = roots.find((root) => root.id === activeId) || null;

  useEffect(() => {
    if (api)
      api
        .roots()
        .then((value) =>
          setRoots(Array.isArray(value) ? value : value.roots || []),
        )
        .catch((reason) => setError(reason.message || String(reason)));
  }, [api]);
  async function choose(kind) {
    setBusy(true);
    setError("");
    try {
      const value = await api.choose(kind);
      if (!value) return;
      const next = Array.isArray(value) ? value : value.roots || [];
      setRoots(next);
      const newest = next.at(-1);
      if (newest) await selectRoot(newest);
    } catch (reason) {
      setError(reason.message || String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function selectRoot(root) {
    setActiveId(root.id);
    setRelative("");
    setPreview(null);
    setEntries([]);
    setError("");
    if (root.kind === "file") {
      await selectFile(root, {
        name: root.name,
        relative: "",
        kind: "file",
        size: root.size || 0,
      });
      return;
    }
    try {
      const value = await api.list(root.id, "");
      setEntries(Array.isArray(value) ? value : value.entries || []);
    } catch (reason) {
      setError(reason.message || String(reason));
    }
  }
  async function browse(next) {
    if (!active) return;
    setBusy(true);
    setPreview(null);
    setError("");
    try {
      const value = await api.list(active.id, next);
      setRelative(next);
      setEntries(Array.isArray(value) ? value : value.entries || []);
    } catch (reason) {
      setError(reason.message || String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function selectFile(root, entry) {
    setBusy(true);
    setError("");
    try {
      const value = await api.readText(root.id, entry.relative);
      setPreview({
        entry: { ...entry, size: value.size ?? entry.size },
        content: typeof value === "string" ? value : value.content,
        readable: true,
      });
    } catch (reason) {
      setPreview({
        entry,
        content: reason.message || String(reason),
        readable: false,
      });
    } finally {
      setBusy(false);
    }
  }
  async function forget(root) {
    try {
      const value = await api.forget(root.id),
        next = Array.isArray(value) ? value : value.roots || [];
      setRoots(next);
      if (activeId === root.id) {
        setActiveId(null);
        setEntries([]);
        setPreview(null);
      }
    } catch (reason) {
      setError(reason.message || String(reason));
    }
  }
  const crumbs = relative.split("/").filter(Boolean);
  if (!api)
    return <FileShelf />;
  return (
    <section className="files-layout">
      <div className="files-top">
        <div>
          <p className="eyebrow">USER APPROVED ACCESS ONLY</p>
          <h2>Browse locations you choose.</h2>
        </div>
        <div className="row-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => choose("folder")}
          >
            <FolderOpen /> Add folder
          </button>
          <button type="button" disabled={busy} onClick={() => choose("files")}>
            <File /> Add files
          </button>
        </div>
      </div>
      <div className="file-browser-grid">
        <aside className="file-roots">
          <h3>Approved locations</h3>
          {roots.map((root) => (
            <div key={root.id} className={activeId === root.id ? "active" : ""}>
              <button type="button" onClick={() => selectRoot(root)}>
                {root.kind === "folder" ? <FolderOpen /> : <FileText />}
                <span>{root.name}</span>
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={`Forget ${root.name}`}
                onClick={() => forget(root)}
              >
                <Trash />
              </button>
            </div>
          ))}
          {!roots.length && <p>No locations approved.</p>}
        </aside>
        <section className="file-list">
          <div className="breadcrumbs">
            <button type="button" onClick={() => browse("")}>
              <House />
            </button>
            {crumbs.map((crumb, index) => (
              <span key={`${crumb}-${index}`}>
                <CaretRight />
                <button
                  type="button"
                  onClick={() => browse(crumbs.slice(0, index + 1).join("/"))}
                >
                  {crumb}
                </button>
              </span>
            ))}
          </div>
          {active ? (
            entries.map((entry) => (
              <button
                key={entry.relative}
                type="button"
                onClick={() =>
                  entry.kind === "folder"
                    ? browse(entry.relative)
                    : selectFile(active, entry)
                }
              >
                {entry.kind === "folder" ? (
                  <FolderOpen weight="fill" />
                ) : (
                  <FileText />
                )}
                <span>
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.kind === "folder"
                      ? "Folder"
                      : formatBytes(entry.size)}
                  </small>
                </span>
                <CaretRight />
              </button>
            ))
          ) : (
            <EmptyInline copy="Select an approved location." />
          )}
        </section>
        <aside className="file-preview">
          {preview ? (
            <>
              <div>
                <FileText />
                <span>
                  <strong>{preview.entry.name}</strong>
                  <small>{formatBytes(preview.entry.size)}</small>
                </span>
              </div>
              <pre className={preview.readable ? "" : "preview-message"}>
                {preview.content}
              </pre>
              <button
                type="button"
                onClick={() => api.open(active.id, preview.entry.relative)}
              >
                Open in default app <ArrowSquareOut />
              </button>
            </>
          ) : (
            <EmptyInline copy="Select a text file to preview it." />
          )}
        </aside>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
