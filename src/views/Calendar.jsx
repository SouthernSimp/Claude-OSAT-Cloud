import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  CalendarBlank,
  Clock,
  DotsThree,
  DownloadSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { calendarMonthDays, localDateKey } from "../daily-practice.js";
import { calendarToIcs } from "../osat-data.js";
import {
  calendarProviderUrl,
  downloadFile,
  makeId,
  timeLabel,
  toLocalInput,
} from "../lib/ui.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const DAY_FULL = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const slug = (value) =>
  value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "osat-event";

/* Events are keyed by their local start date so a day cell can find them in O(1). */
function groupByDay(events) {
  const groups = new Map();
  for (const event of events) {
    const time = Date.parse(event.start);
    if (Number.isNaN(time)) continue;
    const key = localDateKey(new Date(time));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  for (const list of groups.values()) list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return groups;
}

export function CalendarView({ workspace, commit, initialDate }) {
  const today = localDateKey();
  const now = useRef(initialDate ? new Date(`${initialDate}T12:00:00`) : new Date()).current;
  const [cursor, setCursor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1, 12));
  const [selected, setSelected] = useState(initialDate || today);
  const [composing, setComposing] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [form, setForm] = useState({ title: "", start: "", end: "", notes: "" });

  const events = workspace.calendar.events;
  const byDay = useMemo(() => groupByDay(events), [events]);
  const days = useMemo(
    () => calendarMonthDays(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );
  const dayEvents = byDay.get(selected) || [];
  const upcoming = useMemo(
    () =>
      events
        .filter((event) => Date.parse(event.start) >= Date.now())
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
        .slice(0, 4),
    [events],
  );

  function moveMonth(offset) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1, 12));
  }

  function goToday() {
    const current = new Date();
    setCursor(new Date(current.getFullYear(), current.getMonth(), 1, 12));
    setSelected(today);
  }

  function openComposer(dayKey = selected, hour = 9) {
    setSelected(dayKey);
    setForm({ title: "", start: `${dayKey}T${String(hour).padStart(2, "0")}:00`, end: "", notes: "" });
    setComposing(true);
  }

  function chooseDay(day) {
    setSelected(day.key);
    if (!day.inMonth) setCursor(new Date(day.date.getFullYear(), day.date.getMonth(), 1, 12));
  }

  function save(submitEvent) {
    submitEvent.preventDefault();
    if (!form.title.trim() || !form.start) return;
    const item = {
      id: makeId("event"),
      title: form.title.trim(),
      start: new Date(form.start).toISOString(),
      end: form.end ? new Date(form.end).toISOString() : "",
      notes: form.notes.trim(),
    };
    commit((state) => ({
      ...state,
      calendar: {
        ...state.calendar,
        events: [...state.calendar.events, item].sort(
          (a, b) => Date.parse(a.start) - Date.parse(b.start),
        ),
      },
    }));
    setSelected(localDateKey(new Date(item.start)));
    setForm({ title: "", start: "", end: "", notes: "" });
    setComposing(false);
  }

  function remove(id) {
    commit((state) => ({
      ...state,
      calendar: {
        ...state.calendar,
        events: state.calendar.events.filter((item) => item.id !== id),
      },
    }));
    setMenuFor(null);
  }

  return (
    <section className="calendar-view">
      <div className="calendar-main">
        <header className="calendar-toolbar">
          <div className="calendar-title">
            <h2>{MONTH_YEAR.format(cursor)}</h2>
            <span>
              {events.length} {events.length === 1 ? "event" : "events"} on this device
            </span>
          </div>
          <div className="calendar-nav">
            <button
              className="icon-button"
              type="button"
              aria-label="Previous month"
              onClick={() => moveMonth(-1)}
            >
              <ArrowLeft />
            </button>
            <button className="outline-button today-button" type="button" onClick={goToday}>
              Today
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Next month"
              onClick={() => moveMonth(1)}
            >
              <ArrowRight />
            </button>
            <button
              className="outline-button"
              type="button"
              onClick={() =>
                downloadFile(
                  `osat-calendar-${today}.ics`,
                  calendarToIcs(events),
                  "text/calendar;charset=utf-8",
                )
              }
            >
              <DownloadSimple /> Export
            </button>
          </div>
        </header>

        <div className="month-grid" role="grid" aria-label={MONTH_YEAR.format(cursor)}>
          {WEEKDAYS.map((day) => (
            <div className="weekday" role="columnheader" key={day}>
              <abbr title={day}>{day.slice(0, 1)}</abbr>
              <span>{day}</span>
            </div>
          ))}
          {days.map((day) => {
            const list = byDay.get(day.key) || [];
            const shown = list.slice(0, 3);
            return (
              <div
                className={[
                  "day-cell",
                  day.inMonth ? "" : "outside",
                  day.key === today ? "is-today" : "",
                  day.key === selected ? "is-selected" : "",
                ].join(" ")}
                key={day.key}
                role="gridcell"
                aria-selected={day.key === selected}
              >
                <button
                  className="day-open"
                  type="button"
                  onClick={() => chooseDay(day)}
                  onDoubleClick={() => openComposer(day.key)}
                  aria-label={`${DAY_FULL.format(day.date)}, ${list.length} ${list.length === 1 ? "event" : "events"}`}
                >
                  <span className="day-number">{day.date.getDate()}</span>
                </button>
                <div className="day-events">
                  {shown.map((event) => (
                    <button
                      className="event-chip"
                      type="button"
                      key={event.id}
                      title={event.title}
                      onClick={() => setSelected(day.key)}
                    >
                      <time dateTime={event.start}>{timeLabel(event.start)}</time>
                      <span>{event.title}</span>
                    </button>
                  ))}
                  {list.length > shown.length && (
                    <button className="event-more" type="button" onClick={() => setSelected(day.key)}>
                      {list.length - shown.length} more
                    </button>
                  )}
                </div>
                <button
                  className="day-add"
                  type="button"
                  aria-label={`Add an event on ${DAY_FULL.format(day.date)}`}
                  onClick={() => openComposer(day.key)}
                >
                  <Plus weight="bold" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="calendar-agenda">
        <header>
          <p className="eyebrow">SELECTED DAY</p>
          <h3>{DAY_FULL.format(new Date(`${selected}T12:00`))}</h3>
          <span>
            {dayEvents.length
              ? `${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`
              : "Nothing scheduled"}
          </span>
        </header>

        {composing ? (
          <form className="agenda-composer" onSubmit={save}>
            <div className="composer-head">
              <strong>New event</strong>
              <button
                className="icon-button"
                type="button"
                aria-label="Cancel new event"
                onClick={() => setComposing(false)}
              >
                <X />
              </button>
            </div>
            <label>
              Title
              <input
                autoFocus
                value={form.title}
                maxLength={200}
                placeholder="What is it?"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <div className="composer-times">
              <label>
                Starts
                <input
                  type="datetime-local"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </label>
              <label>
                Ends
                <input
                  type="datetime-local"
                  value={form.end}
                  min={form.start || undefined}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </label>
            </div>
            <label>
              Notes
              <textarea
                rows="3"
                value={form.notes}
                placeholder="Optional"
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
            <button className="primary-button" disabled={!form.title.trim() || !form.start}>
              <Plus /> Add event
            </button>
          </form>
        ) : (
          <button className="agenda-add" type="button" onClick={() => openComposer()}>
            <Plus /> Add an event on this day
          </button>
        )}

        <div className="agenda-list">
          {dayEvents.map((event) => (
            <article className="agenda-item" key={event.id}>
              <time dateTime={event.start}>
                <strong>{timeLabel(event.start)}</strong>
                {event.end && <small>{timeLabel(event.end)}</small>}
              </time>
              <div>
                <h4>{event.title}</h4>
                {event.notes && <p>{event.notes}</p>}
              </div>
              <div className="agenda-menu">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Actions for ${event.title}`}
                  aria-expanded={menuFor === event.id}
                  onClick={() => setMenuFor(menuFor === event.id ? null : event.id)}
                >
                  <DotsThree weight="bold" />
                </button>
                {menuFor === event.id && (
                  <div className="agenda-popover" role="menu">
                    <a
                      href={calendarProviderUrl("google", event)}
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                    >
                      <ArrowSquareOut /> Send to Google
                    </a>
                    <a
                      href={calendarProviderUrl("outlook", event)}
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                    >
                      <ArrowSquareOut /> Send to Outlook
                    </a>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        downloadFile(
                          `${slug(event.title)}.ics`,
                          calendarToIcs([event]),
                          "text/calendar;charset=utf-8",
                        )
                      }
                    >
                      <DownloadSimple /> Download .ics
                    </button>
                    <button type="button" role="menuitem" className="danger" onClick={() => remove(event.id)}>
                      <Trash /> Delete event
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
          {!dayEvents.length && !composing && (
            <div className="agenda-empty">
              <CalendarBlank />
              <p>A clear day. Double-click any date to put something on it.</p>
            </div>
          )}
        </div>

        {upcoming.length > 0 && (
          <section className="agenda-upcoming">
            <p className="eyebrow">COMING UP</p>
            {upcoming.map((event) => (
              <button
                type="button"
                key={event.id}
                onClick={() => {
                  const date = new Date(event.start);
                  setCursor(new Date(date.getFullYear(), date.getMonth(), 1, 12));
                  setSelected(localDateKey(date));
                }}
              >
                <Clock />
                <span>
                  <strong>{event.title}</strong>
                  <small>
                    {new Intl.DateTimeFormat("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(event.start))}
                  </small>
                </span>
              </button>
            ))}
          </section>
        )}

        <footer className="agenda-footer">
          Local events only. No calendar account is connected.
        </footer>
      </aside>
    </section>
  );
}

export { toLocalInput };
