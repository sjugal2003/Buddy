import type { IssueActivity } from "@/lib/data/live";
import { escalationConditionLabels, isEscalationCondition } from "@/lib/escalations";
import { intentLabels, sentimentLabels, statusLabels, urgencyLabels } from "@/lib/labels";
import { intentSchema, sentimentSchema, statusSchema, urgencySchema } from "@/lib/validation";

// One line of an issue's history, as people read it. Used on the issue page
// and the workspace home.

function statusName(value: string | null) {
  const parsed = statusSchema.safeParse(value);
  return parsed.success ? statusLabels[parsed.data] : (value ?? "none");
}

const fieldNames: Record<string, string> = { sentiment: "sentiment", intent: "type", urgency: "urgency", category: "category" };

/** A value as people read it, e.g. "very_negative" becomes "Very negative". */
function valueName(field: string, value: string | null) {
  const label =
    (field === "urgency" && urgencySchema.safeParse(value).success && urgencyLabels[value as keyof typeof urgencyLabels]) ||
    (field === "sentiment" && sentimentSchema.safeParse(value).success && sentimentLabels[value as keyof typeof sentimentLabels]) ||
    (field === "intent" && intentSchema.safeParse(value).success && intentLabels[value as keyof typeof intentLabels]);
  return label || (value ?? "none");
}

export function describeActivity(event: Pick<IssueActivity, "kind" | "fromValue" | "toValue">) {
  switch (event.kind) {
    case "created":
      return `Issue created as ${statusName(event.toValue)}`;
    case "status_changed":
      return `Status changed from ${statusName(event.fromValue)} to ${statusName(event.toValue)}`;
    case "assignee_changed":
      if (!event.toValue) return `Unassigned (was ${event.fromValue})`;
      return event.fromValue ? `Reassigned from ${event.fromValue} to ${event.toValue}` : `Assigned to ${event.toValue}`;
    case "team_changed":
      return event.toValue ? `Moved to team ${event.toValue}` : `Removed from team ${event.fromValue ?? ""}`.trim();
    case "escalated":
      // Written by the escalation check: from_value is the level, to_value the reason.
      return event.fromValue ? `Escalated (level ${event.fromValue}): ${event.toValue ?? ""}`.trim() : "Escalated";
    case "routing_applied":
      // from_value is the rule's name, to_value the team, written by apply_routing_rule.
      return `Moved to team ${event.toValue ?? ""} by routing rule “${event.fromValue ?? ""}”`;
    case "routing_dismissed":
      return "Routing suggestion dismissed";
    case "duplicate_linked":
      // to_value is the main issue's reference, from_value the previous one (if any).
      return event.fromValue
        ? `Linked to ${event.toValue ?? ""} as the same problem (was ${event.fromValue})`
        : `Linked to ${event.toValue ?? ""} as the same problem`;
    case "duplicate_unlinked":
      return event.fromValue ? `Unlinked from ${event.fromValue}` : "Unlinked from its main issue";
    case "escalation_acknowledged": {
      const what = isEscalationCondition(event.fromValue) ? ` (${escalationConditionLabels[event.fromValue]})` : "";
      return `Escalation acknowledged${what}${event.toValue ? `: “${event.toValue}”` : ""}`;
    }
    case "category_changed":
      return `Category changed from ${event.fromValue ?? "No category"} to ${event.toValue ?? "No category"}`;
    case "first_response":
      return "First response recorded";
    case "resolved":
      return `Resolved (was ${statusName(event.fromValue)})`;
    case "reopened":
      return `Reopened as ${statusName(event.toValue)}`;
    case "ai_analysed":
      return `Analysed by AI (suggested urgency ${valueName("urgency", event.toValue)})`;
    case "ai_accepted": {
      // from_value is "<field>:<old value>", written by accept_issue_analysis.
      const [field, ...rest] = (event.fromValue ?? "").split(":");
      return `Accepted AI ${fieldNames[field] ?? field}: ${valueName(field, rest.join(":"))} → ${valueName(field, event.toValue)}`;
    }
  }
}
