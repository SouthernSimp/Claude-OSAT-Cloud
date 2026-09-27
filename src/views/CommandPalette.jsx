import { ArrowRight, CalendarBlank, File, FolderSimple, MagnifyingGlass, MoonStars, NotePencil, Plus, ShareNetwork } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { EVERYWHERE } from "../lib/spaces.js";
import { useFocusTrap } from "../lib/use-focus-trap.js";
import { folderPath, isActiveNote, parseQuery } from "../notes-model.js";

export function CommandPalette({ workspace, navigate, close, initialQuery = "" }) {
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const ref = useRef(null);
  useFocusTrap(ref, true, close);
  const q = query.trim().toLowerCase();
  const { tags, words } = parseQuery(q);
  const matchesWords = (text) => words.every((word) => text.includes(word));

  /* Files on this Mac, by name, from Spotlight (the Mac app only). */
  const [found, setFound] = useState([]);
  useEffect(() => {
    const api = window.nateOSFiles;
    if (!api?.search || q.length < 2 || tags.length) { setFound([]); return undefined; }
    let live = true;
    const timer = setTimeout(() => api.search(q).then((items) => { if (live) setFound(Array.isArray(items) ? items : []); }, () => {}), 180);
    return () => { live = false; clearTimeout(timer); };
  }, [q, tags.length]);
  const PLACE = { desktop: "Desktop", documents: "Documents", downloads: "Downloads" };
  const macFiles = found.slice(0, 8).map((item) => {
    const parent = item.relative.split("/").slice(0, -1);
    return {
      key: `file:${item.rootId}:${item.relative}`,
      label: item.name,
      hint: [PLACE[item.rootId] || "Your folder", ...parent].join(" / "),
      icon: item.kind === "folder" ? FolderSimple : File,
      kind: "On this Mac",
      run: () => navigate("Files", item.kind === "folder"
        ? { rootId: item.rootId, relative: item.relative }
        : { rootId: item.rootId, relative: parent.join("/"), select: item.relative }),
    };
  });

  const actions = [
    { key: "act:new-note", label: "New note", icon: Plus, kind: "Action", run: () => navigate("Notes", { action: "new" }) },
    { key: "act:today", label: "Today’s note", icon: CalendarBlank, kind: "Action", run: () => navigate("Notes", { action: "today" }) },
    { key: "act:new-folder", label: "New folder", icon: FolderSimple, kind: "Action", run: () => navigate("Notes", { action: "new-folder" }) },
    { key: "act:board", label: "Open the Map", icon: ShareNetwork, kind: "Action", run: () => navigate("Mindmap") },
    { key: "act:sky", label: "See the Sky", icon: MoonStars, kind: "Action", run: () => navigate("Sky") },
  ].filter((action) => !q || action.label.toLowerCase().includes(q));

  const notes = q
    ? workspace.notes.filter(isActiveNote)
      .filter((note) => tags.every((tag) => note.tags.includes(tag)) && matchesWords(`${note.title}\n${note.markdown}`.toLowerCase()))
      .sort((a, b) => Number(b.title.toLowerCase().includes(q)) - Number(a.title.toLowerCase().includes(q)) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 12)
      .map((note) => ({ key: `note:${note.id}`, label: note.title || "Untitled note", hint: folderPath(workspace.folders, note.folderId).join(" / "), icon: NotePencil, kind: "Note", run: () => navigate("Notes", { noteId: note.id }) }))
    : [];
  const folders = q && !tags.length
    ? workspace.folders.filter((folder) => folder.name.toLowerCase().includes(q)).slice(0, 6)
      .map((folder) => ({ key: `folder:${folder.id}`, label: folder.name, hint: folderPath(workspace.folders, folder.parentId).join(" / "), icon: FolderSimple, kind: "Folder", run: () => navigate("Notes", { folderId: folder.id }) }))
    : [];
  const boards = q && !tags.length
    ? (workspace.sorter?.boards || []).filter((board) => board.name.toLowerCase().includes(q)).slice(0, 6)
      .map((board) => ({ key: `board:${board.id}`, label: board.name, hint: `${board.notes.length} notes`, icon: ShareNetwork, kind: "Board", run: () => navigate("Mindmap", { boardId: board.id }) }))
    : [];
  const projects = q && !tags.length
    ? workspace.projects.filter((project) => `${project.title} ${project.summary}`.toLowerCase().includes(q))
      .map((project) => ({ key: `project:${project.id}`, label: project.title, icon: FolderSimple, kind: "Project", run: () => navigate("Projects") }))
    : [];
  const routes = EVERYWHERE.filter((route) => route.label.toLowerCase().includes(q) && !tags.length)
    .map((route) => ({ key: `route:${route.id}`, label: route.label, icon: route.icon, kind: "Go to", run: () => navigate(route.id) }));
  const results = [...notes, ...macFiles, ...folders, ...boards, ...projects, ...actions, ...routes].slice(0, 40);
  const pick = (item) => { item.run(); close(); };

  return (
    <div className="modal-backdrop command-backdrop" onPointerDown={close}>
      <section ref={ref} className="glass command-palette" role="dialog" aria-modal="true" aria-label="Search workspace" onPointerDown={(event) => event.stopPropagation()}>
        <label>
          <MagnifyingGlass />
          <input
            data-autofocus
            aria-label="Search notes, files, folders, boards, and tools"
            value={query}
            placeholder={window.nateOSFiles ? "Search notes, files on this Mac, #tags…" : "Search notes, #tags, folders, boards…"}
            onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setCursor((index) => Math.min(index + 1, results.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setCursor((index) => Math.max(index - 1, 0)); }
              if (event.key === "Enter" && results[cursor]) { event.preventDefault(); pick(results[cursor]); }
            }}
          />
          <kbd>esc</kbd>
        </label>
        <p className="command-result-group">{!q ? "JUMP TO ANYWHERE" : macFiles.length ? "IN OSAT AND ON THIS MAC" : "IN YOUR WORKSPACE"}</p>
        <div>
          {results.map((item, index) => (
            <button key={item.key} className={index === cursor ? "active" : ""} data-active={index === cursor} onClick={() => pick(item)}>
              <item.icon />
              <span>{item.label}{item.hint ? <em>{item.hint}</em> : null}</span>
              <small>{item.kind}</small>
              <ArrowRight />
            </button>
          ))}
          {!results.length && <p className="quiet-empty" style={{ padding: 20 }}>No matches. Try a different word.</p>}
        </div>
      </section>
    </div>
  );
}
