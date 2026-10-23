import { describe, expect, it } from "vitest";
import {
  averageFirstResponseHours,
  byPriority,
  countBy,
  inLastDays,
  isOverdue,
  negativeShare,
  resolutionRate,
  responseTargetRate,
  themeTrends,
  weeklySentiment,
} from "@/lib/analytics";
import type { Issue, Workspace } from "@/lib/types";

const now = new Date("2026-10-23T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

function issue(overrides: Omit<Partial<Issue>, "analysis"> & { analysis?: Partial<Issue["analysis"]> }): Issue {
  const { analysis, ...rest } = overrides;
  return {
    id: "i",
    workspaceId: "w",
    reference: "R-1",
    customerName: "Ada",
    channel: "email",
    subject: "Subject",
    message: "Message",
    receivedAt: hoursAgo(1),
    teamId: null,
    assignee: null,
    status: "new",
    firstResponseAt: null,
    resolvedAt: null,
    events: [],
    ...rest,
    analysis: {
      sentiment: "neutral",
      sentimentScore: 0,
      intent: "question",
      urgency: "medium",
      categoryId: "c",
      themes: [],
      summary: "",
      suggestedAction: "",
      confidence: 1,
      source: "demo",
      ...analysis,
    },
  };
}

const workspace: Workspace = {
  id: "w",
  slug: "w",
  name: "W",
  industry: "",
  timezone: "UTC",
  responseTargetsHours: { critical: 1, high: 4, medium: 8, low: 24 },
};

describe("time windows", () => {
  it("keeps issues received inside the window", () => {
    const recent = issue({ id: "recent", receivedAt: hoursAgo(24) });
    const old = issue({ id: "old", receivedAt: hoursAgo(24 * 10) });
    expect(inLastDays([recent, old], 7, now).map((i) => i.id)).toEqual(["recent"]);
    expect(inLastDays([recent, old], 7, now, 7).map((i) => i.id)).toEqual(["old"]);
  });
});

describe("rates and averages", () => {
  it("returns NaN for empty lists instead of a misleading zero", () => {
    expect(resolutionRate([])).toBeNaN();
    expect(negativeShare([])).toBeNaN();
    expect(averageFirstResponseHours([issue({})])).toBeNaN();
    expect(responseTargetRate([issue({})], workspace)).toBeNaN();
  });

  it("computes resolution rate and negative share", () => {
    const issues = [
      issue({ status: "resolved", analysis: { sentiment: "very_negative" } }),
      issue({ analysis: { sentiment: "negative" } }),
      issue({}),
      issue({}),
    ];
    expect(resolutionRate(issues)).toBe(0.25);
    expect(negativeShare(issues)).toBe(0.5);
  });

  it("measures first responses against the target for each urgency", () => {
    const fast = issue({ receivedAt: hoursAgo(10), firstResponseAt: hoursAgo(8), analysis: { urgency: "high" } });
    const slow = issue({ receivedAt: hoursAgo(10), firstResponseAt: hoursAgo(4), analysis: { urgency: "high" } });
    expect(averageFirstResponseHours([fast, slow])).toBe(4);
    expect(responseTargetRate([fast, slow], workspace)).toBe(0.5);
  });
});

describe("isOverdue", () => {
  it("flags open, unanswered issues past their target only", () => {
    expect(isOverdue(issue({ receivedAt: hoursAgo(2), analysis: { urgency: "critical" } }), workspace, now)).toBe(true);
    expect(isOverdue(issue({ receivedAt: hoursAgo(2), analysis: { urgency: "low" } }), workspace, now)).toBe(false);
    expect(
      isOverdue(issue({ receivedAt: hoursAgo(2), firstResponseAt: hoursAgo(1), analysis: { urgency: "critical" } }), workspace, now),
    ).toBe(false);
    expect(
      isOverdue(issue({ receivedAt: hoursAgo(2), status: "resolved", analysis: { urgency: "critical" } }), workspace, now),
    ).toBe(false);
  });
});

describe("byPriority", () => {
  it("sorts by urgency, then sentiment, then oldest first", () => {
    const issues = [
      issue({ id: "low", analysis: { urgency: "low" } }),
      issue({ id: "critical-new", receivedAt: hoursAgo(1), analysis: { urgency: "critical" } }),
      issue({ id: "critical-old", receivedAt: hoursAgo(5), analysis: { urgency: "critical" } }),
      issue({ id: "critical-angry", receivedAt: hoursAgo(1), analysis: { urgency: "critical", sentiment: "very_negative" } }),
    ];
    expect([...issues].sort(byPriority).map((i) => i.id)).toEqual(["critical-angry", "critical-old", "critical-new", "low"]);
  });
});

describe("counts and trends", () => {
  it("counts every theme on an issue", () => {
    const counts = countBy([issue({ analysis: { themes: ["a", "b"] } }), issue({ analysis: { themes: ["a"] } })], (i) => i.analysis.themes);
    expect(Object.fromEntries(counts)).toEqual({ a: 2, b: 1 });
  });

  it("compares this period with the one before", () => {
    const issues = [
      issue({ receivedAt: hoursAgo(24), analysis: { themes: ["outage"] } }),
      issue({ receivedAt: hoursAgo(48), analysis: { themes: ["outage"] } }),
      issue({ receivedAt: hoursAgo(24 * 20), status: "resolved", analysis: { themes: ["outage", "refund"] } }),
    ];
    const trends = themeTrends(issues, now, 14);
    expect(trends.find((t) => t.theme === "outage")).toMatchObject({ current: 2, previous: 1, change: 1, openCount: 2 });
    expect(trends.find((t) => t.theme === "refund")).toMatchObject({ current: 0, previous: 1, change: -1, openCount: 0 });
  });

  it("gives one point per week, oldest first, with matching totals", () => {
    const points = weeklySentiment([issue({ receivedAt: hoursAgo(24), analysis: { sentiment: "negative" } })], now, 4);
    expect(points).toHaveLength(4);
    expect(points[3]).toMatchObject({ negative: 1, total: 1 });
    expect(points.slice(0, 3).every((p) => p.total === 0)).toBe(true);
  });
});
