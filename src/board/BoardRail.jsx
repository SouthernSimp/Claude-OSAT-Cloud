import { BookmarkSimple, CaretLeft, DotsThree, FolderSimple, Hash, Plus, ShareNetwork } from "@phosphor-icons/react";
import { Menu } from "../lib/Menu.jsx";
import { PAPERS, PAPER_LABEL, boardTagIndex, tagPaper } from "../board-model.js";
import { folderPath } from "../notes-model.js";

export function BoardRail({ workspace, doc, board, notesById, filter, setFilter, actions, onClose }) {
  const tags = boardTagIndex(board, notesById);
  const toggleTag = (tag) => setFilter((current) => ({ ...current, tags: current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : [...current.tags, tag] }));
  const scopeLabel = (item) => item.scope.kind === "all" ? "Every note" : item.scope.kind === "folder" ? folderPath(workspace.folders, item.scope.folderId).join(" / ") || "Folder" : "Curated";
  return (
    <aside className="board-rail" aria-label="Board panel">
      <div className="rail-head">
        <h2><ShareNetwork /> Mindmap</h2>
        <button type="button" className="icon-button" aria-label="Hide panel" title="Hide panel" onClick={onClose}><CaretLeft /></button>
      </div>

      <section className="rail-section">
        <div className="rail-label">
          <span>Boards <small>{doc.boards.length}</small></span>
          <button type="button" className="icon-button" aria-label="New board" title="New board" onClick={actions.newBoard}><Plus /></button>
        </div>
        <div className="rail-rows">
          {doc.boards.map((item) => (
            <div key={item.id} className={`rail-row board-row ${item.id === board.id ? "active" : ""}`}>
              <button type="button" className="rail-main" onClick={() => actions.switchBoard(item.id)}>
                {item.scope.kind === "folder" ? <FolderSimple /> : <ShareNetwork />}
                <span>{item.name}</span>
                <small>{item.notes.length}</small>
              </button>
              <Menu
                ariaLabel={`Actions for ${item.name}`}
                trigger={({ toggle, ariaLabel }) => <button type="button" className="row-menu" aria-label={ariaLabel} onClick={toggle}><DotsThree weight="bold" /></button>}
                items={[
                  { label: "Rename", onSelect: () => actions.renameBoard(item.id) },
                  { label: "Shows", hint: scopeLabel(item), disabled: true },
                  { label: "Show every note", checked: item.scope.kind === "all", onSelect: () => actions.setScope(item.id, { kind: "all", folderId: null }) },
                  { label: "Only notes I add", checked: item.scope.kind === "manual", onSelect: () => actions.setScope(item.id, { kind: "manual", folderId: null }) },
                  ...workspace.folders.map((folder) => ({ label: `Folder: ${folderPath(workspace.folders, folder.id).join(" / ")}`, checked: item.scope.kind === "folder" && item.scope.folderId === folder.id, onSelect: () => actions.setScope(item.id, { kind: "folder", folderId: folder.id }) })),
                  { divider: true },
                  { label: "Delete board", hint: "keeps notes", danger: true, disabled: doc.boards.length === 1, onSelect: () => actions.deleteBoard(item.id) },
                ]}
              />
            </div>
          ))}
        </div>
        <p className="rail-hint">{scopeLabel(board)}{board.scope.kind !== "manual" ? " · new notes land here" : " · add notes from Notes or the composer"}</p>
      </section>

      <section className="rail-section">
        <div className="rail-label">
          <span>Tags <small>{tags.length}</small></span>
          <span className="segmented mini" role="group" aria-label="Tag match">
            <button type="button" className={filter.mode === "any" ? "active" : ""} onClick={() => setFilter((current) => ({ ...current, mode: "any" }))}>Any</button>
            <button type="button" className={filter.mode === "all" ? "active" : ""} onClick={() => setFilter((current) => ({ ...current, mode: "all" }))}>All</button>
          </span>
        </div>
        {tags.length ? (
          <div className="rail-rows">
            {tags.map(({ tag, count }) => {
              const on = filter.tags.includes(tag);
              const paper = tagPaper(board, tag);
              return (
                <div key={tag} className={`rail-row tag-row ${on ? "active" : ""}`}>
                  <Menu
                    ariaLabel={`Colour for #${tag}`}
                    align="start"
                    trigger={({ toggle }) => <button type="button" className="swatch" data-paper={paper} title={`Paper colour: ${PAPER_LABEL[paper]}`} onClick={toggle} />}
                    items={PAPERS.map((color) => ({ label: PAPER_LABEL[color], checked: paper === color, onSelect: () => actions.setTagColor(tag, color) }))}
                  />
                  <button type="button" className="rail-main" aria-pressed={on} onClick={() => toggleTag(tag)}>
                    <span><Hash weight="bold" />{tag}</span>
                    <small>{count}</small>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rail-hint">Type <code>#</code> anywhere in a note and the tag shows up here.</p>
        )}
        <div className="rail-flags">
          <label><input type="checkbox" checked={filter.untagged} onChange={(event) => setFilter((current) => ({ ...current, untagged: event.target.checked }))} /> Untagged only</label>
          <label><input type="checkbox" checked={filter.unconnected} onChange={(event) => setFilter((current) => ({ ...current, unconnected: event.target.checked }))} /> Unconnected only</label>
          <label><input type="checkbox" checked={doc.showWikilinks} onChange={(event) => actions.setShowWikilinks(event.target.checked)} /> Show [[note links]]</label>
        </div>
      </section>

      <section className="rail-section">
        <div className="rail-label">
          <span>Views <small>{board.views.length}</small></span>
          <button type="button" className="icon-button" aria-label="Save current view" title="Save the current filter and camera as a view" onClick={actions.saveView}><BookmarkSimple /></button>
        </div>
        {board.views.length ? (
          <div className="rail-rows">
            {board.views.map((view) => (
              <div key={view.id} className="rail-row view-row">
                <button type="button" className="rail-main" onClick={() => actions.applyView(view)}>
                  <BookmarkSimple />
                  <span>{view.name}</span>
                  <small>{view.tags.length ? view.tags.map((tag) => `#${tag}`).join(" ") : view.query || ""}</small>
                </button>
                <Menu
                  ariaLabel={`Actions for view ${view.name}`}
                  trigger={({ toggle, ariaLabel }) => <button type="button" className="row-menu" aria-label={ariaLabel} onClick={toggle}><DotsThree weight="bold" /></button>}
                  items={[
                    { label: "Update to current", onSelect: () => actions.updateView(view.id) },
                    { label: "Rename", onSelect: () => actions.renameView(view.id) },
                    { divider: true },
                    { label: "Delete view", danger: true, onSelect: () => actions.deleteView(view.id) },
                  ]}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="rail-hint">Filter by a few tags, frame the board how you like it, then save it here.</p>
        )}
      </section>
    </aside>
  );
}
