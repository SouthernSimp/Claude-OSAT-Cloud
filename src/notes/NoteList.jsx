import { useEffect, useMemo, useRef } from "react";
import {
  Archive, ArrowCounterClockwise, CalendarBlank, FolderSimple, MagnifyingGlass, Plus, PushPin, SortAscending, Trash, X,
} from "@phosphor-icons/react";
import { Menu } from "../lib/Menu.jsx";
import { formatRelativeTime } from "../lib/ui.js";
import { SORTS, excerpt, folderPath, folderTree, isDayNote, notesInList, searchNotes, sortNotes } from "../notes-model.js";

const LIST_TITLES = {
  all: "All notes", pinned: "Pinned", recent: "Recent", daily: "Daily notes", unfiled: "Unfiled", archived: "Archive", trash: "Trash",
};

export function useVisibleNotes(workspace, ui) {
  return useMemo(() => {
    const scoped = notesInList(workspace, ui.list, ui.folderId);
    return sortNotes(searchNotes(scoped, ui.query, ui.tags), ui.sort);
  }, [workspace, ui.list, ui.folderId, ui.query, ui.tags, ui.sort]);
}

export function NoteList({ workspace, ui, setUi, notes, selectedId, selection, onSelect, onToggleSelect, actions }) {
  const listRef = useRef(null);
  const folder = ui.list === "folder" ? workspace.folders.find((item) => item.id === ui.folderId) : null;
  const title = folder ? folder.name : LIST_TITLES[ui.list] || "Notes";
  const trash = ui.list === "trash";
  const archive = ui.list === "archived";
  const canCreate = !trash && !archive;
  const folderOptions = [{ id: null, label: "Unfiled" }, ...folderTree(workspace.folders).map(({ folder: item, depth }) => ({ id: item.id, label: `${"  ".repeat(depth)}${item.name}` }))];

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
          <small>{notes.length} {notes.length === 1 ? "note" : "notes"}{ui.tags.length ? ` · ${ui.tags.map((tag) => `#${tag}`).join(" ")}` : ""}</small>
        </div>
        {trash && notes.length > 0 && (
          <button type="button" className="text-button danger" onClick={actions.emptyTrash}>Empty trash</button>
        )}
        {ui.list === "daily" && (
          <button type="button" className="text-button" onClick={actions.openToday}><CalendarBlank /> Today</button>
        )}
      </div>

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
                {note.pinned && <PushPin weight="fill" className="pin" />}
                <strong>{note.title || "Untitled note"}</strong>
                <time dateTime={note.updatedAt}>{formatRelativeTime(note.updatedAt)}</time>
              </div>
              <p>{excerpt(note.markdown) || <em>Nothing written yet</em>}</p>
              <div className="note-row-meta">
                {isDayNote(note) && <span className="meta-chip"><CalendarBlank /> Daily</span>}
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
