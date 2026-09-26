import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Database, Plus, X } from "@phosphor-icons/react";


import { LocalAssistant } from "./assistant/LocalAssistant.jsx";
import { BrowserView } from "./tools/Browser.jsx";
import { TerminalView } from "./tools/Terminal.jsx";
import { FieldDesk } from "./field/FieldDesk.jsx";
import { FieldSky } from "./field/FieldSky.jsx";
import { addFieldSample, hasFieldSample, removeFieldSample } from "./field/field-sample.js";
import { BLANK_KEY } from "./field/field-model.js";


import { CalendarView } from "./views/Calendar.jsx";
import { CommandPalette } from "./views/CommandPalette.jsx";
import { FilesView } from "./views/Files.jsx";
import { HabitsView } from "./views/Habits.jsx";
import { InboxView } from "./views/Inbox.jsx";
import { JournalView } from "./views/Journal.jsx";
import { NotesView } from "./notes/NotesView.jsx";
import { BoardView } from "./board/BoardView.jsx";
import { BudgetView } from "./views/Budget.jsx";
import { ProjectsView } from "./views/Projects.jsx";
import { ReflectionView } from "./views/Reflection.jsx";
import { SettingsView } from "./views/Settings.jsx";

import { localDateKey } from "./daily-practice.js";
import { captureThought, isActiveNote } from "./notes-model.js";
import { storageFrom, useWorkspace } from "./store/useWorkspace.js";
import { OverlaySurface } from "./surfaces/Overlay.jsx";
import { inputActive } from "./lib/ui.js";
import { useFocusTrap } from "./lib/use-focus-trap.js";
import { SETTINGS, spaceFor, spaceForKey, titleFor } from "./lib/spaces.js";
import { GlassDefs, useAlive } from "./shell/glass.jsx";
import { Dock, RoomSheet } from "./shell/Shell.jsx";
import { Welcome } from "./shell/Welcome.jsx";

const FILLED_VIEWS = new Set(["Mindmap", "Assistant", "Notes", "Calendar", "Sky", "Browser", "Terminal"]);

function WorkspaceApp() {
  const { workspace, status, commit, ready } = useWorkspace();
  const hydrated = Boolean(ready && workspace);
  const storage = storageFrom(status, hydrated);
  const [view, setView] = useState("Today");
  const [closing, setClosing] = useState(false);
  // While a sheet grows out of the desk it is scaled down; native views wait until it has risen.
  const [rising, setRising] = useState(false);
  const [origin, setOrigin] = useState(null);
  const [notesTarget, setNotesTarget] = useState(null);
  const [boardTarget, setBoardTarget] = useState(null);
  const [calendarTarget, setCalendarTarget] = useState(null);
  const [assistantTarget, setAssistantTarget] = useState(null);
  const [settingsTarget, setSettingsTarget] = useState(null);
  const [skyTarget, setSkyTarget] = useState(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [roomCommand, setRoomCommand] = useState(null);
  const [sampleHidden, setSampleHidden] = useState(() => localStorage.getItem(BLANK_KEY) === "1");
  const [deskSheet, setDeskSheet] = useState(null);
  const [focusAt, setFocusAt] = useState(0);
  const [draft, setDraft] = useState("");
  const [welcome, setWelcome] = useState(false);
  const modalRef = useRef(null);
  const pointer = useRef({ x: 0, y: 0, at: 0 });
  const today = localDateKey();
  const closeCapture = useCallback(() => setCaptureOpen(false), []);
  const closeCommands = useCallback(() => setCommandOpen(false), []);
  useFocusTrap(modalRef, captureOpen, closeCapture);
  useAlive();

  /* The first launch on this Mac starts with the welcome. */
  useEffect(() => {
    window.osatApp?.needsWelcome?.().then((need) => setWelcome(need === true)).catch(() => {});
  }, []);

  /* Sheets grow out of the point you clicked, so remember it. */
  useEffect(() => {
    const down = (event) => { pointer.current = { x: event.clientX, y: event.clientY, at: Date.now() }; };
    addEventListener("pointerdown", down, true);
    return () => removeEventListener("pointerdown", down, true);
  }, []);

  useEffect(() => {
    if (view !== "Today") document.querySelector(".sheet-title")?.focus({ preventScroll: true });
  }, [view]);

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
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandQuery("");
        setCommandOpen((open) => !open);
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && spaceForKey(event.key)) {
        event.preventDefault();
        latest.current?.navigate(spaceForKey(event.key));
        return;
      }
      if (mod && event.key === ",") {
        event.preventDefault();
        latest.current?.navigate(SETTINGS.id);
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCaptureOpen(true);
        return;
      }
      if (!mod && event.key.toLowerCase() === "n" && !inputActive() && !["Mindmap", "Notes", "Today", "Sky", "Terminal"].includes(view)) {
        event.preventDefault();
        setCaptureOpen(true);
        return;
      }
      // Esc backs out one step: out of a field, then out of the room, back to the desk.
      if (event.key === "Escape" && !event.defaultPrevented && view !== "Today" && !commandOpen && !captureOpen) {
        const active = document.activeElement;
        if (active?.closest?.(".xterm, .browser-view")) return;
        if (inputActive()) { active.blur(); return; }
        latest.current?.navigate("Today");
      }
    };
    addEventListener("keydown", keydown);
    return () => removeEventListener("keydown", keydown);
  }, [view, commandOpen, captureOpen]);

  function originFor(next) {
    const recent = Date.now() - pointer.current.at < 700;
    if (recent) return { x: pointer.current.x, y: pointer.current.y };
    const id = spaceFor(next)?.id;
    const button = document.querySelector(`.app-dock [data-space="${id}"]`) || document.querySelector('.app-dock [data-space="tools"]');
    const box = button?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: innerWidth / 2, y: innerHeight };
  }

  function navigate(next, detail = null) {
    if (next === "Capture") {
      setCaptureOpen(true);
      return;
    }
    // The Obsidian export lives in Settings → Data now.
    if (next === "Obsidian") { navigate("Settings", { section: "data" }); return; }
    if (next === "Settings") setSettingsTarget(detail?.section ? { section: detail.section, at: Date.now() } : null);
    if (next === "Notes") setNotesTarget(detail ? { ...(typeof detail === "string" ? { noteId: detail } : detail), at: Date.now() } : null);
    if (next === "Sky") setSkyTarget(typeof detail?.noteId === "string" ? { noteId: detail.noteId, at: Date.now() } : null);
    if (next === "Mindmap") setBoardTarget(detail && typeof detail === "object" ? { ...detail, at: Date.now() } : null);
    if (next === "Calendar") setCalendarTarget(detail?.date || null);
    if (next === "Today" && detail && typeof detail === "object" && typeof detail.noteId === "string") setDeskSheet({ id: detail.noteId, at: Date.now() });
    if (next === "Assistant") setAssistantTarget(typeof detail?.prompt === "string" || typeof detail?.chatId === "string" ? { ...detail, at: Date.now() } : null);
    setCommandOpen(false);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Back to the desk: the sheet sinks into its place in the dock.
    if (next === "Today") {
      if (view === "Today") return;
      if (reduced) { setView("Today"); return; }
      const button = document.querySelector(`.app-dock [data-space="${spaceFor(view)?.id}"]`) || document.querySelector('.app-dock [data-space="tools"]');
      const box = button?.getBoundingClientRect();
      if (box) setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      setClosing(true);
      return;
    }
    // From the desk: the room rises out of what you clicked.
    if (view === "Today" || closing) {
      setClosing(false);
      setRising(!reduced);
      setOrigin(originFor(next));
      setView(next);
      return;
    }
    if (next === view) return;
    // Room to room: the page inside the sheet changes; Board and Sky zoom into each other.
    if (reduced || !document.startViewTransition) { setView(next); return; }
    const kind = view === "Mindmap" && next === "Sky" ? "zoom-out" : view === "Sky" && next === "Mindmap" ? "zoom-in" : "room";
    document.documentElement.dataset.vt = kind;
    document.startViewTransition(() => flushSync(() => setView(next))).finished.finally(() => { delete document.documentElement.dataset.vt; });
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
            <p>{storage.status === "error" ? `${storage.message} Nothing has been changed.` : "Your notes stay on this Mac."}</p>
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
      navigate("Today");
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
  latest.current = { navigate, openCommands };
  const open = view !== "Today";
  const wallpaper = workspace.settings?.wallpaper === "moss" ? "moss" : "lake";

  return (
    <main className="app-shell field-app">
      <GlassDefs />
      <section className={`workspace is-home ${open && !closing ? "has-sheet" : ""}`} aria-label="OSAT workspace" inert={captureOpen || commandOpen || welcome || undefined}>
        <div className="workspace-content is-filled desk-layer" data-view="Today" inert={open && !closing ? true : undefined}>
          <FieldDesk
            {...common}
            {...room}
            today={today}
            sheet={deskSheet}
            onSheetDone={() => setDeskSheet(null)}
            storage={storage}
            onSearch={openCommands}
            wallpaper={wallpaper}
            focusAt={focusAt}
            dock={<span className="dock-slot" aria-hidden="true" />}
          />
        </div>
        {open && <div className={`sheet-scrim ${closing ? "is-closing" : ""}`} aria-hidden="true" onPointerDown={() => navigate("Today")} />}
        {open && (
          <RoomSheet
            view={view}
            title={titleFor(view)}
            origin={origin}
            closing={closing}
            filled={FILLED_VIEWS.has(view)}
            onClose={() => navigate("Today")}
            onClosed={() => { setClosing(false); setView("Today"); }}
            onRisen={() => setRising(false)}
            onSearch={() => openCommands()}
            onMode={(mode) => navigate(mode)}
          >
            {view === "Sky" && <FieldSky {...common} {...room} target={skyTarget} />}
            {view === "Assistant" && <LocalAssistant {...common} initialPrompt={assistantTarget} />}
            {view === "Browser" && <BrowserView {...common} covered={captureOpen || commandOpen || closing || rising} command={roomCommand} />}
            {view === "Terminal" && <TerminalView command={roomCommand} />}
            {view === "Inbox" && <InboxView {...common} />}
            {view === "Notes" && <NotesView {...common} target={notesTarget} today={today} />}
            {view === "Mindmap" && <BoardView {...common} boardTarget={boardTarget} />}
            {view === "Projects" && <ProjectsView {...common} />}
            {view === "Budget" && <BudgetView {...common} />}
            {view === "Calendar" && <CalendarView {...common} initialDate={calendarTarget} />}
            {view === "Habits" && <HabitsView {...common} today={today} />}
            {view === "Reflection" && <ReflectionView {...common} today={today} />}
            {view === "Journal" && <JournalView {...common} />}
            {view === "Files" && <FilesView />}
                        {view === "Settings" && <SettingsView {...common} storage={storage} target={settingsTarget} />}
          </RoomSheet>
        )}
        <Dock
          view={closing ? "Today" : view}
          navigate={navigate}
          storage={storage}
          workspace={workspace}
          commit={commit}
          onSearch={() => openCommands()}
          onCapture={() => setCaptureOpen(true)}
          onFocus={() => { navigate("Today"); setFocusAt(Date.now()); }}
        />
      </section>

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
              <span>It waits in Unsorted until you give it a home.</span>
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
      {welcome && <Welcome onDone={() => setWelcome(false)} />}
    </main>
  );
}

export function App() {
  const surface = new URLSearchParams(window.location.search).get("surface");
  if (surface === "overlay") return <OverlaySurface />;
  return <WorkspaceApp />;
}
