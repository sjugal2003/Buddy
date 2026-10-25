// Escalations are raised by the database (run_escalation_check), never by the
// browser. These helpers only describe them.

export const escalationConditions = [
  "first_response_breached",
  "resolution_breached",
  "urgent_no_team",
  "no_team",
  "no_update",
] as const;

export type EscalationCondition = (typeof escalationConditions)[number];

export const escalationConditionLabels: Record<EscalationCondition, string> = {
  first_response_breached: "First-response target breached",
  resolution_breached: "Resolution target breached",
  urgent_no_team: "Critical or High urgency with no team",
  no_team: "Open with no team",
  no_update: "No update",
};

export function isEscalationCondition(value: string | null): value is EscalationCondition {
  return escalationConditions.includes(value as EscalationCondition);
}

/** The highest level among escalations nobody has acknowledged yet, or 0. */
export function openEscalationLevel(escalations: { level: number; acknowledgedAt: string | null }[]) {
  return escalations.reduce((top, e) => (e.acknowledgedAt === null && e.level > top ? e.level : top), 0);
}

export interface EscalationRunSummary {
  issuesChecked: number;
  escalationsCreated: number;
  error: string | null;
}

/** "Checked 12 open issues: 2 new escalations." */
export function describeRun(run: EscalationRunSummary) {
  if (run.error) return `The check failed: ${run.error}`;
  const issues = `${run.issuesChecked} open ${run.issuesChecked === 1 ? "issue" : "issues"}`;
  const created =
    run.escalationsCreated === 0
      ? "no new escalations"
      : `${run.escalationsCreated} new ${run.escalationsCreated === 1 ? "escalation" : "escalations"}`;
  return `Checked ${issues}: ${created}.`;
}

/** How often the database scheduler checks (pg_cron job "buddy-escalation-check"). */
export const SCHEDULED_CHECK_MINUTES = 15;

/**
 * What Settings says about automatic checks, judged only from the latest
 * scheduled check actually logged, never assumed. Three missed checks in a
 * row count as stopped. `latest` adds whether that check failed and when one
 * last succeeded (stage 31), so failures show even while checks keep running.
 */
export function automaticCheckStatus(
  lastScheduledAt: string | null,
  now: Date,
  latest?: { error: string | null; lastSuccessAt: string | null },
): { running: boolean; failing: boolean; text: string } {
  if (!lastScheduledAt) return { running: false, failing: false, text: "Not running. Use Check now." };
  const minutes = (now.getTime() - new Date(lastScheduledAt).getTime()) / 60_000;
  if (minutes > SCHEDULED_CHECK_MINUTES * 3) {
    return {
      running: false,
      failing: false,
      text: "No scheduled check in the last 45 minutes, so they may have stopped. Use Check now.",
    };
  }
  if (latest?.error) {
    const sinceSuccess = latest.lastSuccessAt ? (now.getTime() - new Date(latest.lastSuccessAt).getTime()) / 60_000 : Infinity;
    const noneThisHour = sinceSuccess > 60 ? " No automatic check has succeeded in the last hour." : "";
    return {
      running: true,
      failing: true,
      text: `Running every ${SCHEDULED_CHECK_MINUTES} minutes, but the last automatic check failed: ${latest.error}${noneThisHour}`,
    };
  }
  return { running: true, failing: false, text: `Running every ${SCHEDULED_CHECK_MINUTES} minutes.` };
}
