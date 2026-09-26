import {
  ArrowSquareOut, CaretLeft, CaretRight, Eye, File, FolderOpen, FolderSimple, FolderSimplePlus, MagnifyingGlass, Sparkle, X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { cleanError } from "../assistant/useAi.js";
import { formatBytes } from "../lib/ui.js";

/* Your Mac's files: Desktop, Documents and Downloads, and folders you add. A small
   Finder: go into folders, back and forward, Quick Look with Space, open with
   Return. The desk shows the Desktop with the same pieces. */

const PLACE_NAMES = { desktop: "Desktop", documents: "Documents", downloads: "Downloads" };
// What Ask can read (see desktop/mac-files.cjs).
const READABLE = /\.(c|canvas|conf|cpp|css|csv|docx?|go|h|hpp|html?|ini|java|jsx?|json|log|md|markdown|odt|pdf|plist|py|rb|rs|rtfd?|sh|sql|toml|tsx?|tsv|txt|webarchive|xml|ya?ml|zsh)$/i;
const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export const filesBridge = () => (typeof window === "undefined" ? null : window.nateOSFiles || null);
export const canAsk = (entry) => entry?.kind === "file" && READABLE.test(entry.name);

/* Bumps when the window comes back, so folders show what changed in Finder meanwhile. */
export function useFreshness() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => { if (document.visibilityState === "visible") setTick((value) => value + 1); };
    addEventListener("focus", bump);
    document.addEventListener("visibilitychange", bump);
    return () => { removeEventListener("focus", bump); document.removeEventListener("visibilitychange", bump); };
  }, []);
  return tick;
}

/* One folder's contents: { entries: null while looking, error }. */
export function useFolder(rootId, relative = "", fresh = 0) {
  const [state, setState] = useState({ entries: null, error: "" });
  useEffect(() => {
    const api = filesBridge();
    if (!api || !rootId) return undefined;
    let live = true;
    api.list(rootId, relative).then(
      (entries) => { if (live) setState({ entries, error: "" }); },
      (reason) => { if (live) setState({ entries: [], error: cleanError(reason) }); },
    );
    return () => { live = false; };
  }, [rootId, relative, fresh]);
  return state;
}

/* What Finder would draw: a picture of the page, or the file's own icon. */
const thumbs = new Map();
export function FileThumb({ rootId, entry, size = 128, className = "" }) {
  const key = `${rootId}\u0000${entry.relative}\u0000${size}\u0000${entry.modifiedAt || ""}`;
  const [src, setSrc] = useState(() => thumbs.get(key)?.value || null);
  useEffect(() => {
    const api = filesBridge();
    if (!api?.thumb) return undefined;
    let live = true;
    if (!thumbs.has(key)) {
      if (thumbs.size > 800) thumbs.delete(thumbs.keys().next().value);
      const item = { value: null };
      item.ready = api.thumb(rootId, entry.relative, size).then((value) => { item.value = value; return value; }, () => null);
      thumbs.set(key, item);
    }
    thumbs.get(key).ready.then((value) => { if (live) setSrc(value); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (src) return <img className={`file-thumb ${className}`} src={src} alt="" draggable={false} />;
  const Glyph = entry.kind === "folder" ? FolderSimple : File;
  return <span className={`file-thumb file-glyph ${entry.kind === "folder" ? "is-folder" : ""} ${className}`} aria-hidden="true"><Glyph weight={entry.kind === "folder" ? "fill" : "regular"} /></span>;
}

/* Opens a file in its app. Apps, scripts and installers are shown in Finder instead. */
export function openEntry(rootId, entry) {
  return filesBridge()?.open(rootId, entry.relative);
}

function kindLabel(entry) {
  if (entry.kind === "folder") return "Folder";
  const ext = entry.name.includes(".") ? entry.name.split(".").pop().toUpperCase() : "";
  return ext ? `${ext} file` : "File";
}

export function FilesView({ navigate, target = null }) {
  const api = filesBridge();
  const [roots, setRoots] = useState([]);
  const [spot, setSpot] = useState({ rootId: "desktop", relative: "" });
  const [history, setHistory] = useState({ back: [], forward: [] });
  const [selected, setSelected] = useState(null);
  const [reload, setReload] = useState(0);
  const [note, setNote] = useState("");
  const grid = useRef(null);
  const focusNext = useRef(null);
  const fresh = useFreshness();
  const { entries, error } = useFolder(spot.rootId, spot.relative, fresh + reload);
  const chosen = entries?.find((entry) => entry.relative === selected) || null;
  const root = roots.find((item) => item.id === spot.rootId);
  const rootName = root?.name || PLACE_NAMES[spot.rootId] || "Folder";

  useEffect(() => {
    api?.roots().then(setRoots).catch(() => {});
  }, [api]);

  /* Asked for from elsewhere: the desk, ⌘K. */
  useEffect(() => {
    if (!target?.rootId) return;
    go({ rootId: target.rootId, relative: target.relative || "" }, target.select || null);
  }, [target?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Focus follows a pick made with the keys or from ⌘K, once that folder has loaded. */
  useEffect(() => {
    const want = focusNext.current;
    if (!want || !entries?.some((entry) => entry.relative === want)) return;
    focusNext.current = null;
    grid.current?.querySelector(`[data-relative="${CSS.escape(want)}"]`)?.focus();
  }, [entries, selected]);

  function go(next, select = null) {
    setNote("");
    setSelected(select);
    focusNext.current = select;
    if (next.rootId === spot.rootId && next.relative === spot.relative) return;
    setHistory((value) => ({ back: [...value.back, spot].slice(-50), forward: [] }));
    setSpot(next);
  }

  function step(direction) {
    const from = direction === "back" ? history.back : history.forward;
    const next = from.at(-1);
    if (!next) return;
    setHistory((value) => direction === "back"
      ? { back: value.back.slice(0, -1), forward: [...value.forward, spot] }
      : { back: [...value.back, spot], forward: value.forward.slice(0, -1) });
    setSelected(null);
    setSpot(next);
  }

  async function act(run) {
    setNote("");
    try {
      const result = await run();
      if (result === "shown") setNote("Shown in Finder. OSAT opens documents, pictures and media itself.");
    } catch (reason) {
      setNote(cleanError(reason));
    }
  }

  function open(entry) {
    if (entry.kind === "folder") go({ rootId: spot.rootId, relative: entry.relative });
    else act(() => openEntry(spot.rootId, entry));
  }

  function onKey(event) {
    if (!entries?.length) return;
    const index = entries.findIndex((entry) => entry.relative === selected);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = entries[Math.min(Math.max(index + (event.key === "ArrowRight" ? 1 : -1), 0), entries.length - 1)];
      focusNext.current = next.relative;
      setSelected(next.relative);
    } else if (event.key === "Enter" && chosen) {
      event.preventDefault();
      open(chosen);
    } else if (event.key === " " && chosen) {
      event.preventDefault();
      act(() => api.quickLook(spot.rootId, chosen.relative));
    } else if ((event.key === "Backspace" || (event.metaKey && event.key === "ArrowUp")) && spot.relative) {
      event.preventDefault();
      go({ rootId: spot.rootId, relative: spot.relative.split("/").slice(0, -1).join("/") }, spot.relative);
    }
  }

  async function addFolder() {
    try {
      const value = await api.choose("folder");
      if (!value) return;
      setRoots(await api.roots());
      const newest = value.at(-1);
      if (newest) go({ rootId: newest.id, relative: "" });
    } catch (reason) {
      setNote(cleanError(reason));
    }
  }

  async function forget(item) {
    try {
      await api.forget(item.id);
      setRoots(await api.roots());
      if (spot.rootId === item.id) go({ rootId: "desktop", relative: "" });
    } catch (reason) {
      setNote(cleanError(reason));
    }
  }

  if (!api)
    return (
      <section className="tool-unavailable">
        <FolderOpen weight="duotone" />
        <h2>Files live in the OSAT Mac app.</h2>
        <p>Open OSAT on your Mac to see your Desktop, Documents and Downloads here.</p>
      </section>
    );

  const crumbs = spot.relative ? spot.relative.split("/") : [];
  const places = roots.filter((item) => item.place);
  const folders = roots.filter((item) => !item.place && item.kind === "folder");

  return (
    <section className="finder" aria-label="Files">
      <aside className="finder-side">
        <p className="finder-kicker">On this Mac</p>
        {places.map((item) => (
          <button key={item.id} type="button" aria-current={spot.rootId === item.id ? "true" : undefined} onClick={() => go({ rootId: item.id, relative: "" })}>
            <FolderSimple weight={spot.rootId === item.id ? "fill" : "regular"} /> {item.name}
          </button>
        ))}
        <p className="finder-kicker">Your folders</p>
        {folders.map((item) => (
          <span key={item.id} className="finder-side-row">
            <button type="button" aria-current={spot.rootId === item.id ? "true" : undefined} onClick={() => go({ rootId: item.id, relative: "" })}>
              <FolderSimple weight={spot.rootId === item.id ? "fill" : "regular"} /> {item.name}
            </button>
            <button type="button" className="finder-forget" aria-label={`Take ${item.name} out of the list`} title="Take it out of the list (the folder stays)" onClick={() => forget(item)}><X /></button>
          </span>
        ))}
        <button type="button" className="finder-add" onClick={addFolder}><FolderSimplePlus /> Add a folder…</button>
      </aside>

      <div className="finder-main">
        <header className="finder-bar">
          <button type="button" aria-label="Back" disabled={!history.back.length} onClick={() => step("back")}><CaretLeft weight="bold" /></button>
          <button type="button" aria-label="Forward" disabled={!history.forward.length} onClick={() => step("forward")}><CaretRight weight="bold" /></button>
          <nav className="finder-path" aria-label="Where you are">
            <button type="button" onClick={() => go({ rootId: spot.rootId, relative: "" })}>{rootName}</button>
            {crumbs.map((crumb, index) => (
              <span key={`${crumb}-${index}`}>
                <CaretRight />
                <button type="button" onClick={() => go({ rootId: spot.rootId, relative: crumbs.slice(0, index + 1).join("/") })}>{crumb}</button>
              </span>
            ))}
          </nav>
          <span className="finder-hint"><MagnifyingGlass /> ⌘K finds any file</span>
        </header>
        <div ref={grid} className="finder-grid" role="listbox" aria-label={rootName} onKeyDown={onKey} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          {entries?.map((entry) => (
            <button
              key={entry.relative}
              type="button"
              role="option"
              aria-selected={entry.relative === selected}
              data-relative={entry.relative}
              className="finder-item"
              title={entry.name}
              onClick={() => setSelected(entry.relative)}
              onDoubleClick={() => open(entry)}
            >
              <FileThumb rootId={spot.rootId} entry={entry} />
              <span>{entry.name}</span>
            </button>
          ))}
          {entries && !entries.length && <p className="finder-empty">{error || "Nothing in this folder."}</p>}
        </div>
        {note && <p className="finder-note" role="status">{note}</p>}
      </div>

      <aside className="finder-info" aria-label="About the selected item">
        {chosen ? (
          <>
            <FileThumb rootId={spot.rootId} entry={chosen} size={512} className="is-large" />
            <h3>{chosen.name}</h3>
            <p>{kindLabel(chosen)}{chosen.size !== undefined ? ` · ${formatBytes(chosen.size)}` : ""}</p>
            {chosen.modifiedAt && <p>Changed {WHEN.format(new Date(chosen.modifiedAt))}</p>}
            <div className="finder-actions">
              <button type="button" className="primary-button" onClick={() => open(chosen)}>
                {chosen.kind === "folder" ? <FolderOpen /> : <ArrowSquareOut />} Open
              </button>
              {chosen.kind === "file" && <button type="button" onClick={() => act(() => api.quickLook(spot.rootId, chosen.relative))}><Eye /> Quick Look <kbd>space</kbd></button>}
              {canAsk(chosen) && navigate && (
                <button type="button" onClick={() => navigate("Assistant", { file: { rootId: spot.rootId, relative: chosen.relative, name: chosen.name } })}><Sparkle /> Ask about it</button>
              )}
              <button type="button" onClick={() => act(() => api.reveal(spot.rootId, chosen.relative))}><FolderOpen /> Show in Finder</button>
            </div>
          </>
        ) : (
          <p className="finder-empty">Click once to see a file here. Double-click opens it; Space shows it in Quick Look.</p>
        )}
      </aside>
    </section>
  );
}
