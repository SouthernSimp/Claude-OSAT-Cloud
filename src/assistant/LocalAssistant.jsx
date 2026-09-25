import {
  ArrowClockwise,
  ArrowUp,
  Check,
  CircleNotch,
  Copy,
  FolderSimple,
  LockKey,
  MagnifyingGlass,
  Microphone,
  NotePencil,
  Plus,
  Sparkle,
  Stop,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLocalModels, streamLocalMessage } from "../local-ai.js";
import { normalizeNote } from "../osat-data.js";
import { localDateKey } from "../daily-practice.js";
import { Markdown } from "../lib/markdown.jsx";
import { isActiveNote } from "../notes-model.js";
import {
  applyAction,
  describeAction,
  extractActions,
  systemPrompt,
} from "./actions.js";
import {
  deleteConversation,
  deriveTitle,
  listConversations,
  newConversation,
  saveConversation,
  searchConversations,
} from "./chat-store.js";
import "../styles/assistant.css";

const STARTERS = [
  "I have a lot on my mind. Help me untangle it.",
  "Help me find one small next step.",
  "I'd like to think out loud for a minute.",
  "Help me gently reflect on my day.",
];

export const modelLabel = (model) =>
  typeof model === "string" ? model : model?.name || model?.id || "Local model";
const modelId = (model) => (typeof model === "string" ? model : model?.id || "");

const dayLabel = (iso) => {
  const date = new Date(iso);
  const key = localDateKey(date);
  if (key === localDateKey()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === localDateKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
};

/* Only the records the conversation explicitly selected are ever sent. */
function buildContext(workspace, ids) {
  const chosen = new Set(ids);
  const parts = [];
  for (const project of workspace.projects || []) {
    if (!chosen.has(project.id)) continue;
    parts.push(
      `PROJECT: ${project.title}\n${String(project.summary || "").slice(0, 600)} [${project.status || "active"}]`,
    );
  }
  for (const note of workspace.notes || []) {
    if (!chosen.has(note.id)) continue;
    parts.push(`NOTE: ${note.title || "Untitled"}\n${String(note.markdown || "").slice(0, 1400)}`);
  }
  return parts.join("\n\n").slice(0, 14000);
}

/* initialPrompt is a hand-off from elsewhere in OSAT: { prompt, at }. Each new
   `at` opens a fresh chat with the text waiting in the composer. Nothing is sent
   until the person presses Return here, and no notes are shared. */
export function LocalAssistant({ workspace, commit, navigate, initialPrompt = null }) {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);
  const [search, setSearch] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [pending, setPending] = useState({});
  const [railOpen, setRailOpen] = useState(false);
  const [voiceHint, setVoiceHint] = useState(false);

  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const threadRef = useRef(null);
  const stickRef = useRef(true);

  const active = conversations.find((item) => item.id === activeId) || null;
  const messages = active?.messages || [];
  const today = localDateKey();

  /* ---- load ------------------------------------------------------------ */

  useEffect(() => {
    let alive = true;
    listConversations()
      .then((all) => {
        if (!alive) return;
        const seed = all.length ? all : [newConversation()];
        setConversations(seed);
        setActiveId(seed[0].id);
      })
      .catch(() => {
        if (!alive) return;
        const blank = newConversation();
        setConversations([blank]);
        setActiveId(blank.id);
        setError("Chat history could not be opened. This conversation stays in memory only.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const handedOff = useRef(null);
  useEffect(() => {
    if (!activeId || !initialPrompt || handedOff.current === initialPrompt.at) return;
    handedOff.current = initialPrompt.at;
    const blank = newConversation();
    setConversations((current) => [blank, ...current.filter((item) => item.messages.length)]);
    setActiveId(blank.id);
    setDraft(String(initialPrompt.prompt || "").slice(0, 8000));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, initialPrompt?.at]);

  const refreshModels = useCallback(async () => {
    setStatus("checking");
    try {
      const value = await getLocalModels();
      const next = (Array.isArray(value) ? value : value?.models || []).filter(Boolean);
      setModels(next);
      setModel((current) =>
        current && next.some((item) => modelId(item) === current) ? current : modelId(next[0]) || "",
      );
      setStatus(next.length ? "ready" : "unavailable");
      setError(next.length ? "" : "No local model is loaded. Start one in LM Studio, then refresh.");
    } catch (reason) {
      setModels([]);
      setModel("");
      setStatus("unavailable");
      setError(reason?.message || "The local runtime could not be reached on this Mac.");
    }
  }, []);

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeId]);

  /* Follow the stream only while the reader is already near the bottom. */
  useEffect(() => {
    const node = threadRef.current;
    if (!node || !stickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, streaming]);

  function onThreadScroll(event) {
    const node = event.currentTarget;
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  /* ---- conversation plumbing ------------------------------------------- */

  const persist = useCallback((conversation) => {
    saveConversation(conversation).catch(() =>
      setError("This conversation could not be written to local history."),
    );
  }, []);

  const patchActive = useCallback(
    (updater) => {
      let updated = null;
      setConversations((current) =>
        current.map((item) => {
          if (item.id !== activeId) return item;
          updated = { ...updater(item), updatedAt: new Date().toISOString() };
          return updated;
        }),
      );
      return updated;
    },
    [activeId],
  );

  function startChat() {
    abortRef.current?.abort();
    const blank = newConversation();
    setConversations((current) => [blank, ...current.filter((item) => item.messages.length)]);
    setActiveId(blank.id);
    setDraft("");
    setStreaming("");
    setError("");
    setRailOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectChat(id) {
    if (id === activeId) return;
    abortRef.current?.abort();
    setActiveId(id);
    setStreaming("");
    setError("");
    setRailOpen(false);
  }

  function removeChat(id) {
    deleteConversation(id).catch(() => {});
    setConversations((current) => {
      const next = current.filter((item) => item.id !== id);
      if (id !== activeId) return next;
      if (next.length) {
        setActiveId(next[0].id);
        return next;
      }
      const blank = newConversation();
      setActiveId(blank.id);
      return [blank];
    });
  }

  /* ---- asking ----------------------------------------------------------- */

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  async function ask(text = draft, { retry = false } = {}) {
    const content = text.trim();
    if (!content || busy || !model || !active || content.length > 8000) return;

    const history = active.messages;
    const base =
      retry && history.at(-1)?.role === "user" ? history.slice(0, -1) : history;
    const question = {
      id: `m-${crypto.randomUUID()}`,
      role: "user",
      content,
      at: new Date().toISOString(),
    };
    const withQuestion = { ...active, messages: [...base, question] };

    setDraft("");
    setError("");
    setBusy(true);
    setStreaming("");
    stickRef.current = true;
    setConversations((current) =>
      current.map((item) => (item.id === activeId ? withQuestion : item)),
    );

    const controller = new AbortController();
    abortRef.current = controller;

    const context = active.includeContext ? buildContext(workspace, active.contextIds) : "";
    const outbound = [
      { role: "system", content: systemPrompt() },
      ...base.map(({ role, content: value }) => ({ role, content: value })),
      {
        role: "user",
        content: context
          ? `${content}\n\n[WORKSPACE CONTEXT — the person shared these records with you]\n${context}`
          : content,
      },
    ];

    let full = "";
    try {
      await streamLocalMessage({
        model,
        messages: outbound,
        signal: controller.signal,
        onDelta: (delta) => {
          full += delta;
          setStreaming(extractActions(full).body);
        },
      });
      setStatus("ready");
    } catch (reason) {
      if (reason?.name !== "AbortError") {
        setError(reason?.message || "The local model could not answer.");
        setStatus(models.length ? "ready" : "unavailable");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }

    const { body, actions } = extractActions(full);
    setStreaming("");
    setBusy(false);
    if (!body.trim() && !actions.length) return;

    const answer = {
      id: `m-${crypto.randomUUID()}`,
      role: "assistant",
      content: body,
      at: new Date().toISOString(),
    };
    const finished = {
      ...withQuestion,
      messages: [...withQuestion.messages, answer],
      updatedAt: new Date().toISOString(),
    };
    setConversations((current) =>
      current.map((item) => (item.id === activeId ? finished : item)),
    );
    if (actions.length) setPending((current) => ({ ...current, [answer.id]: actions }));
    persist(finished);
  }

  /* ---- actions & saving -------------------------------------------------- */

  function approve(messageId, action) {
    commit((state) => applyAction(state, action, today));
    discard(messageId, action.id);
  }

  function discard(messageId, actionId) {
    setPending((current) => ({
      ...current,
      [messageId]: (current[messageId] || []).filter((item) => item.id !== actionId),
    }));
  }

  function saveToNotes(message) {
    const note = normalizeNote({
      id: `note-${crypto.randomUUID()}`,
      title: deriveTitle(active).slice(0, 80) || "Local response",
      markdown: message.content.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    commit((state) => ({ ...state, notes: [note, ...state.notes] }));
    const updated = patchActive((item) => ({
      ...item,
      messages: item.messages.map((entry) =>
        entry.id === message.id ? { ...entry, savedNoteId: note.id } : entry,
      ),
    }));
    if (updated) persist(updated);
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(message.id);
      setTimeout(() => setCopied(null), 1300);
    } catch {
      setError("Copying is unavailable here.");
    }
  }

  function toggleContext(id) {
    const updated = patchActive((item) => ({
      ...item,
      contextIds: item.contextIds.includes(id)
        ? item.contextIds.filter((value) => value !== id)
        : [...item.contextIds, id],
    }));
    if (updated) persist(updated);
  }

  function setIncludeContext(value) {
    const updated = patchActive((item) => ({ ...item, includeContext: value }));
    if (updated) persist(updated);
    if (value) setContextOpen(true);
  }

  /* ---- render ------------------------------------------------------------ */

  const visible = useMemo(
    () => searchConversations(conversations.filter((item) => item.messages.length), search),
    [conversations, search],
  );
  const contextCount = active?.contextIds.length || 0;
  const lastPrompt = messages.filter((item) => item.role === "user").at(-1)?.content || "";

  return (
    <section className="assistant" aria-label="Local AI">
      <aside className={`chat-rail ${railOpen ? "is-open" : ""}`}>
        <div className="rail-head">
          <button className="new-chat" type="button" onClick={startChat}>
            <Plus weight="bold" /> New chat
          </button>
          <button
            className="icon-button rail-close"
            type="button"
            aria-label="Close conversations"
            onClick={() => setRailOpen(false)}
          >
            <X />
          </button>
        </div>
        <label className="rail-search">
          <MagnifyingGlass />
          <input
            type="search"
            value={search}
            placeholder="Search chats"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="rail-list">
          {visible.map((conversation) => (
            <div
              className={`rail-item ${conversation.id === activeId ? "active" : ""}`}
              key={conversation.id}
            >
              <button type="button" onClick={() => selectChat(conversation.id)}>
                <strong>{deriveTitle(conversation)}</strong>
                <small>
                  {dayLabel(conversation.updatedAt)} · {conversation.messages.length} messages
                </small>
              </button>
              <button
                className="icon-button danger"
                type="button"
                aria-label={`Delete ${deriveTitle(conversation)}`}
                onClick={() => removeChat(conversation.id)}
              >
                <Trash />
              </button>
            </div>
          ))}
          {!visible.length && (
            <p className="rail-empty">
              {search ? "No chat matches that." : "Your conversations will collect here."}
            </p>
          )}
        </div>
        <footer className="rail-foot">
          <LockKey />
          <span>History stays on this device and is left out of workspace exports.</span>
        </footer>
      </aside>

      <div className="chat-main">
        <header className="chat-head">
          <button
            className="icon-button rail-toggle"
            type="button"
            aria-label="Show conversations"
            onClick={() => setRailOpen(true)}
          >
            <Sparkle />
          </button>
          <div className="chat-title">
            <h2>{active ? deriveTitle(active) : "Local AI"}</h2>
            <span className={`chat-status ${status}`}>
              {status === "checking" ? (
                <CircleNotch className="spin" />
              ) : status === "ready" ? (
                <Check />
              ) : (
                <WarningCircle />
              )}
              {status === "checking"
                ? "Checking this Mac"
                : status === "ready"
                  ? "Running on this Mac"
                  : "No local model"}
            </span>
          </div>
          <div className="chat-head-actions">
            <label className="model-select">
              <span className="visually-hidden">Local model</span>
              <select
                value={model}
                disabled={!models.length || busy}
                onChange={(event) => setModel(event.target.value)}
              >
                {!models.length && <option value="">No model available</option>}
                {models.map((item) => (
                  <option key={modelId(item)} value={modelId(item)}>
                    {modelLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            <button className="outline-button" type="button" onClick={startChat}>
              <Plus /> New
            </button>
          </div>
        </header>

        <div className="chat-thread" ref={threadRef} onScroll={onThreadScroll}>
          <div className="thread-inner">
            {!messages.length && !streaming && !busy && (
              <div className="chat-welcome">
                <span className="welcome-orb">
                  <Sparkle weight="fill" />
                </span>
                <h3>What are you working through?</h3>
                <p>
                  This runs entirely on your Mac. Nothing you type here leaves the device — no
                  account, no cloud, no fallback.
                </p>
                <div className="chat-starters">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      disabled={busy || !model}
                      onClick={() => ask(starter)}
                    >
                      {starter}
                      <ArrowUp />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <article className={`bubble ${message.role}`} key={message.id}>
                {message.role === "assistant" && (
                  <span className="bubble-avatar">
                    <Sparkle weight="fill" />
                  </span>
                )}
                <div className="bubble-body">
                  {message.role === "assistant" ? (
                    <Markdown text={message.content} headingOffset={2} />
                  ) : (
                    <p className="user-text">{message.content}</p>
                  )}

                  {(pending[message.id] || []).length > 0 && (
                    <div className="action-cards">
                      <p className="action-lead">Add these to your workspace?</p>
                      {pending[message.id].map((action) => {
                        const { label, detail } = describeAction(action);
                        return (
                          <div className="action-card" key={action.id}>
                            <span className="action-copy">
                              <strong>{label}</strong>
                              <small>{detail}</small>
                            </span>
                            <span className="action-buttons">
                              <button
                                className="primary-button"
                                type="button"
                                onClick={() => approve(message.id, action)}
                              >
                                <Check /> Add
                              </button>
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={() => discard(message.id, action.id)}
                              >
                                Discard
                              </button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {message.role === "assistant" && (
                    <div className="bubble-actions">
                      <button
                        type="button"
                        disabled={!!message.savedNoteId}
                        onClick={() => saveToNotes(message)}
                      >
                        {message.savedNoteId ? <Check /> : <NotePencil />}
                        {message.savedNoteId ? "Saved" : "Save to Notes"}
                      </button>
                      <button
                        type="button"
                        aria-label="Copy reply"
                        onClick={() => copyMessage(message)}
                      >
                        {copied === message.id ? <Check /> : <Copy />}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}

            {(streaming || busy) && (
              <article className="bubble assistant">
                <span className="bubble-avatar">
                  <Sparkle weight="fill" />
                </span>
                <div className="bubble-body">
                  {streaming ? (
                    <>
                      <Markdown text={streaming} headingOffset={2} />
                      <span className="caret" aria-hidden="true" />
                    </>
                  ) : (
                    <p className="thinking">
                      <CircleNotch className="spin" /> Thinking on this Mac…
                    </p>
                  )}
                </div>
              </article>
            )}
          </div>
        </div>

        {error && (
          <div className="chat-error" role="alert">
            <WarningCircle />
            <span>{error}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => (lastPrompt ? ask(lastPrompt, { retry: true }) : refreshModels())}
            >
              <ArrowClockwise /> {lastPrompt ? "Retry" : "Refresh"}
            </button>
            <button type="button" aria-label="Dismiss" onClick={() => setError("")}>
              <X />
            </button>
          </div>
        )}

        {contextOpen && active && (
          <div className="context-picker">
            <div className="context-head">
              <strong>Share specific records with this chat</strong>
              <button
                className="icon-button"
                type="button"
                aria-label="Close context picker"
                onClick={() => setContextOpen(false)}
              >
                <X />
              </button>
            </div>
            <div className="context-list">
              {(workspace.projects || []).map((project) => (
                <label key={project.id}>
                  <input
                    type="checkbox"
                    checked={active.contextIds.includes(project.id)}
                    onChange={() => toggleContext(project.id)}
                  />
                  <FolderSimple />
                  <span>{project.title}</span>
                </label>
              ))}
              {(workspace.notes || []).filter(isActiveNote).map((note) => (
                <label key={note.id}>
                  <input
                    type="checkbox"
                    checked={active.contextIds.includes(note.id)}
                    onChange={() => toggleContext(note.id)}
                  />
                  <NotePencil />
                  <span>{note.title || "Untitled note"}</span>
                </label>
              ))}
              {!workspace.notes?.some(isActiveNote) && !workspace.projects?.length && (
                <p className="rail-empty">Nothing to share yet.</p>
              )}
            </div>
          </div>
        )}

        <div className="composer">
          {voiceHint && <div className="voice-hint" role="status"><Microphone /><span><strong>Speak with Mac Dictation</strong>Press Fn twice, then speak. Your words appear here before anything is sent.</span><button type="button" aria-label="Dismiss voice instructions" onClick={() => setVoiceHint(false)}><X /></button></div>}
          <textarea
            ref={inputRef}
            rows="1"
            maxLength={8000}
            value={draft}
            disabled={busy || !model}
            placeholder={
              status === "unavailable"
                ? "Start a model in LM Studio to begin…"
                : "Ask anything. Shift + Return for a new line."
            }
            aria-label="Message the local model"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask();
              }
            }}
          />
          <div className="composer-foot">
            <button
              className={`context-toggle ${active?.includeContext ? "on" : ""}`}
              type="button"
              onClick={() => setIncludeContext(!active?.includeContext)}
            >
              <LockKey />
              {active?.includeContext
                ? `Sharing ${contextCount || "no"} record${contextCount === 1 ? "" : "s"}`
                : "Private to this chat"}
            </button>
            {active?.includeContext && (
              <button className="context-edit" type="button" onClick={() => setContextOpen(true)}>
                Choose records
              </button>
            )}
            <span className="composer-spacer" />
            <button className="voice-button" type="button" aria-label="Speak with Mac Dictation" title="Speak with Mac Dictation" disabled={busy || !model} onClick={() => { setVoiceHint(true); inputRef.current?.focus(); }}><Microphone /> Speak</button>
            {busy ? (
              <button className="primary-button send" type="button" onClick={cancel}>
                <Stop weight="fill" /> Stop
              </button>
            ) : (
              <button
                className="primary-button send"
                type="button"
                disabled={!draft.trim() || !model}
                onClick={() => ask()}
              >
                <ArrowUp weight="bold" /> Ask
              </button>
            )}
          </div>
        </div>

        <footer className="chat-foot">
          <span>
            <LockKey /> Local runtime only · no cloud fallback
          </span>
          <button type="button" onClick={() => navigate?.("Settings")}>
            Privacy & storage
          </button>
        </footer>
      </div>

      {railOpen && <div className="rail-scrim" onClick={() => setRailOpen(false)} />}
    </section>
  );
}
