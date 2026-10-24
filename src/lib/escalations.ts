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
