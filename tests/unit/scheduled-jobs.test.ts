import { describe, expect, it } from "vitest";
import { DAILY_CLEANUP_JOB, dailyCleanupStatus, type ScheduledJob } from "@/lib/scheduled-jobs";

const now = new Date("2026-11-02T10:00:00Z");
const format = (iso: string) => `at ${iso}`;
const job = (overrides: Partial<ScheduledJob> = {}): ScheduledJob => ({
  name: DAILY_CLEANUP_JOB,
  schedule: "30 3 * * *",
  active: true,
  lastRunAt: "2026-11-02T03:30:00Z",
  lastStatus: "succeeded",
  ...overrides,
});

describe("dailyCleanupStatus", () => {
  it("says it works after a recent successful run", () => {
    expect(dailyCleanupStatus([job()], now, format)).toEqual({
      failing: false,
      text: "Working. Last run at 2026-11-02T03:30:00Z.",
    });
  });

  it("warns when the last success is more than a day old", () => {
    const status = dailyCleanupStatus([job({ lastRunAt: "2026-10-31T03:30:00Z" })], now, format);
    expect(status.failing).toBe(true);
    expect(status.text).toContain("more than a day ago");
  });

  it("still counts a run 25 hours ago as working", () => {
    expect(dailyCleanupStatus([job({ lastRunAt: "2026-11-01T09:00:00Z" })], now, format).failing).toBe(false);
  });

  it("reports a failed run", () => {
    const status = dailyCleanupStatus([job({ lastStatus: "failed" })], now, format);
    expect(status).toEqual({ failing: true, text: "The last run failed (at 2026-11-02T03:30:00Z)." });
  });

  it("shows a run in progress without calling it a failure", () => {
    expect(dailyCleanupStatus([job({ lastStatus: "running" })], now, format)).toEqual({
      failing: false,
      text: "Running now (started at 2026-11-02T03:30:00Z).",
    });
  });

  it("says when it has not run yet", () => {
    const status = dailyCleanupStatus([job({ lastRunAt: null, lastStatus: null })], now, format);
    expect(status).toEqual({ failing: false, text: "Set up to run every day at 03:30 UTC. It hasn't run yet." });
  });

  it("flags a job that is missing, switched off, or unreadable", () => {
    expect(dailyCleanupStatus([], now, format).failing).toBe(true);
    expect(dailyCleanupStatus([{ ...job(), name: "something-else" }], now, format).text).toContain("Not set up");
    expect(dailyCleanupStatus([job({ active: false })], now, format).text).toBe("Switched off in this database.");
    expect(dailyCleanupStatus(null, now, format)).toEqual({ failing: true, text: "Couldn't check right now. Try again later." });
  });
});
