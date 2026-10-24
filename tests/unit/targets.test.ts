import { describe, expect, it } from "vitest";
import {
  compareAttention,
  deadlines,
  describeDeadline,
  firstResponseDeadline,
  formatDuration,
  isOverdue,
  nextDeadline,
  resolutionDeadline,
  type TargetHours,
  type TimedIssue,
} from "@/lib/targets";

const targets: TargetHours = {
  firstResponse: { critical: 1, high: 4, medium: 12, low: 24 },
  resolution: { critical: 8, high: 24, medium: 72, low: 120 },
};

const received = "2026-10-24T10:00:00.000Z";
const at = (time: string) => new Date(`2026-10-24T${time}:00.000Z`);

function issue(overrides: Partial<TimedIssue> = {}): TimedIssue {
  return {
    receivedAt: received,
    urgency: "critical",
    status: "new",
    firstResponseAt: null,
    resolvedAt: null,
    waitingSeconds: 0,
    waitingSince: null,
    ...overrides,
  };
}

describe("first-response deadline", () => {
  it("is due one target after arrival, for the issue's urgency", () => {
    const d = firstResponseDeadline(issue(), targets, at("10:10"));
    expect(d.dueAt.toISOString()).toBe("2026-10-24T11:00:00.000Z");
    expect(d.state).toBe("on_track");
    expect(firstResponseDeadline(issue({ urgency: "low" }), targets, at("10:10")).dueAt.toISOString()).toBe(
      "2026-10-25T10:00:00.000Z",
    );
  });

  it("is due soon in the last quarter and breached after the deadline", () => {
    expect(firstResponseDeadline(issue(), targets, at("10:50")).state).toBe("due_soon");
    const late = firstResponseDeadline(issue(), targets, at("12:30"));
    expect(late.state).toBe("breached");
    expect(describeDeadline("first_response", late)).toBe("First response overdue by 1 h 30 min");
  });

  it("stops when a response is recorded, noting if it was late", () => {
    expect(firstResponseDeadline(issue({ firstResponseAt: at("10:30").toISOString() }), targets, at("15:00")).state).toBe("met");
    const late = firstResponseDeadline(issue({ firstResponseAt: at("11:20").toISOString() }), targets, at("15:00"));
    expect(late.state).toBe("met_late");
    expect(describeDeadline("first_response", late)).toBe("First response met, 20 min late");
  });

  it("is not counted as breached once the issue is resolved without a response", () => {
    const d = firstResponseDeadline(issue({ status: "resolved", resolvedAt: at("12:00").toISOString() }), targets, at("15:00"));
    expect(d.state).toBe("stopped");
  });
});

describe("resolution deadline", () => {
  it("is due one resolution target after arrival", () => {
    const d = resolutionDeadline(issue(), targets, at("12:00"));
    expect(d.dueAt.toISOString()).toBe("2026-10-24T18:00:00.000Z");
    expect(d.state).toBe("on_track");
    expect(resolutionDeadline(issue(), targets, at("19:00")).state).toBe("breached");
  });

  it("is pushed back by time spent waiting on the customer, and paused during a wait", () => {
    const waited = resolutionDeadline(issue({ status: "open", waitingSeconds: 2 * 3600 }), targets, at("19:00"));
    expect(waited.dueAt.toISOString()).toBe("2026-10-24T20:00:00.000Z");
    expect(waited.state).toBe("due_soon");

    const waiting = resolutionDeadline(
      issue({ status: "waiting_on_customer", waitingSince: at("12:00").toISOString() }),
      targets,
      at("15:00"),
    );
    expect(waiting.state).toBe("paused");
    expect(waiting.dueAt.toISOString()).toBe("2026-10-24T21:00:00.000Z");
  });

  it("records whether a resolved issue met its target", () => {
    expect(resolutionDeadline(issue({ status: "resolved", resolvedAt: at("17:00").toISOString() }), targets, at("23:00")).state).toBe(
      "met",
    );
    expect(resolutionDeadline(issue({ status: "resolved", resolvedAt: at("19:00").toISOString() }), targets, at("23:00")).state).toBe(
      "met_late",
    );
  });

  it("keeps the original arrival time after a reopen, so a late issue stays late", () => {
    const reopened = resolutionDeadline(issue({ status: "open" }), targets, at("20:00"));
    expect(reopened.state).toBe("breached");
  });
});

describe("overdue and ordering", () => {
  it("is overdue when either running deadline is missed", () => {
    expect(isOverdue(deadlines(issue(), targets, at("11:30")))).toBe(true);
    expect(isOverdue(deadlines(issue({ firstResponseAt: at("10:30").toISOString() }), targets, at("11:30")))).toBe(false);
  });

  it("shows the first response until it is recorded, then the resolution", () => {
    expect(nextDeadline(deadlines(issue(), targets, at("10:10"))).kind).toBe("first_response");
    expect(nextDeadline(deadlines(issue({ firstResponseAt: at("10:30").toISOString() }), targets, at("10:40"))).kind).toBe(
      "resolution",
    );
  });

  it("puts breached issues first, then the nearest deadline, then urgency", () => {
    const now = at("12:00");
    const item = (o: Partial<TimedIssue>) => ({ urgency: o.urgency ?? "critical", d: deadlines(issue(o), targets, now) });
    const breached = item({ urgency: "critical" });
    const soon = item({ urgency: "high", receivedAt: "2026-10-24T08:30:00.000Z" });
    const later = item({ urgency: "low" });
    const waiting = item({ urgency: "critical", status: "waiting_on_customer", firstResponseAt: at("10:05").toISOString(), waitingSince: at("11:00").toISOString() });
    const sorted = [later, waiting, soon, breached].sort(compareAttention);
    expect(sorted).toEqual([breached, soon, later, waiting]);
  });

  it("formats durations in minutes, hours and days", () => {
    expect(formatDuration(30_000)).toBe("1 min");
    expect(formatDuration(45 * 60_000)).toBe("45 min");
    expect(formatDuration(-(3 * 60 + 20) * 60_000)).toBe("3 h 20 min");
    expect(formatDuration(52 * 3_600_000)).toBe("2 d 4 h");
  });
});
