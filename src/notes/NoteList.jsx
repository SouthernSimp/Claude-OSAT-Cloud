import { useEffect, useMemo, useRef } from "react";
import {
  Archive, ArrowCounterClockwise, CalendarBlank, FolderSimple, ListBullets, MagnifyingGlass, Plus, PushPin, SortAscending, Stack, Trash, TreeStructure, X,
} from "@phosphor-icons/react";
import { Menu } from "../lib/Menu.jsx";
import { formatRelativeTime } from "../lib/ui.js";
import { WHAT_LABEL, WHAT_PAPER, WHATS, whatOf, whenOf } from "../../shared/what-model.mjs";
import { CalendarChoice } from "../intake/CalendarChoice.jsx";
import { datesSettings, whenLine } from "../intake/dates.js";
import { SORTS, notePreview, folderPath, folderTree, isDayNote, isJustInList, isUnsorted, notesInList, searchNotes, sortNotes } from "../notes-model.js";
import { autoFileSettings, waitingFromBefore } from "../sky/auto-file.js";
import { useAutoFileStatus } from "../sky/useAutoFile.js";

const LIST_TITLES = {
  justin: "Just in", unsorted: "Just in", unfiled: "Just in", filed: "Just in", all: "All notes", pinned: "Pinned", recent: "Recent", daily: "Daily notes",
  archived: "Archive", trash: "Trash", questions: "Questions", buy: "To buy", coming: "Coming up",
};
// What the lists OSAT keeps say under their title, and what ticking a sticky off there means.
const KEPT = {
  questions: { line: "Every open question, from every board.", done: "Answered" },
  buy: { line: "Everything to buy, wherever you wrote it.", done: "Bought" },
  coming: { line: "Days your stickies name, soonest first.", done: "Done" },
};

export function useVisibleNotes(workspace, ui) {
  return useMemo(() => {
    const scoped = searchNotes(notesInList(workspace, ui.list, ui.folderId), ui.query, ui.tags);
    // Coming up keeps its own order: soonest first.
    return ui.list === "coming" ? scoped : sortNotes(scoped, ui.sort);
  }, [workspace, ui.list, ui.folderId, ui.query, ui.tags, ui.sort]);
}

export function NoteList({ workspace, ui, setUi, notes, selectedId, selection, onSelect, onToggleSelect, actions }) {
  const listRef = useRef(null);
  const folder = ui.list === "folder" ? workspace.folders.find((item) => item.id === ui.folderId) : null;
  const title = folder ? folder.name : LIST_TITLES[ui.list] || "Notes";
  const trash = ui.list === "trash";
  const archive = ui.list === "archived";
  const canCreate = !trash && !archive;
  const kept = KEPT[ui.list];
  const justIn = isJustInList(ui.list);
  const folderOptions = [{ id: null, label: "Just in" }, ...folderTree(workspace.folders).map(({ folder: item, depth }) => ({ id: item.id, label: `${"  ".repeat(depth)}${item.name}` }))];

  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-current="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const selectedIds = selection.size ? [...selection] : selectedId ? [selectedId] : [];
  const bulk = selection.size > 1;

  return (
    <section className="notes-list" aria-label="Note list">
      <div className="list-head">
        <label className="list-search">
          <MagnifyingGlass />
          <input
            value={ui.query}
            aria-label="Search notes"
            placeholder={folder ? `Search in ${folder.name}` : "Search notes, #tag"}
            onChange={(event) => setUi({ query: event.target.value })}
            onKeyDown={(event) => { if (event.key === "Escape" && ui.query) { event.preventDefault(); setUi({ query: "" }); } }}
          />
          {ui.query && <button type="button" className="clear" aria-label="Clear search" onClick={() => setUi({ query: "" })}><X /></button>}
        </label>
        <Menu
          ariaLabel="Sort notes"
          trigger={({ toggle, ariaLabel }) => <button type="button" className="icon-button" aria-label={ariaLabel} title="Sort" onClick={toggle}><SortAscending /></button>}
          items={SORTS.map(([id, label]) => ({ label, checked: ui.sort === id, onSelect: () => setUi({ sort: id }) }))}
        />
        {canCreate && (
          <button type="button" className="icon-button primary" aria-label="New note" title="New note (N)" onClick={() => actions.createNote(folder?.id || null)}>
            <Plus weight="bold" />
          </button>
        )}
      </div>

      <div className="list-title">
        <div>
          <h3>{title}</h3>
          <small>{kept ? kept.line : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`}{ui.tags.length ? ` · ${ui.tags.map((tag) => `#${tag}`).join(" ")}` : ""}</small>
        </div>
        {trash && notes.length > 0 && (
          <button type="button" className="text-button danger" onClick={actions.emptyTrash}>Empty trash</button>
        )}
        {ui.list === "daily" && (
          <button type="button" className="text-button" onClick={actions.openToday}><CalendarBlank /> Today</button>
        )}
        {justIn && notes.some(isUnsorted) && (
          <button type="button" className="text-button" onClick={actions.sortByHand}><Stack /> Sort by hand</button>
        )}
        {(folder || ui.list === "all") && (
          <div className="list-view-switch" role="group" aria-label="Show as">
            <button type="button" aria-pressed="true"><ListBullets /> List</button>
            <button type="button" aria-pressed="false" title={folder ? `${folder.name} as a board` : "Your boards"} onClick={() => actions.openCanvas(folder?.id || null)}><TreeStructure /> Board</button>
          </div>
        )}
      </div>

      {justIn && <FilingLine workspace={workspace} actions={actions} filedList />}
      {ui.list === "coming" && <DatesLine workspace={workspace} actions={actions} />}

      {bulk && (
        <div className="bulk-bar" role="toolbar" aria-label="Selected notes">
          <span>{selection.size} selected</span>
          {!trash && (
            <Menu
              ariaLabel="Move selected notes"
              trigger={({ toggle }) => <button type="button" onClick={toggle}><FolderSimple /> Move</button>}
              items={folderOptions.map((option) => ({ label: option.label, onSelect: () => actions.moveNotes(selectedIds, option.id) }))}
            />
          )}
          {!trash && (
            <Menu
              ariaLabel="Say what the selected notes are"
              trigger={({ toggle }) => <button type="button" onClick={toggle}>Kind</button>}
              items={WHATS.map((id) => ({ label: WHAT_LABEL[id], onSelect: () => actions.setWhat(selectedIds, id) }))}
            />
          )}
          {!trash && <button type="button" onClick={() => actions.setPinned(selectedIds, true)}><PushPin /> Pin</button>}
          {!trash && <button type="button" onClick={() => actions.setArchived(selectedIds, !archive)}><Archive /> {archive ? "Unarchive" : "Archive"}</button>}
          {trash ? (
            <>
              <button type="button" onClick={() => actions.restoreNotes(selectedIds)}><ArrowCounterClockwise /> Restore</button>
              <button type="button" className="danger" onClick={() => actions.purgeNotes(selectedIds)}><Trash /> Delete forever</button>
            </>
          ) : (
            <button type="button" className="danger" onClick={() => actions.trashNotes(selectedIds)}><Trash /> Trash</button>
          )}
          <button type="button" className="icon-button" aria-label="Clear selection" onClick={() => onToggleSelect(null)}><X /></button>
        </div>
      )}

      <div className="list-rows" ref={listRef} role="listbox" aria-label={title} aria-multiselectable="true">
        {notes.map((note) => {
          const path = folderPath(workspace.folders, note.folderId);
          const checked = selection.has(note.id);
          const what = whatOf(note);
          const when = ui.list === "coming" ? whenOf(note) : null;
          return (
            <div
              key={note.id}
              role="option"
              aria-selected={checked || note.id === selectedId}
              aria-current={note.id === selectedId ? "true" : undefined}
              tabIndex={0}
              className={`note-row ${note.id === selectedId ? "active" : ""} ${checked ? "checked" : ""}`}
              draggable={!trash}
              onDragStart={(event) => {
                const ids = checked ? [...selection] : [note.id];
                event.dataTransfer.setData("text/osat-notes", JSON.stringify(ids));
                event.dataTransfer.effectAllowed = "move";
              }}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) onToggleSelect(note.id);
                else if (event.shiftKey && selectedId) {
                  const ids = notes.map((item) => item.id);
                  const [a, b] = [ids.indexOf(selectedId), ids.indexOf(note.id)].sort((x, y) => x - y);
                  onToggleSelect(ids.slice(a, b + 1));
                } else onSelect(note.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(note.id); }
                if (event.key === "ArrowDown") { event.preventDefault(); event.currentTarget.nextElementSibling?.focus(); }
                if (event.key === "ArrowUp") { event.preventDefault(); event.currentTarget.previousElementSibling?.focus(); }
              }}
            >
              <div className="note-row-title">
                {kept && (
                  <label className="note-done" title={kept.done} onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" aria-label={`${kept.done}: ${note.title || "this note"}`} checked={Boolean(note.doneAt)} onChange={(event) => actions.setDone([note.id], event.target.checked, kept.done)} />
                  </label>
                )}
                {note.pinned && <PushPin weight="fill" className="pin" />}
                <strong>{note.title || "Untitled note"}</strong>
                <time dateTime={note.updatedAt}>{formatRelativeTime(note.updatedAt)}</time>
              </div>
              {/* A one-line sticky is all title: nothing more to show, rather than "Nothing written yet". */}
              {(note.gist || notePreview(note)) ? <p>{note.gist || notePreview(note)}</p> : !note.markdown.trim() && <p><em>Nothing written yet</em></p>}
              <div className="note-row-meta">
                {what && (
                  <Menu
                    align="start"
                    ariaLabel={`What this is: ${WHAT_LABEL[what]}. Change it`}
                    trigger={({ toggle, ariaLabel }) => (
                      <button type="button" className="meta-kind" data-paper={WHAT_PAPER[what]} aria-label={ariaLabel} title="What this is" onClick={toggle}>{WHAT_LABEL[what]}</button>
                    )}
                    items={WHATS.map((id) => ({ label: WHAT_LABEL[id], checked: id === what, onSelect: () => actions.setWhat([note.id], id) }))}
                  />
                )}
                {when && <span className="meta-chip"><CalendarBlank /> {whenLine(when)}</span>}
                {when && (note.cal?.id
                  ? <button type="button" className="meta-action" title="Take it off the calendar" onClick={(event) => { event.stopPropagation(); actions.takeOffCalendar(note.id); }}>On your calendar · Take off</button>
                  : <button type="button" className="meta-action" onClick={(event) => { event.stopPropagation(); actions.putOnCalendar(note, when); }}>Put on calendar</button>)}
                {!when && note.cal?.id && <span className="meta-chip"><CalendarBlank /> On your calendar</span>}
                {isDayNote(note) && <span className="meta-chip"><CalendarBlank /> Daily</span>}
                {justIn && isUnsorted(note) && <span className="meta-chip">Needs a home</span>}
                {path.length > 0 && ui.list !== "folder" && <span className="meta-chip"><FolderSimple /> {path.join(" / ")}</span>}
                {note.tags.slice(0, 3).map((tag) => <span key={tag} className="meta-tag">#{tag}</span>)}
                {note.tags.length > 3 && <span className="meta-tag">+{note.tags.length - 3}</span>}
              </div>
            </div>
          );
        })}
        {!notes.length && (
          <div className="list-empty">
            {trash ? <p>Trash is empty.</p> : archive ? <p>Nothing archived.</p> : ui.query || ui.tags.length ? (
              <>
                <p>No notes match.</p>
                <button type="button" className="text-button" onClick={() => setUi({ query: "", tags: [] })}>Clear filters</button>
              </>
            ) : (
              <>
                <p>{folder ? `Nothing in ${folder.name} yet.` : "No notes here yet."}</p>
                <button type="button" className="outline-button" onClick={() => actions.createNote(folder?.id || null)}><Plus /> New note</button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* Where new dates go, in one line, with the calendar to choose (Phase 67). */
function DatesLine({ workspace, actions }) {
  const { on } = datesSettings(workspace.settings);
  return (
    <div className="filing-line" role="status">
      {on ? (
        <p className="dates-line">New dates go on <CalendarChoice workspace={workspace} commit={actions.commit} /></p>
      ) : (
        <p>New dates stay in their stickies. <button type="button" className="text-button" onClick={() => actions.datesOn(true)}>Put them on my calendar</button></p>
      )}
    </div>
  );
}

/* What filing on its own is doing, in one calm line, and the way forward when it can't. */
function FilingLine({ workspace, actions, filedList }) {
  const status = useAutoFileStatus();
  const { on, since } = autoFileSettings(workspace.settings);
  if (!on && !filedList) return null;
  const before = on && since ? waitingFromBefore(workspace, since) : 0;
  const count = (n) => `${n} ${n === 1 ? "sticky" : "stickies"}`;
  let line;
  if (!on) line = filedList ? "The AI doesn’t file stickies for you right now." : null;
  else if (status.state === "filing") line = `Filing ${count(status.count)}…`;
  else if (status.state === "waiting") line = "New stickies are filed once you stop writing for a moment.";
  else if (status.state === "no-ai") line = `${count(status.count)} wait for the AI. Set it up in Settings → AI.`;
  else if (status.state === "resting") line = `The AI couldn’t file ${count(status.count)} just now (${status.message}). It tries again in a few minutes.`;
  else if (filedList) line = "The AI files new stickies once you stop writing. Moving one yourself takes it off this list.";
  if (!line && !before) return null;
  return (
    <div className="filing-line" role="status">
      {line && <p>{line}</p>}
      {!on && <button type="button" className="text-button" onClick={() => actions.autoFile({ on: true })}>File new stickies for me</button>}
      {before > 0 && (
        <p>
          {count(before)} from before {before === 1 ? "waits" : "wait"} in Just in.{" "}
          <button type="button" className="text-button" onClick={() => actions.autoFile({ since: new Date(0).toISOString() })}>File {before === 1 ? "it" : "them"} too</button>
        </p>
      )}
    </div>
  );
}
