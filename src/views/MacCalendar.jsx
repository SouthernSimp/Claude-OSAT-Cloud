/* Your Mac's calendars and reminders inside the Calendar room (Phase 14, step one).
   Everything is read on the Mac through window.osatMacCalendar; in the browser preview there is
   no bridge and none of this shows. Nothing is read until the button is pressed once. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Plus } from "@phosphor-icons/react";
import {
  accessLine,
  accessOf,
  dueLabel,
  gridRange,
  macCalendars,
  macEvents,
  macReminders,
  newReminder,
  soonReminders,
} from "../../shared/mac-calendar-model.mjs";

const HIDDEN_KEY = "osat.maccal.hidden.v1";
export const macError = (error) =>
  String(error?.message || error || "That didn’t work.").replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function loadHidden() {
  try {
    const list = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
    return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function useMacCalendar(cursor) {
  const bridge = typeof window !== "undefined" ? window.osatMacCalendar : undefined;
  const [access, setAccess] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [rows, setRows] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [hidden, setHidden] = useState(loadHidden);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0);

  const eventsOk = access?.events === "allowed";
  const remindersOk = access?.reminders === "allowed";
  const month = cursor.getFullYear() * 12 + cursor.getMonth();

  useEffect(() => {
    if (!bridge) return;
    bridge.status().then((status) => setAccess({ events: accessOf(status?.events), reminders: accessOf(status?.reminders) }),
      () => setAccess({ events: "unavailable", reminders: "unavailable" }));
  }, [bridge]);

  // The Mac's calendars can change under us (the Calendar app, a sync): look again when the window comes back.
  useEffect(() => {
    if (!bridge) return undefined;
    const again = () => setTick((n) => n + 1);
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !eventsOk) return undefined;
    let live = true;
    const range = gridRange(Math.floor(month / 12), month % 12);
    Promise.all([bridge.calendars(), bridge.events(range)]).then(
      ([cals, list]) => { if (live) { setCalendars(macCalendars(cals)); setRows(Array.isArray(list) ? list : []); setNotice(""); } },
      (error) => { if (live) setNotice(macError(error)); },
    );
    return () => { live = false; };
  }, [bridge, eventsOk, month, tick]);

  useEffect(() => {
    if (!bridge || !remindersOk) return undefined;
    let live = true;
    bridge.reminders().then(
      (list) => { if (live) setReminders(macReminders(list)); },
      (error) => { if (live) setNotice(macError(error)); },
    );
    return () => { live = false; };
  }, [bridge, remindersOk, tick]);

  const events = useMemo(() => macEvents(rows, calendars), [rows, calendars]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const allow = useCallback(async (kind) => {
    setBusy(true);
    setNotice("");
    try {
      const status = accessOf(await bridge.allow(kind));
      setAccess((current) => ({ ...current, [kind]: status }));
    } catch (error) {
      setNotice(macError(error));
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  const toggle = useCallback((id) => {
    setHidden((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* per-Mac convenience only */ }
      return next;
    });
  }, []);

  return { bridge, access, calendars, events, hidden, toggle, busy, notice, setNotice, allow, refresh, reminders, setReminders };
}

/* Under the day's header: the one button that asks the Mac, a calm line if it was refused, and the
   calendars to switch on and off once it is allowed. */
export function MacCalendarBar({ mac }) {
  if (!mac.bridge || !mac.access) return null;
  const line = accessLine(mac.access.events);
  return (
    <section className="mac-cal" aria-label="Your Mac’s calendars">
      {mac.access.events === "notAsked" && (
        <>
          <button className="outline-button" type="button" disabled={mac.busy} onClick={() => mac.allow("events")}>
            <CalendarCheck /> Show my Mac’s calendars
          </button>
          <p className="mac-cal-note">Your Mac asks once. They are read here and go nowhere else.</p>
        </>
      )}
      {line && <p className="mac-cal-note">{line}</p>}
      {mac.notice && <p className="mac-cal-note" role="status">{mac.notice}</p>}
      {mac.access.events === "allowed" && mac.calendars.length > 0 && (
        <div className="mac-cal-list">
          <p className="eyebrow">FROM YOUR MAC</p>
          {mac.calendars.map((calendar) => (
            <label key={calendar.id} className="mac-cal-row">
              <input type="checkbox" checked={!mac.hidden.includes(calendar.id)} onChange={() => mac.toggle(calendar.id)} />
              <i className="mac-dot" style={calendar.color ? { background: calendar.color } : undefined} aria-hidden="true" />
              <span>{calendar.name}</span>
              {calendar.source && <small>{calendar.source}</small>}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

/* Reminders that are due soon or have no date: tick one done (Undo puts it back), or add one. */
export function MacReminders({ mac, showUndo }) {
  const [title, setTitle] = useState("");
  const now = new Date();
  const line = mac.access ? accessLine(mac.access.reminders, "reminders") : null;
  const soon = useMemo(() => soonReminders(mac.reminders), [mac.reminders]);
  if (!mac.bridge || !mac.access) return null;

  const { bridge } = mac;
  const drop = (id) => mac.setReminders((list) => list.filter((item) => item.id !== id));
  const fail = (error) => { mac.setNotice(macError(error)); mac.refresh(); };

  async function tick(reminder) {
    drop(reminder.id);
    try {
      await bridge.setReminderDone(reminder.id, true);
      showUndo(`Ticked off “${reminder.title}”`, () => bridge.setReminderDone(reminder.id, false).then(mac.refresh, fail));
    } catch (error) {
      fail(error);
    }
  }

  async function add(event) {
    event.preventDefault();
    const reminder = newReminder({ title });
    if (!reminder) return;
    setTitle("");
    try {
      const { id } = await bridge.addReminder(reminder);
      mac.refresh();
      showUndo(`Added “${reminder.title}” to Reminders`, () => bridge.removeReminder(id).then(mac.refresh, fail));
    } catch (error) {
      fail(error);
    }
  }

  return (
    <section className="mac-reminders" aria-label="Reminders">
      <p className="eyebrow">REMINDERS</p>
      {mac.access.reminders === "notAsked" && (
        <button className="outline-button" type="button" disabled={mac.busy} onClick={() => mac.allow("reminders")}>
          Show my Mac’s reminders
        </button>
      )}
      {line && <p className="mac-cal-note">{line}</p>}
      {mac.access.reminders === "allowed" && (
        <>
          <ul className="mac-reminder-list">
            {soon.map((reminder) => (
              <li key={reminder.id}>
                <label>
                  <input type="checkbox" checked={false} onChange={() => tick(reminder)} aria-label={`Tick off ${reminder.title}`} />
                  <span>{reminder.title}</span>
                </label>
                <small>{dueLabel(reminder, now)}</small>
              </li>
            ))}
            {!soon.length && <li className="mac-cal-note">Nothing due soon.</li>}
          </ul>
          <form className="mac-reminder-add" onSubmit={add}>
            <input value={title} maxLength={300} placeholder="Add a reminder" aria-label="Add a reminder" onChange={(e) => setTitle(e.target.value)} />
            <button className="icon-button" type="submit" aria-label="Add reminder" disabled={!title.trim()}><Plus /></button>
          </form>
        </>
      )}
    </section>
  );
}
