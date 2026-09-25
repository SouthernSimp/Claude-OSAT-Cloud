import { useRef } from "react";
import { Check, DownloadSimple, Monitor, MoonStars, SunHorizon, UploadSimple } from "@phosphor-icons/react";
import { downloadFile } from "../lib/ui.js";
import { localDateKey } from "../daily-practice.js";
import { makeBackup, readWorkspaceBackup } from "../osat-data.js";
import { workspaceClient } from "../store/useWorkspace.js";

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
      <section className="content-card">
        <p className="eyebrow">APPEARANCE</p>
        <h2>Make yourself at home.</h2>
        <div className="theme-options">
          {[
            ["system", Monitor],
            ["light", SunHorizon],
            ["dark", MoonStars],
          ].map(([theme, Icon]) => (
            <button
              key={theme}
              type="button"
              className={workspace.theme === theme ? "active" : ""}
              onClick={() => commit((state) => ({ ...state, theme }))}
            >
              <Icon />
              <span>{theme}</span>
              {workspace.theme === theme && <Check />}
            </button>
          ))}
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
