import { describe, expect, it } from "vitest";
import { backupFolderName, backupSteps } from "../../scripts/backup-plan.mjs";

type Step = { label: string; file: string; args: string[] };

describe("backup plan", () => {
  it("names the folder by local date and time so folders sort in order", () => {
    expect(backupFolderName(new Date(2026, 10, 2, 9, 5))).toBe("2026-11-02_0905");
    expect(backupFolderName(new Date(2026, 0, 31, 23, 59))).toBe("2026-01-31_2359");
  });

  it("dumps roles, structure and data from the linked project", () => {
    const steps: Step[] = backupSteps(false);
    expect(steps.map((s) => s.file)).toEqual(["roles.sql", "schema.sql", "data.sql"]);
    for (const step of steps) {
      expect(step.args.slice(0, 3)).toEqual(["supabase", "db", "dump"]);
      expect(step.args).toContain("--linked");
      expect(step.args).not.toContain("--local");
    }
    expect(steps[0].args).toContain("--role-only");
    expect(steps[2].args).toEqual(expect.arrayContaining(["--data-only", "--use-copy", "--schema", "auth,public,private"]));
  });

  it("uses the local test database only when asked", () => {
    const steps: Step[] = backupSteps(true);
    expect(steps.every((s) => s.args.includes("--local") && !s.args.includes("--linked"))).toBe(true);
  });
});
