import {
  ArrowBendUpRight, ArrowSquareOut, CaretLeft, CaretRight, Eye, File, FolderOpen, FolderPlus, FolderSimple, FolderSimplePlus, MagnifyingGlass, PencilSimple, Sparkle, Trash, X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { describeFileQuery, parseFileQuery } from "../../shared/file-query.mjs";
import { cleanError } from "../assistant/useAi.js";
import { carryable, useDrop } from "../lib/carry.js";
import { useContextMenu } from "../lib/ContextMenu.jsx";
import { useUndoToast } from "../lib/UndoToast.jsx";
import { formatBytes } from "../lib/ui.js";

/* Your Mac's files: Desktop, Documents and Downloads, and folders you add. A small
   Finder: go into folders, back and forward, Quick Look with Space, open with
   Return, and Find: plain words ("pdf taxes last week") look in names and inside files,
   and each result says where it lives. Tidying: New folder, Rename, Move to, and Move to
   Bin, all with Undo; ⌘-click or ⇧-click picks several; drag them onto a folder (hold ⌥ to
   copy). The desk shows the Desktop with the same pieces. */

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

const keyOf = (entry) => `${entry.rootId}\u0000${entry.relative}`;

/* "Documents › Taxes": where a found file lives. */
function whereOf(entry, roots) {
  const root = roots.find((item) => item.id === entry.rootId)?.name || PLACE_NAMES[entry.rootId] || "Your folder";
  return [root, ...entry.relative.split("/").slice(0, -1)].join(" › ");
}

/* Find as you type: { results: null until the first answer, looking }. */
function useFind(text, tick = 0) {
  const [state, setState] = useState({ results: null, looking: false });
  useEffect(() => {
    const api = filesBridge();
    const words = text.trim();
    if (!api?.search || words.length < 2) { setState({ results: null, looking: false }); return undefined; }
    let live = true;
    setState((value) => ({ ...value, looking: true }));
    const timer = setTimeout(() => api.search(words).then(
      (items) => { if (live) setState({ results: Array.isArray(items) ? items : [], looking: false }); },
      () => { if (live) setState({ results: [], looking: false }); },
    ), 200);
    return () => { live = false; clearTimeout(timer); };
  }, [text, tick]);
  return state;
}

/* A button that takes files dropped on it (the sidebar, the path bar). */
function DropButton({ id, onDrop, children, ...props }) {
  const drop = useDrop(id, { accepts: ["file"], onDrop });
  return <button type="button" {...props} {...drop}>{children}</button>;
}

/* The name field that replaces a name in place: Return or a click away keeps it, Esc leaves it. */
function RenameField({ entry, onDone }) {
  const input = useRef(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current.focus();
    const dot = entry.kind === "file" ? entry.name.lastIndexOf(".") : -1;
    input.current.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (value) => { if (!finished.current) { finished.current = true; onDone(value); } };
  return (
    <input
      ref={input}
      className="finder-rename"
      defaultValue={entry.name}
      aria-label={`Name for ${entry.name}`}
      spellCheck={false}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); finish(event.currentTarget.value); }
        else if (event.key === "Escape") { event.preventDefault(); finish(null); }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}

/* One file or folder in the grid. It can be picked up (with whatever else is picked), and a
   folder takes what is set down on it (and opens if you hold it there). */
function FinderItem({ entry, selected, finding, where, items, renaming, onClick, onOpen, onMenu, onMove, onRenamed }) {
  const key = keyOf(entry);
  const drop = useDrop(`file:${key}`, {
    accepts: (carried) => carried.kind === "file" && !carried.data.items.some((item) => keyOf(item) === key),
    disabled: entry.kind !== "folder" || finding,
    onDrop: ({ data, alt }) => onMove(data.items, entry.rootId, entry.relative, alt),
    spring: () => onOpen(entry),
  });
  const lift = carryable({ kind: "file", id: key, data: { items } }, { disabled: renaming });
  const Tag = renaming ? "div" : "button";
  return (
    <Tag
      {...(renaming ? {} : { type: "button" })}
      role="option"
      aria-selected={selected}
      data-key={key}
      className="finder-item"
      title={finding ? `${entry.name} — ${where}` : entry.name}
      onClick={(event) => onClick(event, entry)}
      onDoubleClick={() => onOpen(entry)}
      onContextMenu={(event) => onMenu(event, entry)}
      {...drop}
      {...lift}
    >
      <FileThumb rootId={entry.rootId} entry={entry} />
      {renaming ? <RenameField entry={entry} onDone={(value) => onRenamed(entry, value)} /> : <span>{entry.name}</span>}
      {finding && <small className="finder-where">{where}</small>}
    </Tag>
  );
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
  // What is picked, in the order it was picked; the last is the one the info pane shows.
  const [picked, setPicked] = useState([]);
  const selected = picked.at(-1) ?? null;
  const setSelected = (key) => setPicked(key ? [key] : []);
  const [renaming, setRenaming] = useState(null);
  const [menu, openMenu] = useContextMenu();
  const [toast, showUndo] = useUndoToast();
  const anchor = useRef(null);
  const [reload, setReload] = useState(0);
  const [note, setNote] = useState("");
  const [find, setFind] = useState("");
  const grid = useRef(null);
  const findBox = useRef(null);
  const focusNext = useRef(null);
  const fresh = useFreshness();
  const { entries: here, error } = useFolder(spot.rootId, spot.relative, fresh + reload);
  const finding = find.trim().length >= 2;
  const { results, looking } = useFind(finding ? find : "", reload);
  const understood = useMemo(() => (finding ? describeFileQuery(parseFileQuery(find)) : ""), [find, finding]);
  const entries = finding ? results : here?.map((entry) => ({ ...entry, rootId: spot.rootId })) ?? null;
  const chosen = entries?.find((entry) => keyOf(entry) === selected) || null;
  const picks = (entries ? picked.map((key) => entries.find((entry) => keyOf(entry) === key)) : []).filter(Boolean);
  const hereDrop = useDrop("files:here", { accepts: ["file"], disabled: finding, onDrop: ({ data, alt }) => moveTo(data.items, spot.rootId, spot.relative, alt) });
  const root = roots.find((item) => item.id === spot.rootId);
  const rootName = root?.name || PLACE_NAMES[spot.rootId] || "Folder";

  useEffect(() => {
    api?.roots().then(setRoots).catch(() => {});
  }, [api]);

  const lookedAgain = () => setReload((value) => value + 1);

  /* Asked for from elsewhere: the desk, ⌘K. */
  useEffect(() => {
    if (!target?.rootId) return;
    setFind("");
    go({ rootId: target.rootId, relative: target.relative || "" }, target.select || null);
  }, [target?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Focus follows a pick made with the keys or from ⌘K, once that folder has loaded. */
  useEffect(() => {
    const want = focusNext.current;
    if (!want || !entries?.some((entry) => keyOf(entry) === want)) return;
    focusNext.current = null;
    grid.current?.querySelector(`[data-key="${CSS.escape(want)}"]`)?.focus();
  }, [entries, selected]);

  function go(next, select = null) {
    const key = select ? keyOf({ rootId: next.rootId, relative: select }) : null;
    setNote("");
    setSelected(key);
    focusNext.current = key;
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
    if (entry.kind === "folder") { setFind(""); go({ rootId: entry.rootId, relative: entry.relative }); }
    else act(() => openEntry(entry.rootId, entry));
  }

  /* A found file, shown where it lives. */
  function showHere(entry) {
    setFind("");
    go({ rootId: entry.rootId, relative: entry.relative.split("/").slice(0, -1).join("/") }, entry.relative);
  }

  function pick(entry) {
    focusNext.current = keyOf(entry);
    setSelected(keyOf(entry));
  }

  /* In the find box: ↓ or Return goes to the first result; Esc empties the box first. */
  function onFindKey(event) {
    if ((event.key === "ArrowDown" || event.key === "Enter") && entries?.length) {
      event.preventDefault();
      pick(entries[0]);
      grid.current?.querySelector(`[data-key="${CSS.escape(keyOf(entries[0]))}"]`)?.focus();
    } else if (event.key === "Escape" && find) {
      event.preventDefault();
      setFind("");
    }
  }

  function onKey(event) {
    if (!entries?.length) return;
    const index = entries.findIndex((entry) => keyOf(entry) === selected);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft" || (finding && (event.key === "ArrowDown" || event.key === "ArrowUp") && !event.metaKey)) {
      event.preventDefault();
      if (finding && event.key === "ArrowUp" && index <= 0) { findBox.current?.focus(); return; }
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      pick(entries[Math.min(Math.max(index + (forward ? 1 : -1), 0), entries.length - 1)]);
    } else if (event.key === "Enter" && chosen) {
      event.preventDefault();
      open(chosen);
    } else if (event.key === " " && chosen) {
      event.preventDefault();
      act(() => api.quickLook(chosen.rootId, chosen.relative));
    } else if (event.key === "Escape" && finding) {
      event.preventDefault();
      setFind("");
      findBox.current?.focus();
    } else if (event.metaKey && (event.key === "Backspace" || event.key === "Delete") && picks.length) {
      event.preventDefault();
      toBin(picks);
    } else if (!finding && (event.key === "Backspace" || (event.metaKey && event.key === "ArrowUp")) && spot.relative) {
      event.preventDefault();
      go({ rootId: spot.rootId, relative: spot.relative.split("/").slice(0, -1).join("/") }, spot.relative);
    }
  }

  /* Tidying. Each change says so in a toast with Undo (calm rule 2), or says calmly why not. */
  const nameOf = (rootId, relative) => (relative ? relative.split("/").at(-1) : roots.find((item) => item.id === rootId)?.name || PLACE_NAMES[rootId] || "Folder");
  const label = (items) => (items.length === 1 ? `“${items[0].name}”` : `${items.length} items`);
  const refs = (items) => items.map(({ rootId, relative }) => ({ rootId, relative }));

  async function undoWith(token) {
    try {
      const result = await api.undo(token);
      if (result?.failed) setNote(result.failed);
    } catch (reason) {
      setNote(cleanError(reason));
    }
    lookedAgain();
  }

  async function moveTo(items, rootId, relative, copy = false) {
    setNote("");
    try {
      const result = await api.move(refs(items), rootId, relative, copy);
      lookedAgain();
      if (result.failed) setNote(result.failed);
      if (!result.moved.length) return;
      if (!copy) setPicked([]);
      showUndo(`${copy ? "Copied" : "Moved"} ${label(items.slice(0, result.moved.length))} to ${nameOf(rootId, relative)}`, () => undoWith(result.undo));
    } catch (reason) {
      setNote(cleanError(reason));
    }
  }

  async function toBin(items) {
    if (!items.length) return;
    setNote("");
    try {
      const result = await api.trash(refs(items));
      lookedAgain();
      if (result.failed) setNote(result.failed);
      if (!result.count) return;
      setPicked([]);
      showUndo(`Moved ${label(items.slice(0, result.count))} to the Bin`, () => undoWith(result.undo));
    } catch (reason) {
      setNote(cleanError(reason));
    }
  }

  async function newFolder() {
    setNote("");
    try {
      const made = await api.newFolder(spot.rootId, spot.relative);
      lookedAgain();
      const key = keyOf({ rootId: spot.rootId, relative: made.relative });
      setSelected(key);
      setRenaming(key);
    } catch (reason) {
      setNote(cleanError(reason));
    }
  }

  async function renamed(entry, value) {
    setRenaming(null);
    const name = value?.trim();
    if (!name || name === entry.name) return;
    try {
      const result = await api.rename(entry.rootId, entry.relative, name);
      lookedAgain();
      setSelected(keyOf({ rootId: entry.rootId, relative: result.relative }));
      if (result.undo) showUndo(`Renamed to “${result.name}”`, () => undoWith(result.undo));
    } catch (reason) {
      setNote(cleanError(reason));
    }
  }

  /* Where "Move to" can send these: up a level, the folders here, then every place. */
  function destinations(items) {
    const skip = new Set(items.map(keyOf));
    const list = [];
    if (!finding && spot.relative) {
      const parent = spot.relative.split("/").slice(0, -1).join("/");
      list.push({ label: "Up one folder", icon: ArrowBendUpRight, hint: nameOf(spot.rootId, parent), onSelect: () => moveTo(items, spot.rootId, parent) });
    }
    if (!finding) {
      for (const folder of (here || []).filter((item) => item.kind === "folder" && !skip.has(keyOf({ rootId: spot.rootId, relative: item.relative }))).slice(0, 12)) {
        list.push({ label: folder.name, icon: FolderSimple, onSelect: () => moveTo(items, spot.rootId, folder.relative) });
      }
    }
    if (list.length) list.push({ divider: true });
    for (const item of roots.filter((entry) => entry.kind === "folder")) list.push({ label: item.name, icon: FolderSimple, onSelect: () => moveTo(items, item.id, "") });
    return list;
  }

  function click(event, entry) {
    const key = keyOf(entry);
    if (event.shiftKey && anchor.current && entries) {
      const from = entries.findIndex((item) => keyOf(item) === anchor.current);
      const to = entries.findIndex((item) => keyOf(item) === key);
      if (from >= 0 && to >= 0) {
        setPicked([...entries.slice(Math.min(from, to), Math.max(from, to) + 1).map(keyOf).filter((item) => item !== key), key]);
        return;
      }
    }
    anchor.current = key;
    if (event.metaKey || event.ctrlKey) setPicked((value) => (value.includes(key) ? value.filter((item) => item !== key) : [...value, key]));
    else setSelected(key);
  }

  /* What a right-click (or a drag) on `entry` means: all that is picked, if it is one of them. */
  const itemsFor = (entry) => (picks.length > 1 && picked.includes(keyOf(entry)) ? picks : [entry]);

  function menuFor(event, entry) {
    const items = itemsFor(entry);
    if (!picked.includes(keyOf(entry))) setSelected(keyOf(entry));
    const one = items.length === 1;
    openMenu(event, [
      one && { label: "Open", icon: entry.kind === "folder" ? FolderOpen : ArrowSquareOut, onSelect: () => open(entry) },
      one && entry.kind === "file" && { label: "Quick Look", icon: Eye, hint: "space", onSelect: () => act(() => api.quickLook(entry.rootId, entry.relative)) },
      one && canAsk(entry) && navigate && { label: "Ask about it", icon: Sparkle, onSelect: () => navigate("Assistant", { file: { rootId: entry.rootId, relative: entry.relative, name: entry.name } }) },
      one && { label: "Rename", icon: PencilSimple, onSelect: () => setRenaming(keyOf(entry)) },
      { label: "Move to", icon: ArrowBendUpRight, items: destinations(items) },
      { divider: true },
      { label: "Move to Bin", icon: Trash, hint: "⌘⌫", danger: true, onSelect: () => toBin(items) },
      one && { label: "Show in Finder", icon: FolderOpen, onSelect: () => act(() => api.reveal(entry.rootId, entry.relative)) },
    ]);
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
          <DropButton key={item.id} id={`files:root:${item.id}`} onDrop={({ data, alt }) => moveTo(data.items, item.id, "", alt)} aria-current={!finding && spot.rootId === item.id ? "true" : undefined} onClick={() => { setFind(""); go({ rootId: item.id, relative: "" }); }}>
            <FolderSimple weight={!finding && spot.rootId === item.id ? "fill" : "regular"} /> <span>{item.name}</span>
          </DropButton>
        ))}
        <p className="finder-kicker">Your folders</p>
        {folders.map((item) => (
          <span key={item.id} className="finder-side-row">
            <DropButton id={`files:root:${item.id}`} onDrop={({ data, alt }) => moveTo(data.items, item.id, "", alt)} aria-current={!finding && spot.rootId === item.id ? "true" : undefined} onClick={() => { setFind(""); go({ rootId: item.id, relative: "" }); }}>
              <FolderSimple weight={!finding && spot.rootId === item.id ? "fill" : "regular"} /> <span>{item.name}</span>
            </DropButton>
            <button type="button" className="finder-forget" aria-label={`Take ${item.name} out of the list`} title="Take it out of the list (the folder stays)" onClick={() => forget(item)}><X /></button>
          </span>
        ))}
        <button type="button" className="finder-add" onClick={addFolder}><FolderSimplePlus /> Add a folder…</button>
      </aside>

      <div className="finder-main">
        <header className="finder-bar">
          <button type="button" aria-label="Back" disabled={finding || !history.back.length} onClick={() => step("back")}><CaretLeft weight="bold" /></button>
          <button type="button" aria-label="Forward" disabled={finding || !history.forward.length} onClick={() => step("forward")}><CaretRight weight="bold" /></button>
          <button type="button" aria-label="New folder" title="New folder" disabled={finding} onClick={newFolder}><FolderPlus /></button>
          {finding ? (
            <p className="finder-path finder-found" role="status" title={understood || undefined}>{looking && !results ? "Looking…" : understood || "Found in names and inside files"}</p>
          ) : (
            <nav className="finder-path" aria-label="Where you are">
              <DropButton id="files:crumb:" onDrop={({ data, alt }) => moveTo(data.items, spot.rootId, "", alt)} onClick={() => go({ rootId: spot.rootId, relative: "" })}>{rootName}</DropButton>
              {crumbs.map((crumb, index) => (
                <span key={`${crumb}-${index}`}>
                  <CaretRight />
                  <DropButton id={`files:crumb:${index}`} onDrop={({ data, alt }) => moveTo(data.items, spot.rootId, crumbs.slice(0, index + 1).join("/"), alt)} onClick={() => go({ rootId: spot.rootId, relative: crumbs.slice(0, index + 1).join("/") })}>{crumb}</DropButton>
                </span>
              ))}
            </nav>
          )}
          <label className="finder-find">
            <MagnifyingGlass aria-hidden="true" />
            <input
              ref={findBox}
              type="search"
              aria-label="Find a file"
              placeholder="Find a file, like “pdf taxes last week”"
              value={find}
              onChange={(event) => { setFind(event.target.value); setSelected(null); }}
              onKeyDown={onFindKey}
            />
          </label>
        </header>
        <div ref={grid} className={`finder-grid ${finding ? "is-found" : ""}`} role="listbox" aria-multiselectable="true" aria-label={finding ? "Found" : rootName} onKeyDown={onKey} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }} {...hereDrop}>
          {entries?.map((entry) => (
            <FinderItem
              key={keyOf(entry)}
              entry={entry}
              selected={picked.includes(keyOf(entry))}
              finding={finding}
              where={finding ? whereOf(entry, roots) : ""}
              items={itemsFor(entry)}
              renaming={renaming === keyOf(entry)}
              onClick={click}
              onOpen={open}
              onMenu={menuFor}
              onMove={moveTo}
              onRenamed={renamed}
            />
          ))}
          {entries && !entries.length && (
            <p className="finder-empty">
              {finding ? "Nothing found. OSAT looks in Desktop, Documents, Downloads and your folders." : error || "Nothing in this folder."}
            </p>
          )}
        </div>
        {note && <p className="finder-note" role="status">{note}</p>}
      </div>

      <aside className="finder-info" aria-label="About the selected item">
        {picks.length > 1 ? (
          <>
            <h3>{picks.length} items picked</h3>
            <p>Drag them onto a folder, or use these.</p>
            <div className="finder-actions">
              <button type="button" onClick={(event) => openMenu(event, destinations(picks))}><ArrowBendUpRight /> Move to…</button>
              <button type="button" onClick={() => toBin(picks)}><Trash /> Move to Bin <kbd>⌘⌫</kbd></button>
            </div>
          </>
        ) : chosen ? (
          <>
            <FileThumb rootId={chosen.rootId} entry={chosen} size={512} className="is-large" />
            <h3>{chosen.name}</h3>
            <p>{kindLabel(chosen)}{chosen.size !== undefined ? ` · ${formatBytes(chosen.size)}` : ""}</p>
            {chosen.modifiedAt && <p>Changed {WHEN.format(new Date(chosen.modifiedAt))}</p>}
            {finding && <p>In {whereOf(chosen, roots)}{chosen.match === "inside" ? " · the words are inside it" : ""}</p>}
            <div className="finder-actions">
              <button type="button" className="primary-button" onClick={() => open(chosen)}>
                {chosen.kind === "folder" ? <FolderOpen /> : <ArrowSquareOut />} Open
              </button>
              {chosen.kind === "file" && <button type="button" onClick={() => act(() => api.quickLook(chosen.rootId, chosen.relative))}><Eye /> Quick Look <kbd>space</kbd></button>}
              {canAsk(chosen) && navigate && (
                <button type="button" onClick={() => navigate("Assistant", { file: { rootId: chosen.rootId, relative: chosen.relative, name: chosen.name } })}><Sparkle /> Ask about it</button>
              )}
              {finding && <button type="button" onClick={() => showHere(chosen)}><FolderSimple /> Show in its folder</button>}
              <button type="button" onClick={() => act(() => api.reveal(chosen.rootId, chosen.relative))}><FolderOpen /> Show in Finder</button>
              <button type="button" onClick={() => setRenaming(keyOf(chosen))}><PencilSimple /> Rename</button>
              <button type="button" onClick={(event) => openMenu(event, destinations([chosen]))}><ArrowBendUpRight /> Move to…</button>
              <button type="button" onClick={() => toBin([chosen])}><Trash /> Move to Bin <kbd>⌘⌫</kbd></button>
            </div>
          </>
        ) : (
          <p className="finder-empty">Click once to see a file here. Double-click opens it; Space shows it in Quick Look. ⌘-click picks several.</p>
        )}
      </aside>
      {menu}
      {toast}
    </section>
  );
}
