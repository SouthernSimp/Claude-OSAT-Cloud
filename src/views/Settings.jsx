import { useEffect, useRef, useState } from "react";
import { Check, DownloadSimple, Keyboard, UploadSimple } from "@phosphor-icons/react";
import { downloadFile } from "../lib/ui.js";
import { localDateKey } from "../daily-practice.js";
import { makeBackup, readWorkspaceBackup } from "../osat-data.js";
import { workspaceClient } from "../store/useWorkspace.js";
import { AppearanceControls } from "../shell/Shell.jsx";

export function SettingsView({ workspace, commit, storage }) {
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
  return (
    <section className="settings-grid">
      <ShortcutCard />
      <section className="content-card">
        <p className="eyebrow">APPEARANCE</p>
        <h2>Make yourself at home.</h2>
        <div className="appearance-card">
          <AppearanceControls workspace={workspace} commit={commit} />
        </div>
      </section>
      <section className="content-card">
        <p className="eyebrow">LOCAL STORAGE</p>
        <h2>
          {storage.status === "ready"
            ? "Your workspace stays here."
            : storage.status === "error"
              ? "Database needs attention."
              : "Opening database."}
        </h2>
        <p>{storage.message}</p>
        <div className="storage-facts">
          <span>
            <Check /> Notes, folders, boards, projects, and next steps in one workspace
          </span>
          <span>
            <Check /> Original data preserved
          </span>
          <span>
            <Check /> No cloud sync or account
          </span>
        </div>
      </section>
      <section className="content-card">
        <p className="eyebrow">PORTABILITY</p>
        <h2>Take your work with you.</h2>
        <p>
          The backup contains the whole workspace — notes, folders, every
          Mindmap board, and the original import snapshot. Backups from the
          earlier OSAT app restore here too.
        </p>
        <button className="primary-button" type="button" onClick={backup}>
          <DownloadSimple /> Download JSON backup
        </button>
        <button
          className="outline-button"
          type="button"
          onClick={() => restoreInputRef.current?.click()}
        >
          <UploadSimple /> Restore from backup
        </button>
        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={restore}
        />
      </section>
      <section className="content-card danger-zone">
        <p className="eyebrow">BOUNDARIES</p>
        <h2>Your privacy, your choice.</h2>
        <p>
          Cloud accounts, provider calendars, automated Obsidian sync and
          autonomous filing are inactive by design.
        </p>
      </section>
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
