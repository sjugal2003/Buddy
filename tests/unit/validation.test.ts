import { describe, expect, it } from "vitest";
import {
  analyseIssueSchema,
  createIssueSchema,
  createRuleSchema,
  fieldErrors,
  issueFiltersSchema,
  signUpSchema,
  slugSchema,
  timezoneSchema,
  updateAiSettingsSchema,
  updateOrganizationSchema,
} from "@/lib/validation";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("sign-up and workspace names", () => {
  it("tidies emails and explains short passwords", () => {
    const ok = signUpSchema.parse({ fullName: " Ada ", email: " ADA@Example.com ", password: "long enough" });
    expect(ok).toMatchObject({ fullName: "Ada", email: "ada@example.com" });
    const bad = signUpSchema.safeParse({ fullName: "Ada", email: "ada@example.com", password: "short" });
    expect(bad.success || fieldErrors(bad.error)).toEqual({ password: "Use at least 8 characters." });
  });

  it("accepts simple workspace addresses only", () => {
    expect(slugSchema.parse(" Outskill ")).toBe("outskill");
    expect(slugSchema.safeParse("-bad").success).toBe(false);
    expect(slugSchema.safeParse("a").success).toBe(false);
    expect(slugSchema.safeParse("no spaces").success).toBe(false);
  });

  it("knows real time zones", () => {
    expect(timezoneSchema.safeParse("Asia/Kolkata").success).toBe(true);
    expect(timezoneSchema.safeParse("Mars/Olympus").success).toBe(false);
  });
});

describe("issues", () => {
  const base = {
    organizationId: uuid,
    teamId: "",
    categoryId: "",
    customerName: "Ada",
    channel: "email",
    subject: "Help",
    message: "It broke",
    urgency: "high",
    sentiment: "negative",
    intent: "complaint",
  };

  it("turns an empty team or category into no link", () => {
    expect(createIssueSchema.parse(base)).toMatchObject({ teamId: null, categoryId: null });
    expect(createIssueSchema.parse({ ...base, teamId: uuid })).toMatchObject({ teamId: uuid });
  });

  it("refuses values the database would refuse", () => {
    expect(createIssueSchema.safeParse({ ...base, channel: "fax" }).success).toBe(false);
    expect(createIssueSchema.safeParse({ ...base, teamId: "not-an-id" }).success).toBe(false);
    expect(createIssueSchema.safeParse({ ...base, subject: "x".repeat(201) }).success).toBe(false);
  });

  it("falls back to safe filters and strips odd characters from searches", () => {
    expect(issueFiltersSchema.parse({ status: "nonsense", urgency: 3, team: "x", q: undefined })).toEqual({
      status: "active",
      urgency: "",
      team: "",
      q: "",
      due: "",
      sort: "",
    });
    expect(issueFiltersSchema.parse({ due: "bogus", sort: "oldest" })).toMatchObject({ due: "", sort: "" });
    expect(issueFiltersSchema.parse({ due: "overdue", sort: "attention" })).toMatchObject({ due: "overdue", sort: "attention" });
    expect(issueFiltersSchema.parse({ status: "all", q: "  o'neil,(id.eq.1)*  " }).q).toBe("o'neil id.eq.1");
  });
});

describe("settings", () => {
  it("needs whole hours between 1 and 720 for response targets", () => {
    const base = {
      organizationId: uuid,
      name: "Outskill",
      industry: "",
      timezone: "UTC",
      targetCritical: "1",
      targetHigh: "4",
      targetMedium: "8",
      targetLow: "24",
      resolutionCritical: "8",
      resolutionHigh: "24",
      resolutionMedium: "72",
      resolutionLow: "120",
    };
    expect(updateOrganizationSchema.parse(base).targetLow).toBe(24);
    expect(updateOrganizationSchema.parse(base).resolutionLow).toBe(120);
    expect(updateOrganizationSchema.safeParse({ ...base, resolutionLow: "2161" }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ ...base, resolutionHigh: "0" }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ ...base, targetHigh: "0" }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ ...base, targetHigh: "1.5" }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ ...base, targetLow: "721" }).success).toBe(false);
  });
});

describe("routing rules", () => {
  const base = { organizationId: uuid, name: "Refunds", match: "any", teamId: uuid };
  const parse = (conditions: unknown) =>
    createRuleSchema.safeParse({ ...base, conditions: typeof conditions === "string" ? conditions : JSON.stringify(conditions) });

  it("accepts well-formed conditions", () => {
    const ok = parse([
      { field: "keyword", value: " refund " },
      { field: "urgency", value: "critical" },
      { field: "category", value: uuid },
    ]);
    expect(ok.success && ok.data.conditions[0]).toEqual({ field: "keyword", value: "refund" });
  });

  it("refuses empty, malformed or oversized condition lists", () => {
    expect(parse([]).success).toBe(false);
    expect(parse("not json").success).toBe(false);
    expect(parse([{ field: "keyword", value: "  " }]).success).toBe(false);
    expect(parse([{ field: "urgency", value: "extreme" }]).success).toBe(false);
    expect(parse([{ field: "category", value: "billing" }]).success).toBe(false);
    expect(parse([{ field: "owner", value: "x" }]).success).toBe(false);
    expect(parse(Array.from({ length: 21 }, () => ({ field: "urgency", value: "low" }))).success).toBe(false);
  });

  it("refuses an unknown match mode", () => {
    expect(createRuleSchema.safeParse({ ...base, match: "most", conditions: "[]" }).success).toBe(false);
  });
});

describe("AI inputs", () => {
  it("accepts 'Let AI decide' only for urgency, sentiment and type", () => {
    const base = {
      organizationId: "00000000-0000-4000-8000-000000000001",
      teamId: "",
      categoryId: "",
      customerName: "Sam",
      channel: "email",
      subject: "Hi",
      message: "Hello",
    };
    expect(createIssueSchema.safeParse({ ...base, urgency: "ai", sentiment: "ai", intent: "ai" }).success).toBe(true);
    expect(createIssueSchema.safeParse({ ...base, urgency: "ai", sentiment: "ai", intent: "maybe" }).success).toBe(false);
  });

  it("only lets the AI fill known fields", () => {
    const issueId = "00000000-0000-4000-8000-000000000001";
    expect(analyseIssueSchema.safeParse({ issueId, fill: ["urgency", "category"] }).success).toBe(true);
    expect(analyseIssueSchema.safeParse({ issueId, fill: ["status"] }).success).toBe(false);
  });

  it("AI settings take on/off switches and a limit of 0 to 2,000", () => {
    const base = { organizationId: uuid, enabled: "on", autoRoute: "off", monthlyLimit: "500" };
    expect(updateAiSettingsSchema.safeParse(base).success).toBe(true);
    expect(updateAiSettingsSchema.safeParse({ ...base, autoRoute: "yes" }).success).toBe(false);
    expect(updateAiSettingsSchema.safeParse({ ...base, monthlyLimit: "2001" }).success).toBe(false);
  });
});
