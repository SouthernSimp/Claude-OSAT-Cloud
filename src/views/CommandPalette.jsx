import { ArrowRight, CalendarBlank, FolderSimple, MagnifyingGlass, NotePencil, Plus, ShareNetwork } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { MODULES, CORE_NAV, TOOL_NAV, FOOT_NAV } from "../lib/modules.js";
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

  const actions = [
    { key: "act:new-note", label: "New note", icon: Plus, kind: "Action", run: () => navigate("Notes", { action: "new" }) },
    { key: "act:today", label: "Today’s note", icon: CalendarBlank, kind: "Action", run: () => navigate("Notes", { action: "today" }) },
    { key: "act:new-folder", label: "New folder", icon: FolderSimple, kind: "Action", run: () => navigate("Notes", { action: "new-folder" }) },
    { key: "act:board", label: "Open Mindmap", icon: ShareNetwork, kind: "Action", run: () => navigate("Mindmap") },
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
  const routes = [...CORE_NAV, ...TOOL_NAV, ...FOOT_NAV, ...MODULES].filter((route) => route.label.toLowerCase().includes(q) && !tags.length)
    .map((route) => ({ key: `route:${route.id}`, label: route.label, icon: route.icon, kind: "Go to", run: () => navigate(route.id) }));
  const results = [...notes, ...folders, ...boards, ...projects, ...actions, ...routes].slice(0, 40);
  const pick = (item) => { item.run(); close(); };

  return (
    <div className="modal-backdrop command-backdrop" onPointerDown={close}>
      <section ref={ref} className="command-palette" role="dialog" aria-modal="true" aria-label="Search workspace" onPointerDown={(event) => event.stopPropagation()}>
        <label>
          <MagnifyingGlass />
          <input
            data-autofocus
            aria-label="Search notes, folders, boards, and tools"
            value={query}
            placeholder="Search notes, #tags, folders, boards…"
            onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setCursor((index) => Math.min(index + 1, results.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setCursor((index) => Math.max(index - 1, 0)); }
              if (event.key === "Enter" && results[cursor]) { event.preventDefault(); pick(results[cursor]); }
            }}
          />
          <kbd>esc</kbd>
        </label>
        <p className="command-result-group">{q ? "IN YOUR WORKSPACE" : "JUMP TO ANYWHERE"}</p>
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
