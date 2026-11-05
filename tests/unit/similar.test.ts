import { describe, expect, it } from "vitest";
import { reportedTimes, reportsBadge, similarityLabel, VERY_SIMILAR } from "@/lib/similar";

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
