import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArrowCounterClockwise, ArrowLeft, ArrowUpRight, CheckSquare, Code, Copy, CopySimple, DotsThree, FolderSimple, Hash, Link as LinkIcon,
  LinkSimple, ListBullets, ListNumbers, Minus, PushPin, Quotes, ShareNetwork, Sidebar, TextB, TextHOne, TextItalic, TextStrikethrough, Trash, BracketsSquare, MoonStars } from "@phosphor-icons/react";
import { Markdown } from "../lib/markdown.jsx";
import { Menu } from "../lib/Menu.jsx";
import { formatRelativeTime } from "../lib/ui.js";
import { backlinks, folderPath, folderTree, isActiveNote, outgoingLinks, outline, resolveWikilink, wordCount } from "../notes-model.js";
import { caretPosition } from "./caret.js";
import {
  applyAutocomplete, autocompleteContext, continueList, indentLines, insertAtCaret, setHeading, toggleLinePrefix, toggleTaskAt,
  toggleTaskAtCaret, wrapSelection,
} from "./editor-commands.js";

const MODES = [["write", "Write"], ["split", "Split"], ["read", "Read"]];

export function NoteEditor({ workspace, note, ui, setUi, actions, onBack }) {
  const textareaRef = useRef(null);
  const titleAtFocus = useRef(null);
  const [complete, setComplete] = useState(null); // { context, items, cursor, top, left }
  const [pendingSelection, setPendingSelection] = useState(null);
  const trashed = Boolean(note.trashedAt);
  const mode = trashed ? "read" : ui.mode;
  const path = folderPath(workspace.folders, note.folderId);
  const folderOptions = [{ id: null, label: "Unfiled" }, ...folderTree(workspace.folders).map(({ folder, depth }) => ({ id: folder.id, label: `${"  ".repeat(depth)}${folder.name}` }))];
  const boards = (workspace.sorter?.boards || []).filter((board) => board.notes.some((card) => card.id === note.id));
  const tasks = useMemo(() => {
    const lines = note.markdown.split("\n").filter((line) => /^\s*[-*+]\s+\[[ xX]\]\s+\S/.test(line));
    return { total: lines.length, done: lines.filter((line) => /\[[xX]\]/.test(line)).length };
  }, [note.markdown]);

  // Restore caret after a programmatic edit (React re-renders the textarea value first).
  useLayoutEffect(() => {
    if (!pendingSelection || !textareaRef.current) return;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(pendingSelection.start, pendingSelection.end);
    setPendingSelection(null);
  }, [pendingSelection]);

  const current = () => {
    const element = textareaRef.current;
    return { text: note.markdown, start: element?.selectionStart ?? note.markdown.length, end: element?.selectionEnd ?? note.markdown.length };
  };
  const apply = useCallback((result) => {
    if (!result) return;
    actions.updateNote(note.id, { markdown: result.text });
    setPendingSelection({ start: result.start, end: result.end });
  }, [actions, note.id]);

  const commands = {
    bold: () => apply(wrapSelection(current(), "**", "**", "bold")),
    italic: () => apply(wrapSelection(current(), "_", "_", "italic")),
    strike: () => apply(wrapSelection(current(), "~~", "~~", "struck")),
    code: () => apply(wrapSelection(current(), "`", "`", "code")),
    link: () => {
      const state = current();
      const selected = state.text.slice(state.start, state.end);
      apply(selected ? insertAtCaret(state, `[${selected}](https://)`, selected.length + 3, selected.length + 11) : insertAtCaret(state, "[link](https://)", 1, 5));
    },
    wikilink: () => {
      const state = current();
      const selected = state.text.slice(state.start, state.end);
      const next = insertAtCaret(state, `[[${selected}]]`, 2, 2 + selected.length);
      apply(next);
      setTimeout(() => refreshAutocomplete(), 0);
    },
    tag: () => { apply(insertAtCaret(current(), "#")); setTimeout(() => refreshAutocomplete(), 0); },
    bullet: () => apply(toggleLinePrefix(current(), "bullet")),
    ordered: () => apply(toggleLinePrefix(current(), "ordered")),
    task: () => apply(toggleLinePrefix(current(), "task")),
    quote: () => apply(toggleLinePrefix(current(), "quote")),
    rule: () => apply(insertAtCaret(current(), "\n---\n")),
    heading: (level) => apply(setHeading(current(), level)),
  };

  function refreshAutocomplete() {
    const element = textareaRef.current;
    if (!element) return;
    const context = autocompleteContext(element.value, element.selectionEnd);
    if (!context) { setComplete(null); return; }
    const query = context.query.toLowerCase();
    let items = [];
    if (context.kind === "wikilink") {
      items = workspace.notes.filter((item) => isActiveNote(item) && item.id !== note.id && item.title.toLowerCase().includes(query))
        .sort((a, b) => a.title.toLowerCase().indexOf(query) - b.title.toLowerCase().indexOf(query) || a.title.localeCompare(b.title))
        .slice(0, 8).map((item) => ({ value: item.title, label: item.title, hint: folderPath(workspace.folders, item.folderId).join(" / ") }));
      if (context.query.trim() && !items.some((item) => item.value.toLowerCase() === query)) items.push({ value: context.query.trim(), label: `Create “${context.query.trim()}”`, hint: "new note", create: true });
    } else {
      const counts = new Map();
      workspace.notes.filter(isActiveNote).forEach((item) => item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
      items = [...counts.entries()].filter(([tag]) => tag.includes(query) && tag !== query).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([tag, count]) => ({ value: tag, label: `#${tag}`, hint: `${count}` }));
    }
    if (!items.length) { setComplete(null); return; }
    const position = caretPosition(element, context.from);
    setComplete({ context, items, cursor: 0, top: position.top + position.lineHeight + 4, left: Math.min(position.left, element.clientWidth - 280) });
  }

  function choose(item) {
    const element = textareaRef.current;
    const state = { text: element.value, start: element.selectionStart, end: element.selectionEnd };
    apply(applyAutocomplete(state, complete.context, item.value));
    setComplete(null);
  }

  function onKeyDown(event) {
    const meta = event.metaKey || event.ctrlKey;
    if (complete) {
      if (event.key === "ArrowDown") { event.preventDefault(); setComplete({ ...complete, cursor: (complete.cursor + 1) % complete.items.length }); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setComplete({ ...complete, cursor: (complete.cursor - 1 + complete.items.length) % complete.items.length }); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); choose(complete.items[complete.cursor]); return; }
      if (event.key === "Escape") { event.preventDefault(); setComplete(null); return; }
    }
    if (event.key === "Escape") { event.currentTarget.blur(); return; }
    if (meta && !event.shiftKey && event.key.toLowerCase() === "b") { event.preventDefault(); commands.bold(); return; }
    if (meta && !event.shiftKey && event.key.toLowerCase() === "i") { event.preventDefault(); commands.italic(); return; }
    if (meta && !event.shiftKey && event.key.toLowerCase() === "e") { event.preventDefault(); commands.code(); return; }
    if (meta && event.shiftKey && event.key.toLowerCase() === "x") { event.preventDefault(); commands.strike(); return; }
    if (meta && event.shiftKey && event.key.toLowerCase() === "l") { event.preventDefault(); commands.link(); return; }
    if (meta && event.shiftKey && event.key.toLowerCase() === "k") { event.preventDefault(); commands.wikilink(); return; }
    if (meta && event.key === "Enter") { event.preventDefault(); apply(toggleTaskAtCaret(current())); return; }
    if (event.key === "Tab") {
      const state = current();
      const line = state.text.slice(state.text.lastIndexOf("\n", state.start - 1) + 1, state.start);
      if (state.start !== state.end || /^\s*([-*+]|\d+[.)])\s/.test(line)) { event.preventDefault(); apply(indentLines(state, event.shiftKey)); }
      return;
    }
    if (event.key === "Enter" && !meta && !event.shiftKey) {
      const next = continueList(current());
      if (next) { event.preventDefault(); apply(next); }
    }
  }

  const readHandlers = {
    onToggleTask: trashed ? null : (line) => actions.updateNote(note.id, { markdown: toggleTaskAt(note.markdown, line) }),
    onWikilink: (target) => actions.openWikilink(target, note.folderId),
    onTag: (tag) => setUi({ tags: [tag], list: "all", folderId: null }),
    resolves: (target) => Boolean(resolveWikilink(workspace.notes, target)),
    headingIds: true,
  };

  const writing = mode !== "read";
  const menuItems = [
    { label: note.pinned ? "Unpin" : "Pin to top", icon: PushPin, onSelect: () => actions.setPinned([note.id], !note.pinned) },
    { label: note.archived ? "Unarchive" : "Archive", icon: Archive, onSelect: () => actions.setArchived([note.id], !note.archived) },
    { label: "Duplicate", icon: CopySimple, onSelect: () => actions.duplicateNote(note.id) },
    { label: "See on the Map", icon: ShareNetwork, onSelect: () => actions.showOnBoard(note.id, boards[0]?.id) },
    ...(isActiveNote(note) ? [{ label: "See in the Sky", icon: MoonStars, onSelect: () => actions.showInSky(note.id) }] : []),
    { label: "Copy as Markdown", icon: Copy, onSelect: () => navigator.clipboard?.writeText(`# ${note.title}\n\n${note.markdown}`) },
    { divider: true },
    { label: "Move to Trash", icon: Trash, danger: true, onSelect: () => actions.trashNotes([note.id]) },
  ];

  return (
    <section className={`note-editor mode-${mode} ${ui.inspector ? "with-inspector" : ""}`} aria-label="Note editor">
      <header className="editor-bar">
        <button type="button" className="icon-button back" aria-label="Back to list" onClick={onBack}><ArrowLeft /></button>
        {trashed ? (
          <span className="editor-crumb"><Trash /> In Trash</span>
        ) : (
          <Menu
            ariaLabel="Move to folder"
            align="start"
            trigger={({ toggle }) => (
              <button type="button" className="editor-crumb" onClick={toggle} title="Move to folder">
                <FolderSimple />
                <span>{path.length ? path.join(" / ") : "Unfiled"}</span>
              </button>
            )}
            items={folderOptions.map((option) => ({ label: option.label, checked: (note.folderId || null) === option.id, onSelect: () => actions.moveNotes([note.id], option.id) }))}
          />
        )}
        <div className="editor-bar-spacer" />
        {!trashed && (
          <div className="segmented" role="tablist" aria-label="Editor mode">
            {MODES.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? "active" : ""} onClick={() => setUi({ mode: id })}>{label}</button>
            ))}
          </div>
        )}
        <button type="button" className={`icon-button ${ui.inspector ? "active" : ""}`} aria-label="Toggle note details" aria-pressed={ui.inspector} title="Details" onClick={() => setUi({ inspector: !ui.inspector })}>
          <Sidebar />
        </button>
        {trashed ? (
          <>
            <button type="button" className="outline-button" onClick={() => actions.restoreNotes([note.id])}><ArrowCounterClockwise /> Restore</button>
            <button type="button" className="danger-button outline-button" onClick={() => actions.purgeNotes([note.id])}>Delete forever</button>
          </>
        ) : (
          <Menu
            ariaLabel="Note actions"
            trigger={({ toggle, ariaLabel }) => <button type="button" className="icon-button" aria-label={ariaLabel} onClick={toggle}><DotsThree weight="bold" /></button>}
            items={menuItems}
          />
        )}
      </header>

      <div className="editor-body">
        <div className="editor-column">
          <input
            className="note-title"
            aria-label="Note title"
            value={note.title}
            placeholder="Untitled note"
            readOnly={trashed}
            onChange={(event) => actions.updateNote(note.id, { title: event.target.value })}
            onFocus={() => { titleAtFocus.current = note.title; }}
            onBlur={() => { if (titleAtFocus.current !== null && titleAtFocus.current !== note.title) actions.relinkTitle(titleAtFocus.current, note.title); titleAtFocus.current = null; }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); textareaRef.current?.focus(); } }}
          />
          <div className="note-tags-row">
            {note.pinned && <span className="meta-chip pinned"><PushPin weight="fill" /> Pinned</span>}
            {note.archived && <span className="meta-chip"><Archive /> Archived</span>}
            {note.tags.map((tag) => (
              <button key={tag} type="button" className="meta-tag" onClick={() => setUi({ tags: [tag], list: "all", folderId: null })}>#{tag}</button>
            ))}
            {!note.tags.length && !trashed && <button type="button" className="meta-tag ghost" onClick={() => { textareaRef.current?.focus(); commands.tag(); }}><Hash /> add a tag</button>}
          </div>

          {writing && (
            <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
              <Menu
                ariaLabel="Heading"
                align="start"
                trigger={({ toggle }) => <button type="button" title="Heading" aria-label="Heading" onClick={toggle}><TextHOne /></button>}
                items={[["Heading 1", 1], ["Heading 2", 2], ["Heading 3", 3], ["Plain text", 0]].map(([label, level]) => ({ label, onSelect: () => commands.heading(level) }))}
              />
              <button type="button" title="Bold (⌘B)" aria-label="Bold" onClick={commands.bold}><TextB /></button>
              <button type="button" title="Italic (⌘I)" aria-label="Italic" onClick={commands.italic}><TextItalic /></button>
              <span className="toolbar-gap" />
              <button type="button" title="Bulleted list" aria-label="Bulleted list" onClick={commands.bullet}><ListBullets /></button>
              <button type="button" title="Checklist (⌘↩ toggles)" aria-label="Checklist" onClick={commands.task}><CheckSquare /></button>
              <span className="toolbar-gap" />
              <button type="button" title="Link to a note (⇧⌘K)" aria-label="Link to a note" onClick={commands.wikilink}><BracketsSquare /></button>
              <Menu
                ariaLabel="More formatting"
                trigger={({ toggle, ariaLabel }) => <button type="button" title={ariaLabel} aria-label={ariaLabel} onClick={toggle}><DotsThree weight="bold" /></button>}
                items={[
                  { label: "Numbered list", icon: ListNumbers, onSelect: commands.ordered },
                  { label: "Strikethrough", icon: TextStrikethrough, onSelect: commands.strike },
                  { label: "Inline code", icon: Code, onSelect: commands.code },
                  { label: "Quote", icon: Quotes, onSelect: commands.quote },
                  { label: "Divider", icon: Minus, onSelect: commands.rule },
                  { label: "Link", icon: LinkSimple, onSelect: commands.link },
                  { label: "Tag", icon: Hash, onSelect: commands.tag },
                ]}
              />
            </div>
          )}

          <div className={`editor-panes mode-${mode}`}>
            {writing && (
              <div className="write-pane">
                <textarea
                  ref={textareaRef}
                  className="note-source"
                  aria-label="Note text"
                  spellCheck="true"
                  value={note.markdown}
                  placeholder={"Start writing. Use #tags to organize, [[Note title]] to link, and - [ ] for next steps."}
                  onChange={(event) => { actions.updateNote(note.id, { markdown: event.target.value }); setTimeout(refreshAutocomplete, 0); }}
                  onKeyDown={onKeyDown}
                  onClick={() => setComplete(null)}
                  onBlur={() => setTimeout(() => setComplete(null), 120)}
                />
                {complete && (
                  <div className="autocomplete" role="listbox" style={{ top: complete.top, left: Math.max(0, complete.left) }}>
                    {complete.items.map((item, index) => (
                      <button
                        key={`${item.value}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === complete.cursor}
                        className={`${index === complete.cursor ? "active" : ""} ${item.create ? "create" : ""}`}
                        onMouseDown={(event) => { event.preventDefault(); choose(item); }}
                        onMouseEnter={() => setComplete({ ...complete, cursor: index })}
                      >
                        {complete.context.kind === "wikilink" ? <BracketsSquare /> : <Hash />}
                        <span>{item.label}</span>
                        {item.hint && <small>{item.hint}</small>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {mode !== "write" && (
              <div className="read-pane">
                {note.markdown.trim() ? (
                  <Markdown text={note.markdown} className="note-read" {...readHandlers} />
                ) : (
                  <p className="read-empty">Nothing written yet.</p>
                )}
              </div>
            )}
          </div>

          <footer className="editor-foot">
            <span>{wordCount(note.markdown)} words</span>
            {tasks.total > 0 && <span>{tasks.done}/{tasks.total} steps done</span>}
            <span>Edited {formatRelativeTime(note.updatedAt)}</span>
            {boards.length > 0 && <button type="button" className="text-button" onClick={() => actions.showOnBoard(note.id, boards[0].id)}><ShareNetwork /> See on the Map</button>}
            {isActiveNote(note) && <button type="button" className="text-button" onClick={() => actions.showInSky(note.id)}><MoonStars /> See in the Sky</button>}
          </footer>
        </div>

        {ui.inspector && <NoteInspector workspace={workspace} note={note} actions={actions} tasks={tasks} boards={boards} textareaRef={textareaRef} />}
      </div>
    </section>
  );
}

function NoteInspector({ workspace, note, actions, tasks, boards, textareaRef }) {
  const headings = outline(note.markdown);
  const incoming = backlinks(workspace.notes, note);
  const outgoing = outgoingLinks(workspace.notes, note);
  const created = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(note.createdAt));
  function jumpTo(line) {
    const element = textareaRef.current;
    if (element) {
      const index = note.markdown.split("\n").slice(0, line).join("\n").length + (line ? 1 : 0);
      element.focus();
      element.setSelectionRange(index, index);
      const position = caretPosition(element, index);
      element.scrollTop = Math.max(0, position.top + element.scrollTop - 40);
      return;
    }
    document.querySelector(`.note-read [data-line="${line}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  return (
    <aside className="note-inspector" aria-label="Note details">
      <section>
        <h4>Details</h4>
        <dl>
          <dt>Created</dt><dd>{created}</dd>
          <dt>Edited</dt><dd>{formatRelativeTime(note.updatedAt)}</dd>
          <dt>Words</dt><dd>{wordCount(note.markdown)}</dd>
          {tasks.total > 0 && <><dt>Next steps</dt><dd>{tasks.done} of {tasks.total} done</dd></>}
          {note.source && <><dt>Came from</dt><dd>{note.source}</dd></>}
        </dl>
      </section>
      {headings.length > 1 && (
        <section>
          <h4>Outline</h4>
          <ul className="outline-list">
            {headings.map((item) => (
              <li key={`${item.line}`} style={{ "--level": item.level - 1 }}>
                <button type="button" onClick={() => jumpTo(item.line)}>{item.text}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h4>Links <small>{outgoing.length}</small></h4>
        {outgoing.length ? (
          <ul className="link-list">
            {outgoing.map(({ target, note: linked }) => (
              <li key={target}>
                <button type="button" className={linked ? "" : "is-missing"} onClick={() => actions.openWikilink(target, note.folderId)}>
                  <LinkIcon /> <span>{target}</span>{!linked && <small>create</small>}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="inspector-empty">Type [[ to link another note.</p>}
      </section>
      <section>
        <h4>Mentioned in <small>{incoming.length}</small></h4>
        {incoming.length ? (
          <ul className="link-list">
            {incoming.map((other) => (
              <li key={other.id}>
                <button type="button" onClick={() => actions.selectNote(other.id)}><ArrowUpRight /> <span>{other.title}</span></button>
              </li>
            ))}
          </ul>
        ) : <p className="inspector-empty">No other note links here yet.</p>}
      </section>
      <section>
        <h4>Mindmap</h4>
        {boards.length ? (
          <ul className="link-list">
            {boards.map((board) => (
              <li key={board.id}><button type="button" onClick={() => actions.showOnBoard(note.id, board.id)}><ShareNetwork /> <span>{board.name}</span></button></li>
            ))}
          </ul>
        ) : <p className="inspector-empty">{note.archived ? "Archived notes leave the desk." : "Not on a board."} {!note.archived && !note.trashedAt && <button type="button" className="text-button" onClick={() => actions.showOnBoard(note.id)}>Add to the desk</button>}</p>}
      </section>
    </aside>
  );
}
