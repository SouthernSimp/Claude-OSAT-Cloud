/* Small shared helpers used across views. */

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const makeId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

export const inputActive = () =>
  ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) ||
  document.activeElement?.isContentEditable;

export function downloadFile(name, content, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function calendarProviderUrl(provider, event) {
  const end =
    event.end ||
    new Date(new Date(event.start).getTime() + 60 * 60 * 1000).toISOString();
  if (provider === "google") {
    const dates = [event.start, end]
      .map((value) =>
        new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"),
      )
      .join("/");
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${dates}&details=${encodeURIComponent(event.notes || "")}`;
  }
  const query = new URLSearchParams({
    subject: event.title,
    startdt: event.start,
    enddt: end,
    body: event.notes || "",
    path: "/calendar/action/compose",
    rru: "addevent",
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${query}`;
}

export function formatRelativeTime(value) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  const diff = Date.now() - time;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(time);
}

export function formatBytes(value = 0) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

/* `datetime-local` needs local wall-clock text, not an ISO instant. */
export function toLocalInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const timeLabel = (value) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
