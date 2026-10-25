import { z } from "zod";
import { formatDuration } from "@/lib/targets";

// The Reports page (Phase 6). The figures are counted by the database
// (public.issue_report); these pure helpers pick the date range from the
// address bar, check the database's answer and format it. Dates are calendar
// days in the company's time zone, written "YYYY-MM-DD".

export type ReportPreset = "7d" | "30d" | "custom";

export const DEFAULT_PRESET = "30d" satisfies ReportPreset;

/** The database refuses longer ranges too. */
export const MAX_REPORT_DAYS = 366;

const presetDays: Record<Exclude<ReportPreset, "custom">, number> = { "7d": 7, "30d": 30 };

export const presetLabels: Record<ReportPreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  custom: "Custom range",
};

/** Today's date on the company's calendar. `now` comes from the server. */
export function todayIn(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const DAY = 86_400_000;

/** A real calendar date "YYYY-MM-DD" as days since 1970, or null. */
function dayNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms / DAY;
}

function fromDayNumber(n: number) {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const n = dayNumber(date);
  if (n === null) throw new Error(`Not a date: ${date}`);
  return fromDayNumber(n + days);
}

export interface ReportRange {
  preset: ReportPreset;
  from: string;
  to: string;
  /** Set when a custom range could not be used; the default range is shown instead. */
  error?: string;
}

function presetRange(preset: Exclude<ReportPreset, "custom">, today: string): ReportRange {
  return { preset, from: addDays(today, 1 - presetDays[preset]), to: today };
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The range asked for in the address bar (?range=7d|30d|custom&from=&to=).
 * Anything unusable falls back to the last 30 days, with a message for a
 * custom range that could not be used.
 */
export function resolveReportRange(
  params: Record<string, string | string[] | undefined>,
  today: string,
): ReportRange {
  const range = first(params.range);
  if (range === "7d" || range === "30d") return presetRange(range, today);
  if (range !== "custom") return presetRange(DEFAULT_PRESET, today);

  const from = first(params.from)?.trim() ?? "";
  const to = first(params.to)?.trim() ?? "";
  const fallback = (error: string): ReportRange => ({ ...presetRange(DEFAULT_PRESET, today), error });
  const fromDay = dayNumber(from);
  const toDay = dayNumber(to);
  const todayDay = dayNumber(today)!;
  if (fromDay === null || toDay === null) return fallback("Choose both a start and an end date.");
  if (fromDay > toDay) return fallback("Choose a start date on or before the end date.");
  if (toDay > todayDay) return fallback("The end date can't be after today.");
  if (toDay - fromDay + 1 > MAX_REPORT_DAYS) return fallback(`Choose a date range of ${MAX_REPORT_DAYS} days or fewer.`);
  return { preset: "custom", from, to };
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "1 Jan 2025 to 31 Jan 2025", or one day on its own. */
export function describeRange(from: string, to: string) {
  const f = dayFormat.format(new Date(`${from}T00:00:00Z`));
  if (from === to) return f;
  return `${f} to ${dayFormat.format(new Date(`${to}T00:00:00Z`))}`;
}

// ---------------------------------------------------------------------------
// The database's answer
// ---------------------------------------------------------------------------

const count = z.number().int().nonnegative();
const seconds = z.number().nonnegative().nullable();
const keyed = z.array(z.object({ key: z.string(), count }));

export const issueReportSchema = z.object({
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  totals: z.object({ received: count, history: count, still_open: count }),
  resolved: count,
  first_response: z.object({ count, median_seconds: seconds, average_seconds: seconds }),
  resolution: z.object({ count, median_seconds: seconds, average_seconds: seconds }),
  response_target: z.object({ met: count, late: count, missed: count, not_due: count, resolved_without_response: count }),
  escalations: z.array(z.object({ condition: z.string(), count, acknowledged: count })),
  teams: z.array(
    z.object({
      name: z.string().nullable(),
      received: count,
      still_open: count,
      median_response_seconds: seconds,
      median_resolution_seconds: seconds,
    }),
  ),
  categories: z.array(z.object({ name: z.string().nullable(), count })),
  channels: keyed,
  urgency: keyed,
  sentiment: keyed,
  imports: z.array(
    z.object({ source: z.string(), runs: count, failed: count, imported: count, skipped_duplicate: count, rejected: count }),
  ),
});

export type IssueReport = z.infer<typeof issueReportSchema>;

/** A time such as "2 h 15 min", or a dash when there is nothing to measure. */
export function formatSeconds(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "–";
  if (value < 60) return "under 1 min";
  return formatDuration(value * 1000);
}

/** Share of issues that met the response target, or null when none could be judged yet. */
export function responseTargetShare(target: IssueReport["response_target"]) {
  const judged = target.met + target.late + target.missed;
  return judged === 0 ? null : target.met / judged;
}

/** Puts rows in a fixed order (for example Critical first); unknown keys go last. */
export function inOrder<T extends { key: string }>(rows: T[], order: readonly string[]) {
  const rank = (key: string) => {
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  return [...rows].sort((a, b) => rank(a.key) - rank(b.key));
}
