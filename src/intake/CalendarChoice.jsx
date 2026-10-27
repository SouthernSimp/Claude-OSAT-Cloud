import { useEffect, useState } from "react";
import { accessLine, accessOf, defaultCalendar, macCalendarChoices, macCalendars } from "../../shared/mac-calendar-model.mjs";
import { macError } from "../views/MacCalendar.jsx";
import { datesSettings, setDates } from "./dates.js";

/* Where new dates go (Phase 67): the Mac's default calendar unless one is picked (Phase 103), one on this Mac
   (which passes it on to Google, Outlook or iCloud), or OSAT's own. The Mac is only asked when the button is
   pressed; in the browser preview there is no Mac, so only OSAT's own shows. */
export function CalendarChoice({ workspace, commit }) {
  const bridge = typeof window !== "undefined" ? window.osatMacCalendar : undefined;
  const { calendar } = datesSettings(workspace.settings);
  const [access, setAccess] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!bridge) return undefined;
    let live = true;
    bridge.status().then((status) => { if (live) setAccess(accessOf(status?.events)); }, () => { if (live) setAccess("unavailable"); });
    return () => { live = false; };
  }, [bridge]);

  useEffect(() => {
    if (!bridge || access !== "allowed") return undefined;
    let live = true;
    bridge.calendars().then((rows) => { if (live) setCalendars(macCalendarChoices(macCalendars(rows))); }, (error) => { if (live) setNotice(macError(error)); });
    return () => { live = false; };
  }, [bridge, access]);

  async function allow() {
    try { setAccess(accessOf(await bridge.allow("events"))); } catch (error) { setNotice(macError(error)); }
  }

  const pick = (id) => commit((state) => setDates(state, { calendar: id }));
  if (bridge && access === "notAsked") {
    return (
      <span className="calendar-choice">
        <span>OSAT’s own calendar</span>
        <button type="button" className="text-button" onClick={allow}>Use my iCloud or Google calendar</button>
      </span>
    );
  }
  const line = notice || (bridge && access && access !== "allowed" ? accessLine(access) : "");
  // A Mac calendar chosen earlier that isn't here now (removed, or not readable yet) still shows, so the choice isn't lost.
  const first = defaultCalendar(calendars);
  const missing = calendar !== "osat" && calendar !== "default" && !calendars.some((item) => item.id === calendar);
  // Not allowed (or no Mac): 'default' lands on OSAT's own, so the menu says so.
  const value = calendar === "default" && !first ? "osat" : calendar;
  return (
    <span className="calendar-choice">
      <select aria-label="Calendar for new dates" value={value} onChange={(event) => pick(event.target.value)}>
        {first && <option value="default">My default calendar ({first.name})</option>}
        <option value="osat">OSAT’s own calendar</option>
        {calendars.map((item) => <option key={item.id} value={item.id}>{item.name}{item.source ? ` · ${item.source}` : ""}</option>)}
        {missing && <option value={calendar}>The calendar you chose</option>}
      </select>
      {line && <span className="calendar-choice-note">{line}</span>}
    </span>
  );
}
