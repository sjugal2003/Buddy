import { describe, expect, it } from "vitest";
import { conditionMatches, findMatchingRule, ruleMatches, type RoutableMessage } from "@/lib/routing";
import { fakeAnswer } from "@/lib/ai/fake";
import { toSuggestion } from "@/lib/ai/schema";
import type { RoutingRule } from "@/lib/types";

const message: RoutableMessage = {
  subject: "Refund for double charge",
  message: "I was charged twice this month.",
  channel: "email",
  analysis: { categoryId: "billing", urgency: "high", sentiment: "negative", intent: "complaint" },
};

function rule(overrides: Partial<RoutingRule>): RoutingRule {
  return {
    id: "r",
    workspaceId: "w",
    name: "Rule",
    enabled: true,
    match: "all",
    conditions: [],
    teamId: "team",
    ...overrides,
  };
}

describe("conditionMatches", () => {
  it("compares each field with the message", () => {
    expect(conditionMatches({ field: "category", value: "billing" }, message)).toBe(true);
    expect(conditionMatches({ field: "category", value: "orders" }, message)).toBe(false);
    expect(conditionMatches({ field: "urgency", value: "high" }, message)).toBe(true);
    expect(conditionMatches({ field: "sentiment", value: "positive" }, message)).toBe(false);
    expect(conditionMatches({ field: "intent", value: "complaint" }, message)).toBe(true);
    expect(conditionMatches({ field: "channel", value: "live_chat" }, message)).toBe(false);
  });

  it("finds keywords in the subject or message, ignoring case and spaces", () => {
    expect(conditionMatches({ field: "keyword", value: "REFUND" }, message)).toBe(true);
    expect(conditionMatches({ field: "keyword", value: "  charged twice " }, message)).toBe(true);
    expect(conditionMatches({ field: "keyword", value: "delivery" }, message)).toBe(false);
  });

  it("never matches an empty keyword", () => {
    expect(conditionMatches({ field: "keyword", value: "   " }, message)).toBe(false);
  });
});

describe("ruleMatches", () => {
  const yes = { field: "urgency", value: "high" } as const;
  const no = { field: "channel", value: "phone_transcript" } as const;

  it("needs every condition when matching all", () => {
    expect(ruleMatches(rule({ match: "all", conditions: [yes, yes] }), message)).toBe(true);
    expect(ruleMatches(rule({ match: "all", conditions: [yes, no] }), message)).toBe(false);
  });

  it("needs one condition when matching any", () => {
    expect(ruleMatches(rule({ match: "any", conditions: [no, yes] }), message)).toBe(true);
    expect(ruleMatches(rule({ match: "any", conditions: [no] }), message)).toBe(false);
  });

  it("ignores switched-off rules and rules without conditions", () => {
    expect(ruleMatches(rule({ enabled: false, conditions: [yes] }), message)).toBe(false);
    expect(ruleMatches(rule({ conditions: [] }), message)).toBe(false);
  });
});

describe("findMatchingRule", () => {
  it("returns the first matching rule from the top", () => {
    const rules = [
      rule({ id: "off", enabled: false, conditions: [{ field: "category", value: "billing" }] }),
      rule({ id: "miss", conditions: [{ field: "category", value: "orders" }] }),
      rule({ id: "first", conditions: [{ field: "keyword", value: "refund" }] }),
      rule({ id: "second", conditions: [{ field: "category", value: "billing" }] }),
    ];
    expect(findMatchingRule(rules, message)?.id).toBe("first");
  });

  it("returns null when nothing matches", () => {
    expect(findMatchingRule([rule({ conditions: [{ field: "intent", value: "praise" }] })], message)).toBeNull();
    expect(findMatchingRule([], message)).toBeNull();
  });
});

describe("routing with AI values", () => {
  it("matches a rule on the urgency and category the AI chose", () => {
    const categories = [{ id: "billing", name: "Billing" }];
    const input = { subject: "Down", message: "Billing portal is down, urgent.", channel: "email" as const, categories };
    const suggestion = toSuggestion(fakeAnswer(input), categories)!;
    const analysed: RoutableMessage = {
      ...input,
      analysis: {
        categoryId: suggestion.categoryId ?? "",
        urgency: suggestion.urgency,
        sentiment: suggestion.sentiment,
        intent: suggestion.intent,
      },
    };
    const critical = rule({ id: "critical", conditions: [{ field: "urgency", value: "critical" }] });
    const billing = rule({ id: "billing", conditions: [{ field: "category", value: "billing" }] });
    expect(findMatchingRule([critical, billing], analysed)?.id).toBe("critical");
    expect(findMatchingRule([billing, critical], analysed)?.id).toBe("billing");
  });
});
