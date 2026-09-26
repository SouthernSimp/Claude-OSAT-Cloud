import {
  ArrowClockwise,
  ArrowUp,
  Check,
  CircleNotch,
  Copy,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { streamLocalMessage } from "../local-ai.js";
import { normalizeNote } from "../osat-data.js";
import { localDateKey } from "../daily-practice.js";
import { Markdown } from "../lib/markdown.jsx";
import { isActiveNote, relatedNotes } from "../notes-model.js";
import { applyAction, describeAction, extractActions, systemPrompt, wantsActions } from "./actions.js";
import { deriveTitle, newChat, newestFirst, newMessage, outbound, putChat, removeChat, searchChats } from "./chats.js";
import { cleanError, setupLine, useAi } from "./useAi.js";
import "../styles/assistant.css";

const STARTERS = [
  "I have a lot on my mind. Help me untangle it.",
  "Help me find one small next step.",
  "I'd like to think out loud for a minute.",
  "Help me gently reflect on my day.",
];

export const modelLabel = (model) =>
  typeof model === "string" ? model : model?.name || model?.id || "Local model";

const dayLabel = (iso) => {
  const date = new Date(iso);
  const key = localDateKey(date);
  if (key === localDateKey()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === localDateKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
};

/* Accept or decline what the AI proposes. Nothing is added without a click. */
export function ActionCards({ actions, onAdd, onDiscard }) {
  if (!actions?.length) return null;
  return (
    <div className="action-cards">
      <p className="action-lead">Add these to your workspace?</p>
      {actions.map((action) => {
        const { label, detail } = describeAction(action);
        return (
          <div className="action-card" key={action.id}>
            <span className="action-copy">
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
            <span className="action-buttons">
              <button className="primary-button" type="button" onClick={() => onAdd(action)}>
                <Check /> Add
              </button>
              <button className="ghost-button" type="button" onClick={() => onDiscard(action)}>
                Discard
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* The notes a question used, as small links back to them. */
export function UsedNotes({ ids, notes, onOpen }) {
  const used = (ids || []).map((id) => notes.find((note) => note.id === id)).filter(Boolean);
  if (!used.length) return null;
  return (
    <p className="bubble-notes">
      <span>From your notes</span>
      {used.map((note) => (
        <button key={note.id} type="button" onClick={() => onOpen(note.id)}>
          <NotePencil /> {note.title || "Untitled"}
        </button>
      ))}
    </p>
  );
}

/* Ask: conversations with the AI on this Mac. Each question reads the notes it
   matches, shown as chips you can remove before sending. `initialPrompt` is a
   hand-off from elsewhere: { prompt, at } opens a new chat with the text waiting,
   { chatId, at } opens that chat. */
export function LocalAssistant({ workspace, commit, navigate, initialPrompt = null }) {
  const { models, status: ai } = useAi();
  const [model, setModel] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState("");
  const [dropped, setDropped] = useState(() => new Set());
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState({});
  const [railOpen, setRailOpen] = useState(false);
  const [voiceHint, setVoiceHint] = useState(false);

  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const threadRef = useRef(null);
  const stickRef = useRef(true);

  const chats = useMemo(() => newestFirst(workspace.chats), [workspace.chats]);
  const active = chats.find((chat) => chat.id === activeId) || null;
  const messages = active?.messages || [];
  const today = localDateKey();
  const status = models === null ? "checking" : models.length ? "ready" : "unavailable";
  const setup = setupLine(ai);

  useEffect(() => {
    if (!models) return;
    setModel((current) => (current && models.some((item) => item.id === current) ? current : models[0]?.id || ""));
  }, [models]);

  const handedOff = useRef(null);
  useEffect(() => {
    if (!initialPrompt || handedOff.current === initialPrompt.at) return;
    handedOff.current = initialPrompt.at;
    abortRef.current?.abort();
    if (typeof initialPrompt.chatId === "string") {
      setActiveId(initialPrompt.chatId);
      setDraft("");
    } else {
      setActiveId(null);
      setDraft(String(initialPrompt.prompt || "").slice(0, 8000));
    }
  }, [initialPrompt?.at]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /* The notes this question will read. A follow-up with no matches of its own keeps the notes already in play. */
  useEffect(() => {
    const timer = setTimeout(() => setAsking(draft), 250);
    return () => clearTimeout(timer);
  }, [draft]);
  const earlierIds = [...messages].reverse().find((message) => message.role === "user" && message.noteIds?.length)?.noteIds || [];
  const pickNotes = (text) => {
    if (!text.trim()) return [];
    const found = relatedNotes(workspace.notes, text).map((note) => note.id);
    return (found.length ? found : earlierIds).filter((id) => !dropped.has(id) && isActiveNote(workspace.notes.find((note) => note.id === id)));
  };
  const using = useMemo(() => pickNotes(asking), [asking, workspace.notes, dropped, earlierIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  function onThreadScroll(event) {
    const node = event.currentTarget;
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  function startChat() {
    abortRef.current?.abort();
    setActiveId(null);
    setDraft("");
    setDropped(new Set());
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

  function deleteChat(id) {
    if (id === activeId) startChat();
    commit((state) => removeChat(state, id));
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  async function ask(text = draft, { retry = false } = {}) {
    const content = text.trim();
    if (!content || busy || !model || content.length > 8000) return;
    const noteIds = text === asking ? using : pickNotes(content);
    let base = active || newChat();
    if (retry && base.messages.at(-1)?.role === "user") base = { ...base, messages: base.messages.slice(0, -1) };
    const question = newMessage("user", content, noteIds.length ? { noteIds } : {});
    const chat = { ...base, messages: [...base.messages, question] };
    commit((state) => putChat(state, chat));
    setActiveId(chat.id);
    setDraft("");
    setDropped(new Set());
    setError("");
    setBusy(true);
    setStreaming("");
    stickRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    let full = "";
    try {
      await streamLocalMessage({
        model,
        messages: outbound(systemPrompt(), base.messages, content, workspace.notes, noteIds),
        signal: controller.signal,
        onDelta: (delta) => {
          full += delta;
          setStreaming(extractActions(full).body);
        },
      });
    } catch (reason) {
      if (reason?.name !== "AbortError") setError(cleanError(reason) || "The AI could not answer.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }

    const { body, actions } = extractActions(full);
    setStreaming("");
    setBusy(false);
    if (!body.trim()) return;
    const answer = newMessage("assistant", body);
    commit((state) => {
      const saved = (state.chats || []).find((item) => item.id === chat.id) || chat;
      return putChat(state, { ...saved, messages: [...saved.messages, answer] });
    });
    if (actions.length && wantsActions(content)) setPending((current) => ({ ...current, [answer.id]: actions }));
  }

  function approve(messageId, action) {
    commit((state) => applyAction(state, action, today));
    discard(messageId, action);
  }

  function discard(messageId, action) {
    setPending((current) => ({ ...current, [messageId]: (current[messageId] || []).filter((item) => item.id !== action.id) }));
  }

  function saveToNotes(message) {
    const note = normalizeNote({
      id: `note-${crypto.randomUUID()}`,
      title: deriveTitle(active).slice(0, 80) || "From Ask",
      markdown: message.content.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    commit((state) => {
      const saved = (state.chats || []).find((item) => item.id === active.id);
      const next = { ...state, notes: [note, ...state.notes] };
      return saved ? putChat(next, { ...saved, messages: saved.messages.map((entry) => (entry.id === message.id ? { ...entry, savedNoteId: note.id } : entry)) }) : next;
    });
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

  const openNote = (noteId) => navigate?.("Notes", { noteId });
  const visible = useMemo(() => searchChats(chats, search), [chats, search]);
  const lastPrompt = messages.at(-1)?.role === "user" ? messages.at(-1).content : "";
  const noteTitle = (id) => workspace.notes.find((note) => note.id === id)?.title || "Untitled";

  return (
    <section className="assistant" aria-label="Ask">
      <aside className={`chat-rail ${railOpen ? "is-open" : ""}`}>
        <div className="rail-head">
          <button className="new-chat" type="button" onClick={startChat}>
            <Plus weight="bold" /> New chat
          </button>
          <button className="icon-button rail-close" type="button" aria-label="Close conversations" onClick={() => setRailOpen(false)}>
            <X />
          </button>
        </div>
        <label className="rail-search">
          <MagnifyingGlass />
          <input type="search" value={search} placeholder="Search chats" onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="rail-list">
          {visible.map((chat) => (
            <div className={`rail-item ${chat.id === activeId ? "active" : ""}`} key={chat.id}>
              <button type="button" onClick={() => selectChat(chat.id)}>
                <strong>{deriveTitle(chat)}</strong>
                <small>{dayLabel(chat.updatedAt)} · {chat.messages.length} messages</small>
              </button>
              <button className="icon-button danger" type="button" aria-label={`Delete ${deriveTitle(chat)}`} onClick={() => deleteChat(chat.id)}>
                <Trash />
              </button>
            </div>
          ))}
          {!visible.length && <p className="rail-empty">{search ? "No chat matches that." : "Your conversations will collect here."}</p>}
        </div>
        <footer className="rail-foot">
          <LockKey />
          <span>Chats are saved with your notes, on this Mac.</span>
        </footer>
      </aside>

      <div className="chat-main">
        <header className="chat-head">
          <button className="icon-button rail-toggle" type="button" aria-label="Show conversations" onClick={() => setRailOpen(true)}>
            <Sparkle />
          </button>
          <div className="chat-title">
            <h2>{active ? deriveTitle(active) : "New chat"}</h2>
            <span className={`chat-status ${status}`}>
              {status === "checking" ? <CircleNotch className="spin" /> : status === "ready" ? <Check /> : <WarningCircle />}
              {status === "checking" ? "Checking this Mac" : status === "ready" ? `${modelLabel(models.find((item) => item.id === model))} · on this Mac` : setup || "No AI set up yet"}
            </span>
          </div>
          <div className="chat-head-actions">
            {models?.length > 1 && (
              <label className="model-select">
                <span className="visually-hidden">Model</span>
                <select value={model} disabled={busy} onChange={(event) => setModel(event.target.value)}>
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>{modelLabel(item)}</option>
                  ))}
                </select>
              </label>
            )}
            <button className="outline-button" type="button" onClick={startChat}>
              <Plus /> New
            </button>
          </div>
        </header>

        <div className="chat-thread" ref={threadRef} onScroll={onThreadScroll}>
          <div className="thread-inner">
            {!messages.length && !streaming && !busy && (
              <div className="chat-welcome">
                <span className="welcome-orb"><Sparkle weight="fill" /></span>
                {status === "unavailable" ? (
                  <>
                    <h3>{setup || "Ask needs its AI."}</h3>
                    <p>OSAT downloads one model, once, and runs it on this Mac. Choose its size in Settings. LM Studio works too.</p>
                    <button className="primary-button" type="button" onClick={() => navigate?.("Settings", { section: "ai" })}>
                      <Sparkle /> Set up the AI
                    </button>
                  </>
                ) : (
                  <>
                    <h3>What are you working through?</h3>
                    <p>This runs entirely on your Mac. Ask reads the notes that match your question, and shows which.</p>
                    <div className="chat-starters">
                      {STARTERS.map((starter) => (
                        <button key={starter} type="button" disabled={busy || !model} onClick={() => ask(starter)}>
                          {starter}
                          <ArrowUp />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {messages.map((message) => (
              <article className={`bubble ${message.role}`} key={message.id}>
                {message.role === "assistant" && <span className="bubble-avatar"><Sparkle weight="fill" /></span>}
                <div className="bubble-body">
                  {message.role === "assistant" ? <Markdown text={message.content} headingOffset={2} /> : <p className="user-text">{message.content}</p>}
                  {message.role === "user" && <UsedNotes ids={message.noteIds} notes={workspace.notes} onOpen={openNote} />}
                  <ActionCards actions={pending[message.id]} onAdd={(action) => approve(message.id, action)} onDiscard={(action) => discard(message.id, action)} />
                  {message.role === "assistant" && (
                    <div className="bubble-actions">
                      <button type="button" disabled={!!message.savedNoteId} onClick={() => saveToNotes(message)}>
                        {message.savedNoteId ? <Check /> : <NotePencil />}
                        {message.savedNoteId ? "Saved" : "Save to Notes"}
                      </button>
                      <button type="button" aria-label="Copy reply" onClick={() => copyMessage(message)}>
                        {copied === message.id ? <Check /> : <Copy />}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}

            {(streaming || busy) && (
              <article className="bubble assistant">
                <span className="bubble-avatar"><Sparkle weight="fill" /></span>
                <div className="bubble-body">
                  {streaming ? (
                    <>
                      <Markdown text={streaming} headingOffset={2} />
                      <span className="caret" aria-hidden="true" />
                    </>
                  ) : (
                    <p className="thinking"><CircleNotch className="spin" /> Thinking on this Mac…</p>
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
            {lastPrompt && (
              <button type="button" disabled={busy} onClick={() => ask(lastPrompt, { retry: true })}>
                <ArrowClockwise /> Try again
              </button>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => setError("")}><X /></button>
          </div>
        )}

        <div className="composer">
          {voiceHint && <div className="voice-hint" role="status"><Microphone /><span><strong>Speak with Mac Dictation</strong>Press Fn twice, then speak. Your words appear here before anything is sent.</span><button type="button" aria-label="Dismiss voice instructions" onClick={() => setVoiceHint(false)}><X /></button></div>}
          {using.length > 0 && (
            <div className="ask-notes" aria-label="Notes Ask will read">
              <span>Using {using.length} {using.length === 1 ? "note" : "notes"}</span>
              {using.map((id) => (
                <span className="ask-note-chip" key={id}>
                  <NotePencil /> {noteTitle(id)}
                  <button type="button" aria-label={`Leave out ${noteTitle(id)}`} onClick={() => setDropped((current) => new Set(current).add(id))}><X /></button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            rows="1"
            maxLength={8000}
            value={draft}
            disabled={busy || !model}
            placeholder={status === "unavailable" ? "Set up the AI in Settings to begin…" : "Ask anything. Shift + Return for a new line."}
            aria-label="Ask the AI on this Mac"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask();
              }
            }}
          />
          <div className="composer-foot">
            <span className="composer-note"><LockKey /> Nothing leaves this Mac</span>
            <span className="composer-spacer" />
            <button className="voice-button" type="button" aria-label="Speak with Mac Dictation" title="Speak with Mac Dictation" disabled={busy || !model} onClick={() => { setVoiceHint(true); inputRef.current?.focus(); }}><Microphone /> Speak</button>
            {busy ? (
              <button className="primary-button send" type="button" onClick={cancel}>
                <Stop weight="fill" /> Stop
              </button>
            ) : (
              <button className="primary-button send" type="button" disabled={!draft.trim() || !model} onClick={() => ask()}>
                <ArrowUp weight="bold" /> Ask
              </button>
            )}
          </div>
        </div>

        <footer className="chat-foot">
          <span><LockKey /> Runs on this Mac · no cloud</span>
          <button type="button" onClick={() => navigate?.("Settings", { section: "ai" })}>AI settings</button>
        </footer>
      </div>

      {railOpen && <div className="rail-scrim" onClick={() => setRailOpen(false)} />}
    </section>
  );
}
