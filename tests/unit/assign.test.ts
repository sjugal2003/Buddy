import { describe, expect, it } from "vitest";
import { assigneeOptions } from "@/lib/assign";

const ana = { userId: "11111111-1111-4111-8111-111111111111", fullName: "Ana", role: "owner" as const };
const bo = { userId: "22222222-2222-4222-8222-222222222222", fullName: "Bo", role: "member" as const };

describe("assigneeOptions", () => {
  it("offers Nobody and each member, and picks the current one", () => {
    const { options, selected } = assigneeOptions([ana, bo], { assigneeId: bo.userId, assigneeName: "Bo" });
    expect(options).toEqual([
      { value: "", label: "Nobody" },
      { value: ana.userId, label: "Ana" },
      { value: bo.userId, label: "Bo" },
    ]);
    expect(selected).toBe(bo.userId);
  });

  it("selects Nobody when the issue isn't assigned", () => {
    expect(assigneeOptions([ana], { assigneeId: null, assigneeName: null }).selected).toBe("");
  });

  it("adds the role when two members share a name", () => {
    const twin = { ...bo, fullName: "Ana" };
    const labels = assigneeOptions([ana, twin], { assigneeId: null, assigneeName: null }).options.map((o) => o.label);
    expect(labels).toEqual(["Nobody", "Ana (Owner)", "Ana (Member)"]);
  });

  it("keeps an older typed name as its own choice", () => {
    const { options, selected } = assigneeOptions([ana], { assigneeId: null, assigneeName: "Old Name" });
    expect(options.at(-1)).toEqual({ value: "keep", label: "Old Name (not linked to a member)" });
    expect(selected).toBe("keep");
  });
});
