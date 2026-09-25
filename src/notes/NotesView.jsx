import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderSimple, NotePencil, Plus, X } from "@phosphor-icons/react";
import { localDateKey } from "../daily-practice.js";
import { addCardsToBoard, newBoard, normalizeBoardDoc, stockFor, updateBoard } from "../board-model.js";
import {
  canMoveFolder, createFolder, createNote, dailyNoteFor, deleteFolder, duplicateNote, emptyTrash, isActiveNote, moveNotes, notesInList,
  purgeNotes, resolveWikilink, restoreNotes, trashNotes, updateNote,
} from "../notes-model.js";
import { Organizer } from "./Organizer.jsx";
import { NoteList, useVisibleNotes } from "./NoteList.jsx";
import { NoteEditor } from "./NoteEditor.jsx";

const UI_KEY = "osat.notes-ui.v2";
const DEFAULT_UI = { list: "all", folderId: null, tags: [], query: "", sort: "updated", mode: "write", inspector: false, organizer: true };

function loadUi() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
    return { ...DEFAULT_UI, ...saved, query: "", tags: [] };
  } catch {
    return DEFAULT_UI;
  }
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function NotesView({ workspace, commit, navigate, target, today = localDateKey() }) {
  const [ui, setUiState] = useState(loadUi);
  const [selectedId, setSelectedId] = useState(target?.noteId || null);
  const [selection, setSelection] = useState(() => new Set());
  const [pane, setPane] = useState(target?.noteId ? "editor" : "list");
  const [drawer, setDrawer] = useState(false); // the organizer as a sheet on phones
  const narrow = useMediaQuery("(max-width: 860px)");
  const organizerOpen = narrow ? drawer : ui.organizer;
  const setUi = useCallback((patch) => setUiState((current) => ({ ...current, ...patch })), []);
  useEffect(() => {
    const { query, tags, ...persisted } = ui;
    localStorage.setItem(UI_KEY, JSON.stringify(persisted));
  }, [ui]);

  const notes = useVisibleNotes(workspace, ui);
  const selected = workspace.notes.find((note) => note.id === selectedId) || null;

  // A target handed over by navigation (Today, Mindmap, the command palette):
  // a note to open, a folder to show, or an action to run.
  const handledTarget = useRef(null);
  const actionsRef = useRef(null);
  useEffect(() => {
    if (!target || handledTarget.current === target.at) return;
    handledTarget.current = target.at;
    if (target.action) { requestAnimationFrame(() => actionsRef.current?.[target.action === "new" ? "createNote" : target.action === "today" ? "openToday" : "startFolder"]?.()); return; }
    if (target.folderId) {
      setUi({ list: "folder", folderId: target.folderId, query: "", tags: [] });
      setSelection(new Set());
      setPane("list");
      return;
    }
    if (!target.noteId) return;
    const note = workspace.notes.find((item) => item.id === target.noteId);
    if (!note) return;
    setSelectedId(target.noteId);
    setSelection(new Set());
    setPane("editor");
    if (!notesInList(workspace, ui.list, ui.folderId).some((item) => item.id === target.noteId)) {
      setUi({ list: note.trashedAt ? "trash" : note.archived ? "archived" : "all", folderId: null, query: "", tags: [] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // When the visible list no longer holds the open note, open the first one
  // (on a phone the list is its own screen, so leave it alone there).
  useEffect(() => {
    if (selectedId && notes.some((note) => note.id === selectedId)) return;
    if (!narrow) setSelectedId(notes[0]?.id || null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const pendingFocus = useRef(null);
  const [folderDraftAt, setFolderDraftAt] = useState(0);
  const actions = useMemo(() => {
    const open = (id) => { setSelectedId(id); setSelection(new Set()); setPane("editor"); };
    return {
      selectNote: open,
      createNote(folderId = null) {
        let created;
        commit((state) => { const result = createNote(state, { folderId }); created = result.note; return result.state; });
        if (!created) return;
        const visible = ["all", "recent"].includes(ui.list) || (ui.list === "unfiled" && !folderId) || (ui.list === "folder" && ui.folderId === folderId);
        setUi({
          query: "", tags: [],
          ...(visible ? {} : { list: folderId ? "folder" : "all", folderId: folderId || null }),
          ...(ui.mode === "read" ? { mode: "write" } : {}),
        });
        open(created.id);
        pendingFocus.current = "title";
      },
      updateNote: (id, patch) => commit((state) => updateNote(state, id, patch)),
      moveNotes: (ids, folderId) => commit((state) => moveNotes(state, ids, folderId)),
      setPinned: (ids, pinned) => commit((state) => ({ ...state, notes: state.notes.map((note) => ids.includes(note.id) ? { ...note, pinned } : note) })),
      setArchived: (ids, archived) => commit((state) => ({ ...state, notes: state.notes.map((note) => ids.includes(note.id) ? { ...note, archived, pinned: archived ? false : note.pinned } : note) })),
      trashNotes(ids) { commit((state) => trashNotes(state, ids)); setSelection(new Set()); },
      restoreNotes(ids) { commit((state) => restoreNotes(state, ids)); setSelection(new Set()); },
      purgeNotes(ids) {
        if (!confirm(ids.length === 1 ? "Delete this note forever? This cannot be undone." : `Delete ${ids.length} notes forever? This cannot be undone.`)) return;
        commit((state) => purgeNotes(state, ids));
        setSelection(new Set());
      },
      emptyTrash() { if (confirm("Empty the trash? Notes in it are deleted for good.")) commit((state) => emptyTrash(state)); },
      duplicateNote(id) {
        let copy;
        commit((state) => { const result = duplicateNote(state, id); copy = result.note; return result.state; });
        if (copy) open(copy.id);
      },
      openWikilink(target, folderId = null) {
        const existing = resolveWikilink(workspace.notes, target);
        if (existing) { open(existing.id); return; }
        let created;
        commit((state) => {
          const again = resolveWikilink(state.notes, target);
          if (again) { created = again; return state; }
          const result = createNote(state, { title: target.trim(), folderId });
          created = result.note;
          return result.state;
        });
        if (created) { setUi({ query: "", tags: [] }); open(created.id); }
      },
      openToday() {
        let note;
        commit((state) => { const result = dailyNoteFor(state, today); note = result.note; return result.state; });
        if (note) { setUi({ list: "daily", folderId: null, query: "", tags: [] }); open(note.id); }
      },
      showOnBoard(noteId, boardId = null) {
        const doc = normalizeBoardDoc(workspace.sorter);
        const target = doc.boards.find((board) => board.id === boardId) || doc.boards.find((board) => board.notes.some((card) => card.id === noteId)) || doc.boards[0];
        commit((state) => {
          const note = state.notes.find((item) => item.id === noteId);
          const { w, h } = stockFor(note?.markdown || note?.title || "");
          const next = updateBoard(state, target.id, (board) => board.notes.some((card) => card.id === noteId) ? board : addCardsToBoard(board, [{ id: noteId, w, h }]));
          return { ...next, sorter: { ...next.sorter, activeId: target.id } };
        });
        navigate("Mindmap", { boardId: target.id, focusNoteId: noteId });
      },
      createFolder(name, parentId) {
        const folder = createFolder(name, parentId);
        if (!folder) return;
        commit((state) => ({ ...state, folders: [...state.folders, folder] }));
        setUi({ list: "folder", folderId: folder.id, query: "", tags: [] });
      },
      renameFolder: (id, name) => commit((state) => ({ ...state, folders: state.folders.map((folder) => folder.id === id ? { ...folder, name: name.trim().slice(0, 80) || folder.name } : folder) })),
      toggleFolder: (id) => commit((state) => ({ ...state, folders: state.folders.map((folder) => folder.id === id ? { ...folder, collapsed: !folder.collapsed } : folder) })),
      moveFolder(id, parentId) {
        if (!canMoveFolder(workspace.folders, id, parentId)) return;
        commit((state) => ({ ...state, folders: state.folders.map((folder) => folder.id === id ? { ...folder, parentId: parentId || null } : folder) }));
      },
      deleteFolder(id) {
        const folder = workspace.folders.find((item) => item.id === id);
        if (!folder || !confirm(`Delete the folder “${folder.name}”? Its notes stay and move up one level.`)) return;
        commit((state) => deleteFolder(state, id));
        if (ui.list === "folder" && ui.folderId === id) setUi({ list: "all", folderId: null });
      },
      startFolder() { setUi({ organizer: true }); setDrawer(true); setFolderDraftAt(Date.now()); },
      openFolderBoard(folderId) {
        const folder = workspace.folders.find((item) => item.id === folderId);
        if (!folder) return;
        const doc = normalizeBoardDoc(workspace.sorter);
        let board = doc.boards.find((item) => item.scope.kind === "folder" && item.scope.folderId === folderId);
        commit((state) => {
          const current = normalizeBoardDoc(state.sorter);
          board = current.boards.find((item) => item.scope.kind === "folder" && item.scope.folderId === folderId);
          if (board) return { ...state, sorter: { ...current, activeId: board.id } };
          board = newBoard(folder.name, { kind: "folder", folderId });
          return { ...state, sorter: { ...current, boards: [...current.boards, board], activeId: board.id } };
        });
        navigate("Mindmap", { boardId: board?.id });
      },
    };
  }, [commit, navigate, workspace, ui.list, ui.folderId, ui.mode, setUi, today]);

  actionsRef.current = actions;

  useEffect(() => {
    if (pendingFocus.current === "title") {
      pendingFocus.current = null;
      requestAnimationFrame(() => { const input = document.querySelector(".note-title"); input?.focus(); input?.select(); });
    }
  }, [selectedId]);

  // "N" makes a new note in the current folder (App reserves it for capture elsewhere).
  useEffect(() => {
    const key = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (typing) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); actions.createNote(ui.list === "folder" ? ui.folderId : null); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [actions, ui.list, ui.folderId]);

  const toggleSelect = (value) => {
    if (value === null) { setSelection(new Set()); return; }
    if (Array.isArray(value)) { setSelection(new Set(value)); return; }
    setSelection((current) => {
      const next = new Set(current);
      if (!next.size && selectedId && selectedId !== value) next.add(selectedId);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  return (
    <div className={`notes-view ${organizerOpen ? "" : "organizer-hidden"} pane-${pane}`}>
      {organizerOpen && (
        <Organizer
          workspace={workspace}
          ui={ui}
          setUi={(patch) => { setUi(patch); if (narrow && "list" in patch) setDrawer(false); }}
          actions={actions}
          draftAt={folderDraftAt}
        />
      )}
      {narrow && organizerOpen && (
        <button type="button" className="organizer-scrim" aria-label="Close folders" onClick={() => setDrawer(false)}><X /></button>
      )}
      <NoteList
        workspace={workspace}
        ui={ui}
        setUi={setUi}
        notes={notes}
        selectedId={selectedId}
        selection={selection}
        onSelect={(id) => { setSelectedId(id); setSelection(new Set()); setPane("editor"); }}
        onToggleSelect={toggleSelect}
        actions={actions}
      />
      {!organizerOpen && (
        <button type="button" className="organizer-reveal" aria-label="Show folders" title="Show folders" onClick={() => (narrow ? setDrawer(true) : setUi({ organizer: true }))}><FolderSimple /></button>
      )}
      {selected ? (
        <NoteEditor key={selected.id} workspace={workspace} note={selected} ui={ui} setUi={setUi} actions={actions} onBack={() => setPane("list")} />
      ) : (
        <section className="note-editor is-empty" aria-label="Note editor">
          <div className="empty-panel">
            <NotePencil />
            <h2>{workspace.notes.filter(isActiveNote).length ? "Pick a note, or start a new one." : "Your first note is a blank page."}</h2>
            <p>Folders keep things tidy, #tags cut across them, and [[links]] connect ideas. Everything stays on this Mac.</p>
            <button className="primary-button" type="button" onClick={() => actions.createNote(ui.list === "folder" ? ui.folderId : null)}><Plus /> New note</button>
          </div>
        </section>
      )}
    </div>
  );
}
