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

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Enter the company name.").max(100, "Use 100 characters or fewer."),
  slug: slugSchema,
  industry: z.string().trim().max(100, "Use 100 characters or fewer."),
  timezone: z
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
    }, "Choose a valid time zone."),
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
