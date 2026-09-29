import { useEffect, useRef, useState } from "react";
import { Check, Database, DeviceMobile, DownloadSimple, FolderOpen, GearSix, Keyboard, LockSimple, Printer, Sparkle, UploadSimple } from "@phosphor-icons/react";
import { downloadFile, formatRelativeTime } from "../lib/ui.js";
import { localDateKey } from "../daily-practice.js";
import { makeBackup, readWorkspaceBackup } from "../osat-data.js";
import { workspaceClient } from "../store/useWorkspace.js";
import { AppearanceControls } from "../shell/Shell.jsx";
import { setupLine, useAi } from "../assistant/useAi.js";
import { ObsidianView } from "./Obsidian.jsx";
import { useUndoToast } from "../lib/UndoToast.jsx";

export function SettingsView({ workspace, commit, storage, target }) {
  const restoreInputRef = useRef(null);
  const [toast, showUndo] = useUndoToast();
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
      showUndo("That file isn’t a backup OSAT can read.");
      return;
    }
    let restored;
    try {
      restored = readWorkspaceBackup(payload);
    } catch (error) {
      showUndo(error.message);
      return;
    }
    const before = workspace;
    try {
      await workspaceClient().replace(restored);
      showUndo(`Restored the backup (${restored.notes.length} notes)`, () => workspaceClient().replace(before).catch(() => {}));
    } catch (error) {
      showUndo(`The backup couldn’t be restored: ${error.message}`);
    }
  }
  const about = useAbout();
  const [section, setSection] = useState(() => sectionFor(target?.section));
  useEffect(() => { if (target?.section) setSection(sectionFor(target.section)); }, [target]);

  return (
    <div className="settings">
      <nav className="settings-rail" aria-label="Settings sections">
        {SECTIONS.map(([id, label, Icon]) => (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
            <Icon weight={section === id ? "fill" : "regular"} /> {label}
          </button>
        ))}
      </nav>
      {toast}
      <div className="settings-page" key={section}>
        {section === "general" && (
          <>
            <ShortcutCard />
            <section className="content-card">
              <p className="eyebrow">KEYBOARD</p>
              <h2>Everything is a key away.</h2>
              <dl className="key-list">
                {[["⌘1 – ⌘5", "Desk, Notes, Sky, Ask, Files"], ["⌘K", "Find anything"], ["⇧⌘N", "A new sticky"], ["⌘,", "Settings"], ["esc", "Back out, one step at a time"]].map(([keys, what]) => (
                  <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>
                ))}
              </dl>
            </section>
            <section className="content-card">
              <p className="eyebrow">APPEARANCE</p>
              <h2>Make yourself at home.</h2>
              <div className="appearance-card">
                <AppearanceControls workspace={workspace} commit={commit} />
              </div>
            </section>
          </>
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
                <span><Check /> No account, and nothing leaves this Mac unless you link your iPhone</span>
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
              <p>One file with every note and node. Restoring keeps a copy of what it replaces.</p>
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
            <ScansCard />
            <PhoneCards />
            <section className="content-card">
              <p className="eyebrow">ABOUT</p>
              <h2>OSAT{about?.version ? ` ${about.version}` : ""}</h2>
              <p>A calm layer over your Mac. Everything, the AI included, stays on this Mac. Cloud accounts, provider calendars and automatic filing are off by design.</p>
              {about?.dataFolder && <p className="settings-path">{about.dataFolder}</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const SECTIONS = [
  ["general", "General", GearSix],
  ["ai", "AI", Sparkle],
  ["data", "Data", Database],
];
/* Older names (the tray's "shortcut", Tools → "appearance") land where those cards live now. */
const MOVED = { appearance: "general", shortcut: "general", iphone: "data", about: "data" };
const sectionFor = (id) => SECTIONS.some(([known]) => known === id) ? id : MOVED[id] || "general";

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
              Delete {tier.label} from this Mac ({gb(tier.size)})
            </button>
          ))}
        </p>
      )}
      <p className="ai-note">{others.length ? `LM Studio is running too: ${others.map((model) => model.name).slice(0, 2).join(", ")} ${others.length === 1 ? "appears" : "appear"} in Ask.` : "LM Studio also works: while its local server runs, its models appear in Ask."}</p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

/* Scans: the folder a scanner saves to. Each new scan is read and sorted into a node on this Mac. */
function ScansCard() {
  const bridge = window.osatScans;
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!bridge) return undefined;
    bridge.status().then(setStatus).catch(() => {});
    return bridge.onStatus(setStatus);
  }, [bridge]);
  const act = async (work) => {
    setMessage("");
    try {
      setStatus(await work());
    } catch (error) {
      setMessage(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  };
  if (!bridge) return null;
  const folder = status?.dir ? status.dir.split("/").filter(Boolean).at(-1) : "";
  return (
    <section className="content-card">
      <p className="eyebrow">SCANS</p>
      {status?.dir ? (
        <>
          <h2>Scans become nodes.</h2>
          <p>
            {status.error || (status.waiting
              ? "A scan is being sorted now."
              : status.last
                ? `Watching ${folder}. The last scan came in ${formatRelativeTime(status.last)}.`
                : `Watching ${folder}. Scan something and it appears in the Sky in a minute or two.`)}
          </p>
          <div className="button-row">
            <button className="outline-button" type="button" onClick={() => bridge.show().catch(() => {})}><FolderOpen /> Show the folder</button>
            <button className="text-button" type="button" onClick={() => act(bridge.choose)}>Choose another folder</button>
            <button className="text-button" type="button" onClick={() => act(bridge.stop)}>Stop</button>
          </div>
        </>
      ) : (
        <>
          <h2>Turn paper into a node.</h2>
          <p>Choose the folder your scanner saves to. Each new scan is read on this Mac, and the AI sorts it into a node with branches, waiting for you in the Sky. A single sticky comes in as one sticky. A date becomes a question: add it to your Calendar? Scans already in the folder are left alone.</p>
          <button className="primary-button" type="button" onClick={() => act(bridge.choose)}><Printer /> Choose the scans folder</button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

/* Your iPhone, through an OSAT folder in iCloud Drive. The one thing that leaves the Mac, so it is off until chosen. */
function PhoneCards() {
  const bridge = window.osatPhone;
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return undefined;
    bridge.status().then(setStatus).catch(() => {});
    return bridge.onStatus(setStatus);
  }, [bridge]);
  const act = async (work) => {
    setBusy(true);
    setMessage("");
    try {
      setStatus(await work());
    } catch (error) {
      setMessage(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };

  if (!bridge) {
    return (
      <section className="content-card">
        <p className="eyebrow">IPHONE</p>
        <h2>The iPhone link lives in the Mac app.</h2>
        <p>In the Mac app, OSAT can keep a folder in your iCloud Drive for your iPhone.</p>
      </section>
    );
  }
  if (!status?.enabled) {
    return (
      <section className="content-card phone-card">
        <p className="eyebrow">IPHONE</p>
        <h2>Reach OSAT from your iPhone.</h2>
        <p>OSAT can keep a folder in your iCloud Drive. Text you drop into it from your iPhone becomes a sticky in Unsorted, and a copy of your notes waits there to read.</p>
        <p className="phone-privacy"><LockSimple /> This is the one thing that leaves this Mac. It goes to your own iCloud Drive, which Apple keeps; turn on Advanced Data Protection in iCloud settings for end-to-end encryption.</p>
        <button className="primary-button" type="button" disabled={busy} onClick={() => act(bridge.enable)}>
          <DeviceMobile /> Use iCloud Drive
        </button>
        {message && <p role="status">{message}</p>}
      </section>
    );
  }
  return (
    <>
      <section className="content-card phone-card">
        <p className="eyebrow">IPHONE</p>
        <h2>Your iPhone can reach OSAT.</h2>
        <p>
          {status.error || status.sync?.error || (status.lastCapture ? `The last sticky from your iPhone arrived ${formatRelativeTime(status.lastCapture)}.` : "Nothing from your iPhone yet. Stickies land in Unsorted a few seconds after iCloud brings them.")}
        </p>
        {status.sync?.on && (
          <p className="phone-sync">
            {status.sync.devices
              ? `In step with ${status.sync.devices === 1 ? "one other device" : `${status.sync.devices} other devices`}${status.sync.lastArrival ? `; the last change arrived ${formatRelativeTime(status.sync.lastArrival)}` : ""}.`
              : "Ready to keep other devices in step. The OSAT iPhone app, and any other Mac with OSAT, will use it."}
          </p>
        )}
        <div className="button-row">
          <button className="outline-button" type="button" onClick={() => bridge.show().catch(() => {})}><FolderOpen /> Show the folder</button>
          <button className="text-button" type="button" disabled={busy} onClick={() => act(bridge.disable)}>Turn off and remove the copy of your notes</button>
        </div>
        {message && <p role="status">{message}</p>}
      </section>
      <section className="content-card">
        <p className="eyebrow">SEND A THOUGHT</p>
        <h2>Make “Add to OSAT” once.</h2>
        <ol className="phone-steps">
          <li>On your iPhone, open <b>Shortcuts</b> and tap <b>+</b>.</li>
          <li>Add <b>Ask for Input</b>. To speak instead, add <b>Dictate Text</b>.</li>
          <li>Add <b>Save File</b>, tap its folder, and choose <b>iCloud Drive → OSAT → Inbox</b>.</li>
          <li>Name it <b>Add to OSAT</b>, then put it on your Home Screen or the Action button.</li>
        </ol>
        <p>From any app, Share → Save to Files → OSAT → Inbox works too.</p>
      </section>
      <section className="content-card">
        <p className="eyebrow">READ YOUR NOTES</p>
        <h2>Files → iCloud Drive → OSAT → Notes.</h2>
        <p>A copy that follows your notes as you write, in the same nodes. Write in OSAT; changes made to the copy aren’t read back.</p>
      </section>
    </>
  );
}

/* The key that shows the OSAT desk from anywhere. Recorded from event.code,
   because ⌥ changes event.key on a Mac. */
const KEY_NAMES = { Space: "Space", Tab: "Tab", Enter: "Return", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  const match = /^(?:Key([A-Z])|Digit([0-9])|(F[0-9]{1,2}))$/.exec(code);
  return match ? match[1] || match[2] || match[3] : null;
}

function ShortcutCard() {
  const bridge = window.osatDesk;
  const [info, setInfo] = useState(null);
  const [recording, setRecording] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => { bridge?.prefs().then(setInfo).catch(() => {}); }, [bridge]);
  if (!bridge) return null;

  async function record(event, which) {
    if (recording !== which) return;
    event.preventDefault();
    if (event.key === "Escape") { setRecording(null); return; }
    const key = keyName(event.code);
    if (!key) return; // only a modifier so far
    const modifiers = [event.metaKey && "Command", event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift"].filter(Boolean);
    if (!modifiers.length) { setMessage("Hold ⌘, ⌃, ⌥ or ⇧ together with a key."); return; }
    setRecording(null);
    try {
      const saved = await bridge.setHotkey([...modifiers, key].join("+"), which);
      setInfo((value) => (which === "chat" ? { ...value, chat: saved } : { ...value, ...saved }));
      setMessage("Saved. Try it from any app.");
    } catch (error) {
      setMessage(String(error?.message || "That shortcut didn’t work.").replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  }

  const button = (which, shortcut, fallback) => (
    <button
      type="button"
      className={recording === which ? "primary-button" : "outline-button"}
      onClick={() => { setMessage(""); setRecording((value) => (value === which ? null : which)); }}
      onKeyDown={(event) => record(event, which)}
      onBlur={() => setRecording(null)}
    >
      <Keyboard /> {recording === which ? "Press the new shortcut…" : shortcut?.failed ? "Choose a shortcut" : `${shortcut?.label || fallback} · Change`}
    </button>
  );

  return (
    <section className="content-card">
      <p className="eyebrow">SHORTCUTS</p>
      <h2>{info?.failed ? "Pick a key for OSAT." : "OSAT, from anywhere."}</h2>
      <div className="shortcut-row">
        <p>
          <strong>The desk</strong>
          {info?.failed
            ? `${info.label} is already used by another app, so OSAT can’t listen for it. Choose a different shortcut.`
            : "Brings OSAT up over your desktop. Press it again, or Esc, to put it away."}
        </p>
        {button("layer", info, "⌥Space")}
      </div>
      <div className="shortcut-row">
        <p>
          <strong>Quick chat</strong>
          {info?.chat?.failed
            ? `${info.chat.label} is already used by another app. Choose a different shortcut.`
            : "Ask in a small window that floats over your other apps."}
        </p>
        {button("chat", info?.chat, "⌥⇧Space")}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
