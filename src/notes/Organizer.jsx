import { useEffect, useRef, useState } from "react";
import {
  Archive, CalendarBlank, CaretRight, Clock, DotsThree, Folder, FolderPlus, FolderSimple, Hash, Notebook, PushPin, ShareNetwork, Trash, Tray,
} from "@phosphor-icons/react";
import { Menu } from "../lib/Menu.jsx";
import { canMoveFolder, folderSubtree, folderTree, isActiveNote, noteCounts, tagIndex } from "../notes-model.js";

const SMART = [
  ["all", "All notes", Notebook, "all"],
  ["pinned", "Pinned", PushPin, "pinned"],
  ["recent", "Recent", Clock, null],
  ["daily", "Daily notes", CalendarBlank, "daily"],
  ["unfiled", "Unfiled", Tray, "unfiled"],
  ["archived", "Archive", Archive, "archived"],
  ["trash", "Trash", Trash, "trashed"],
];

export function Organizer({ workspace, ui, setUi, actions, draftAt = 0 }) {
  const counts = noteCounts(workspace);
  const tags = tagIndex(workspace.notes);
  const [draft, setDraft] = useState(null); // { parentId, name } for a folder being created
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [dropTarget, setDropTarget] = useState(null);
  useEffect(() => { if (draftAt) setDraft({ parentId: null, name: "" }); }, [draftAt]);
  const tree = folderTree(workspace.folders);
  const folderCount = (folderId) => {
    const scope = folderSubtree(workspace.folders, folderId);
    return workspace.notes.filter((note) => isActiveNote(note) && scope.has(note.folderId)).length;
  };
  const pick = (list, folderId = null) => setUi({ list, folderId, query: "" });

  function onDrop(event, folderId) {
    event.preventDefault();
    setDropTarget(null);
    const raw = event.dataTransfer.getData("text/osat-notes");
    if (raw) {
      try { actions.moveNotes(JSON.parse(raw), folderId); } catch { /* not ours */ }
      return;
    }
    const folder = event.dataTransfer.getData("text/osat-folder");
    if (folder && folder !== folderId && canMoveFolder(workspace.folders, folder, folderId)) actions.moveFolder(folder, folderId);
  }
  const dropProps = (folderId) => ({
    onDragOver: (event) => {
      if (![...event.dataTransfer.types].some((type) => type === "text/osat-notes" || type === "text/osat-folder")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropTarget !== folderId) setDropTarget(folderId);
    },
    onDragLeave: () => setDropTarget((current) => (current === folderId ? null : current)),
    onDrop: (event) => onDrop(event, folderId),
  });

  return (
    <aside className="notes-organizer" aria-label="Notes organizer">
      <div className="organizer-head">
        <h2>Notes</h2>
        <button className="icon-button" type="button" title="New folder" aria-label="New folder" onClick={() => setDraft({ parentId: null, name: "" })}>
          <FolderPlus />
        </button>
      </div>

      <nav className="organizer-section" aria-label="Smart lists">
        {SMART.map(([id, label, Icon, countKey]) => (
          <button
            key={id}
            type="button"
            className={`organizer-row ${ui.list === id ? "active" : ""} ${dropTarget === `smart:${id}` ? "is-drop" : ""}`}
            onClick={() => pick(id)}
            {...(id === "unfiled" ? {
              onDragOver: (event) => { if ([...event.dataTransfer.types].includes("text/osat-notes")) { event.preventDefault(); setDropTarget("smart:unfiled"); } },
              onDragLeave: () => setDropTarget(null),
              onDrop: (event) => onDrop(event, null),
            } : {})}
          >
            <Icon weight={ui.list === id ? "fill" : "regular"} />
            <span>{label}</span>
            {countKey && counts[countKey] > 0 && <small>{counts[countKey]}</small>}
          </button>
        ))}
      </nav>

      <div className="organizer-label">
        <span>Folders</span>
        <button type="button" className="text-button" onClick={() => setDraft({ parentId: null, name: "" })}>New</button>
      </div>
      <nav className="organizer-section" aria-label="Folders">
        {draft && draft.parentId === null && (
          <FolderNameInput
            depth={0}
            value={draft.name}
            onChange={(name) => setDraft({ ...draft, name })}
            onCommit={() => { if (draft.name.trim()) actions.createFolder(draft.name, null); setDraft(null); }}
            onCancel={() => setDraft(null)}
          />
        )}
        {tree.map(({ folder, depth }) => {
          const hasChildren = workspace.folders.some((item) => item.parentId === folder.id);
          const active = ui.list === "folder" && ui.folderId === folder.id;
          return (
            <div key={folder.id}>
              {renaming?.id === folder.id ? (
                <FolderNameInput
                  depth={depth}
                  value={renaming.name}
                  onChange={(name) => setRenaming({ ...renaming, name })}
                  onCommit={() => { if (renaming.name.trim()) actions.renameFolder(folder.id, renaming.name); setRenaming(null); }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <div
                  className={`organizer-row folder-row ${active ? "active" : ""} ${dropTarget === folder.id ? "is-drop" : ""}`}
                  style={{ "--depth": depth }}
                  draggable
                  onDragStart={(event) => { event.dataTransfer.setData("text/osat-folder", folder.id); event.dataTransfer.effectAllowed = "move"; }}
                  {...dropProps(folder.id)}
                >
                  <button
                    type="button"
                    className={`caret ${hasChildren ? "" : "is-leaf"}`}
                    aria-label={folder.collapsed ? "Expand folder" : "Collapse folder"}
                    onClick={(event) => { event.stopPropagation(); if (hasChildren) actions.toggleFolder(folder.id); }}
                  >
                    <CaretRight style={{ rotate: folder.collapsed || !hasChildren ? "0deg" : "90deg" }} />
                  </button>
                  <button type="button" className="folder-main" onClick={() => pick("folder", folder.id)}>
                    {active ? <Folder weight="fill" /> : <FolderSimple />}
                    <span>{folder.name}</span>
                    <small>{folderCount(folder.id) || ""}</small>
                  </button>
                  <Menu
                    ariaLabel={`Actions for ${folder.name}`}
                    trigger={({ toggle, ariaLabel }) => (
                      <button type="button" className="row-menu" aria-label={ariaLabel} onClick={toggle}><DotsThree weight="bold" /></button>
                    )}
                    items={[
                      { label: "New note here", icon: Notebook, onSelect: () => actions.createNote(folder.id) },
                      { label: "New subfolder", icon: FolderPlus, onSelect: () => { if (folder.collapsed) actions.toggleFolder(folder.id); setDraft({ parentId: folder.id, name: "" }); } },
                      { label: "Rename", onSelect: () => setRenaming({ id: folder.id, name: folder.name }) },
                      { label: "Open as board", icon: ShareNetwork, onSelect: () => actions.openFolderBoard(folder.id) },
                      { divider: true },
                      { label: "Delete folder", hint: "keeps notes", danger: true, onSelect: () => actions.deleteFolder(folder.id) },
                    ]}
                  />
                </div>
              )}
              {draft && draft.parentId === folder.id && (
                <FolderNameInput
                  depth={depth + 1}
                  value={draft.name}
                  onChange={(name) => setDraft({ ...draft, name })}
                  onCommit={() => { if (draft.name.trim()) actions.createFolder(draft.name, folder.id); setDraft(null); }}
                  onCancel={() => setDraft(null)}
                />
              )}
            </div>
          );
        })}
        {!tree.length && !draft && (
          <button type="button" className="organizer-empty" onClick={() => setDraft({ parentId: null, name: "" })}>
            <FolderPlus /> Make your first folder
          </button>
        )}
      </nav>

      {tags.length > 0 && (
        <>
          <div className="organizer-label"><span>Tags</span>{ui.tags.length > 0 && <button type="button" className="text-button" onClick={() => setUi({ tags: [] })}>Clear</button>}</div>
          <div className="organizer-tags" role="group" aria-label="Filter by tag">
            {tags.map(({ tag, count }) => {
              const on = ui.tags.includes(tag);
              return (
                <button key={tag} type="button" className={`tag-toggle ${on ? "active" : ""}`} aria-pressed={on} onClick={() => setUi({ tags: on ? ui.tags.filter((item) => item !== tag) : [...ui.tags, tag] })}>
                  <Hash weight="bold" />{tag}<small>{count}</small>
                </button>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}

function FolderNameInput({ depth, value, onChange, onCommit, onCancel }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <div className="organizer-row folder-row is-editing" style={{ "--depth": depth }}>
      <FolderSimple />
      <input
        ref={ref}
        aria-label="Folder name"
        value={value}
        placeholder="Folder name"
        maxLength={80}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onCommit(); } if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}
        onBlur={onCommit}
      />
    </div>
  );
}
