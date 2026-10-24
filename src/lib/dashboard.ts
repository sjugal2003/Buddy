import type { IssueStatus, Urgency } from "@/lib/types";
import { deadlines, isOverdue, type IssueDeadlines, type TargetHours, type TimedIssue } from "@/lib/targets";

// The workspace home's counts. Pure functions shared with the Issues list
// filters, so a card's number and the list it links to always agree. `now`
// always comes from the server.

const HOUR = 3_600_000;

/** "Due within 2 hours" on the dashboard and the Issues list. */
export const DUE_WITHIN_MS = 2 * HOUR;

export function isUrgent(urgency: Urgency) {
  return urgency === "critical" || urgency === "high";
}

/** A deadline that is still running (not missed, not paused) and ends within `ms`. */
export function isDueWithin(d: IssueDeadlines, ms: number) {
  return [d.firstResponse, d.resolution].some(
    (x) => (x.state === "on_track" || x.state === "due_soon") && x.remainingMs <= ms,
  );
}

export interface DashboardIssue extends TimedIssue {
  id: string;
  status: IssueStatus;
  teamId: string | null;
}

export interface DashboardCounts {
  urgent: number;
  dueSoon: number;
  breached: number;
  escalated: number;
  noTeam: number;
  waiting: number;
}

/**
 * Counts over open issues. Resolved issues passed in are ignored.
 * `escalatedIssueIds` are issues with an escalation nobody has acknowledged.
 */
export function summariseOpenIssues(
  issues: DashboardIssue[],
  targets: TargetHours,
  escalatedIssueIds: Set<string>,
  now: Date,
): DashboardCounts {
  const counts: DashboardCounts = { urgent: 0, dueSoon: 0, breached: 0, escalated: 0, noTeam: 0, waiting: 0 };
  for (const issue of issues) {
    if (issue.status === "resolved") continue;
    const d = deadlines(issue, targets, now);
    if (isUrgent(issue.urgency)) counts.urgent++;
    if (isDueWithin(d, DUE_WITHIN_MS)) counts.dueSoon++;
    if (isOverdue(d)) counts.breached++;
    if (escalatedIssueIds.has(issue.id)) counts.escalated++;
    if (!issue.teamId) counts.noTeam++;
    if (issue.status === "waiting_on_customer") counts.waiting++;
  }
  return counts;
}

/** The parts of a moment as seen on the wall clock in `timeZone`. */
function wallClock(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday),
  };
}

/** How far `timeZone` is ahead of UTC at `at`, in milliseconds. */
function offsetMs(at: Date, timeZone: string) {
  const w = wallClock(at, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The moment a wall-clock time in `timeZone` happens (month is 1 to 12). */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // Shift by the zone's offset; check again in case a clock change falls in between.
  let guess = asUtc - offsetMs(new Date(asUtc), timeZone);
  guess = asUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Monday 00:00 of the current week in the company's time zone, as a moment. */
export function startOfWeek(now: Date, timeZone: string): Date {
  const w = wallClock(now, timeZone);
  // Midnight of Monday on the company's calendar, written as if it were UTC.
  const mondayAsUtc = Date.UTC(w.year, w.month - 1, w.day - w.weekday);
  // Shift by the zone's offset; check again in case a clock change falls in between.
  let guess = mondayAsUtc - offsetMs(new Date(mondayAsUtc), timeZone);
  guess = mondayAsUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}
