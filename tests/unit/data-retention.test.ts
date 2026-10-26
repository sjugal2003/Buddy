import { describe, expect, it } from "vitest";
import { describeDeletion, RETENTION_DAYS, retentionLabel } from "@/lib/data-retention";
import { deleteAccountSchema, deleteCustomerDataSchema, deleteIssueSchema, retentionSchema } from "@/lib/validation";

const org = "11111111-1111-4111-8111-111111111111";

describe("retention wording", () => {
  it("offers only periods the database accepts (30 days to 10 years)", () => {
    expect(RETENTION_DAYS.length).toBeGreaterThan(0);
    for (const days of RETENTION_DAYS) expect(days >= 30 && days <= 3650).toBe(true);
  });

  it("says what happens to resolved issues", () => {
    expect(retentionLabel(null)).toBe("Kept until someone deletes them");
    expect(retentionLabel(365)).toBe("Deleted 1 year after they are resolved");
    expect(retentionLabel(400)).toBe("Deleted 400 days after they are resolved");
  });
});

describe("deletion log lines", () => {
  it("never needs customer details", () => {
    expect(describeDeletion({ kind: "issue", issueCount: 1, reference: "ISS-1A2B3C4D", deletedByName: "Ada" })).toBe(
      "Ada deleted issue ISS-1A2B3C4D",
    );
    expect(describeDeletion({ kind: "customer", issueCount: 3, reference: null, deletedByName: null })).toBe(
      "A former member deleted a customer's data (3 issues)",
    );
    expect(describeDeletion({ kind: "retention", issueCount: 1, reference: null, deletedByName: null })).toBe(
      "Automatic clean-up deleted 1 issue resolved longer ago than the company keeps them",
    );
  });
});

describe("deletion input", () => {
  it("compares the typed reference without caring about case or spaces", () => {
    expect(deleteIssueSchema.parse({ issueId: org, confirm: " iss-1a2b " }).confirm).toBe("ISS-1A2B");
  });

  it("needs a real email and a ticked box to delete a customer's data", () => {
    expect(deleteCustomerDataSchema.parse({ organizationId: org, email: " Gone@Example.com ", confirm: "on" }).email).toBe(
      "gone@example.com",
    );
    expect(deleteCustomerDataSchema.safeParse({ organizationId: org, email: "gone@example.com", confirm: "" }).success).toBe(
      false,
    );
    expect(deleteCustomerDataSchema.safeParse({ organizationId: org, email: "nope", confirm: "on" }).success).toBe(false);
  });

  it("accepts only the offered retention periods, or keeping issues", () => {
    expect(retentionSchema.parse({ organizationId: org, retentionDays: "" }).retentionDays).toBeNull();
    expect(retentionSchema.parse({ organizationId: org, retentionDays: "365" }).retentionDays).toBe(365);
    expect(retentionSchema.safeParse({ organizationId: org, retentionDays: "7" }).success).toBe(false);
    expect(retentionSchema.safeParse({ organizationId: org, retentionDays: "abc" }).success).toBe(false);
  });
});

describe("deleting your own account", () => {
  it("needs an email typed, compared without case or spaces", () => {
    expect(deleteAccountSchema.parse({ confirm: " Me@Example.com " }).confirm).toBe("me@example.com");
    expect(deleteAccountSchema.safeParse({ confirm: "" }).success).toBe(false);
  });
});

