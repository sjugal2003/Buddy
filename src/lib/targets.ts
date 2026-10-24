import type { IssueStatus, Urgency } from "@/lib/types";

// Response and resolution deadlines. Pure functions, so the same rules can be
// unit tested and used by any page. Times are counted around the clock (no
// business hours). `now` always comes from the server, never the browser.

export interface TargetHours {
  firstResponse: Record<Urgency, number>;
  resolution: Record<Urgency, number>;
}

/** The parts of an issue the deadlines depend on. */
export interface TimedIssue {
  receivedAt: string;
  urgency: Urgency;
  status: IssueStatus;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  /** Seconds spent in "Waiting on customer" before the current spell. */
  waitingSeconds: number;
  /** Start of the current "Waiting on customer" spell, or null. */
  waitingSince: string | null;
}

/**
 * - on_track / due_soon (under 25% of the time left) / breached: still running
 * - paused: waiting on the customer (resolution only)
 * - met / met_late: done (first response recorded, or issue resolved)
 * - stopped: resolved before a first response was recorded
 */
export type DeadlineState = "on_track" | "due_soon" | "breached" | "paused" | "met" | "met_late" | "stopped";

export interface Deadline {
  state: DeadlineState;
  dueAt: Date;
  /** Milliseconds until the deadline (negative once it has passed). */
  remainingMs: number;
}

const HOUR = 3_600_000;
const DUE_SOON_SHARE = 0.25;

function running(dueAt: Date, targetMs: number, now: Date): Deadline {
  const remainingMs = dueAt.getTime() - now.getTime();
  const state: DeadlineState = remainingMs < 0 ? "breached" : remainingMs < targetMs * DUE_SOON_SHARE ? "due_soon" : "on_track";
  return { state, dueAt, remainingMs };
}

function finished(dueAt: Date, doneAt: Date): Deadline {
  const remainingMs = dueAt.getTime() - doneAt.getTime();
  return { state: remainingMs < 0 ? "met_late" : "met", dueAt, remainingMs };
}

export function firstResponseDeadline(issue: TimedIssue, targets: TargetHours, now: Date): Deadline {
  const targetMs = targets.firstResponse[issue.urgency] * HOUR;
  const dueAt = new Date(new Date(issue.receivedAt).getTime() + targetMs);
  if (issue.firstResponseAt) return finished(dueAt, new Date(issue.firstResponseAt));
  if (issue.status === "resolved") return { state: "stopped", dueAt, remainingMs: dueAt.getTime() - now.getTime() };
  return running(dueAt, targetMs, now);
}

/** Waiting-on-customer time up to `at`, in milliseconds. */
function waitingMs(issue: TimedIssue, at: Date) {
  const current = issue.waitingSince ? Math.max(0, at.getTime() - new Date(issue.waitingSince).getTime()) : 0;
  return issue.waitingSeconds * 1000 + current;
}

export function resolutionDeadline(issue: TimedIssue, targets: TargetHours, now: Date): Deadline {
  const targetMs = targets.resolution[issue.urgency] * HOUR;
  const start = new Date(issue.receivedAt).getTime();
  if (issue.status === "resolved" && issue.resolvedAt) {
    const resolvedAt = new Date(issue.resolvedAt);
    return finished(new Date(start + targetMs + waitingMs(issue, resolvedAt)), resolvedAt);
  }
  const dueAt = new Date(start + targetMs + waitingMs(issue, now));
  if (issue.waitingSince) return { state: "paused", dueAt, remainingMs: dueAt.getTime() - now.getTime() };
  return running(dueAt, targetMs, now);
}

export interface IssueDeadlines {
  firstResponse: Deadline;
  resolution: Deadline;
}

export function deadlines(issue: TimedIssue, targets: TargetHours, now: Date): IssueDeadlines {
  return { firstResponse: firstResponseDeadline(issue, targets, now), resolution: resolutionDeadline(issue, targets, now) };
}

/** Is either deadline missed on an issue that is still open? */
export function isOverdue(d: IssueDeadlines) {
  return d.firstResponse.state === "breached" || d.resolution.state === "breached";
}

/** The deadline to show first for an open issue: the first response until it is recorded. */
export function nextDeadline(d: IssueDeadlines): { kind: "first_response" | "resolution"; deadline: Deadline } {
  const fr = d.firstResponse.state;
  if (fr === "on_track" || fr === "due_soon" || fr === "breached") return { kind: "first_response", deadline: d.firstResponse };
  return { kind: "resolution", deadline: d.resolution };
}

const urgencyRank: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const RUNNING: DeadlineState[] = ["breached", "due_soon", "on_track"];

/**
 * "Needs attention first": anything breached, then the nearest running
 * deadline, then urgency. Paused and finished issues go last.
 */
export function compareAttention(a: { urgency: Urgency; d: IssueDeadlines }, b: { urgency: Urgency; d: IssueDeadlines }) {
  const key = (x: { urgency: Urgency; d: IssueDeadlines }) => {
    const running = [x.d.firstResponse, x.d.resolution].filter((d) => RUNNING.includes(d.state));
    const breached = running.some((d) => d.state === "breached") ? 0 : 1;
    const nearest = running.length ? Math.min(...running.map((d) => d.remainingMs)) : Number.POSITIVE_INFINITY;
    return { breached, nearest };
  };
  const ka = key(a);
  const kb = key(b);
  return ka.breached - kb.breached || ka.nearest - kb.nearest || urgencyRank[a.urgency] - urgencyRank[b.urgency];
}

/** "3 h 20 min", "45 min", "2 d 4 h": for remaining or overdue time. */
export function formatDuration(ms: number) {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** One line for a deadline, e.g. "First response due in 2 h" or "Resolution overdue by 3 h". */
export function describeDeadline(kind: "first_response" | "resolution", d: Deadline) {
  const label = kind === "first_response" ? "First response" : "Resolution";
  switch (d.state) {
    case "on_track":
    case "due_soon":
      return `${label} due in ${formatDuration(d.remainingMs)}`;
    case "breached":
      return `${label} overdue by ${formatDuration(d.remainingMs)}`;
    case "paused":
      return `${label} paused while waiting on the customer`;
    case "met":
      return `${label} met`;
    case "met_late":
      return `${label} met, ${formatDuration(d.remainingMs)} late`;
    case "stopped":
      return `${label}: none recorded`;
  }
}
