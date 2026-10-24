import { describe, expect, it } from "vitest";
import { DUE_WITHIN_MS, isDueWithin, isUrgent, startOfWeek, summariseOpenIssues, type DashboardIssue } from "@/lib/dashboard";
import { deadlines, type TargetHours } from "@/lib/targets";
import { describeActivity } from "@/lib/activity";

const targets: TargetHours = {
  firstResponse: { critical: 1, high: 4, medium: 12, low: 24 },
  resolution: { critical: 8, high: 24, medium: 72, low: 120 },
};

const now = new Date("2026-10-24T12:00:00.000Z");
let n = 0;

function issue(overrides: Partial<DashboardIssue> = {}): DashboardIssue {
  n += 1;
  return {
    id: `issue-${n}`,
    receivedAt: "2026-10-24T11:30:00.000Z",
    urgency: "medium",
    status: "open",
    teamId: "team-1",
    firstResponseAt: null,
    resolvedAt: null,
    waitingSeconds: 0,
    waitingSince: null,
    ...overrides,
  };
}

describe("dashboard counts", () => {
  it("are all zero for a company with no issues", () => {
    expect(summariseOpenIssues([], targets, new Set(), now)).toEqual({
      urgent: 0,
      dueSoon: 0,
      breached: 0,
      escalated: 0,
      noTeam: 0,
      waiting: 0,
    });
  });

  it("count each open issue under every card it belongs to", () => {
    const issues = [
      // Critical, 30 min old: first response due in 30 min.
      issue({ urgency: "critical" }),
      // High, 5 hours old with no response: first response missed.
      issue({ urgency: "high", receivedAt: "2026-10-24T07:00:00.000Z" }),
      // Low, no team, waiting on the customer.
      issue({ urgency: "low", teamId: null, status: "waiting_on_customer", firstResponseAt: "2026-10-24T11:40:00.000Z", waitingSince: "2026-10-24T11:45:00.000Z" }),
      // Medium, escalated, nothing due soon.
      issue({ id: "escalated-1", firstResponseAt: "2026-10-24T11:35:00.000Z" }),
      // Resolved issues never count.
      issue({ urgency: "critical", teamId: null, status: "resolved", resolvedAt: "2026-10-24T11:50:00.000Z" }),
    ];
    expect(summariseOpenIssues(issues, targets, new Set(["escalated-1"]), now)).toEqual({
      urgent: 2,
      dueSoon: 1,
      breached: 1,
      escalated: 1,
      noTeam: 1,
      waiting: 1,
    });
  });

  it("ignore escalations on issues that are not open", () => {
    const resolved = issue({ status: "resolved", resolvedAt: "2026-10-24T11:50:00.000Z" });
    expect(summariseOpenIssues([resolved], targets, new Set([resolved.id]), now).escalated).toBe(0);
  });
});

describe("due within 2 hours", () => {
  it("includes a running deadline 2 hours away or less, but not a missed or paused one", () => {
    // Medium: first response due 12 h after arrival.
    const at = (hoursLeft: number) =>
      deadlines(issue({ receivedAt: new Date(now.getTime() - (12 - hoursLeft) * 3_600_000).toISOString() }), targets, now);
    expect(isDueWithin(at(2), DUE_WITHIN_MS)).toBe(true);
    expect(isDueWithin(at(2.1), DUE_WITHIN_MS)).toBe(false);
    expect(isDueWithin(at(-1), DUE_WITHIN_MS)).toBe(false);
    const paused = deadlines(
      issue({
        urgency: "critical",
        receivedAt: "2026-10-24T05:00:00.000Z",
        firstResponseAt: "2026-10-24T05:10:00.000Z",
        status: "waiting_on_customer",
        waitingSince: "2026-10-24T11:00:00.000Z",
      }),
      targets,
      now,
    );
    expect(isDueWithin(paused, DUE_WITHIN_MS)).toBe(false);
  });

  it("treats Critical and High as urgent", () => {
    expect(["critical", "high", "medium", "low"].map((u) => isUrgent(u as DashboardIssue["urgency"]))).toEqual([true, true, false, false]);
  });
});

describe("start of the week", () => {
  it("is Monday midnight in the company's time zone", () => {
    // Saturday 24 Oct 2026, 12:00 UTC is 17:30 in Kolkata (UTC+5:30).
    expect(startOfWeek(now, "Asia/Kolkata").toISOString()).toBe("2026-10-18T18:30:00.000Z");
    expect(startOfWeek(now, "UTC").toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });

  it("uses the company's date when it differs from UTC", () => {
    // Sunday 25 Oct 22:00 UTC is already Monday 26 Oct in Auckland (UTC+13).
    expect(startOfWeek(new Date("2026-10-25T22:00:00.000Z"), "Pacific/Auckland").toISOString()).toBe("2026-10-25T11:00:00.000Z");
    // Monday 26 Oct 03:00 UTC is still Sunday evening in New York.
    expect(startOfWeek(new Date("2026-10-26T03:00:00.000Z"), "America/New_York").toISOString()).toBe("2026-10-19T04:00:00.000Z");
  });

  it("copes with a clock change during the week", () => {
    // London leaves summer time on Sunday 25 Oct 2026; that Monday began at 23:00 UTC on the 18th.
    expect(startOfWeek(new Date("2026-10-25T12:00:00.000Z"), "Europe/London").toISOString()).toBe("2026-10-18T23:00:00.000Z");
  });
});

describe("history lines", () => {
  it("read the same on the home page as on the issue page", () => {
    expect(describeActivity({ kind: "status_changed", fromValue: "new", toValue: "in_progress" })).toBe(
      "Status changed from New to In progress",
    );
    expect(describeActivity({ kind: "escalated", fromValue: "2", toValue: "Critical issue has no team" })).toBe(
      "Escalated (level 2): Critical issue has no team",
    );
  });
});
