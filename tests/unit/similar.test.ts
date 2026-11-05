import { describe, expect, it } from "vitest";
import { mostReported, reportedTimes, reportsBadge, similarityLabel, VERY_SIMILAR } from "@/lib/similar";

describe("similarityLabel", () => {
  it("calls high scores very similar", () => {
    expect(similarityLabel(1)).toBe("Very similar");
    expect(similarityLabel(VERY_SIMILAR)).toBe("Very similar");
  });
  it("calls the rest similar", () => {
    expect(similarityLabel(VERY_SIMILAR - 0.01)).toBe("Similar");
    expect(similarityLabel(0.3)).toBe("Similar");
  });
});

describe("reportedTimes", () => {
  it("counts the main issue too", () => {
    expect(reportedTimes(1)).toBe("Reported 2 times");
    expect(reportedTimes(3)).toBe("Reported 4 times");
  });
  it("says nothing without linked reports", () => {
    expect(reportedTimes(0)).toBeNull();
    expect(reportedTimes(-1)).toBeNull();
    expect(reportedTimes(1.5)).toBeNull();
  });
});

describe("reportsBadge", () => {
  it("uses the singular for one report", () => {
    expect(reportsBadge(1)).toBe("+1 report");
  });
  it("uses the plural for more", () => {
    expect(reportsBadge(3)).toBe("+3 reports");
  });
  it("shows nothing without linked reports", () => {
    expect(reportsBadge(0)).toBeNull();
  });
});

describe("mostReported", () => {
  const issue = (id: string, receivedAt: string) => ({ id, receivedAt });
  it("orders by reports, then newest, and keeps only issues with reports", () => {
    const counts = new Map([
      ["a", 1],
      ["b", 3],
      ["c", 3],
    ]);
    const open = [issue("a", "2026-11-01"), issue("b", "2026-11-02"), issue("c", "2026-11-03"), issue("d", "2026-11-04")];
    expect(mostReported(counts, open, 5).map((x) => [x.id, x.reports])).toEqual([
      ["c", 3],
      ["b", 3],
      ["a", 1],
    ]);
  });
  it("stops at the limit", () => {
    const counts = new Map([
      ["a", 2],
      ["b", 1],
    ]);
    expect(mostReported(counts, [issue("a", "x"), issue("b", "y")], 1).map((x) => x.id)).toEqual(["a"]);
  });
});
