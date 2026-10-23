import type { Issue, Sentiment, Team, Urgency, Workspace } from "@/lib/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const isOpen = (issue: Issue) => issue.status !== "resolved";

export function hoursBetween(from: string, to: string) {
  return (new Date(to).getTime() - new Date(from).getTime()) / HOUR;
}

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

export function inLastDays(issues: Issue[], days: number, now: Date, offsetDays = 0) {
  const end = now.getTime() - offsetDays * DAY;
  const start = end - days * DAY;
  return issues.filter((i) => {
    const t = new Date(i.receivedAt).getTime();
    return t > start && t <= end;
  });
}

export function averageFirstResponseHours(issues: Issue[]) {
  return average(
    issues.filter((i) => i.firstResponseAt).map((i) => hoursBetween(i.receivedAt, i.firstResponseAt!)),
  );
}

export function averageResolutionHours(issues: Issue[]) {
  return average(issues.filter((i) => i.resolvedAt).map((i) => hoursBetween(i.receivedAt, i.resolvedAt!)));
}

export function resolutionRate(issues: Issue[]) {
  return issues.length ? issues.filter((i) => i.status === "resolved").length / issues.length : NaN;
}

/** Share of answered issues whose first response met the workspace target. */
export function responseTargetRate(issues: Issue[], workspace: Workspace) {
  const answered = issues.filter((i) => i.firstResponseAt);
  if (!answered.length) return NaN;
  const met = answered.filter(
    (i) => hoursBetween(i.receivedAt, i.firstResponseAt!) <= workspace.responseTargetsHours[i.analysis.urgency],
  );
  return met.length / answered.length;
}

export function negativeShare(issues: Issue[]) {
  if (!issues.length) return NaN;
  return issues.filter((i) => i.analysis.sentiment === "negative" || i.analysis.sentiment === "very_negative").length / issues.length;
}

export interface WeeklySentimentPoint {
  week: string;
  positive: number;
  neutral: number;
  negative: number;
  very_negative: number;
  total: number;
}

/** Issue counts per sentiment for each of the last `weeks` weeks, oldest first. */
export function weeklySentiment(issues: Issue[], now: Date, weeks = 8): WeeklySentimentPoint[] {
  const points: WeeklySentimentPoint[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const slice = inLastDays(issues, 7, now, w * 7);
    const weekStart = new Date(now.getTime() - (w + 1) * 7 * DAY + DAY);
    const point: WeeklySentimentPoint = {
      week: weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
      positive: 0,
      neutral: 0,
      negative: 0,
      very_negative: 0,
      total: slice.length,
    };
    for (const issue of slice) point[issue.analysis.sentiment] += 1;
    points.push(point);
  }
  return points;
}

export function countBy<K extends string>(issues: Issue[], key: (issue: Issue) => K | K[]) {
  const counts = new Map<K, number>();
  for (const issue of issues) {
    const keys = key(issue);
    for (const k of Array.isArray(keys) ? keys : [keys]) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export interface ThemeTrend {
  theme: string;
  current: number;
  previous: number;
  change: number;
  openCount: number;
}

/** Recurring themes in the last `days` days compared with the period before. */
export function themeTrends(issues: Issue[], now: Date, days = 14): ThemeTrend[] {
  const current = countBy(inLastDays(issues, days, now), (i) => i.analysis.themes);
  const previous = countBy(inLastDays(issues, days, now, days), (i) => i.analysis.themes);
  const open = countBy(issues.filter(isOpen), (i) => i.analysis.themes);
  const themes = new Set([...current.keys(), ...previous.keys()]);
  return [...themes]
    .map((theme) => {
      const c = current.get(theme) ?? 0;
      const p = previous.get(theme) ?? 0;
      return { theme, current: c, previous: p, change: p ? (c - p) / p : c ? 1 : 0, openCount: open.get(theme) ?? 0 };
    })
    .sort((a, b) => b.current - a.current);
}

export interface TeamPerformance {
  team: Team;
  open: number;
  escalated: number;
  resolvedLast30: number;
  avgFirstResponseHours: number;
  avgResolutionHours: number;
}

export function teamPerformance(issues: Issue[], teams: Team[], now: Date): TeamPerformance[] {
  const last30 = inLastDays(issues, 30, now);
  return teams.map((team) => {
    const teamIssues = issues.filter((i) => i.teamId === team.id);
    const teamLast30 = last30.filter((i) => i.teamId === team.id);
    return {
      team,
      open: teamIssues.filter(isOpen).length,
      escalated: teamIssues.filter((i) => i.status === "escalated").length,
      resolvedLast30: teamLast30.filter((i) => i.status === "resolved").length,
      avgFirstResponseHours: averageFirstResponseHours(teamLast30),
      avgResolutionHours: averageResolutionHours(teamLast30),
    };
  });
}

const urgencyRank: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const sentimentRank: Record<Sentiment, number> = { very_negative: 0, negative: 1, neutral: 2, positive: 3 };

/** Most pressing first: urgency, then sentiment, then oldest. */
export function byPriority(a: Issue, b: Issue) {
  return (
    urgencyRank[a.analysis.urgency] - urgencyRank[b.analysis.urgency] ||
    sentimentRank[a.analysis.sentiment] - sentimentRank[b.analysis.sentiment] ||
    a.receivedAt.localeCompare(b.receivedAt)
  );
}

export function isOverdue(issue: Issue, workspace: Workspace, now: Date) {
  if (!isOpen(issue)) return false;
  const target = workspace.responseTargetsHours[issue.analysis.urgency];
  const reference = issue.firstResponseAt ? null : issue.receivedAt;
  return reference !== null && hoursBetween(reference, now.toISOString()) > target;
}
