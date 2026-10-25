import { describe, expect, it } from "vitest";
import { automaticCheckStatus, describeRun, escalationConditionLabels, isEscalationCondition, openEscalationLevel } from "@/lib/escalations";

describe("escalations", () => {
  it("shows the highest level nobody has acknowledged", () => {
    expect(openEscalationLevel([])).toBe(0);
    expect(
      openEscalationLevel([
        { level: 1, acknowledgedAt: null },
        { level: 2, acknowledgedAt: "2026-10-24T10:00:00Z" },
      ]),
    ).toBe(1);
    expect(
      openEscalationLevel([
        { level: 1, acknowledgedAt: null },
        { level: 2, acknowledgedAt: null },
      ]),
    ).toBe(2);
    expect(openEscalationLevel([{ level: 2, acknowledgedAt: "2026-10-24T10:00:00Z" }])).toBe(0);
  });

  it("knows the conditions the database can raise", () => {
    expect(isEscalationCondition("no_team")).toBe(true);
    expect(isEscalationCondition("status")).toBe(false);
    expect(isEscalationCondition(null)).toBe(false);
    expect(escalationConditionLabels.resolution_breached).toBe("Resolution target breached");
  });

  it("describes a check in a sentence", () => {
    expect(describeRun({ issuesChecked: 12, escalationsCreated: 2, error: null })).toBe(
      "Checked 12 open issues: 2 new escalations.",
    );
    expect(describeRun({ issuesChecked: 1, escalationsCreated: 1, error: null })).toBe(
      "Checked 1 open issue: 1 new escalation.",
    );
    expect(describeRun({ issuesChecked: 3, escalationsCreated: 0, error: null })).toBe(
      "Checked 3 open issues: no new escalations.",
    );
    expect(describeRun({ issuesChecked: 3, escalationsCreated: 0, error: "boom" })).toBe("The check failed: boom");
  });
});

describe("automatic check status", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");
  it("says not running until a scheduled check has been logged", () => {
    expect(automaticCheckStatus(null, now)).toEqual({ running: false, failing: false, text: "Not running. Use Check now." });
  });
  it("says running while scheduled checks keep arriving", () => {
    expect(automaticCheckStatus("2026-10-24T11:50:00.000Z", now)).toEqual({
      running: true,
      failing: false,
      text: "Running every 15 minutes.",
    });
    expect(automaticCheckStatus("2026-10-24T11:15:00.000Z", now).running).toBe(true);
  });
  it("warns when three checks in a row are missing", () => {
    const status = automaticCheckStatus("2026-10-24T11:14:00.000Z", now);
    expect(status.running).toBe(false);
    expect(status.text).toContain("may have stopped");
  });
  it("says when the last automatic check failed", () => {
    const status = automaticCheckStatus("2026-10-24T11:50:00.000Z", now, {
      error: "canceling statement due to statement timeout",
      lastSuccessAt: "2026-10-24T11:35:00.000Z",
    });
    expect(status).toEqual({
      running: true,
      failing: true,
      text: "Running every 15 minutes, but the last automatic check failed: canceling statement due to statement timeout",
    });
  });
  it("warns when no automatic check has succeeded for an hour", () => {
    const old = automaticCheckStatus("2026-10-24T11:50:00.000Z", now, { error: "boom", lastSuccessAt: "2026-10-24T10:30:00.000Z" });
    expect(old.text).toContain("No automatic check has succeeded in the last hour.");
    const never = automaticCheckStatus("2026-10-24T11:50:00.000Z", now, { error: "boom", lastSuccessAt: null });
    expect(never.text).toContain("No automatic check has succeeded in the last hour.");
  });
  it("ignores an old failure once a later check succeeded", () => {
    expect(automaticCheckStatus("2026-10-24T11:50:00.000Z", now, { error: null, lastSuccessAt: "2026-10-24T11:50:00.000Z" }).failing).toBe(false);
  });
});
