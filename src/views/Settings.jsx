import { useEffect, useRef, useState } from "react";
import { Check, CircleHalf, Database, DownloadSimple, FolderOpen, GearSix, Info, Keyboard, Sparkle, UploadSimple } from "@phosphor-icons/react";
import { downloadFile } from "../lib/ui.js";
import { localDateKey } from "../daily-practice.js";
import { makeBackup, readWorkspaceBackup } from "../osat-data.js";
import { workspaceClient } from "../store/useWorkspace.js";
import { AppearanceControls } from "../shell/Shell.jsx";
import { setupLine, useAi } from "../assistant/useAi.js";
import { ObsidianView } from "./Obsidian.jsx";

export function SettingsView({ workspace, commit, storage, target }) {
  const restoreInputRef = useRef(null);
  function backup() {
    const payload = makeBackup(workspace);
    downloadFile(
      `osat-backup-${localDateKey()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  }
  async function restore(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      window.alert("That file isn't valid JSON.");
      return;
    }
    let restored;
    try {
      restored = readWorkspaceBackup(payload);
    } catch (error) {
      window.alert(error.message);
      return;
    }
    if (!window.confirm(`Replace your current workspace with this backup (${restored.notes.length} notes)? OSAT keeps a copy of your current workspace in its data folder first.`)) {
      return;
    }
    try {
      await workspaceClient().replace(restored);
    } catch (error) {
      window.alert(`The backup couldn't be restored: ${error.message}`);
    }
  }
  const about = useAbout();
  const [section, setSection] = useState(target?.section && SECTIONS.some(([id]) => id === target.section) ? target.section : "general");
  useEffect(() => { if (target?.section) setSection(target.section); }, [target]);

  return (
    <div className="settings">
      <nav className="settings-rail" aria-label="Settings sections">
        {SECTIONS.map(([id, label, Icon]) => (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
            <Icon weight={section === id ? "fill" : "regular"} /> {label}
          </button>
        ))}
      </nav>
      <div className="settings-page" key={section}>
        {section === "general" && (
          <>
            <ShortcutCard />
            <section className="content-card">
              <p className="eyebrow">KEYBOARD</p>
              <h2>Everything is a key away.</h2>
              <dl className="key-list">
                {[["⌘1 – ⌘4", "Desk, Notes, Map, Ask"], ["⌘K", "Find anything"], ["⇧⌘N", "A new thought"], ["⌘,", "Settings"], ["esc", "Back out, one step at a time"]].map(([keys, what]) => (
                  <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>
                ))}
              </dl>
            </section>
          </>
        )}
        {section === "appearance" && (
          <section className="content-card">
            <p className="eyebrow">APPEARANCE</p>
            <h2>Make yourself at home.</h2>
            <div className="appearance-card">
              <AppearanceControls workspace={workspace} commit={commit} />
            </div>
          </section>
        )}
        {section === "ai" && <AiCard />}
        {section === "data" && (
          <>
            <section className="content-card">
              <p className="eyebrow">ON THIS MAC</p>
              <h2>{storage.status === "error" ? "Saving needs attention." : "Your workspace stays here."}</h2>
              <p>{storage.message}</p>
              <div className="storage-facts">
                <span><Check /> Saved a moment after every change, with 14 daily copies kept</span>
                <span><Check /> No cloud sync, no account</span>
              </div>
              {window.osatApp?.showDataFolder && (
                <button className="outline-button" type="button" onClick={() => window.osatApp.showDataFolder().catch(() => {})}>
                  <FolderOpen /> Show the data folder
                </button>
              )}
            </section>
            <section className="content-card">
              <p className="eyebrow">BACKUP</p>
              <h2>Take your work with you.</h2>
              <p>One file with every note, folder and board. Restoring keeps a copy of what it replaces.</p>
              <div className="button-row">
                <button className="primary-button" type="button" onClick={backup}>
                  <DownloadSimple /> Download a backup
                </button>
                <button className="outline-button" type="button" onClick={() => restoreInputRef.current?.click()}>
                  <UploadSimple /> Restore a backup
                </button>
              </div>
              <input ref={restoreInputRef} type="file" accept="application/json" hidden onChange={restore} />
            </section>
            <section className="content-card settings-obsidian">
              <p className="eyebrow">OBSIDIAN</p>
              <h2>Send notes to a vault.</h2>
              <ObsidianView workspace={workspace} commit={commit} />
            </section>
          </>
        )}
        {section === "about" && (
          <section className="content-card">
            <p className="eyebrow">ABOUT</p>
            <h2>OSAT{about?.version ? ` ${about.version}` : ""}</h2>
            <p>A calm layer over your Mac. Everything, the AI included, stays on this Mac. Cloud accounts, provider calendars and automatic filing are off by design.</p>
            {about?.dataFolder && <p className="settings-path">{about.dataFolder}</p>}
          </section>
        )}
      </div>
    </div>
  );
}

const SECTIONS = [
  ["general", "General", GearSix],
  ["appearance", "Appearance", CircleHalf],
  ["ai", "AI", Sparkle],
  ["data", "Data", Database],
  ["about", "About", Info],
];

function useAbout() {
  const [about, setAbout] = useState(null);
  useEffect(() => { window.osatApp?.about?.().then(setAbout).catch(() => {}); }, []);
  return about;
}

const gb = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;

/* The three sizes of built-in AI. Choosing one downloads it once, in the background. */
export function AiSizes({ status, value, onChoose }) {
  return (
    <div className="ai-sizes" role="radiogroup" aria-label="AI size">
      {status.tiers.map((tier) => (
        <button key={tier.id} type="button" role="radio" className="ai-size" aria-checked={value === tier.id} onClick={() => onChoose(tier.id)}>
          <strong>
            {tier.label}
            {tier.id === status.recommended && <em>Best for this Mac</em>}
          </strong>
          <span>{tier.blurb}</span>
          <small>{tier.model} · {gb(tier.size)}{tier.ready ? " · on this Mac" : ""}</small>
        </button>
      ))}
    </div>
  );
}

function AiCard() {
  const { status, models, bridge } = useAi();
  const [message, setMessage] = useState("");
  const act = (work) => work().catch((error) => setMessage(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")));
  const others = (models || []).filter((model) => model.runtime !== "osat");

  if (!bridge?.status) {
    return (
      <section className="content-card">
        <p className="eyebrow">LOCAL AI</p>
        <h2>{models?.length ? "A model is ready." : "The AI lives in the Mac app."}</h2>
        <p>{models?.length ? `${models.map((model) => model.name || model.id).slice(0, 3).join(", ")}, through LM Studio.` : "In the Mac app, OSAT downloads its own AI and runs it on your Mac. Here in the preview, LM Studio's local server works."}</p>
      </section>
    );
  }
  if (!status) return <section className="content-card"><p className="eyebrow">LOCAL AI</p><h2>Looking at this Mac…</h2></section>;

  const chosen = status.tiers.find((tier) => tier.id === status.chosen);
  const download = status.download;
  const percent = download ? Math.floor((download.received / download.total) * 100) : 0;
  const headline = download?.state === "running" ? `Setting up ${status.tiers.find((tier) => tier.id === download.tier)?.label || "the AI"}…`
    : download?.state === "failed" ? "The download stopped."
      : download?.state === "paused" ? `Paused at ${percent}%.`
        : chosen?.ready ? `${chosen.model} runs on this Mac.`
          : "Choose how much AI this Mac runs.";
  const detail = download?.state === "failed" ? download.message
    : download ? "It downloads once, in the background. OSAT works as usual meanwhile, and a quit or a sleep just pauses it."
      : status.engine === "error" ? status.message
        : chosen?.ready ? (status.engine === "ready" ? "Awake now. It rests after ten quiet minutes to give the memory back." : "It wakes on your first question and rests after ten quiet minutes.")
          : "Everything you ask stays here: the model is one file on your Mac, and nothing is sent anywhere.";

  return (
    <section className="content-card ai-card">
      <p className="eyebrow">LOCAL AI</p>
      <h2>{headline}</h2>
      <p>{detail}</p>
      {download && (
        <div className="ai-progress">
          <progress max="100" value={percent} aria-label={setupLine(status) || "Download"} />
          <span>{gb(download.received)} of {gb(download.total)}</span>
          {download.state === "running"
            ? <button type="button" className="text-button" onClick={() => act(bridge.cancel)}>Pause</button>
            : <button type="button" className="text-button" onClick={() => act(bridge.resume)}>{download.state === "failed" ? "Try again" : "Resume"}</button>}
        </div>
      )}
      <AiSizes status={status} value={status.chosen} onChoose={(tier) => act(() => bridge.choose(tier))} />
      {status.tiers.some((tier) => tier.ready && tier.id !== status.chosen) && (
        <p className="ai-remove">
          {status.tiers.filter((tier) => tier.ready && tier.id !== status.chosen).map((tier) => (
            <button key={tier.id} type="button" className="text-button" onClick={() => act(() => bridge.remove(tier.id))}>
              Remove {tier.label} from this Mac ({gb(tier.size)})
            </button>
          ))}
        </p>
      )}
      <p className="ai-note">{others.length ? `LM Studio is running too: ${others.map((model) => model.name).slice(0, 2).join(", ")} ${others.length === 1 ? "appears" : "appear"} in Ask.` : "LM Studio also works: while its local server runs, its models appear in Ask."}</p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

/* The key that shows the OSAT layer from anywhere. Recorded from event.code,
   because ⌥ changes event.key on a Mac. */
const KEY_NAMES = { Space: "Space", Tab: "Tab", Enter: "Return", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  const match = /^(?:Key([A-Z])|Digit([0-9])|(F[0-9]{1,2}))$/.exec(code);
  return match ? match[1] || match[2] || match[3] : null;
}

function ShortcutCard() {
  const bridge = window.osatOverlay;
  const [info, setInfo] = useState(null);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { bridge?.prefs().then(setInfo).catch(() => {}); }, [bridge]);
  if (!bridge) return null;

  async function record(event) {
    if (!recording) return;
    event.preventDefault();
    if (event.key === "Escape") { setRecording(false); return; }
    const key = keyName(event.code);
    if (!key) return; // only a modifier so far
    const modifiers = [event.metaKey && "Command", event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
    if (!modifiers.length) { setMessage("Hold ⌘, ⌃, ⌥ or ⇧ together with a key."); return; }
    setRecording(false);
    try {
      setInfo({ ...info, ...(await bridge.setHotkey([...modifiers, key].join("+"))) });
      setMessage("Saved. Try it from any app.");
    } catch (error) {
      setMessage(String(error?.message || "That shortcut didn’t work.").replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  }

  return (
    <section className="content-card">
      <p className="eyebrow">SHORTCUT</p>
      <h2>{info?.failed ? "Pick a key for the OSAT layer." : "The OSAT layer, from anywhere."}</h2>
      <p>
        {info?.failed
          ? `${info.label} is already used by another app, so OSAT can’t listen for it. Choose a different shortcut.`
          : "Press it in any app to drop a thought, find something or ask. Esc puts it away."}
      </p>
      <button
        type="button"
        className={recording ? "primary-button" : "outline-button"}
        onClick={() => { setMessage(""); setRecording((value) => !value); }}
        onKeyDown={record}
        onBlur={() => setRecording(false)}
      >
        <Keyboard /> {recording ? "Press the new shortcut…" : info?.failed ? "Choose a shortcut" : `${info?.label || "⌥Space"} · Change`}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
