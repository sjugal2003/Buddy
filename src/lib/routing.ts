import type { Channel, Intent, Issue, RoutingRule, RuleCondition, Sentiment, Urgency } from "@/lib/types";
import { channelLabels, intentLabels, sentimentLabels, urgencyLabels } from "@/lib/labels";

/** The parts of an issue that routing rules can look at. */
export type RoutableMessage = Pick<Issue, "subject" | "message" | "channel"> & {
  analysis: Pick<Issue["analysis"], "categoryId" | "urgency" | "sentiment" | "intent">;
};

export function conditionMatches(condition: RuleCondition, item: RoutableMessage) {
  switch (condition.field) {
    case "category":
      return item.analysis.categoryId === condition.value;
    case "urgency":
      return item.analysis.urgency === condition.value;
    case "sentiment":
      return item.analysis.sentiment === condition.value;
    case "intent":
      return item.analysis.intent === condition.value;
    case "channel":
      return item.channel === condition.value;
    case "keyword": {
      const keyword = condition.value.trim().toLowerCase();
      if (!keyword) return false;
      return `${item.subject} ${item.message}`.toLowerCase().includes(keyword);
    }
  }
}

export function ruleMatches(rule: RoutingRule, item: RoutableMessage) {
  if (!rule.enabled || rule.conditions.length === 0) return false;
  return rule.match === "all"
    ? rule.conditions.every((c) => conditionMatches(c, item))
    : rule.conditions.some((c) => conditionMatches(c, item));
}

/** Rules are checked from top to bottom; the first match wins. */
export function findMatchingRule(rules: RoutingRule[], item: RoutableMessage) {
  return rules.find((rule) => ruleMatches(rule, item)) ?? null;
}

/** The conditions of a rule that this issue meets. */
export function matchedConditions(rule: RoutingRule, item: RoutableMessage) {
  return rule.conditions.filter((c) => conditionMatches(c, item));
}

export type RoutingOutcome =
  | { kind: "none" }
  /** Every matching rule names the same team; `rule` is the first of them. */
  | { kind: "match"; rule: RoutingRule; teamId: string; reasons: RuleCondition[] }
  /** Matching rules name different teams: a person has to choose. */
  | { kind: "conflict"; rules: RoutingRule[] };

/**
 * Checks every rule, not just the first match. When matching rules disagree
 * about the team, the result is a conflict instead of "top rule wins".
 */
export function routeIssue(rules: RoutingRule[], item: RoutableMessage): RoutingOutcome {
  const matching = rules.filter((rule) => ruleMatches(rule, item));
  if (matching.length === 0) return { kind: "none" };
  const teams = new Set(matching.map((r) => r.teamId));
  if (teams.size > 1) return { kind: "conflict", rules: matching };
  const rule = matching[0];
  return { kind: "match", rule, teamId: rule.teamId, reasons: matchedConditions(rule, item) };
}

/** May this rule be applied to the issue now? Only the suggestion, or one of the rules in a conflict. */
export function canApplyRule(outcome: RoutingOutcome, ruleId: string) {
  if (outcome.kind === "match") return outcome.rule.id === ruleId;
  if (outcome.kind === "conflict") return outcome.rules.some((r) => r.id === ruleId);
  return false;
}

/** "category is Billing", "message mentions “refund”". */
export function describeCondition(condition: RuleCondition, categoryNames: Map<string, string>) {
  switch (condition.field) {
    case "category":
      return `category is ${categoryNames.get(condition.value) ?? "a deleted category"}`;
    case "urgency":
      return `urgency is ${urgencyLabels[condition.value as Urgency] ?? condition.value}`;
    case "sentiment":
      return `sentiment is ${sentimentLabels[condition.value as Sentiment] ?? condition.value}`;
    case "intent":
      return `type is ${intentLabels[condition.value as Intent] ?? condition.value}`;
    case "channel":
      return `channel is ${channelLabels[condition.value as Channel] ?? condition.value}`;
    case "keyword":
      return `message mentions “${condition.value.trim()}”`;
  }
}

/** "category is Billing and urgency is High". */
export function describeReasons(conditions: RuleCondition[], categoryNames: Map<string, string>) {
  const parts = conditions.map((c) => describeCondition(c, categoryNames));
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
