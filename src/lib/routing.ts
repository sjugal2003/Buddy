import type { Issue, RoutingRule, RuleCondition } from "@/lib/types";

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
