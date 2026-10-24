// Dates are always formatted in UTC with a fixed locale so the server and the
// browser render exactly the same text.

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDate(iso: string) {
  return dateFormat.format(new Date(iso));
}

export function formatDateTime(iso: string) {
  return `${dateTimeFormat.format(new Date(iso))} UTC`;
}

/** Date and time in a company's time zone, e.g. "24 Oct, 13:30 (Asia/Kolkata)". Server only. */
export function formatDateTimeIn(iso: string | Date, timeZone: string) {
  const text = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(
    new Date(iso),
  );
  return `${text} (${timeZone})`;
}

export function formatHours(hours: number) {
  if (!Number.isFinite(hours)) return "–";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function timeAgo(iso: string, now: Date) {
  const minutes = (now.getTime() - new Date(iso).getTime()) / 60000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function percent(value: number) {
  if (!Number.isFinite(value)) return "–";
  return `${Math.round(value * 100)}%`;
}
