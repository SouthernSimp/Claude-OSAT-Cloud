import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise, ArrowClockwise, Broom, CaretRight, CornersOut, Cursor, DotsThree, DownloadSimple, FolderSimple, FrameCorners, Hand,
  Hash, LinkSimple, MagnifyingGlass, Minus, NotePencil, PaintBucket, Plus, Selection, Trash, UploadSimple, X,
} from "@phosphor-icons/react";
import { Menu } from "../lib/Menu.jsx";
import { PromptDialog } from "../lib/PromptDialog.jsx";
import { downloadFile } from "../lib/ui.js";
import { useFocusTrap } from "../lib/use-focus-trap.js";
import { localDateKey } from "../daily-practice.js";
import {
  CARD, EMPTY_FILTER, GRID, PAPERS, PAPER_LABEL, ZOOM, addCardsToBoard, boardToJson, boardToMarkdown, cardCenterInside, cardMatches, cardPaper, clamp,
  clusterCards, contentBounds, ensureTagColors, filterActive, findFreeSpot, fitCamera, hash, importBoardText, looksLikeList, newBoard, normalizeBoardDoc,
  removeCards, snap, stockFor, tagPaper, tidyGrid, updateBoard, zoomCamera,
} from "../board-model.js";
import { createNote, folderPath, trashNotes, updateNote, wikilinkPairs } from "../notes-model.js";
import { Card } from "./Card.jsx";
import { Wires } from "./Wires.jsx";
import { BoardRail } from "./BoardRail.jsx";
import { composedNote } from "./board-text.js";

const RAIL_KEY = "osat.board-rail.v2";
const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const landingRot = (id, x, y) => Math.round((((hash(`${id}:${x},${y}`) % 240) / 100) - 1.2) * 10) / 10;

export function BoardView({ workspace, commit, navigate, boardTarget }) {
  const doc = useMemo(() => normalizeBoardDoc(workspace.sorter), [workspace.sorter]);
  const board = doc.boards.find((item) => item.id === doc.activeId) || doc.boards[0];
  const notesById = useMemo(() => new Map(workspace.notes.map((note) => [note.id, note])), [workspace.notes]);
  const stageRef = useRef(null);
  const [cam, setCam] = useState(board.cam);
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== "closed" && !matchMedia("(max-width: 900px)").matches);
  const [tool, setTool] = useState("select");
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [selection, setSelection] = useState(() => new Set());
  const [selectedLink, setSelectedLink] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [editing, setEditing] = useState(null);
  const [linkFrom, setLinkFrom] = useState(null);
  const [override, setOverrideState] = useState({}); // in-flight geometry while dragging: id -> partial card/group
  const overrideRef = useRef({});
  const setOverride = useCallback((next) => { overrideRef.current = next; setOverrideState(next); }, []);
  const [marquee, setMarquee] = useState(null);
  const [draftWire, setDraftWire] = useState(null);
  const [flying, setFlying] = useState(false);
  const [toast, setToast] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [composer, setComposer] = useState("");
  const [spaceDown, setSpaceDown] = useState(false);
  const history = useRef({ undo: [], redo: [], boardId: board.id });
  const drag = useRef(null);
  const latest = useRef({});
  latest.current = { board, cam, selection, filter, notesById, editing };

  useEffect(() => { localStorage.setItem(RAIL_KEY, railOpen ? "open" : "closed"); }, [railOpen]);

  // Switching boards resets the camera, selection and history.
  useEffect(() => {
    if (history.current.boardId === board.id) return;
    history.current = { undo: [], redo: [], boardId: board.id };
    setCam(board.cam);
    setSelection(new Set());
    setSelectedLink(null);
    setSelectedGroup(null);
    setEditing(null);
    setFilter(EMPTY_FILTER);
  }, [board.id, board.cam]);

  // Persist the camera a moment after it settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (cam.x === board.cam.x && cam.y === board.cam.y && cam.z === board.cam.z) return;
      commit((state) => updateBoard(state, board.id, (current) => ({ ...current, cam })));
    }, 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam]);

  // Every tag gets a stable paper colour the first time it appears here.
  useEffect(() => {
    const coloured = ensureTagColors(board, notesById);
    if (coloured !== board) commit((state) => updateBoard(state, board.id, (current) => ({ ...current, tagColors: coloured.tagColors })));
  }, [board, notesById, commit]);

  /* ---------- helpers ---------- */

  const viewport = () => ({ w: stageRef.current?.clientWidth || 800, h: stageRef.current?.clientHeight || 600 });
  const toWorld = useCallback((clientX, clientY) => {
    const rect = stageRef.current.getBoundingClientRect();
    const camera = latest.current.cam;
    return { x: (clientX - rect.left - camera.x) / camera.z, y: (clientY - rect.top - camera.y) / camera.z };
  }, []);
  const showToast = useCallback((message, action = null) => {
    setToast({ id: Date.now(), message, action });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), toast.action ? 6000 : 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const snapshot = (current) => ({ notes: current.notes, links: current.links, groups: current.groups, tagColors: current.tagColors });
  const pushUndo = useCallback(() => {
    history.current.undo.push(snapshot(latest.current.board));
    if (history.current.undo.length > 80) history.current.undo.shift();
    history.current.redo = [];
  }, []);
  const applySnapshot = useCallback((snap) => {
    commit((state) => updateBoard(state, latest.current.board.id, (current) => ({ ...current, ...snap })));
    setSelection((current) => new Set([...current].filter((id) => snap.notes.some((card) => card.id === id))));
    setSelectedLink(null);
  }, [commit]);
  const undo = useCallback(() => {
    const snap = history.current.undo.pop();
    if (!snap) return;
    history.current.redo.push(snapshot(latest.current.board));
    applySnapshot(snap);
  }, [applySnapshot]);
  const redo = useCallback(() => {
    const snap = history.current.redo.pop();
    if (!snap) return;
    history.current.undo.push(snapshot(latest.current.board));
    applySnapshot(snap);
  }, [applySnapshot]);
  const patchBoard = useCallback((updater) => commit((state) => updateBoard(state, latest.current.board.id, updater)), [commit]);

  const fly = () => {
    if (reduced()) return;
    setFlying(true);
    setTimeout(() => setFlying(false), 800);
  };
  const frameAll = useCallback((items) => {
    const list = items || [...latest.current.board.notes, ...latest.current.board.groups];
    const bounds = contentBounds(list);
    if (!bounds) { setCam({ x: viewport().w / 2, y: viewport().h / 2, z: 1 }); return; }
    setCam(fitCamera(bounds, viewport()));
  }, []);
  const centerOn = useCallback((card, zoom = 1) => {
    const size = viewport();
    setCam({ x: Math.round(size.w / 2 - (card.x + card.w / 2) * zoom), y: Math.round(size.h / 2 - (card.y + card.h / 2) * zoom), z: zoom });
  }, []);

  // Opened from Notes or the command palette with a target.
  const handledTarget = useRef(null);
  useEffect(() => {
    if (!boardTarget || handledTarget.current === boardTarget.at) return;
    handledTarget.current = boardTarget.at;
    if (boardTarget.boardId && boardTarget.boardId !== doc.activeId && doc.boards.some((item) => item.id === boardTarget.boardId)) {
      commit((state) => ({ ...state, sorter: { ...normalizeBoardDoc(state.sorter), activeId: boardTarget.boardId } }));
    }
    if (boardTarget.focusNoteId) {
      const target = doc.boards.find((item) => item.id === (boardTarget.boardId || doc.activeId)) || board;
      const card = target.notes.find((item) => item.id === boardTarget.focusNoteId);
      if (card) {
        // After the board switch effect has run, so the selection survives it.
        requestAnimationFrame(() => { setSelection(new Set([card.id])); centerOn(card); });
      }
    }
  }, [boardTarget, doc, board, commit, centerOn]);

  // First open: keep a useful saved view, otherwise frame the board.
  const framedOnce = useRef(new Set());
  useLayoutEffect(() => {
    if (framedOnce.current.has(board.id)) return;
    framedOnce.current.add(board.id);
    const bounds = contentBounds([...board.notes, ...board.groups]);
    const size = viewport();
    const visible = !bounds || (
      bounds.x * board.cam.z + board.cam.x < size.w &&
      (bounds.x + bounds.w) * board.cam.z + board.cam.x > 0 &&
      bounds.y * board.cam.z + board.cam.y < size.h &&
      (bounds.y + bounds.h) * board.cam.z + board.cam.y > 0
    );
    if (!visible || board.cam.z > 1.4 || board.cam.z < 0.25 || (board.cam.x === 0 && board.cam.y === 0 && board.cam.z === 1)) {
      requestAnimationFrame(() => frameAll());
    }
  }, [board.id, board.cam, frameAll]);

  /* ---------- derived ---------- */

  const cards = useMemo(() => board.notes.map((card) => override[card.id] ? { ...card, ...override[card.id] } : card), [board.notes, override]);
  const groups = useMemo(() => board.groups.map((group) => override[group.id] ? { ...group, ...override[group.id] } : group), [board.groups, override]);
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const filtering = filterActive(filter);
  const matches = useMemo(() => new Set(cards.filter((card) => cardMatches(card, notesById.get(card.id), board, filter)).map((card) => card.id)), [cards, notesById, board, filter]);
  const wikis = useMemo(() => {
    if (!doc.showWikilinks) return [];
    const here = new Set(board.notes.map((card) => card.id));
    return wikilinkPairs(workspace.notes.filter((note) => here.has(note.id)));
  }, [doc.showWikilinks, board.notes, workspace.notes]);
  const linkCounts = useMemo(() => {
    const counts = new Map();
    board.links.forEach((link) => { counts.set(link.a, (counts.get(link.a) || 0) + 1); counts.set(link.b, (counts.get(link.b) || 0) + 1); });
    return counts;
  }, [board.links]);
  const selectedCards = cards.filter((card) => selection.has(card.id));
  const visibleCards = filtering ? cards.filter((card) => matches.has(card.id)) : cards;

  /* ---------- board mutations ---------- */

  const commitText = useCallback((id, text) => commit((state) => updateNote(state, id, { markdown: text })), [commit]);
  const stopEdit = useCallback(() => setEditing(null), []);
  const removeSelected = useCallback((ids) => {
    if (!ids.length) return;
    pushUndo();
    patchBoard((current) => removeCards(current, ids));
    setSelection(new Set());
    showToast(ids.length === 1 ? "Removed from this board. The note stays in Notes." : `${ids.length} cards removed. The notes stay in Notes.`, { label: "Undo", run: undo });
  }, [pushUndo, patchBoard, showToast, undo]);
  const addLink = useCallback((a, b) => {
    const current = latest.current.board;
    if (a === b || current.links.some((link) => (link.a === a && link.b === b) || (link.a === b && link.b === a))) return false;
    pushUndo();
    patchBoard((item) => ({ ...item, links: [...item.links, { id: uid("link"), a, b, label: "", arrow: true }] }));
    return true;
  }, [pushUndo, patchBoard]);
  const deleteLink = useCallback((id) => {
    pushUndo();
    patchBoard((item) => ({ ...item, links: item.links.filter((link) => link.id !== id) }));
    setSelectedLink(null);
  }, [pushUndo, patchBoard]);
  const labelLink = useCallback((id) => {
    const link = latest.current.board.links.find((item) => item.id === id);
    if (!link) return;
    setPrompt({
      title: "Label this connection", label: "Label", value: link.label, confirm: "Save", hint: "Leave it empty for a plain wire.",
      onSubmit: (value) => { pushUndo(); patchBoard((item) => ({ ...item, links: item.links.map((entry) => entry.id === id ? { ...entry, label: value.slice(0, 80) } : entry) })); setPrompt(null); },
    });
  }, [pushUndo, patchBoard]);
  const setColor = useCallback((ids, color) => {
    pushUndo();
    patchBoard((item) => ({ ...item, notes: item.notes.map((card) => ids.includes(card.id) ? { ...card, color, updated: Date.now() } : card) }));
  }, [pushUndo, patchBoard]);

  const layoutWith = (result, message) => {
    pushUndo();
    const moved = new Map(result.cards.map((card) => [card.id, card]));
    patchBoard((item) => ({
      ...item,
      notes: item.notes.map((card) => moved.get(card.id) || card),
      groups: result.groups ? [...item.groups.filter((group) => !group.auto), ...result.groups] : item.groups,
    }));
    fly();
    setTimeout(() => frameAll([...result.cards, ...(result.groups || [])]), 60);
    showToast(message, { label: "Undo", run: undo });
  };
  const clusterByTag = () => {
    const list = latest.current.board.notes;
    if (!list.length) { showToast("Nothing on the board yet"); return; }
    const result = clusterCards(list, (card) => notesById.get(card.id)?.tags?.[0] || "", (key) => key ? `#${key}` : "Untagged", (key) => tagPaper(latest.current.board, key), "tag");
    layoutWith(result, `${result.groups.length} ${result.groups.length === 1 ? "cluster" : "clusters"} laid out by tag`);
  };
  const clusterByFolder = () => {
    const list = latest.current.board.notes;
    if (!list.length) { showToast("Nothing on the board yet"); return; }
    const result = clusterCards(list, (card) => notesById.get(card.id)?.folderId || "", (key) => key ? folderPath(workspace.folders, key).join(" / ") : "Unfiled", () => "bone", "folder");
    layoutWith(result, `${result.groups.length} ${result.groups.length === 1 ? "cluster" : "clusters"} laid out by folder`);
  };
  const tidy = () => {
    const list = latest.current.board.notes;
    if (!list.length) { showToast("Nothing on the board yet"); return; }
    pushUndo();
    const moved = new Map(tidyGrid(list).map((card) => [card.id, card]));
    patchBoard((item) => ({ ...item, notes: item.notes.map((card) => moved.get(card.id) || card), groups: item.groups.filter((group) => !group.auto) }));
    fly();
    setTimeout(() => frameAll([...moved.values()]), 60);
    showToast("Notes tidied into a grid", { label: "Undo", run: undo });
  };
  const groupSelection = () => {
    const chosen = latest.current.board.notes.filter((card) => latest.current.selection.has(card.id));
    if (!chosen.length) return;
    const bounds = contentBounds(chosen);
    setPrompt({
      title: "Name this frame", label: "Frame name", value: "", confirm: "Add frame",
      onSubmit: (value) => {
        pushUndo();
        const group = { id: uid("group"), name: value || "Frame", x: bounds.x - 24, y: bounds.y - 56, w: bounds.w + 48, h: bounds.h + 80, color: null, auto: null };
        patchBoard((item) => ({ ...item, groups: [...item.groups, group] }));
        setPrompt(null);
        setSelectedGroup(group.id);
      },
    });
  };
  const renameGroup = (id) => {
    const group = latest.current.board.groups.find((item) => item.id === id);
    if (!group) return;
    setPrompt({ title: "Rename frame", label: "Frame name", value: group.name, onSubmit: (value) => { pushUndo(); patchBoard((item) => ({ ...item, groups: item.groups.map((entry) => entry.id === id ? { ...entry, name: value || entry.name, auto: null } : entry) })); setPrompt(null); } });
  };
  const deleteGroup = (id) => {
    pushUndo();
    patchBoard((item) => ({ ...item, groups: item.groups.filter((group) => group.id !== id) }));
    setSelectedGroup(null);
  };
  const duplicateSelection = () => {
    const chosen = latest.current.board.notes.filter((card) => latest.current.selection.has(card.id));
    if (!chosen.length) return;
    pushUndo();
    const ids = [];
    commit((state) => {
      let next = state;
      const copies = [];
      chosen.forEach((card) => {
        const note = state.notes.find((item) => item.id === card.id);
        if (!note) return;
        const result = createNote(next, { title: `${note.title} copy`, markdown: note.markdown, folderId: note.folderId });
        next = result.state;
        ids.push(result.note.id);
        copies.push({ id: result.note.id, x: card.x + 28, y: card.y + 28, w: card.w, h: card.h, rot: card.rot, color: card.color });
      });
      return updateBoard(next, latest.current.board.id, (item) => addCardsToBoard(item, copies));
    });
    setSelection(new Set(ids));
  };
  const openInNotes = (id) => navigate("Notes", id);
  const trashSelected = () => {
    const ids = [...latest.current.selection];
    if (!ids.length) return;
    // Nothing is lost: no question first, and Undo puts the notes and their cards back.
    const chosen = new Set(ids);
    const pinned = new Set(ids.filter((id) => latest.current.notesById.get(id)?.pinned));
    pushUndo();
    commit((state) => trashNotes(state, ids));
    setSelection(new Set());
    showToast(ids.length === 1 ? "Note moved to Trash" : `${ids.length} notes moved to Trash`, {
      label: "Undo",
      run: () => {
        commit((state) => ({ ...state, notes: state.notes.map((note) => chosen.has(note.id) ? { ...note, trashedAt: null, pinned: pinned.has(note.id) } : note) }));
        undo();
      },
    });
  };

  const placeNear = (w, h) => {
    const size = viewport();
    const center = toWorld(stageRef.current.getBoundingClientRect().left + size.w / 2, stageRef.current.getBoundingClientRect().top + size.h / 2);
    return findFreeSpot(latest.current.board.notes, w, h, { x: center.x - w / 2, y: center.y - h / 2 });
  };
  const compose = (event) => {
    event.preventDefault();
    const text = composer.trim();
    if (!text) return;
    const { title, markdown } = composedNote(text);
    const stock = stockFor(markdown);
    const spot = placeNear(stock.w, stock.h);
    const current = latest.current.board;
    let created;
    commit((state) => {
      const result = createNote(state, { title, markdown, folderId: current.scope.kind === "folder" ? current.scope.folderId : null });
      created = result.note;
      return updateBoard(result.state, current.id, (item) => addCardsToBoard(item, [{ id: result.note.id, x: spot.x, y: spot.y, w: stock.w, h: stock.h, rot: landingRot(result.note.id, spot.x, spot.y) }]));
    });
    setComposer("");
    if (created) setSelection(new Set([created.id]));
  };

  const boardActions = {
    newBoard: () => setPrompt({
      title: "New board", label: "Board name", value: "", confirm: "Create",
      hint: "A new board starts empty. Add notes from Notes, the composer, or point it at a folder from its menu.",
      onSubmit: (value) => {
        const created = newBoard(value || "Board");
        commit((state) => { const current = normalizeBoardDoc(state.sorter); return { ...state, sorter: { ...current, boards: [...current.boards, created], activeId: created.id } }; });
        setPrompt(null);
      },
    }),
    switchBoard: (id) => commit((state) => ({ ...state, sorter: { ...normalizeBoardDoc(state.sorter), activeId: id } })),
    renameBoard: (id) => {
      const item = doc.boards.find((entry) => entry.id === id);
      setPrompt({ title: "Rename board", label: "Board name", value: item?.name || "", onSubmit: (value) => { if (value) commit((state) => updateBoard(state, id, (current) => ({ ...current, name: value.slice(0, 60) }))); setPrompt(null); } });
    },
    deleteBoard: (id) => {
      const item = doc.boards.find((entry) => entry.id === id);
      if (!item || doc.boards.length === 1) return;
      const at = doc.boards.indexOf(item);
      commit((state) => { const current = normalizeBoardDoc(state.sorter); const boards = current.boards.filter((entry) => entry.id !== id); return { ...state, sorter: { ...current, boards, activeId: current.activeId === id ? boards[0].id : current.activeId } }; });
      showToast(`Board “${item.name}” removed. The notes stay in Notes.`, {
        label: "Undo",
        run: () => commit((state) => { const current = normalizeBoardDoc(state.sorter); if (current.boards.some((entry) => entry.id === id)) return state; const boards = [...current.boards]; boards.splice(at, 0, item); return { ...state, sorter: { ...current, boards, activeId: id } }; }),
      });
    },
    setScope: (id, scope) => commit((state) => updateBoard(state, id, (current) => ({ ...current, scope, hidden: [] }))),
    setTagColor: (tag, color) => patchBoard((item) => ({ ...item, tagColors: { ...item.tagColors, [tag]: color } })),
    setShowWikilinks: (value) => commit((state) => ({ ...state, sorter: { ...normalizeBoardDoc(state.sorter), showWikilinks: value } })),
    saveView: () => setPrompt({
      title: "Save this view", label: "View name", value: "", confirm: "Save view", hint: "Keeps the current tag filter, search, and camera.",
      onSubmit: (value) => {
        if (!value) { setPrompt(null); return; }
        const view = { id: uid("view"), name: value, tags: filter.tags, mode: filter.mode, query: filter.query, untagged: filter.untagged, unconnected: filter.unconnected, cam: { ...cam } };
        patchBoard((item) => ({ ...item, views: [...item.views, view] }));
        setPrompt(null);
      },
    }),
    applyView: (view) => {
      setFilter({ tags: view.tags, mode: view.mode, query: view.query, untagged: view.untagged, unconnected: view.unconnected });
      if (view.cam) setCam(view.cam);
    },
    updateView: (id) => patchBoard((item) => ({ ...item, views: item.views.map((view) => view.id === id ? { ...view, tags: filter.tags, mode: filter.mode, query: filter.query, untagged: filter.untagged, unconnected: filter.unconnected, cam: { ...cam } } : view) })),
    renameView: (id) => {
      const view = board.views.find((entry) => entry.id === id);
      setPrompt({ title: "Rename view", label: "View name", value: view?.name || "", onSubmit: (value) => { if (value) patchBoard((item) => ({ ...item, views: item.views.map((entry) => entry.id === id ? { ...entry, name: value } : entry) })); setPrompt(null); } });
    },
    deleteView: (id) => patchBoard((item) => ({ ...item, views: item.views.filter((view) => view.id !== id) })),
  };

  /* ---------- pointer interactions ---------- */

  const endDrag = useCallback((event) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    try { stageRef.current?.releasePointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    if (d.kind === "move") {
      if (d.moved) {
        const pending = overrideRef.current;
        const positions = new Map(d.start.map((entry) => [entry.id, pending[entry.id] || { x: entry.x, y: entry.y }]));
        patchBoard((item) => ({
          ...item,
          notes: item.notes.map((card) => positions.has(card.id) ? { ...card, ...positions.get(card.id), rot: landingRot(card.id, positions.get(card.id).x, positions.get(card.id).y), updated: Date.now() } : card),
        }));
      }
      setOverride({});
      setDragging(false);
      return;
    }
    if (d.kind === "group-move" || d.kind === "group-resize") {
      if (d.moved) {
        const pending = overrideRef.current;
        patchBoard((item) => ({
          ...item,
          groups: item.groups.map((group) => pending[group.id] ? { ...group, ...pending[group.id] } : group),
          notes: item.notes.map((card) => pending[card.id] ? { ...card, ...pending[card.id] } : card),
        }));
      }
      setOverride({});
      return;
    }
    if (d.kind === "resize") {
      const pending = overrideRef.current[d.id];
      if (pending) patchBoard((item) => ({ ...item, notes: item.notes.map((card) => card.id === d.id ? { ...card, ...pending, updated: Date.now() } : card) }));
      setOverride({});
      return;
    }
    if (d.kind === "wire") {
      if (d.to) showToast(addLink(d.from, d.to) ? "Connected" : "Those two are already connected");
      setDraftWire(null);
      return;
    }
    if (d.kind === "marquee") {
      setMarquee(null);
      return;
    }
    if (d.kind === "pan") stageRef.current.dataset.panning = "";
  }, [patchBoard, addLink, showToast, setOverride]);

  const [dragging, setDragging] = useState(false);

  function onPointerDown(event) {
    if (event.button === 2) return;
    const target = event.target;
    if (target.closest(".board-hud, .board-composer, .board-toasts, .selection-bar, .menu-popover")) return;
    const cardEl = target.closest(".card");
    const port = target.closest(".port");
    const grip = target.closest(".grip");
    const groupEl = target.closest(".frame");
    const groupGrip = target.closest(".frame-grip");
    const stage = stageRef.current;
    const wantsPan = tool === "hand" || spaceDown || event.button === 1;

    if (wantsPan) {
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      stage.dataset.panning = "1";
      drag.current = { kind: "pan", sx: event.clientX, sy: event.clientY, cx: cam.x, cy: cam.y };
      return;
    }

    if (port && cardEl) {
      event.preventDefault();
      event.stopPropagation();
      stage.setPointerCapture(event.pointerId);
      setEditing(null);
      drag.current = { kind: "wire", from: cardEl.dataset.id, to: null };
      setDraftWire({ from: cardEl.dataset.id, to: null, point: toWorld(event.clientX, event.clientY) });
      return;
    }

    if (grip && cardEl) {
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      const card = cardsById.get(cardEl.dataset.id);
      pushUndo();
      setEditing(null);
      drag.current = { kind: "resize", id: card.id, w: card.w, h: card.h, sx: event.clientX, sy: event.clientY };
      return;
    }

    if (cardEl) {
      const id = cardEl.dataset.id;
      if (cardEl.classList.contains("is-dim")) return;
      if (editing === id) return;
      setEditing(null);
      setSelectedLink(null);
      setSelectedGroup(null);
      if (linkFrom && linkFrom !== id) {
        showToast(addLink(linkFrom, id) ? "Connected" : "Those two are already connected");
        setLinkFrom(null);
        return;
      }
      let next = selection;
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        next = new Set(selection);
        if (next.has(id)) next.delete(id); else next.add(id);
      } else if (!selection.has(id)) next = new Set([id]);
      if (next !== selection) setSelection(next);
      event.preventDefault();
      const start = cards.filter((card) => next.has(card.id)).map((card) => ({ id: card.id, x: card.x, y: card.y }));
      drag.current = { kind: "move", sx: event.clientX, sy: event.clientY, start, moved: false, pid: event.pointerId };
      return;
    }

    if (groupGrip && groupEl) {
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      const group = groups.find((item) => item.id === groupEl.dataset.id);
      pushUndo();
      drag.current = { kind: "group-resize", id: group.id, w: group.w, h: group.h, sx: event.clientX, sy: event.clientY, moved: false };
      return;
    }

    if (groupEl) {
      event.preventDefault();
      const group = groups.find((item) => item.id === groupEl.dataset.id);
      setSelectedGroup(group.id);
      setSelection(new Set());
      setSelectedLink(null);
      setEditing(null);
      const members = cards.filter((card) => cardCenterInside(card, group)).map((card) => ({ id: card.id, x: card.x, y: card.y }));
      drag.current = { kind: "group-move", id: group.id, gx: group.x, gy: group.y, members, sx: event.clientX, sy: event.clientY, moved: false, pid: event.pointerId };
      return;
    }

    // Empty desk: marquee select.
    event.preventDefault();
    stage.focus({ preventScroll: true });
    setEditing(null);
    setSelectedLink(null);
    setSelectedGroup(null);
    if (linkFrom) setLinkFrom(null);
    const rect = stage.getBoundingClientRect();
    drag.current = { kind: "marquee", sx: event.clientX, sy: event.clientY, rect, add: event.shiftKey, base: new Set(selection), moved: false, pid: event.pointerId };
    if (!event.shiftKey && selection.size) setSelection(new Set());
  }

  function onPointerMove(event) {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.sx, dy = event.clientY - d.sy;
    const z = cam.z;
    if (d.kind === "pan") { setCam((current) => ({ ...current, x: d.cx + dx, y: d.cy + dy })); return; }
    if (d.kind === "move") {
      if (!d.moved) {
        if (Math.hypot(dx, dy) < 3) return;
        d.moved = true;
        pushUndo();
        setDragging(true);
        try { stageRef.current.setPointerCapture(d.pid); } catch { /* pointer gone */ }
      }
      const free = event.shiftKey;
      const next = {};
      d.start.forEach((entry) => {
        const x = entry.x + dx / z, y = entry.y + dy / z;
        next[entry.id] = free ? { x, y } : { x: snap(x), y: snap(y) };
      });
      setOverride(next);
      return;
    }
    if (d.kind === "group-move") {
      if (!d.moved) {
        if (Math.hypot(dx, dy) < 3) return;
        d.moved = true;
        pushUndo();
        try { stageRef.current.setPointerCapture(d.pid); } catch { /* pointer gone */ }
      }
      const ox = snap(dx / z), oy = snap(dy / z);
      const next = { [d.id]: { x: d.gx + ox, y: d.gy + oy } };
      d.members.forEach((entry) => { next[entry.id] = { x: entry.x + ox, y: entry.y + oy }; });
      setOverride(next);
      return;
    }
    if (d.kind === "group-resize") {
      d.moved = true;
      setOverride({ [d.id]: { w: Math.max(160, snap(d.w + dx / z)), h: Math.max(120, snap(d.h + dy / z)) } });
      return;
    }
    if (d.kind === "resize") {
      setOverride({ [d.id]: { w: clamp(snap(d.w + dx / z), CARD.minW, CARD.maxW), h: clamp(snap(d.h + dy / z), CARD.minH, CARD.maxH) } });
      return;
    }
    if (d.kind === "wire") {
      const under = document.elementFromPoint(event.clientX, event.clientY)?.closest(".card:not(.is-dim)");
      const to = under && under.dataset.id !== d.from ? under.dataset.id : null;
      d.to = to;
      setDraftWire({ from: d.from, to, point: toWorld(event.clientX, event.clientY) });
      return;
    }
    if (d.kind === "marquee") {
      if (!d.moved) { d.moved = true; try { stageRef.current.setPointerCapture(d.pid); } catch { /* pointer gone */ } }
      const x1 = Math.min(d.sx, event.clientX) - d.rect.left, y1 = Math.min(d.sy, event.clientY) - d.rect.top;
      const x2 = Math.max(d.sx, event.clientX) - d.rect.left, y2 = Math.max(d.sy, event.clientY) - d.rect.top;
      setMarquee({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      const a = toWorld(Math.min(d.sx, event.clientX), Math.min(d.sy, event.clientY));
      const b = toWorld(Math.max(d.sx, event.clientX), Math.max(d.sy, event.clientY));
      const next = new Set(d.add ? d.base : []);
      visibleCards.forEach((card) => { if (card.x < b.x && card.x + card.w > a.x && card.y < b.y && card.y + card.h > a.y) next.add(card.id); });
      setSelection(next);
    }
  }

  function onWheel(event) {
    if (event.target.closest(".board-rail, .board-hud, .board-composer, .card-editor")) return;
    event.preventDefault();
    const rect = stageRef.current.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
      setCam((current) => zoomCamera(current, factor, { x: event.clientX - rect.left, y: event.clientY - rect.top }, { w: rect.width, h: rect.height }));
    } else {
      setCam((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    }
  }
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const stage = stageRef.current;
    const handler = (event) => wheelRef.current(event);
    stage.addEventListener("wheel", handler, { passive: false });
    return () => stage.removeEventListener("wheel", handler);
  }, []);

  function onDoubleClick(event) {
    const cardEl = event.target.closest(".card");
    if (cardEl && !cardEl.classList.contains("is-dim")) { setSelection(new Set([cardEl.dataset.id])); setEditing(cardEl.dataset.id); return; }
    const title = event.target.closest(".frame-title");
    if (title) { renameGroup(title.closest(".frame").dataset.id); return; }
    if (event.target.closest(".board-hud, .board-composer, .selection-bar, .board-toasts, .frame, .wires")) return;
    // Double-click on the desk starts a note right there.
    const point = toWorld(event.clientX, event.clientY);
    const stock = stockFor("");
    const current = latest.current.board;
    let created;
    commit((state) => {
      const result = createNote(state, { title: "Untitled note", markdown: "", folderId: current.scope.kind === "folder" ? current.scope.folderId : null });
      created = result.note;
      return updateBoard(result.state, current.id, (item) => addCardsToBoard(item, [{ id: result.note.id, x: snap(point.x - stock.w / 2), y: snap(point.y - stock.h / 2), w: stock.w, h: stock.h, rot: 0 }]));
    });
    if (created) { setSelection(new Set([created.id])); setEditing(created.id); }
  }

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const typing = () => ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    const keydown = (event) => {
      if (event.key === " " && !typing()) { setSpaceDown(true); }
      if (typing() || prompt || dataOpen) return;
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const current = latest.current;
      if (meta && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (meta && key === "a") { event.preventDefault(); setSelection(new Set(visibleCards.map((card) => card.id))); return; }
      if (meta && key === "0") { event.preventDefault(); frameAll(); return; }
      if (meta && (key === "=" || key === "+")) { event.preventDefault(); setCam((c) => zoomCamera(c, 1.2, null, viewport())); return; }
      if (meta && key === "-") { event.preventDefault(); setCam((c) => zoomCamera(c, 1 / 1.2, null, viewport())); return; }
      if (meta && key === "d") { event.preventDefault(); duplicateSelection(); return; }
      if (meta && key === "e" && current.selection.size === 1) { event.preventDefault(); openInNotes([...current.selection][0]); return; }
      if (meta) return;
      if (key === "escape") {
        if (current.editing) { setEditing(null); return; }
        if (linkFrom) { setLinkFrom(null); return; }
        if (filtering) { setFilter(EMPTY_FILTER); return; }
        setSelection(new Set()); setSelectedLink(null); setSelectedGroup(null);
        return;
      }
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        if (selectedLink) { deleteLink(selectedLink); return; }
        if (selectedGroup) { deleteGroup(selectedGroup); return; }
        removeSelected([...current.selection]);
        return;
      }
      if (key === "enter" && current.selection.size === 1) { event.preventDefault(); setEditing([...current.selection][0]); return; }
      if (key === "l" && current.selection.size === 1) { event.preventDefault(); setLinkFrom([...current.selection][0]); showToast("Click another card to connect them"); return; }
      if (key === "l" && current.selection.size === 2) { event.preventDefault(); const [a, b] = [...current.selection]; showToast(addLink(a, b) ? "Connected" : "Those two are already connected"); return; }
      if (key === "s" && event.shiftKey) { event.preventDefault(); tidy(); return; }
      if (key === "s") { event.preventDefault(); clusterByTag(); return; }
      if (key === "g" && current.selection.size) { event.preventDefault(); groupSelection(); return; }
      if (key === "v") { setTool("select"); return; }
      if (key === "h") { setTool("hand"); return; }
      if (key === "f") { event.preventDefault(); document.querySelector(".board-search input")?.focus(); return; }
      if (key === "n") { event.preventDefault(); document.querySelector(".board-composer textarea")?.focus(); return; }
      if (key.startsWith("arrow") && current.selection.size) {
        event.preventDefault();
        const step = event.shiftKey ? GRID * 5 : GRID;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        pushUndo();
        patchBoard((item) => ({ ...item, notes: item.notes.map((card) => current.selection.has(card.id) ? { ...card, x: card.x + dx, y: card.y + dy } : card) }));
      }
    };
    const keyup = (event) => { if (event.key === " ") setSpaceDown(false); };
    addEventListener("keydown", keydown);
    addEventListener("keyup", keyup);
    return () => { removeEventListener("keydown", keydown); removeEventListener("keyup", keyup); };
  });

  /* ---------- import / export ---------- */

  const exportJson = () => downloadFile(`${board.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "board"}-${localDateKey()}.json`, JSON.stringify(boardToJson(board, notesById), null, 2), "application/json");
  const exportMarkdown = () => downloadFile(`${board.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "board"}-${localDateKey()}.md`, boardToMarkdown(board, notesById), "text/markdown");
  const runImport = (text) => {
    const result = importBoardText(text);
    if (result.error) { showToast(result.error); return false; }
    pushUndo();
    const current = latest.current.board;
    const origin = placeNear(0, 0);
    commit((state) => {
      const next = { ...state, notes: [...result.notes.map((note) => ({ ...note, folderId: current.scope.kind === "folder" ? current.scope.folderId : null })), ...state.notes] };
      return updateBoard(next, current.id, (item) => {
        const shifted = result.cards.map((card) => ({ ...card, x: card.x + origin.x, y: card.y + origin.y }));
        const withCards = addCardsToBoard(item, shifted);
        return { ...withCards, links: [...withCards.links, ...result.links] };
      });
    });
    setSelection(new Set(result.notes.map((note) => note.id)));
    setTimeout(() => frameAll(), 60);
    showToast(`${result.notes.length} ${result.notes.length === 1 ? "note" : "notes"} imported`);
    return true;
  };

  /* ---------- render ---------- */

  const selectionBar = selectedCards.length > 0 && !editing ? (() => {
    const bounds = contentBounds(selectedCards);
    const left = bounds.x * cam.z + cam.x + (bounds.w * cam.z) / 2;
    const top = bounds.y * cam.z + cam.y - 14;
    const single = selectedCards.length === 1 ? selectedCards[0] : null;
    return (
      <div className="selection-bar" style={{ left, top }} role="toolbar" aria-label="Selected cards">
        <span className="selection-count">{selectedCards.length}</span>
        <Menu
          ariaLabel="Paper colour"
          trigger={({ toggle }) => <button type="button" title="Paper colour" onClick={toggle}><PaintBucket /></button>}
          items={[...PAPERS.map((color) => ({ label: PAPER_LABEL[color], onSelect: () => setColor(selectedCards.map((card) => card.id), color) })), { divider: true }, { label: "Back to the tag's colour", onSelect: () => setColor(selectedCards.map((card) => card.id), null) }]}
        />
        {single && <button type="button" title="Connect to another card (L)" onClick={() => { setLinkFrom(single.id); showToast("Click another card to connect them"); }}><LinkSimple /></button>}
        {selectedCards.length === 2 && <button type="button" title="Connect these two (L)" onClick={() => { const [a, b] = selectedCards; showToast(addLink(a.id, b.id) ? "Connected" : "Already connected"); }}><LinkSimple /></button>}
        <button type="button" title="Frame the selection (G)" onClick={groupSelection}><FrameCorners /></button>
        {single && <button type="button" title="Open note (⌘E)" onClick={() => openInNotes(single.id)}><NotePencil /><span>Open note</span></button>}
        <button type="button" title="Remove from board (⌫)" onClick={() => removeSelected(selectedCards.map((card) => card.id))}><X /></button>
        <Menu
          ariaLabel="More"
          trigger={({ toggle }) => <button type="button" title="More" onClick={toggle}><DotsThree weight="bold" /></button>}
          items={[
            { label: "Duplicate", hint: "⌘D", onSelect: duplicateSelection },
            single ? { label: "Edit text", hint: "↩", onSelect: () => setEditing(single.id) } : null,
            single ? { label: "Fit to text", onSelect: () => { const note = notesById.get(single.id); const stock = stockFor(note?.markdown || ""); pushUndo(); patchBoard((item) => ({ ...item, notes: item.notes.map((card) => card.id === single.id ? { ...card, w: stock.w, h: Math.max(stock.h, 120) } : card) })); } } : null,
            { divider: true },
            { label: selectedCards.length === 1 ? "Move note to Trash" : "Move notes to Trash", icon: Trash, danger: true, onSelect: trashSelected },
          ]}
        />
      </div>
    );
  })() : null;

  return (
    <div className={`board-view ${railOpen ? "" : "rail-closed"}`}>
      {railOpen && (
        <BoardRail workspace={workspace} doc={doc} board={board} notesById={notesById} filter={filter} setFilter={setFilter} actions={boardActions} onClose={() => setRailOpen(false)} />
      )}
      <div
        ref={stageRef}
        className={`board-stage tool-${tool} ${spaceDown ? "is-space" : ""} ${linkFrom ? "is-linking" : ""}`}
        tabIndex={-1}
        aria-label="Mindmap canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      >
        <div className="board-weave" style={{ backgroundPosition: `${cam.x}px ${cam.y}px`, backgroundSize: `${GRID * 2 * cam.z}px ${GRID * 2 * cam.z}px` }} />
        <div className="board-world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
          {groups.map((group) => (
            <div
              key={group.id}
              className={`frame ${selectedGroup === group.id ? "is-sel" : ""} ${flying ? "is-flying" : ""}`}
              data-id={group.id}
              data-paper={group.color || "bone"}
              style={{ translate: `${group.x}px ${group.y}px`, width: group.w, height: group.h }}
            >
              <div className="frame-title">{group.name || "Frame"}<small>{cards.filter((card) => cardCenterInside(card, group)).length}</small></div>
              <div className="frame-grip" />
            </div>
          ))}
          <Wires cards={cards} links={board.links} wikis={wikis} selectedLink={selectedLink} draft={draftWire} onSelectLink={(id) => { setSelectedLink(id); setSelection(new Set()); setSelectedGroup(null); }} onLabelLink={labelLink} />
          {cards.map((card) => {
            const note = notesById.get(card.id);
            return (
              <Card
                key={card.id}
                card={card}
                note={note}
                paper={cardPaper(card, note, board)}
                ruled={looksLikeList(note?.markdown)}
                selected={selection.has(card.id)}
                editing={editing === card.id}
                dim={filtering && !matches.has(card.id)}
                match={filtering && matches.has(card.id)}
                dragging={dragging && selection.has(card.id)}
                hit={draftWire?.to === card.id || linkFrom === card.id}
                flying={flying}
                linkCount={linkCounts.get(card.id) || 0}
                onCommitText={commitText}
                onStopEdit={stopEdit}
              />
            );
          })}
        </div>
        {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        {selectionBar}

        {!board.notes.length && (
          <div className="board-blank">
            <h2>A clean desk.</h2>
            <p>{board.scope.kind === "manual" ? "Write a thought below, double-click anywhere, or add notes from Notes." : "Write a thought below or double-click anywhere. Notes you make elsewhere land here too."}</p>
          </div>
        )}

        <div className="board-hud">
          <div className="hud-group">
            {!railOpen && <button type="button" className="hud-button" title="Show panel" aria-label="Show panel" onClick={() => setRailOpen(true)}><CaretRight /></button>}
            <span className="hud-title">{board.name}<small>{board.notes.length} {board.notes.length === 1 ? "note" : "notes"}{filtering ? ` · ${matches.size} shown` : ""}</small></span>
          </div>
          <div className="hud-group">
            <label className="board-search">
              <MagnifyingGlass />
              <input value={filter.query} placeholder="Search this board (F)" aria-label="Search this board" onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.blur(); setFilter((current) => ({ ...current, query: "" })); } if (event.key === "Enter") event.currentTarget.blur(); }} />
              {filtering && <button type="button" className="clear" aria-label="Clear filter" onClick={() => setFilter(EMPTY_FILTER)}><X /></button>}
            </label>
          </div>
          <div className="hud-group">
            <span className="segmented mini" role="group" aria-label="Tool">
              <button type="button" className={tool === "select" ? "active" : ""} title="Select (V)" aria-label="Select tool" onClick={() => setTool("select")}><Cursor /></button>
              <button type="button" className={tool === "hand" ? "active" : ""} title="Pan (H, or hold space)" aria-label="Pan tool" onClick={() => setTool("hand")}><Hand /></button>
            </span>
            <Menu
              ariaLabel="Arrange"
              trigger={({ toggle }) => <button type="button" className="hud-button" title="Arrange" onClick={toggle}><Broom /> Arrange</button>}
              items={[
                { label: "Cluster by tag", hint: "S", icon: Hash, onSelect: clusterByTag },
                { label: "Cluster by folder", icon: FolderSimple, onSelect: clusterByFolder },
                { label: "Tidy into a grid", hint: "⇧S", icon: Selection, onSelect: tidy },
                { divider: true },
                { label: "Remove all frames", disabled: !board.groups.length, onSelect: () => { pushUndo(); patchBoard((item) => ({ ...item, groups: [] })); } },
              ]}
            />
            <Menu
              ariaLabel="View and board actions"
              trigger={({ toggle, ariaLabel }) => <button type="button" className="hud-button square" title={ariaLabel} aria-label={ariaLabel} onClick={toggle}><DotsThree weight="bold" /></button>}
              items={[
                { label: "Undo", hint: "⌘Z", icon: ArrowCounterClockwise, disabled: !history.current.undo.length, onSelect: undo },
                { label: "Redo", hint: "⇧⌘Z", icon: ArrowClockwise, disabled: !history.current.redo.length, onSelect: redo },
                { divider: true },
                { label: "Zoom out", hint: "⌘−", icon: Minus, onSelect: () => setCam((c) => zoomCamera(c, 1 / 1.2, null, viewport())) },
                { label: `Reset zoom (${Math.round(cam.z * 100)}%)`, onSelect: () => setCam((c) => zoomCamera(c, 1 / c.z, null, viewport())) },
                { label: "Zoom in", hint: "⌘+", icon: Plus, onSelect: () => setCam((c) => zoomCamera(c, 1.2, null, viewport())) },
                { label: "Frame everything", hint: "⌘0", icon: CornersOut, onSelect: () => frameAll() },
                { divider: true },
                { label: "Export board as JSON", icon: DownloadSimple, onSelect: exportJson },
                { label: "Export board as Markdown", icon: DownloadSimple, onSelect: exportMarkdown },
                { divider: true },
                { label: "Import notes…", icon: UploadSimple, onSelect: () => setDataOpen(true) },
              ]}
            />
          </div>
        </div>

        <form className="board-composer" onSubmit={compose}>
          <span className="composer-mode">{board.scope.kind === "folder" ? <><FolderSimple /> New note in {folderPath(workspace.folders, board.scope.folderId).join(" / ")}</> : <><NotePencil /> New note</>}</span>
          <textarea
            rows={1}
            value={composer}
            placeholder="Write a thought, tag it with #something… (N)"
            aria-label="New note"
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); compose(event); } if (event.key === "Escape") event.currentTarget.blur(); }}
          />
          <button type="submit" className="primary-button" disabled={!composer.trim()}>Place <kbd>↵</kbd></button>
        </form>

        <div className="board-toasts" aria-live="polite">
          {toast && (
            <div className="toast" key={toast.id}>
              <span>{toast.message}</span>
              {toast.action && <button type="button" onClick={() => { toast.action.run(); setToast(null); }}>{toast.action.label}</button>}
            </div>
          )}
        </div>
      </div>

      {prompt && <PromptDialog {...prompt} onClose={() => setPrompt(null)} />}
      {dataOpen && <ImportDialog onClose={() => setDataOpen(false)} onImport={(text) => { if (runImport(text)) setDataOpen(false); }} />}
    </div>
  );
}

function ImportDialog({ onClose, onImport }) {
  const [text, setText] = useState("");
  const ref = useRef(null);
  useFocusTrap(ref, true, onClose);
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <form ref={ref} className="prompt-dialog wide" role="dialog" aria-modal="true" aria-labelledby="import-title" onPointerDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); onImport(text); }}>
        <button className="icon-button modal-close" type="button" aria-label="Close" onClick={onClose}><X /></button>
        <h2 id="import-title">Import notes onto this board</h2>
        <p>Paste a board export (JSON), a Sticky Note Sorter file, or plain text — one thought per line or paragraph. Imported notes become real notes in Notes; nothing here is replaced.</p>
        <textarea data-autofocus rows={9} value={text} onChange={(event) => setText(event.target.value)} placeholder={"Paste JSON, or one thought per line…"} />
        <div className="dialog-actions">
          <label className="file-pick">
            <input type="file" accept=".json,.md,.txt,application/json,text/plain,text/markdown" hidden onChange={async (event) => { const file = event.target.files?.[0]; if (file) setText(await file.text()); event.target.value = ""; }} />
            <UploadSimple /> Choose a file
          </label>
          <span className="dialog-buttons">
            <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={!text.trim()}>Import</button>
          </span>
        </div>
      </form>
    </div>
  );
}
