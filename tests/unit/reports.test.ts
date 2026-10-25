import { describe, expect, it } from "vitest";
import {
  addDays,
  describeRange,
  formatSeconds,
  inOrder,
  issueReportSchema,
  resolveReportRange,
  responseTargetShare,
  todayIn,
} from "@/lib/reports";

describe("todayIn", () => {
  it("uses the company's calendar, not UTC", () => {
    const lateEvening = new Date("2025-01-31T20:00:00Z");
    expect(todayIn(lateEvening, "UTC")).toBe("2025-01-31");
    expect(todayIn(lateEvening, "Asia/Kolkata")).toBe("2025-02-01");
    expect(todayIn(new Date("2025-01-01T03:00:00Z"), "America/New_York")).toBe("2024-12-31");
  });
});

describe("addDays", () => {
  it("crosses months, years and leap days", () => {
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
  });
});

describe("resolveReportRange", () => {
  const today = "2025-01-31";

  it("defaults to the last 30 days, ending today", () => {
    expect(resolveReportRange({}, today)).toEqual({ preset: "30d", from: "2025-01-02", to: "2025-01-31" });
    expect(resolveReportRange({ range: "nonsense" }, today)).toEqual({ preset: "30d", from: "2025-01-02", to: "2025-01-31" });
  });

  it("gives the last 7 days including today", () => {
    expect(resolveReportRange({ range: "7d" }, today)).toEqual({ preset: "7d", from: "2025-01-25", to: "2025-01-31" });
  });

  it("accepts a valid custom range, including a single day", () => {
    expect(resolveReportRange({ range: "custom", from: "2025-01-01", to: "2025-01-15" }, today)).toEqual({
      preset: "custom",
      from: "2025-01-01",
      to: "2025-01-15",
    });
    expect(resolveReportRange({ range: "custom", from: "2025-01-31", to: "2025-01-31" }, today).preset).toBe("custom");
  });

  it("falls back to 30 days with a message for an unusable custom range", () => {
    const cases: [Record<string, string>, string][] = [
      [{ range: "custom" }, "Choose both a start and an end date."],
      [{ range: "custom", from: "2025-02-30", to: "2025-01-31" }, "Choose both a start and an end date."],
      [{ range: "custom", from: "2025-01-20", to: "2025-01-10" }, "Choose a start date on or before the end date."],
      [{ range: "custom", from: "2025-01-01", to: "2025-02-01" }, "The end date can't be after today."],
      [{ range: "custom", from: "2024-01-30", to: "2025-01-31" }, "Choose a date range of 366 days or fewer."],
    ];
    for (const [params, error] of cases) {
      expect(resolveReportRange(params, today)).toEqual({ preset: "30d", from: "2025-01-02", to: "2025-01-31", error });
    }
  });

  it("allows exactly 366 days", () => {
    expect(resolveReportRange({ range: "custom", from: "2024-01-31", to: "2025-01-30" }, today).error).toBeUndefined();
  });

  it("uses the first value when a parameter is repeated", () => {
    expect(resolveReportRange({ range: ["7d", "30d"] }, today).preset).toBe("7d");
  });
});

describe("describeRange", () => {
  it("names the days", () => {
    expect(describeRange("2025-01-01", "2025-01-31")).toBe("1 Jan 2025 to 31 Jan 2025");
    expect(describeRange("2025-01-05", "2025-01-05")).toBe("5 Jan 2025");
  });
});

describe("formatSeconds", () => {
  it("formats times and shows a dash for nothing", () => {
    expect(formatSeconds(null)).toBe("–");
    expect(formatSeconds(30)).toBe("under 1 min");
    expect(formatSeconds(11_700)).toBe("3 h 15 min");
    expect(formatSeconds(3 * 86_400)).toBe("3 d");
  });
});

describe("responseTargetShare", () => {
  it("counts met against everything that could be judged", () => {
    expect(responseTargetShare({ met: 1, late: 1, missed: 1, not_due: 5, resolved_without_response: 2 })).toBeCloseTo(1 / 3);
    expect(responseTargetShare({ met: 0, late: 0, missed: 0, not_due: 3, resolved_without_response: 0 })).toBeNull();
  });
});

describe("inOrder", () => {
  it("sorts by a fixed order and puts unknown keys last", () => {
    const rows = [
      { key: "low", count: 1 },
      { key: "other", count: 9 },
      { key: "critical", count: 2 },
    ];
    expect(inOrder(rows, ["critical", "high", "medium", "low"]).map((r) => r.key)).toEqual(["critical", "low", "other"]);
  });
});

describe("issueReportSchema", () => {
  const report = {
    timezone: "UTC",
    from: "2025-01-01",
    to: "2025-01-31",
    totals: { received: 0, history: 0, still_open: 0 },
    resolved: 0,
    first_response: { count: 0, median_seconds: null, average_seconds: null },
    resolution: { count: 0, median_seconds: null, average_seconds: null },
    response_target: { met: 0, late: 0, missed: 0, not_due: 0, resolved_without_response: 0 },
    escalations: [],
    teams: [],
    categories: [],
    channels: [],
    urgency: [],
    sentiment: [],
    imports: [],
  };

  it("accepts the database's answer for an empty period", () => {
    expect(issueReportSchema.safeParse(report).success).toBe(true);
  });

  it("rejects an answer of the wrong shape", () => {
    expect(issueReportSchema.safeParse({ ...report, totals: { received: -1, history: 0, still_open: 0 } }).success).toBe(false);
    expect(issueReportSchema.safeParse(null).success).toBe(false);
  });
});
