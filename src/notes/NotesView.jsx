import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NotePencil, Plus, X } from "@phosphor-icons/react";
import { localDateKey } from "../daily-practice.js";
import {
  canMoveFolder, createFolder, createNote, ensureDayNote, deleteFolder, duplicateNote, folderSubtree, emptyTrash, isActiveNote, isBranch, isJustInList, moveNotes, notesInList,
  keepNotes, purgeNotes, relinkRenamedNote, resolveWikilink, restoreNotes, setDone, setWhat, trashNotes, updateNote,
} from "../notes-model.js";
import { datesSettings, setDates } from "../intake/dates.js";
import { putOnCalendar, takeOffCalendar } from "../intake/useDates.js";
import { linkMentions, renameFolder } from "../nodes-model.js";
import { undoFrom } from "../boards/boards-model.js";
import { useUndoToast } from "../lib/UndoToast.jsx";
import { Organizer } from "./Organizer.jsx";
import { NoteList, useVisibleNotes } from "./NoteList.jsx";
import { NoteEditor } from "./NoteEditor.jsx";
import { saveNoteAiResponse } from "./note-ai.js";

const UI_KEY = "osat.notes-ui.v2";
const DEFAULT_UI = { list: "all", folderId: null, tags: [], query: "", sort: "updated", mode: "write", inspector: false, organizer: false, focus: false };

// Unsorted and Filed for you became Just in (Phase 67): a view saved or a link made before opens it.
const listFor = (list) => (isJustInList(list) ? "justin" : list);

function loadUi() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
    return { ...DEFAULT_UI, ...saved, list: listFor(saved.list || DEFAULT_UI.list), query: "", tags: [], organizer: false };
  } catch {
    return DEFAULT_UI;
  }
}

// Follow the room's width, including when Ask is open beside Notes.
function useNarrowRoom(ref, max = 760) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const box = ref.current?.closest(".popout-body") || document.documentElement;
    const check = () => setNarrow(box.clientWidth <= max);
    const observer = new ResizeObserver(check);
    observer.observe(box);
    check();
    return () => observer.disconnect();
  }, [ref, max]);
  return narrow;
}

export function NotesView({ workspace, commit, navigate, target, today = localDateKey() }) {
  const [ui, setUiState] = useState(loadUi);
  const [selectedId, setSelectedId] = useState(target?.noteId || null);
  const [selection, setSelection] = useState(() => new Set());
  const [pane, setPane] = useState(target?.noteId ? "editor" : "list");
  const [drawer, setDrawer] = useState(false); // the organizer as a sheet when Notes is narrow
  const rootRef = useRef(null);
  const narrow = useNarrowRoom(rootRef);
  const organizerOpen = narrow ? drawer : ui.organizer;
  const browseRef = useRef(null);
  const setUi = useCallback((patch) => {
    if (patch.focus) setPane("editor");
    setUiState((current) => ({ ...current, ...patch }));
  }, []);
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
    if (target.list) {
      setUi({ list: listFor(target.list), folderId: null, query: "", tags: [], focus: false });
      setSelection(new Set());
      setPane("list");
      return;
    }
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
  // (when Notes is narrow the list is its own screen, so leave it alone there).
  useEffect(() => {
    if (selectedId && notes.some((note) => note.id === selectedId)) return;
    if (!narrow) setSelectedId(notes[0]?.id || null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const pendingFocus = useRef(null);
  const [folderDraftAt, setFolderDraftAt] = useState(0);
  const closeBrowser = () => { setDrawer(false); setUi({ organizer: false }); setFolderDraftAt(0); browseRef.current?.focus(); };
  useEffect(() => {
    if (organizerOpen && !folderDraftAt) rootRef.current?.querySelector(".notes-organizer button")?.focus();
  }, [organizerOpen, folderDraftAt]);
  const [toast, showUndo] = useUndoToast();
  // Undo after a delete for good puts the very same notes back (still in the Trash).
  const bringBack = (gone) => commit((state) => ({ ...state, notes: [...state.notes.filter((note) => !gone.some((item) => item.id === note.id)), ...gone] }));
  const actions = useMemo(() => {
    const open = (id) => { setSelectedId(id); setSelection(new Set()); setPane("editor"); };
    // One change to one or several notes, and one Undo that takes back only what it touched (Calm rule 2, Phase 97).
    const change = (line, updater) => {
      let before = null;
      let next = null;
      commit((state) => { before = state; next = updater(state); return next; });
      if (before && next !== before) showUndo(line, () => commit(undoFrom(before, next)));
    };
    const some = (ids) => (ids.length > 1 ? ` ${ids.length} notes` : "");
    return {
      selectNote: open,
      // Filing on its own (Settings → AI): on or off, or `since: null`-free "File them too" for stickies from before.
      autoFile: (patch) => commit((state) => ({ ...state, settings: { ...(state.settings || {}), autoFile: { ...(state.settings?.autoFile || {}), ...patch } } })),
      createNote(folderId = null) {
        let created;
        commit((state) => { const result = createNote(state, { folderId }); created = result.note; return result.state; });
        if (!created) return;
        const visible = ["all", "recent"].includes(ui.list) || (isJustInList(ui.list) && !folderId) || (ui.list === "folder" && ui.folderId === folderId);
        setUi({
          query: "", tags: [],
          ...(visible ? {} : { list: folderId ? "folder" : "all", folderId: folderId || null }),
          ...(ui.mode === "read" ? { mode: "write" } : {}),
        });
        open(created.id);
        pendingFocus.current = "title";
      },
      updateNote: (id, patch) => commit((state) => updateNote(state, id, patch)),
      saveAiResponse(id, proposal) {
        let saved = false;
        commit((state) => {
          const next = saveNoteAiResponse(state, id, proposal);
          saved = next.notes.some((note) => note.id === proposal.id);
          return next;
        });
        return saved;
      },
      relinkTitle: (oldTitle, newTitle) => commit((state) => relinkRenamedNote(state, oldTitle, newTitle)),
      keepNotes: (ids) => commit((state) => keepNotes(state, ids)),
      commit,
      // What a sticky is (Phase 67): Nate's pick wins over the AI's and code's.
      setWhat: (ids, what) => change(ids.length > 1 ? `Changed what ${ids.length} notes are` : "Changed what it is", (state) => setWhat(state, ids, what)),
      // Answered, bought or done: it leaves the list it was ticked in; Undo puts it back.
      setDone(ids, done, word = "Done") {
        commit((state) => setDone(state, ids, done));
        if (done) showUndo(ids.length === 1 ? `${word}. It stays on its board.` : `${ids.length} ${word.toLowerCase()}`, () => commit((state) => setDone(state, ids, false)));
      },
      async putOnCalendar(note, when) {
        const where = await putOnCalendar(commit, note, when, datesSettings(workspace.settings).calendar);
        showUndo(where === "mac" ? "On your calendar" : "On OSAT’s calendar", () => takeOffCalendar(commit, note.id));
      },
      takeOffCalendar(id) {
        const note = workspace.notes.find((item) => item.id === id);
        takeOffCalendar(commit, id);
        if (note?.cal?.id) showUndo("Taken off the calendar");
      },
      datesOn: (on) => commit((state) => setDates(state, { on })),
      moveNotes: (ids, folderId) => change(`Moved${some(ids)} to ${workspace.folders.find((folder) => folder.id === folderId)?.name || "Just in"}`, (state) => moveNotes(state, ids, folderId)),
      setPinned: (ids, pinned) => change(`${pinned ? "Pinned" : "Unpinned"}${some(ids)}`, (state) => ({ ...state, notes: state.notes.map((note) => ids.includes(note.id) ? { ...note, pinned, unsorted: pinned ? false : note.unsorted } : note) })),
      setArchived: (ids, archived) => change(`${archived ? "Archived" : "Unarchived"}${some(ids)}`, (state) => ({ ...state, notes: state.notes.map((note) => ids.includes(note.id) ? { ...note, archived, pinned: archived ? false : note.pinned } : note) })),
      trashNotes(ids) {
        const chosen = new Set(ids);
        const pinned = new Set(workspace.notes.filter((note) => chosen.has(note.id) && note.pinned).map((note) => note.id));
        commit((state) => trashNotes(state, ids));
        setSelection(new Set());
        showUndo(
          ids.length === 1 ? "Moved to Trash" : `${ids.length} notes moved to Trash`,
          () => commit((state) => ({ ...state, notes: state.notes.map((note) => chosen.has(note.id) ? { ...note, trashedAt: null, pinned: pinned.has(note.id) } : note) })),
        );
      },
      restoreNotes(ids) { commit((state) => restoreNotes(state, ids)); setSelection(new Set()); },
      purgeNotes(ids) {
        const gone = workspace.notes.filter((note) => ids.includes(note.id) && note.trashedAt);
        if (!gone.length || !confirm(`Delete ${gone.length === 1 ? "this note" : `${gone.length} notes`} forever? After Undo expires, this cannot be reversed.`)) return;
        ids = gone.map((note) => note.id);
        commit((state) => purgeNotes(state, ids));
        setSelection(new Set());
        showUndo(gone.length === 1 ? "Deleted for good" : `${gone.length} notes deleted for good`, () => bringBack(gone));
      },
      emptyTrash() {
        const gone = workspace.notes.filter((note) => note.trashedAt);
        if (!gone.length || !confirm(`Empty Trash and delete ${gone.length} ${gone.length === 1 ? "note" : "notes"} forever? After Undo expires, this cannot be reversed.`)) return;
        commit((state) => emptyTrash(state));
        if (gone.length) showUndo("Trash emptied", () => bringBack(gone));
      },
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
        commit((state) => { const result = ensureDayNote(state, today); note = result.note; return result.state; });
        if (note) { setUi({ list: "daily", folderId: null, query: "", tags: [] }); open(note.id); }
      },
      /* The Sky opens on the note's node (or Unsorted). */
      showInNode(noteId) {
        navigate("Mindmap", { noteId });
      },
      createFolder(name, parentId) {
        const folder = createFolder(name, parentId);
        if (!folder) return;
        commit((state) => ({ ...state, folders: [...state.folders, folder] }));
        setUi({ list: "folder", folderId: folder.id, query: "", tags: [] });
      },
      renameFolder: (id, name) => commit((state) => renameFolder(state, id, name)),
      /* When writing ends, the note remembers which node each of its @s means. */
      linkMentions: (id) => commit((state) => linkMentions(state, id)),
      toggleFolder: (id) => commit((state) => ({ ...state, folders: state.folders.map((folder) => folder.id === id ? { ...folder, collapsed: !folder.collapsed } : folder) })),
      moveFolder(id, parentId) {
        if (!canMoveFolder(workspace.folders, id, parentId)) return;
        commit((state) => ({ ...state, folders: state.folders.map((folder) => {
          if (folder.id !== id) return folder;
          const { kind, ...rest } = folder;
          return { ...rest, parentId: parentId || null, ...(!parentId && kind ? { kind } : {}) };
        }) }));
      },
      deleteFolder(id) {
        const folder = workspace.folders.find((item) => item.id === id);
        if (!folder) return;
        const removed = folderSubtree(workspace.folders, id);
        const folders = workspace.folders.filter((item) => removed.has(item.id));
        const homes = new Map(workspace.notes.filter((note) => removed.has(note.folderId)).map((note) => [note.id, note.folderId]));
        commit((state) => deleteFolder(state, id));
        showUndo(`Deleted ${isBranch(folder) ? "branch" : "board"} “${folder.name}”. ${folder.parentId ? "Its notes moved up a level." : "Its notes are in Just in."}`, () => commit((state) => ({
          ...state,
          folders: [...state.folders.filter((item) => !removed.has(item.id)), ...folders],
          notes: state.notes.map((note) => homes.has(note.id) ? { ...note, folderId: homes.get(note.id) } : note),
        })));
        if (ui.list === "folder" && ui.folderId === id) setUi({ list: "all", folderId: null });
      },
      startFolder() { setUi({ organizer: true, focus: false }); setPane("list"); setDrawer(true); setFolderDraftAt(Date.now()); },
      /* A node in Notes is the same node in the Sky: this opens it there. */
      // List | Canvas: the same topic (or everything) spread out on the canvas.
      openCanvas(folderId = null) {
        navigate("Mindmap", folderId ? { folderId, open: true } : {});
      },
      // "Sort by hand": Just in on the canvas, where each sticky can be carried onto a board.
      sortByHand() {
        navigate("Mindmap", { action: "sort" });
      },
      openFolderBoard(folderId) {
        navigate("Mindmap", { folderId });
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
    <div ref={rootRef} className={`notes-view ${organizerOpen ? "" : "organizer-hidden"} ${ui.focus && selected ? "is-writing-focus" : ""} pane-${pane}`} onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (organizerOpen) { event.preventDefault(); event.stopPropagation(); closeBrowser(); }
      else if (ui.focus) { event.stopPropagation(); setUi({ focus: false }); }
    }}>
      {organizerOpen && (
        <Organizer
          workspace={workspace}
          ui={ui}
          setUi={(patch) => { setUi(patch); if ("list" in patch) { setSelection(new Set()); setPane("list"); closeBrowser(); } }}
          actions={actions}
          draftAt={folderDraftAt}
          onClose={closeBrowser}
        />
      )}
      {narrow && organizerOpen && (
        <button type="button" className="organizer-scrim" aria-label="Close the list of boards" onClick={closeBrowser}><X /></button>
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
        browseRef={browseRef}
        browsing={organizerOpen}
        onBrowse={() => { if (organizerOpen) closeBrowser(); else { setUi({ organizer: true }); setDrawer(true); } }}
      />
      {selected ? (
        <NoteEditor key={selected.id} workspace={workspace} note={selected} ui={ui} setUi={setUi} actions={actions} onBack={() => { setUi({ focus: false }); setPane("list"); }} />
      ) : (
        <section className="note-editor is-empty" aria-label="Note editor">
          <div className="empty-panel">
            <NotePencil />
            <h2>{workspace.notes.filter(isActiveNote).length ? "Pick a note, or start a new one." : "Your first note is a blank page."}</h2>
            <p>Write @ and a board’s name to link to it. #tags cut across, [[links]] connect ideas. Everything stays on this Mac.</p>
            <button className="primary-button" type="button" onClick={() => actions.createNote(ui.list === "folder" ? ui.folderId : null)}><Plus /> New note</button>
          </div>
        </section>
      )}
      {toast}
    </div>
  );
}
