import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Aperture, Database, EnvelopeSimple, Plus, ShieldCheck, X } from "@phosphor-icons/react";

import { LocalAssistant } from "./assistant/LocalAssistant.jsx";
import { FieldTopbar } from "./field/FieldChrome.jsx";
import { BrowserView } from "./tools/Browser.jsx";
import { TerminalView } from "./tools/Terminal.jsx";
import { FieldDesk } from "./field/FieldDesk.jsx";
import { FieldSky } from "./field/FieldSky.jsx";
import { addFieldSample, hasFieldSample, removeFieldSample } from "./field/field-sample.js";
import { BLANK_KEY } from "./field/field-model.js";


import { CalendarView } from "./views/Calendar.jsx";
import { CommandPalette } from "./views/CommandPalette.jsx";
import { DisconnectedView } from "./views/Disconnected.jsx";
import { FilesView } from "./views/Files.jsx";
import { HabitsView } from "./views/Habits.jsx";
import { IdeasView } from "./views/Ideas.jsx";
import { InboxView } from "./views/Inbox.jsx";
import { JournalView } from "./views/Journal.jsx";
import { MobileNav } from "./views/MobileNav.jsx";
import { MoreView } from "./views/More.jsx";
import { NotesView } from "./notes/NotesView.jsx";
import { BoardView } from "./board/BoardView.jsx";
import { BudgetView } from "./views/Budget.jsx";
import { ObsidianView } from "./views/Obsidian.jsx";
import { ProjectsView } from "./views/Projects.jsx";
import { ReflectionView } from "./views/Reflection.jsx";
import { SettingsView } from "./views/Settings.jsx";

import { localDateKey } from "./daily-practice.js";
import { createDefaultWorkspace, importLegacyStorage } from "./osat-data.js";
import { reconcileBoards } from "./board-model.js";
import { captureThought, isActiveNote } from "./notes-model.js";
import { loadCanonicalWorkspace, saveCanonicalWorkspace, stageWorkspace } from "./osat-store.js";
import { inputActive, makeId } from "./lib/ui.js";
import { useFocusTrap } from "./lib/use-focus-trap.js";
import { DATE_LABEL } from "./lib/modules.js";

const FILLED_VIEWS = new Set(["Mindmap", "Assistant", "Notes", "Calendar", "Today", "Sky", "Browser", "Terminal"]);
const ROOM_KEYS = { 1: "Today", 2: "Notes", 3: "Mindmap", 4: "Journal", 5: "Calendar", 6: "Assistant", 7: "Browser", 8: "Terminal" };
const WALL_KEY = "osat.home.wallpaper.v1";

function readWallpaper() {
  try {
    return localStorage.getItem(WALL_KEY) === "moss" ? "moss" : "lake";
  } catch {
    return "lake";
  }
}


function useWorkspace() {
  const initial = useRef(null);
  if (!initial.current) {
    try {
      initial.current = importLegacyStorage(localStorage);
    } catch {
      initial.current = createDefaultWorkspace();
    }
  }
  const [workspace, setWorkspace] = useState(initial.current);
  const currentWorkspace = useRef(workspace);
  currentWorkspace.current = workspace;
  const [hydrated, setHydrated] = useState(false);
  const [previewFallback, setPreviewFallback] = useState(false);
  const [storage, setStorage] = useState({
    status: "loading",
    message: "Opening private local database",
  });

  useEffect(() => {
    let active = true;
    const isBrowserPreview = import.meta.env.DEV && /^https?:$/.test(window.location.protocol);
    const fallbackTimer = isBrowserPreview
      ? window.setTimeout(() => {
          if (!active) return;
          // The editable browser preview owns a sandbox workspace. If IndexedDB is
          // blocked by another preview tab, keep the review surface usable without
          // touching the installed app's canonical database.
          setPreviewFallback(true);
          setStorage({ status: "ready", message: "Preview sandbox" });
          setHydrated(true);
        }, 1200)
      : null;

    loadCanonicalWorkspace(localStorage)
      .then(({ state, imported }) => {
        if (!active) return;
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        setPreviewFallback(false);
        setWorkspace(state);
        setStorage({
          status: "ready",
          message: imported
            ? "Earlier data imported once. Original keys left untouched."
            : "Saved in the private local database.",
        });
        setHydrated(true);
      })
      .catch((error) => {
        if (!active) return;
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        setStorage({
          status: "error",
          message: error.message,
        });
      });
    return () => {
      active = false;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    };
  }, []);

  // Saves trail edits by 220ms, but never wait longer than two seconds while
  // someone keeps typing — the recovery copy in localStorage is not the database.
  const lastSave = useRef(Date.now());
  useEffect(() => {
    if (!hydrated || storage.status === "error" || previewFallback) return undefined;
    const overdue = Date.now() - lastSave.current > 2000;
    const timer = setTimeout(() => {
      lastSave.current = Date.now();
      saveCanonicalWorkspace(workspace)
        .then(() =>
          setStorage((current) =>
            current.status === "ready"
              ? current
              : {
                  status: "ready",
                  message: "Saved in the private local database.",
                },
          ),
        )
        .catch((error) =>
          setStorage({
            status: "error",
            message: `${error.message} The original rollback keys were not changed.`,
          }),
        );
    }, overdue ? 0 : 220);
    return () => clearTimeout(timer);
  }, [workspace, hydrated, previewFallback]);
  function updateWorkspace(updater) {
    const previous = currentWorkspace.current;
    let next = typeof updater === 'function' ? updater(previous) : updater;
    // Board creation and scope changes also need to populate their matching notes.
    if (next.notes !== previous.notes || next.folders !== previous.folders || next.sorter !== previous.sorter) next = { ...next, sorter: reconcileBoards(next) };
    try {
      const staged = stageWorkspace(next);
      currentWorkspace.current = staged;
      setWorkspace(staged);
    } catch (error) {
      // Keep accepting edits in memory and attempt IndexedDB if recovery storage is full.
      currentWorkspace.current = next;
      setWorkspace(next);
      saveCanonicalWorkspace(next).catch(() => setStorage({ status: 'error', message: 'Save failed. Export your workspace before closing.' }));
    }
  }
  return { workspace, setWorkspace: updateWorkspace, storage, hydrated };
}

function WorkspaceApp() {
  const { workspace, setWorkspace, storage, hydrated } = useWorkspace();
  const [view, setView] = useState("Today");
  const [notesTarget, setNotesTarget] = useState(null);
  const [boardTarget, setBoardTarget] = useState(null);
  const [calendarTarget, setCalendarTarget] = useState(null);
  const [assistantTarget, setAssistantTarget] = useState(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [wallpaper, setWallpaper] = useState(readWallpaper);
  const [roomCommand, setRoomCommand] = useState(null);
  const [sampleHidden, setSampleHidden] = useState(() => localStorage.getItem(BLANK_KEY) === "1");
  const [deskSheet, setDeskSheet] = useState(null);
  const [draft, setDraft] = useState("");
  const modalRef = useRef(null);
  const titleRef = useRef(null);
  const previousView = useRef(view);
  const today = localDateKey();
  const closeCapture = useCallback(() => setCaptureOpen(false), []);
  const closeCommands = useCallback(() => setCommandOpen(false), []);
  useFocusTrap(modalRef, captureOpen, closeCapture);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        workspace.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : workspace.theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [workspace.theme]);

  useEffect(() => {
    if (previousView.current !== view) titleRef.current?.focus();
    previousView.current = view;
  }, [view]);

  useEffect(() => window.osatQuickCapture?.onCapture?.((text) => saveCaptureText(text, "Global shortcut")), []);

  /* The Mac menu bar and Dock menu send commands here, through the same navigate(). */
  const latest = useRef(null);
  useEffect(() => window.osatApp?.onCommand?.((detail) => {
    if (!detail || typeof detail !== "object") return;
    if (detail.action === "search") { latest.current?.openCommands(); return; }
    if (typeof detail.view === "string") latest.current?.navigate(detail.view, detail.detail || null);
    if (typeof detail.action === "string") setRoomCommand({ action: detail.action, at: Date.now() });
  }), []);

  useEffect(() => {
    const keydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandQuery("");
        setCommandOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && ROOM_KEYS[event.key]) {
        event.preventDefault();
        navigate(ROOM_KEYS[event.key]);
      }
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        event.key.toLowerCase() === "n" &&
        !inputActive() &&
        view !== "Mindmap" &&
        view !== "Notes" &&
        view !== "Today" &&
        view !== "Sky"
      ) {
        event.preventDefault();
        setCaptureOpen(true);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [view]);

  function navigate(next, detail = null) {
    const go = () => {
      if (next === "Notes") setNotesTarget(detail ? { ...(typeof detail === "string" ? { noteId: detail } : detail), at: Date.now() } : null);
      if (next === "Mindmap") setBoardTarget(detail && typeof detail === "object" ? { ...detail, at: Date.now() } : null);
      if (next === "Calendar") setCalendarTarget(detail?.date || null);
      if (next === "Today" && detail && typeof detail === "object" && typeof detail.noteId === "string") {
        setDeskSheet({ id: detail.noteId, at: Date.now() });
      }
      if (next === "Assistant") setAssistantTarget(typeof detail?.prompt === "string" ? { prompt: detail.prompt, at: Date.now() } : null);
      setCommandOpen(false);
      if (next === "Capture") {
        setCaptureOpen(true);
        return;
      }
      setView(next);
    };
    // Changing rooms cross-fades and the tab pill glides; reduced motion just swaps.
    if (next === "Capture" || next === view || !document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) go();
    else {
      document.documentElement.dataset.vt = "room";
      document.startViewTransition(() => flushSync(go)).finished.finally(() => { delete document.documentElement.dataset.vt; });
    }
  }
  function commit(updater) {
    setWorkspace((current) =>
      typeof updater === "function" ? updater(current) : updater,
    );
  }
  function saveCaptureText(value, source = "Private note", openInbox = false) {
    const title = String(value || "").trim();
    if (!title) return;
    let saved;
    commit((current) => { const result = captureThought(current, title, source); saved = result.note; return result.state; });
    setDraft("");
    setCaptureOpen(false);
    if (openInbox && saved) navigate("Notes", { noteId: saved.id });
  }
  function saveCapture(event) {
    event.preventDefault();
    saveCaptureText(draft, "Private note", true);
  }

  if (!hydrated)
    return (
      <main className="app-shell">
        <section className="workspace loading-workspace">
          <section className="connection-gate" aria-live="polite">
            <div>
              <Database />
              <span>LOCAL STORAGE</span>
            </div>
            <h2>{storage.status === "error" ? "Your workspace could not be opened." : "Opening the room."}</h2>
            <p>{storage.status === "error" ? `${storage.message} Editing is paused to protect saved data.` : "Your notes stay on this Mac."}</p>
            {storage.status === "error" && <button type="button" className="primary-button" onClick={() => window.location.reload()}>Try again</button>}
          </section>
        </section>
      </main>
    );

  const common = { workspace, commit, navigate };
  const preview = workspace.notes.filter(isActiveNote).length === 0 && !sampleHidden;
  const sampled = hasFieldSample(workspace);
  const keepSample = (noteId) => {
    commit((state) => addFieldSample(state));
    localStorage.removeItem(BLANK_KEY);
    setSampleHidden(false);
    if (typeof noteId === "string") {
      setDeskSheet({ id: noteId, at: Date.now() });
      setView("Today");
    }
  };
  const hideSample = () => {
    localStorage.setItem(BLANK_KEY, "1");
    setSampleHidden(true);
  };
  const clearSample = () => {
    commit((state) => removeFieldSample(state));
    hideSample();
  };
  const room = { preview, sampled, onKeep: keepSample, onBlank: hideSample, onRemove: clearSample };
  const openCommands = (query = "") => {
    setCommandQuery(query);
    setCommandOpen(true);
  };
  const chooseWallpaper = (value) => {
    setWallpaper(value);
    try { localStorage.setItem(WALL_KEY, value); } catch { /* a convenience only */ }
  };
  latest.current = { navigate, openCommands };
  const toggleTheme = () => commit((state) => ({ ...state, theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }));
  return (
    <main className="app-shell field-app">
      <section
        className={`workspace ${view === "Today" ? "is-home" : ""}`}
        aria-label="OSAT workspace"
        inert={captureOpen || commandOpen || undefined}
      >
        {view !== "Today" && (
          <FieldTopbar
            view={view}
            navigate={navigate}
            storage={storage}
            onCommands={() => openCommands()}
            onCapture={() => setCaptureOpen(true)}
            onTheme={toggleTheme}
          />
        )}
        <div className={`workspace-content ${FILLED_VIEWS.has(view) ? "is-filled" : ""}`} data-view={view}>
        {!FILLED_VIEWS.has(view) && !["Today", "Sky", "More", "Reflection", "Budget", "Journal", "Files"].includes(view) && (
          <header className="page-heading">
            <div>
              <h1 ref={titleRef} tabIndex="-1">
                {view === "Assistant" ? "Local AI" : view}
              </h1>
            </div>
            <p>{DATE_LABEL}</p>
          </header>
        )}
        {view === "Today" && (
          <FieldDesk
            {...common}
            {...room}
            today={today}
            sheet={deskSheet}
            onSheetDone={() => setDeskSheet(null)}
            storage={storage}
            onSearch={openCommands}
            onCapture={() => setCaptureOpen(true)}
            onTheme={toggleTheme}
            wallpaper={wallpaper}
            onWallpaper={chooseWallpaper}
          />
        )}
        {view === "Sky" && <FieldSky {...common} {...room} />}
        {view === "Assistant" && <LocalAssistant {...common} initialPrompt={assistantTarget} />}
        {view === "Browser" && <BrowserView {...common} covered={captureOpen || commandOpen} command={roomCommand} />}
        {view === "Terminal" && <TerminalView command={roomCommand} />}
        {view === "Inbox" && <InboxView {...common} />}
        {view === "Notes" && <NotesView {...common} target={notesTarget} today={today} />}
        {view === "Mindmap" && <BoardView {...common} boardTarget={boardTarget} />}
        {view === "More" && <MoreView navigate={navigate} />}
        {view === "Ideas" && <IdeasView {...common} />}
        {view === "Projects" && <ProjectsView {...common} />}
        {view === "Budget" && <BudgetView {...common} />}
        {view === "Calendar" && <CalendarView {...common} initialDate={calendarTarget} />}
        {view === "Habits" && <HabitsView {...common} today={today} />}
        {view === "Reflection" && <ReflectionView {...common} today={today} />}
        {view === "Journal" && <JournalView {...common} />}
        {view === "Files" && <FilesView />}
        {view === "Obsidian" && <ObsidianView {...common} />}
        {view === "Gmail" && (
          <DisconnectedView
            title="Gmail"
            icon={EnvelopeSimple}
            copy="No Google account is connected. OSAT will not ask for mailbox access until a reviewed connector is deliberately enabled."
          />
        )}
        {view === "Settings" && <SettingsView {...common} storage={storage} />}
        </div>
      </section>
      <MobileNav view={view} navigate={navigate} />

      {captureOpen && (
        <div className="modal-backdrop" onPointerDown={closeCapture}>
          <form
            ref={modalRef}
            className="capture-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="capture-title"
            onSubmit={saveCapture}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              type="button"
              aria-label="Close capture"
              onClick={closeCapture}
            >
              <X />
            </button>
            <p className="eyebrow">MAKE A LITTLE ROOM</p>
            <h2 id="capture-title">Let it land here.</h2>
            <p>A thought, a loose end, a possibility. No need to organize it yet.</p>
          <textarea
            data-autofocus
            value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type the thought exactly as it is..."
              rows="7"
            />
            <div className="dialog-actions">
              <span>One thought. Connected in Notes & Mindmap.</span>
              <button className="primary-button" disabled={!draft.trim()}>
                <Plus /> Capture
              </button>
            </div>
          </form>
        </div>
      )}
      {commandOpen && (
        <CommandPalette workspace={workspace} navigate={navigate} close={closeCommands} initialQuery={commandQuery} />
      )}
    </main>
  );
}

function QuickCaptureSurface() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  function submit(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (window.osatQuickCapture?.submit) window.osatQuickCapture.submit(value);
    setSaved(true);
  }
  return <main className="quick-surface"><form onSubmit={submit}><header><Aperture weight="bold" /><span><strong>Quick capture</strong><small>Sent privately to OSAT</small></span></header>{saved ? <div className="quick-saved"><ShieldCheck /><strong>Captured.</strong><span>You can close this window.</span></div> : <><label htmlFor="quick-text">What’s on your mind?</label><textarea id="quick-text" data-autofocus autoFocus rows="7" value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste or type it exactly as it is…" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit(event); }} /><footer><span>⌘ Return to save</span><button className="primary-button" disabled={!text.trim()}><Plus /> Capture</button></footer></>}</form></main>;
}

function AssistantSurface() {
  const { workspace, setWorkspace, storage, hydrated } = useWorkspace();
  if (!hydrated) return <main className="quick-surface"><div className="quick-loading">Opening local AI…</div></main>;
  return <main className="assistant-popout"><LocalAssistant workspace={workspace} commit={setWorkspace} navigate={() => {}} popout storage={storage} /></main>;
}

export function App() {
  const surface = new URLSearchParams(window.location.search).get("surface");
  if (surface === "quick-capture") return <QuickCaptureSurface />;
  if (surface === "assistant") return <AssistantSurface />;
  return <WorkspaceApp />;
}
