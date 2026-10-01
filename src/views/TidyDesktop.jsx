import { useEffect, useRef, useState } from "react";
import { describeDone, describeGroup, destOfKey, keyOfDest } from "../../shared/tidy-model.mjs";
import { cleanError } from "../assistant/useAi.js";
import "../styles/tidy.css";

/* Tidy my Desktop (Phase 21b). OSAT proposes; nothing moves until "Do the ticked ones", and then
   there is one Undo for the whole tidy (Files shows the toast). `onDone(message, undoToken)`. */

const HOW = {
  ai: "OSAT read the names on your Desktop and made this plan.",
  rules: "The AI isn’t set up yet, so this sorts by kind of file.",
};

export function TidyDesktop({ api, onClose, onDone }) {
  const [state, setState] = useState({ status: "looking" });
  const [groups, setGroups] = useState([]);
  const [switchOn, setSwitchOn] = useState(false);
  const [note, setNote] = useState("");
  const panel = useRef(null);

  useEffect(() => { panel.current?.focus(); }, []); // so Esc backs out at once

  useEffect(() => {
    let live = true;
    api.tidyPlan().then((plan) => {
      if (!live) return;
      setGroups(plan.groups.map((group) => ({ ...group, on: true })));
      setState({ status: "plan", plan });
    }).catch((reason) => live && setState({ status: "error", message: cleanError(reason) }));
    api.tidyOffer().then((answer) => live && setSwitchOn(answer.on)).catch(() => {});
    return () => { live = false; };
  }, [api]);

  const change = (index, patch) => setGroups((list) => list.map((group, at) => (at === index ? { ...group, ...patch } : group)));
  const ticked = groups.filter((group) => group.on);

  async function apply() {
    setNote("");
    setState((value) => ({ ...value, busy: true }));
    try {
      const result = await api.tidyDo(ticked.map((group) => ({ to: group.dest.to, folder: group.dest.folder, names: group.names })));
      if (result.failed) setNote(result.failed);
      if (result.moved + result.binned || !result.failed) onDone(describeDone(result), result.undo);
      else setState((value) => ({ ...value, busy: false }));
    } catch (reason) {
      setNote(cleanError(reason));
      setState((value) => ({ ...value, busy: false }));
    }
  }

  async function layout() {
    setNote("");
    try {
      const result = await api.tidyLayout();
      if (!result.made.length) setNote("Projects, Money, Home, School and Archive are already in Documents.");
      else onDone(`Made ${result.made.join(", ")} in Documents`, result.undo);
    } catch (reason) {
      setNote(cleanError(reason));
    }
  }

  async function flip(on) {
    setSwitchOn(on);
    try { await api.tidySet(on); } catch (reason) { setSwitchOn(!on); setNote(cleanError(reason)); }
  }

  const plan = state.plan;
  return (
    <div ref={panel} tabIndex={-1} className="tidy" role="region" aria-label="Tidy my Desktop" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <header>
        <h2>Tidy my Desktop</h2>
        <p>{state.status === "plan" ? `${HOW[plan.how]} Nothing moves until you say so.` : state.status === "error" ? state.message : "Looking at your Desktop…"}</p>
      </header>

      {state.status === "plan" && !groups.length && <p className="tidy-empty">Your Desktop is already tidy.</p>}

      {groups.length > 0 && (
        <ul className="tidy-list">
          {groups.map((group, index) => (
            <li key={group.id + index} className="tidy-group" data-off={group.on ? undefined : ""}>
              <div className="tidy-line">
                <strong>{describeGroup(group)}</strong>
                <span className="tidy-choice" role="group" aria-label={describeGroup(group)}>
                  <button type="button" aria-pressed={group.on} onClick={() => change(index, { on: true })}>Do it</button>
                  <button type="button" aria-pressed={!group.on} onClick={() => change(index, { on: false })}>Skip</button>
                </span>
              </div>
              <div className="tidy-more">
                <label>
                  Move to
                  <select value={keyOfDest(group.dest)} onChange={(event) => change(index, { dest: destOfKey(event.target.value) })}>
                    {plan.menu.map((name) => <option key={name} value={`folder:${name}`}>Documents/{name}</option>)}
                    {group.dest.to === "folder" && !plan.menu.includes(group.dest.folder) && <option value={keyOfDest(group.dest)}>Documents/{group.dest.folder}</option>}
                    <option value="bin">The Bin</option>
                  </select>
                </label>
                <details>
                  <summary>Show the files</summary>
                  <ul>{group.names.map((name) => <li key={name}>{name}</li>)}</ul>
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}

      {state.status === "plan" && plan.left > 0 && <p className="tidy-left">The rest stays on the Desktop.</p>}
      {note && <p className="tidy-note" role="status">{note}</p>}

      <footer>
        <div className="tidy-actions">
          <button type="button" className="primary-button" disabled={!ticked.length || state.busy} onClick={apply}>Do the ticked ones</button>
          <button type="button" onClick={onClose}>Not now</button>
        </div>
        <div className="tidy-extras">
          <button type="button" className="tidy-link" onClick={layout}>Make Projects, Money, Home, School and Archive folders</button>
          <label className="tidy-switch">
            <input type="checkbox" checked={switchOn} onChange={(event) => flip(event.target.checked)} />
            Offer to move things older than 30 days into Archive
          </label>
        </div>
      </footer>
    </div>
  );
}

/* A quiet line under the Desktop, only when the switch above is on and something is old. No count. */
export function ArchiveOffer({ api, fresh, onDone }) {
  const [offer, setOffer] = useState(null);
  useEffect(() => {
    let live = true;
    api.tidyOffer().then((answer) => live && setOffer(answer.offer)).catch(() => {});
    return () => { live = false; };
  }, [api, fresh]);
  if (!offer) return null;
  return (
    <p className="tidy-offer" role="status">
      <span>Anything on the Desktop older than 30 days goes to Documents/{offer.folder}?</span>
      <button type="button" onClick={async () => {
        try {
          const result = await api.tidyDo([{ to: "folder", folder: offer.folder, names: offer.names }]);
          setOffer(null);
          onDone(describeDone(result), result.undo);
        } catch (reason) { onDone(cleanError(reason), null); }
      }}>Do it</button>
      <button type="button" onClick={() => api.tidyLater().then(() => setOffer(null)).catch(() => setOffer(null))}>Not now</button>
    </p>
  );
}
