import { describe, expect, it } from "vitest";
import { aiPauseMs, describeBatchTime, MAX_AI_BATCH, planAiBatch } from "@/lib/import-ai";

describe("planning AI for imported issues", () => {
  it("analyses every waiting issue when enough analyses are left", () => {
    expect(planAiBatch(3, 10, 100)).toEqual({ waiting: 3, left: 90, toAnalyse: 3 });
  });

  it("never plans more than what is left this month", () => {
    expect(planAiBatch(10, 95, 100)).toEqual({ waiting: 10, left: 5, toAnalyse: 5 });
    expect(planAiBatch(10, 100, 100)).toEqual({ waiting: 10, left: 0, toAnalyse: 0 });
    // A limit lowered below what was used leaves nothing, never a negative number.
    expect(planAiBatch(10, 120, 100)).toEqual({ waiting: 10, left: 0, toAnalyse: 0 });
  });

  it("caps one batch", () => {
    expect(planAiBatch(5000, 0, 10_000).toAnalyse).toBe(MAX_AI_BATCH);
  });
});

describe("pacing", () => {
  it("waits between requests for real services only", () => {
    expect(aiPauseMs("fake")).toBe(0);
    expect(aiPauseMs("claude")).toBe(1000);
    expect(aiPauseMs("gemini")).toBe(4500);
  });

  it("says roughly how long a batch takes", () => {
    expect(describeBatchTime(3, 0)).toBe("under a minute");
    expect(describeBatchTime(100, 4500)).toBe("about 11 minutes");
  });
});
