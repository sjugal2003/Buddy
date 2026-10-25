import { escalationConditionLabels, isEscalationCondition } from "@/lib/escalations";
import { channelLabels, sentimentLabels, urgencyLabels, urgencyOrder } from "@/lib/labels";
import { inOrder, responseTargetShare, type IssueReport } from "@/lib/reports";

// The Reports page as a CSV file (Phase 6 stage 33). The same company-wide
// figures as the page, one per row: section, item, then one or more values.
// Times are in minutes so a spreadsheet can work with them. Nothing per person.

type Cell = string | number | null;

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (team and
 * category names are typed in by people) gets a leading apostrophe, and
 * anything with a comma, quote or line break is quoted.
 */
export function csvCell(value: Cell) {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function minutes(seconds: number | null) {
  return seconds === null ? null : Math.round(seconds / 6) / 10;
}

function label(labels: Record<string, string>, key: string) {
  return labels[key] ?? key;
}

const sentimentOrder = ["very_negative", "negative", "neutral", "positive"];
const importSourceLabels: Record<string, string> = { csv: "CSV import", gmail: "Gmail fetch" };

export interface ReportCsvContext {
  companyName: string;
  /** When the file was made, already written in the company's time zone. */
  generatedAt: string;
}

export function reportToCsv(report: IssueReport, context: ReportCsvContext) {
  const rows: Cell[][] = [["Section", "Item", "Value", "Value 2", "Value 3", "Value 4"]];
  const add = (...row: Cell[]) => rows.push(row);
  const share = responseTargetShare(report.response_target);

  add("Report", "Company", context.companyName);
  add("Report", "From", report.from);
  add("Report", "To", report.to);
  add("Report", "Time zone", report.timezone);
  add("Report", "Made at", context.generatedAt);
  add("Report", "Note", "Company and team figures only; no figures for individual people.");

  add("Totals", "Issues received", report.totals.received);
  add("Totals", "Received and still open", report.totals.still_open);
  add("Totals", "Past conversations imported as already resolved (not timed)", report.totals.history);
  add("Totals", "Issues resolved in this period", report.resolved);

  add("Times (minutes)", "First response: answered", report.first_response.count);
  add("Times (minutes)", "First response: median", minutes(report.first_response.median_seconds));
  add("Times (minutes)", "First response: average", minutes(report.first_response.average_seconds));
  add("Times (minutes)", "Resolution: resolved so far", report.resolution.count);
  add("Times (minutes)", "Resolution: median", minutes(report.resolution.median_seconds));
  add("Times (minutes)", "Resolution: average", minutes(report.resolution.average_seconds));

  const t = report.response_target;
  add("Response target", "Answered on time", t.met);
  add("Response target", "Answered late", t.late);
  add("Response target", "Unanswered past the target", t.missed);
  add("Response target", "Not due yet", t.not_due);
  add("Response target", "Resolved with no first response recorded", t.resolved_without_response);
  add("Response target", "Share met (%)", share === null ? null : Math.round(share * 1000) / 10);

  add("Teams", "Team", "Received", "Still open", "Median first response (minutes)", "Median resolution (minutes)");
  for (const team of report.teams) {
    add(
      "Teams",
      team.name ?? "No team",
      team.received,
      team.still_open,
      minutes(team.median_response_seconds),
      minutes(team.median_resolution_seconds),
    );
  }

  for (const r of inOrder(report.urgency, urgencyOrder)) add("By urgency", label(urgencyLabels, r.key), r.count);
  for (const r of inOrder(report.sentiment, sentimentOrder)) add("By sentiment", label(sentimentLabels, r.key), r.count);
  for (const r of report.channels) add("By channel", label(channelLabels, r.key), r.count);
  for (const r of report.categories) add("By category", r.name ?? "No category", r.count);

  add("Escalations", "Reason", "Raised", "Acknowledged");
  for (const e of report.escalations) {
    add("Escalations", isEscalationCondition(e.condition) ? escalationConditionLabels[e.condition] : e.condition, e.count, e.acknowledged);
  }

  add("Imports", "Source", "Runs", "Failed", "Imported", "Already in Buddy", "Rejected");
  for (const r of report.imports) {
    add("Imports", importSourceLabels[r.source] ?? r.source, r.runs, r.failed, r.imported, r.skipped_duplicate, r.rejected);
  }

  // A byte-order mark so Excel reads names with accents correctly; Windows line ends.
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** "buddy-report-acme-2025-01-01-to-2025-01-31.csv" (the slug is already safe). */
export function reportFileName(slug: string, from: string, to: string) {
  return `buddy-report-${slug}-${from}-to-${to}.csv`;
}
