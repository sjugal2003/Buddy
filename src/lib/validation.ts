import { z } from "zod";

// Input rules for everything the browser sends to the server. The database
// enforces the same limits; checking here gives clearer messages.

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export const signUpSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(120, "Use 120 characters or fewer."),
  email: emailSchema,
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Use 72 characters or fewer."),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(72),
});

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/,
    "Use 3 to 40 lowercase letters, numbers or hyphens, starting and ending with a letter or number.",
  );

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Enter the company name.").max(100, "Use 100 characters or fewer."),
  slug: slugSchema,
  industry: z.string().trim().max(100, "Use 100 characters or fewer."),
  timezone: timezoneSchema,
});

export const roleSchema = z.enum(["owner", "admin", "member"]);
export const inviteRoleSchema = z.enum(["admin", "member"]);

export const createInvitationSchema = z.object({
  organizationId: z.string().uuid(),
  email: emailSchema,
  role: inviteRoleSchema,
});

export const memberChangeSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const inviteTokenSchema = z.string().min(20).max(200);

/** The first message for each field, for showing next to form inputs. */
export function fieldErrors(error: z.ZodError) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

// Issues. The lists match the database's check constraints.
export const channelSchema = z.enum(["email", "live_chat", "app_review", "survey", "social", "phone_transcript"]);
export const urgencySchema = z.enum(["low", "medium", "high", "critical"]);
export const sentimentSchema = z.enum(["positive", "neutral", "negative", "very_negative"]);
export const intentSchema = z.enum(["complaint", "question", "request", "bug_report", "cancellation", "praise"]);
export const statusSchema = z.enum(["new", "open", "in_progress", "waiting_on_customer", "escalated", "resolved"]);

/** An optional link to a team or category: empty means none. */
const optionalId = z.union([z.literal(""), z.string().uuid()]).transform((v) => v || null);

/** An optional email address, stored in lower case; "" means none. */
export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Use 254 characters or fewer.")
  .refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email address, or leave it empty.")
  .transform((v) => v || null)
  .optional()
  .transform((v) => v ?? null);

export const createIssueSchema = z.object({
  organizationId: z.string().uuid(),
  teamId: optionalId,
  categoryId: optionalId,
  customerName: z.string().trim().min(1, "Enter the customer's name.").max(120, "Use 120 characters or fewer."),
  customerEmail: optionalEmailSchema,
  channel: channelSchema,
  subject: z.string().trim().min(1, "Enter a subject.").max(200, "Use 200 characters or fewer."),
  message: z.string().trim().min(1, "Enter what the customer said.").max(10000, "Use 10,000 characters or fewer."),
  // "ai" means "Let AI decide": saved with the usual default, then filled by the AI.
  urgency: z.union([urgencySchema, z.literal("ai")]),
  sentiment: z.union([sentimentSchema, z.literal("ai")]),
  intent: z.union([intentSchema, z.literal("ai")]),
});

/** Issue fields an AI analysis can fill in. "summary" also covers themes and the next step. */
export const aiFieldSchema = z.enum(["sentiment", "intent", "urgency", "category", "summary"]);
export type AiField = z.infer<typeof aiFieldSchema>;

export const analyseIssueSchema = z.object({
  issueId: z.string().uuid(),
  fill: z.array(aiFieldSchema).max(5),
});

export const acceptAiValueSchema = z.object({ analysisId: z.string().uuid(), field: aiFieldSchema });

export const updateIssueSchema = z.object({
  issueId: z.string().uuid(),
  status: statusSchema,
  teamId: optionalId,
  categoryId: optionalId,
  // Empty means nobody is assigned.
  assigneeName: z
    .string()
    .trim()
    .max(120, "Use 120 characters or fewer.")
    .transform((v) => v || null),
});

/** Inbox filters from the address bar. Anything unexpected is ignored. */
export const issueFiltersSchema = z.object({
  status: z.union([statusSchema, z.enum(["active", "all"])]).catch("active"),
  // "urgent" is Critical or High.
  urgency: z.union([urgencySchema, z.enum(["", "urgent"])]).catch(""),
  team: z.union([z.string().uuid(), z.literal("unassigned"), z.literal("")]).catch(""),
  // Deadlines: "overdue" (a target missed), "soon" (due within the last quarter
  // of its time) or "2h" (due within 2 hours).
  due: z.enum(["", "overdue", "soon", "2h"]).catch(""),
  // "open": has an escalation nobody has acknowledged.
  escalated: z.enum(["", "open"]).catch(""),
  sort: z.enum(["", "attention"]).catch(""),
  // Only plain characters, so the search can't change the database query.
  q: z
    .string()
    .catch("")
    .transform((v) => v.replace(/[^\p{L}\p{N} @.'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100)),
});

// Settings (owners and admins; the database refuses anyone else).
const targetHours = z.coerce
  .number({ message: "Enter a number of hours." })
  .int("Use whole hours.")
  .min(1, "Use at least 1 hour.")
  .max(720, "Use 720 hours (30 days) or fewer.");

/** Hours to resolve an issue, per urgency: up to 90 days. */
const resolutionHours = z.coerce
  .number({ message: "Enter a number of hours." })
  .int("Use whole hours.")
  .min(1, "Use at least 1 hour.")
  .max(2160, "Use 2,160 hours (90 days) or fewer.");

export const updateOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1, "Enter the company name.").max(100, "Use 100 characters or fewer."),
  industry: z.string().trim().max(100, "Use 100 characters or fewer."),
  timezone: timezoneSchema,
  targetCritical: targetHours,
  targetHigh: targetHours,
  targetMedium: targetHours,
  targetLow: targetHours,
  resolutionCritical: resolutionHours,
  resolutionHigh: resolutionHours,
  resolutionMedium: resolutionHours,
  resolutionLow: resolutionHours,
});

export const updateAiSettingsSchema = z.object({
  organizationId: z.string().uuid(),
  enabled: z.enum(["on", "off"]),
  autoRoute: z.enum(["on", "off"]),
  monthlyLimit: z.coerce
    .number({ message: "Enter a number." })
    .int("Use a whole number.")
    .min(0, "Use 0 or more.")
    .max(2000, "Use 2,000 or fewer."),
});

const teamFields = {
  name: z.string().trim().min(1, "Enter a team name.").max(80, "Use 80 characters or fewer."),
  leadName: z.string().trim().max(80, "Use 80 characters or fewer."),
  email: z.union([z.literal(""), emailSchema]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour."),
};

export const createTeamSchema = z.object({ organizationId: z.string().uuid(), ...teamFields });
export const updateTeamSchema = z.object({ teamId: z.string().uuid(), ...teamFields });

const categoryName = z.string().trim().min(1, "Enter a category name.").max(80, "Use 80 characters or fewer.");
export const createCategorySchema = z.object({ organizationId: z.string().uuid(), name: categoryName });
export const updateCategorySchema = z.object({ categoryId: z.string().uuid(), name: categoryName });

export const idSchema = z.string().uuid();

// Routing rules. The database checks the same shape (private.valid_rule_conditions).
export const ruleConditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("category"), value: z.string().uuid("Choose a category.") }),
  z.object({ field: z.literal("urgency"), value: urgencySchema }),
  z.object({ field: z.literal("sentiment"), value: sentimentSchema }),
  z.object({ field: z.literal("intent"), value: intentSchema }),
  z.object({ field: z.literal("channel"), value: channelSchema }),
  z.object({
    field: z.literal("keyword"),
    value: z.string().trim().min(1, "Enter a word to look for.").max(200, "Use 200 characters or fewer."),
  }),
]);

/** Conditions arrive from the form as one JSON text field. */
const conditionsSchema = z
  .string()
  .max(20000)
  .transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Add at least one condition." });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(ruleConditionSchema, { message: "Check the conditions." })
      .min(1, "Add at least one condition.")
      .max(20, "Use 20 conditions or fewer."),
  );

const ruleFields = {
  name: z.string().trim().min(1, "Enter a rule name.").max(100, "Use 100 characters or fewer."),
  match: z.enum(["all", "any"]),
  teamId: z.string().uuid("Choose a team."),
  conditions: conditionsSchema,
};

export const createRuleSchema = z.object({ organizationId: z.string().uuid(), ...ruleFields });
export const updateRuleSchema = z.object({ ruleId: z.string().uuid(), ...ruleFields });
export const toggleRuleSchema = z.object({ ruleId: z.string().uuid(), enabled: z.enum(["true", "false"]) });
export const moveRuleSchema = z.object({ ruleId: z.string().uuid(), direction: z.enum(["up", "down"]) });

// Escalation settings. The database checks the same limits.
const escalationHours = (min: number) =>
  z.coerce
    .number({ message: "Enter a number of hours." })
    .int("Use whole hours.")
    .min(min, `Use ${min} or more.`)
    .max(720, "Use 720 hours (30 days) or fewer.");
const onOff = z.enum(["on", "off"]);

export const updateEscalationSettingsSchema = z.object({
  organizationId: z.string().uuid(),
  firstResponse: onOff,
  resolution: onOff,
  urgentNoTeam: onOff,
  urgentNoTeamHours: escalationHours(0),
  noTeam: onOff,
  noTeamHours: escalationHours(0),
  noUpdate: onOff,
  noUpdateHours: escalationHours(1),
});

export const acknowledgeEscalationSchema = z.object({
  escalationId: z.string().uuid(),
  note: z.string().trim().max(500, "Keep the note to 500 characters or fewer."),
});

// CSV import (Phase 5 stage 23). Shapes only: public.import_issues checks
// each row's content again and gives the reasons. Limits are one over the
// database's so an over-long value is still rejected there, with its reason.
export const importRowSchema = z.object({
  row: z.number().int().min(1).max(1_000_000),
  record_id: z.string().max(201),
  customer_name: z.string().max(121),
  customer_email: z.string().max(255),
  channel: z.string().max(40),
  subject: z.string().max(201),
  message: z.string().max(10001),
  received_at: z.string().max(40).nullable(),
});

export const startImportSchema = z.object({
  organizationId: z.string().uuid(),
  fileName: z.string().trim().max(200),
});

export const importChunkSchema = z.object({
  runId: z.string().uuid(),
  rows: z.array(importRowSchema).min(1).max(500),
  asHistory: z.boolean(),
});

export const finishImportSchema = z.object({
  runId: z.string().uuid(),
  error: z.string().trim().max(500).nullable(),
});
