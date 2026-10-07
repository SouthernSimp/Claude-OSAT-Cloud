import { useEffect, useRef, useState } from "react";
import { Check, DeviceMobile, DownloadSimple, FolderOpen, LockSimple, Printer, UploadSimple } from "@phosphor-icons/react";
import { setupLine, useAi } from "../../assistant/useAi.js";
import { memoryResult } from "../../assistant/ModelMenu.jsx";
import { downloadFile, formatRelativeTime } from "../../lib/ui.js";
import { localDateKey } from "../../daily-practice.js";
import { makeBackup, readWorkspaceBackup } from "../../osat-data.js";
import { AppearanceControls } from "../../shell/Shell.jsx";
import { workspaceClient } from "../../store/useWorkspace.js";
import { BotsSettings } from "../Bots.jsx";
import { ObsidianView } from "../Obsidian.jsx";
import { DeskKey, useDeskKeys } from "./launcher.jsx";
import { Group, Legacy, Page, Row, Switch } from "./parts.jsx";
import { autoFileSettings } from "../../sky/auto-file.js";

/* The pages of Settings that are about OSAT itself (Phase 13b): the keys that bring it up, how it looks, the AI, bots,
   where the data lives, scans, the iPhone, About. The cards for the AI, scans and the iPhone are the ones they always
   were; only the frame around them is new. */

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

/* A page the AI reads before every answer, in plain words (like a note to a new helper). */
function AboutYouCard({ workspace, commit }) {
  const [text, setText] = useState(workspace.settings?.aboutMe || "");
  const save = () => commit((state) => ({ ...state, settings: { ...(state.settings || {}), aboutMe: text } }));
  return (
    <section className="content-card about-you">
      <p className="eyebrow">ABOUT YOU</p>
      <h2>Tell the AI who it's helping.</h2>
      <p>Write a few lines: your name, what you do, how you like answers. The AI reads this before every question. It never leaves this Mac.</p>
      <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} onBlur={save}
        placeholder={"I'm Nate. I run a small business.\nKeep answers short, with a clear next step.\nI think best in lists."} aria-label="About you" />
    </section>
  );
}

function AiCard() {
  const { status, models, bridge } = useAi();
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState("");
  const act = async (key, work) => {
    setWorking(key); setMessage("");
    try { await work(); }
    catch (error) { setMessage(String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
    finally { setWorking(""); }
  };
  const others = (models || []).filter((model) => model.runtime !== "osat");

  if (!bridge?.status) return (
    <section className="content-card">
      <p className="eyebrow">LOCAL AI</p><h2>The AI lives in the Mac app.</h2>
      <p>In the Mac app, download models, choose one for each conversation, and free AI memory whenever you need it. This browser preview can use LM Studio.</p>
    </section>
  );
  if (!status) return <section className="content-card"><p className="eyebrow">LOCAL AI</p><h2>Looking at this Mac…</h2></section>;
  const download = status.download;
  const percent = download ? Math.floor((download.received / download.total) * 100) : 0;
  const installed = status.tiers.filter((tier) => tier.ready);
  const missing = status.tiers.filter((tier) => !tier.ready);
  const rowState = (tier) => tier.state === "loading" ? "Loading…" : tier.state === "unloading" ? "Unloading…" : tier.busy ? "Busy · wait until its work finishes" : tier.state === "ready" ? tier.retained ? "Ready · stays loaded until you unload it or quit" : "Ready · rests after ten idle minutes" : tier.state === "error" ? tier.message : "Downloaded · loads on your next question";

  return (
    <section className="ai-management">
      <Group title="Your models" note="Downloads use disk space. Loading uses working memory. Every conversation can choose its own model.">
        {status.tiers.map((tier) => <Row key={tier.id} title={tier.label + (tier.id === status.recommended ? " · Recommended for this Mac" : "")}
          hint={tier.model + " · " + gb(tier.size) + " on disk. " + (tier.ready ? rowState(tier) : status.queued?.includes(tier.id) ? "Download queued" : tier.blurb)}
          words={tier.model + " load unload memory download"} stacked>
          <div className="ai-model-controls">
            {tier.ready ? <>
              <button type="button" className="outline-button" disabled={Boolean(working) || tier.busy}
                onClick={() => act(tier.id, () => tier.state === "ready" ? bridge.unload(tier.id) : bridge.load(tier.id))}>
                {tier.state === "ready" ? "Unload" : tier.state === "loading" ? "Loading…" : tier.state === "unloading" ? "Unloading…" : "Load"}
              </button>
              <label className="ai-retain"><Switch label={"Keep " + tier.label + " loaded"} checked={Boolean(tier.retained)}
                disabled={Boolean(working) || tier.state === "loading" || tier.state === "unloading"}
                onChange={(value) => act(tier.id, () => bridge.keepLoaded(tier.id, value))} /> Keep loaded</label>
              <button type="button" className="text-button" disabled={Boolean(working) || status.chosen === tier.id}
                onClick={() => act(tier.id, () => bridge.select(tier.id))}>{status.chosen === tier.id ? "Default for new chats" : "Use for new chats"}</button>
              <button type="button" className="text-button" disabled={Boolean(working) || tier.busy}
                onClick={() => { if (window.confirm("Delete the " + tier.label + " downloaded model (" + gb(tier.size) + ")? You will need to download it again. Conversations stay here.")) act(tier.id, () => bridge.remove(tier.id)); }}>Delete download</button>
            </> : <button type="button" className="outline-button" disabled={Boolean(working) || status.queued?.includes(tier.id)}
              onClick={() => act(tier.id, () => bridge.install(tier.id))}><DownloadSimple /> Download {tier.label}</button>}
          </div>
        </Row>)}
        {missing.length > 1 && <Row title="Install all three" hint={gb(missing.reduce((sum, tier) => sum + tier.size, 0)) + " remaining downloads. Models download one at a time and stay unloaded."} words="all models download disk">
          <button type="button" className="outline-button" disabled={Boolean(working)} onClick={() => act("install", () => bridge.install(missing.map((tier) => tier.id)))}>Install all three</button>
        </Row>}
      </Group>
      {download && <Group title="Download">
        <Row title={status.tiers.find((tier) => tier.id === download.tier)?.label || "AI model"} hint={download.state === "failed" ? download.message : gb(download.received) + " of " + gb(download.total)} stacked>
          <div className="ai-progress"><progress max="100" value={percent} aria-label={setupLine(status) || "Download"} />
            <button type="button" className="text-button" disabled={Boolean(working)} onClick={() => act("download", download.state === "running" ? bridge.cancel : bridge.resume)}>
              {download.state === "running" ? "Pause" : download.state === "failed" ? "Try again" : "Resume"}
            </button>
          </div>
        </Row>
      </Group>}
      <Group title="Memory" note="Keep loaded is for this session. Otherwise models rest after ten idle minutes. Loading several models requires a resource review.">
        <Row title="Load AI at startup" hint="Load the downloaded default for new chats when OSAT opens. Turning this off keeps loading on demand." words="launch startup">
          <Switch label="Load AI at startup" checked={Boolean(status.startup)} disabled={Boolean(working)} onChange={(value) => act("startup", () => bridge.startup(value))} />
        </Row>
        <Row title="Free AI memory" hint="Unload idle models. Downloaded files and conversations stay here; busy models finish their work." words="unload ram memory">
          <button type="button" className="outline-button" disabled={Boolean(working) || !installed.some((tier) => tier.state === "ready")} onClick={() => act("free", async () => {
            const result = await bridge.freeMemory();
            setMessage(memoryResult(result));
          })}>Free AI memory</button>
        </Row>
      </Group>
      {others.length > 0 && <p className="ai-note">Other connected models are available in Ask. These controls manage OSAT’s built-in models.</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

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

/* ---- The pages ----------------------------------------------------------------------------------------------------- */

const KEYS_INSIDE = [["⌘1 – ⌘5", "Desk, Notes, Sky, Ask, Files"], ["⌘K", "Find anything"], ["⇧⌘N", "A new sticky"], ["⌘,", "Settings"], ["⌘F", "Search these settings"], ["esc", "Back out, one step at a time"]];

export function GeneralPage({ page }) {
  const keys = useDeskKeys();
  const { info } = keys;
  const taken = (which, what) => (which?.failed ? `${which.label} is already used by another app, so OSAT can’t listen for it. Choose a different shortcut.` : what);
  return (
    <Page page={page}>
      {keys.bridge && (
        <Group title="OSAT, from anywhere" note="A key another app already has is refused, and the old one stays.">
          <Row title="The desk" hint={taken(info, "Brings OSAT up over your desktop. Press it again, or Esc, to put it away.")} words="hotkey open show overlay">
            <DeskKey which="layer" name="the desk" keys={keys} />
          </Row>
          <Row title="Quick bar" hint={taken(info?.search, "One bar over your other apps: find a file, a copy, an app or a note; ⌘Return asks the AI, ⌥Return saves a sticky.")} words="hotkey spotlight find search raycast">
            <DeskKey which="search" name="the quick bar" keys={keys} />
          </Row>
          <Row title="Ask" hint={taken(info?.chat, "Opens the quick bar on Ask, with the chat you were in.")} words="hotkey ask ai chat quick chat floating">
            <DeskKey which="chat" name="Ask in the quick bar" keys={keys} />
          </Row>
        </Group>
      )}
      <Group title="Everything is a key away">
        {KEYS_INSIDE.map(([combo, what]) => (
          <Row key={combo} title={what}><kbd className="setting-kbd">{combo}</kbd></Row>
        ))}
      </Group>
    </Page>
  );
}

export function AppearancePage({ page, workspace, commit }) {
  return (
    <Page page={page}>
      <Legacy words="light dark auto backdrop blur desk look">
        <div className="setting-card is-padded appearance-card">
          <AppearanceControls workspace={workspace} commit={commit} />
        </div>
      </Legacy>
    </Page>
  );
}

export function AiPage({ page, workspace, commit }) {
  const filing = autoFileSettings(workspace.settings);
  const setFiling = (on) => commit((state) => ({ ...state, settings: { ...(state.settings || {}), autoFile: { ...(state.settings?.autoFile || {}), on } } }));
  return (
    <Page page={page}>
      <Group title="Sorting" note="Only the AI's own picks move. What it isn't sure of stays in Unsorted for you, and Notes → Filed for you shows where everything went.">
        <Row title="File new stickies for me" hint="Write as many as you like. Once you stop for a moment, the AI puts each one in its node and gives long ones a short version. Undo takes a whole run back." words="auto sort file organize unsorted summarize shorten">
          <Switch label="File new stickies for me" checked={filing.on} onChange={setFiling} />
        </Row>
      </Group>
      <Legacy words="about you model size download lm studio"><AboutYouCard workspace={workspace} commit={commit} /></Legacy>
      <Legacy words="local ai model size download lm studio gemma"><AiCard /></Legacy>
    </Page>
  );
}

export function BotsPage({ page }) {
  return <Page page={page}><Legacy words="drop folder cloud model key connector"><BotsSettings /></Legacy></Page>;
}

export function DataPage({ page, workspace, commit, storage, showUndo }) {
  const restoreInputRef = useRef(null);
  function backup() {
    const payload = makeBackup(workspace);
    downloadFile(`osat-backup-${localDateKey()}.json`, JSON.stringify(payload, null, 2), "application/json");
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
  return (
    <Page page={page}>
      <Group title="On this Mac" note="Saved a moment after every change, with 14 daily copies kept. No account, and nothing leaves this Mac unless you link your iPhone or pick a cloud model in Bots.">
        <Row title={storage.status === "error" ? "Saving needs attention." : "Your workspace stays here."} hint={storage.message} words="saved storage folder">
          {window.osatApp?.showDataFolder && (
            <button className="outline-button" type="button" onClick={() => window.osatApp.showDataFolder().catch(() => {})}><FolderOpen /> Show the data folder</button>
          )}
        </Row>
      </Group>
      <Group title="Backup">
        <Row title="Download a backup" hint="One file with every note and node." words="export save file json">
          <button className="primary-button" type="button" onClick={backup}><DownloadSimple /> Download a backup</button>
        </Row>
        <Row title="Restore a backup" hint="Restoring keeps a copy of what it replaces, so it can be undone." words="import load file json">
          <button className="outline-button" type="button" onClick={() => restoreInputRef.current?.click()}><UploadSimple /> Restore a backup</button>
          <input ref={restoreInputRef} type="file" accept="application/json" hidden onChange={restore} />
        </Row>
      </Group>
      <Legacy words="obsidian vault export notes">
        <section className="content-card settings-obsidian">
          <p className="eyebrow">OBSIDIAN</p>
          <h2>Send notes to a vault.</h2>
          <ObsidianView workspace={workspace} commit={commit} />
        </section>
      </Legacy>
    </Page>
  );
}

export function ScansPage({ page }) {
  return (
    <Page page={page}>
      {window.osatScans
        ? <Legacy words="scanner folder brother paper"><ScansCard /></Legacy>
        : <Group><Row title="Scans live in the Mac app" hint="In the Mac app, choose the folder your scanner saves to, and each new scan is read on this Mac and sorted into a node." /></Group>}
    </Page>
  );
}

export function PhonePage({ page }) {
  return <Page page={page}><Legacy words="icloud drive inbox shortcut"><PhoneCards /></Legacy></Page>;
}

const plainError = (error) => String(error?.message || error || "That didn’t work.").replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/* Check for updates: one calm line and one button. The Mac app fetches the newest build from GitHub and swaps itself;
   notes are never touched. */
function UpdateRow() {
  const bridge = window.osatUpdate;
  const [status, setStatus] = useState({ state: "idle" });
  useEffect(() => bridge?.onProgress?.((progress) => setStatus((now) => (now.state === "restarting" ? now : progress))), [bridge]);
  if (!bridge) return null;
  const run = async (action) => {
    try { setStatus(await action()); } catch (error) { setStatus({ state: "error", message: plainError(error) }); }
  };
  const busy = ["checking-for-update", "downloading", "checking", "restarting"].includes(status.state);
  const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
  const line = {
    idle: "Look for a newer OSAT. Your notes stay exactly where they are.",
    "checking-for-update": "Looking…",
    current: "OSAT is up to date.",
    available: `A newer OSAT is ready (${mb(status.size)}). OSAT will restart; your notes aren’t touched, and the old app is kept.`,
    downloading: `Downloading… ${status.size ? Math.round((status.done / status.size) * 100) : 0}%`,
    checking: "Making sure the download is the real OSAT…",
    restarting: "Restarting OSAT…",
    unavailable: status.message,
    error: status.message,
  }[status.state];
  return (
    <Row title="Updates" hint={line} words="update version new build check">
      {status.state === "available"
        ? <button type="button" className="outline-button" onClick={() => run(() => bridge.install())}>Update and restart</button>
        : <button type="button" className="outline-button" disabled={busy || status.state === "unavailable"}
            onClick={() => { setStatus({ state: "checking-for-update" }); run(() => bridge.check()); }}>Check for updates</button>}
    </Row>
  );
}

export function AboutPage({ page }) {
  const about = useAbout();
  return (
    <Page page={page}>
      <Group>
        <Row title={`OSAT${about?.version ? ` ${about.version}` : ""}`} hint="A calm layer over your Mac. Everything, the AI included, stays on this Mac unless you pick a cloud model in Settings → Bots. Cloud accounts, provider calendars and automatic filing are off by design." words="version privacy" />
        <UpdateRow />
        {about?.dataFolder && <Row title="Data folder" hint={about.dataFolder} words="path where" />}
      </Group>
    </Page>
  );
}
