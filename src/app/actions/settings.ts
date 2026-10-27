"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import {
  createCategorySchema,
  createTeamSchema,
  fieldErrors,
  idSchema,
  teamMemberSchema,
  updateAiSettingsSchema,
  updateCategorySchema,
  updateOrganizationSchema,
  updateTeamSchema,
} from "@/lib/validation";
import type { FormState } from "./types";

// Company settings, teams and categories. Only owners and admins may change
// them: the database refuses anyone else. A refused update or delete changes
// no rows rather than failing, so each action asks for the changed row back
// and only reports success when it got one.

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };
const NOT_ALLOWED: FormState = { error: "Only owners and admins can change this, or it no longer exists." };

function done(success: string): FormState {
  revalidatePath("/w/[workspace]", "layout");
  return { success };
}

export async function updateOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = updateOrganizationSchema.safeParse({
    organizationId: formData.get("organizationId"),
    name: formData.get("name"),
    industry: formData.get("industry") ?? "",
    timezone: formData.get("timezone"),
    targetCritical: formData.get("targetCritical"),
    targetHigh: formData.get("targetHigh"),
    targetMedium: formData.get("targetMedium"),
    targetLow: formData.get("targetLow"),
    resolutionCritical: formData.get("resolutionCritical"),
    resolutionHigh: formData.get("resolutionHigh"),
    resolutionMedium: formData.get("resolutionMedium"),
    resolutionLow: formData.get("resolutionLow"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({
      name: parsed.data.name,
      industry: parsed.data.industry,
      timezone: parsed.data.timezone,
      target_hours_critical: parsed.data.targetCritical,
      target_hours_high: parsed.data.targetHigh,
      target_hours_medium: parsed.data.targetMedium,
      target_hours_low: parsed.data.targetLow,
      resolution_hours_critical: parsed.data.resolutionCritical,
      resolution_hours_high: parsed.data.resolutionHigh,
      resolution_hours_medium: parsed.data.resolutionMedium,
      resolution_hours_low: parsed.data.resolutionLow,
    })
    .eq("id", parsed.data.organizationId)
    .select("id");
  if (error) return { error: friendlyError(error, "We couldn't save the settings. Please try again.", "updateOrganization") };
  if (!data?.length) return NOT_ALLOWED;
  return done("Settings saved.");
}

export async function updateAiSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = updateAiSettingsSchema.safeParse({
    organizationId: formData.get("organizationId"),
    enabled: formData.get("enabled") === "on" ? "on" : "off",
    autoRoute: formData.get("autoRoute") === "on" ? "on" : "off",
    monthlyLimit: formData.get("monthlyLimit"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const enabled = parsed.data.enabled === "on";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({
      ai_enabled: enabled,
      ai_monthly_limit: parsed.data.monthlyLimit,
      // The database refuses a change here from anyone but an owner.
      ai_auto_route: parsed.data.autoRoute === "on",
    })
    .eq("id", parsed.data.organizationId)
    .select("id");
  if (error) return { error: friendlyError(error, "We couldn't save the AI settings. Please try again.", "updateAiSettings") };
  if (!data?.length) return NOT_ALLOWED;
  return done(enabled ? "AI analysis switched on." : "AI analysis switched off.");
}

const TEAM_NAME_TAKEN: FormState = { fieldErrors: { name: "There is already a team with this name." } };

function teamFields(formData: FormData) {
  return {
    name: formData.get("name"),
    leadName: formData.get("leadName") ?? "",
    email: formData.get("email") ?? "",
    color: formData.get("color"),
  };
}

export async function createTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = createTeamSchema.safeParse({ organizationId: formData.get("organizationId"), ...teamFields(formData) });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("teams").insert({
    organization_id: parsed.data.organizationId,
    name: parsed.data.name,
    lead_name: parsed.data.leadName,
    email: parsed.data.email,
    color: parsed.data.color,
  });
  if (error?.code === "23505") return TEAM_NAME_TAKEN;
  if (error) return { error: friendlyError(error, "We couldn't add the team. Please try again.", "createTeam") };
  return done(`Team "${parsed.data.name}" added.`);
}

export async function updateTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = updateTeamSchema.safeParse({ teamId: formData.get("teamId"), ...teamFields(formData) });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .update({
      name: parsed.data.name,
      lead_name: parsed.data.leadName,
      email: parsed.data.email,
      color: parsed.data.color,
    })
    .eq("id", parsed.data.teamId)
    .select("id");
  if (error?.code === "23505") return TEAM_NAME_TAKEN;
  if (error) return { error: friendlyError(error, "We couldn't save the team. Please try again.", "updateTeam") };
  if (!data?.length) return NOT_ALLOWED;
  return done("Team saved.");
}

export async function deleteTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = idSchema.safeParse(formData.get("teamId"));
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("teams").delete().eq("id", parsed.data).select("id");
  if (error?.code === "23503") {
    return { error: "Routing rules still send issues to this team. Change or delete those rules first." };
  }
  if (error) return { error: friendlyError(error, "We couldn't delete the team. Please try again.", "deleteTeam") };
  if (!data?.length) return NOT_ALLOWED;
  return done("Team deleted. Its issues are now unassigned.");
}

function teamMemberFields(formData: FormData) {
  return teamMemberSchema.safeParse({
    organizationId: formData.get("organizationId"),
    teamId: formData.get("teamId"),
    userId: formData.get("userId"),
  });
}

export async function addTeamMember(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = teamMemberFields(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .insert({
      organization_id: parsed.data.organizationId,
      team_id: parsed.data.teamId,
      user_id: parsed.data.userId,
    })
    .select("user_id");
  if (error?.code === "23505") return { error: "That person is already in this team." };
  // The person or the team no longer belongs to this company.
  if (error?.code === "23503") return { error: "That person or team is no longer in this company. Reload the page." };
  if (error) return { error: friendlyError(error, "We couldn't add the team member. Please try again.", "addTeamMember") };
  if (!data?.length) return NOT_ALLOWED;
  return done("Team member added.");
}

export async function removeTeamMember(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = teamMemberFields(formData);
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .delete()
    .eq("organization_id", parsed.data.organizationId)
    .eq("team_id", parsed.data.teamId)
    .eq("user_id", parsed.data.userId)
    .select("user_id");
  if (error) return { error: friendlyError(error, "We couldn't remove the team member. Please try again.", "removeTeamMember") };
  if (!data?.length) return NOT_ALLOWED;
  return done("Team member removed.");
}

const CATEGORY_NAME_TAKEN: FormState = { fieldErrors: { name: "There is already a category with this name." } };

export async function createCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = createCategorySchema.safeParse({
    organizationId: formData.get("organizationId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .insert({ organization_id: parsed.data.organizationId, name: parsed.data.name });
  if (error?.code === "23505") return CATEGORY_NAME_TAKEN;
  if (error) return { error: friendlyError(error, "We couldn't add the category. Please try again.", "createCategory") };
  return done(`Category "${parsed.data.name}" added.`);
}

export async function updateCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = updateCategorySchema.safeParse({ categoryId: formData.get("categoryId"), name: formData.get("name") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.categoryId)
    .select("id");
  if (error?.code === "23505") return CATEGORY_NAME_TAKEN;
  if (error) return { error: friendlyError(error, "We couldn't save the category. Please try again.", "updateCategory") };
  if (!data?.length) return NOT_ALLOWED;
  return done("Category saved.");
}

export async function deleteCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = idSchema.safeParse(formData.get("categoryId"));
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").delete().eq("id", parsed.data).select("id");
  if (error) return { error: friendlyError(error, "We couldn't delete the category. Please try again.", "deleteCategory") };
  if (!data?.length) return NOT_ALLOWED;
  return done("Category deleted. Issues that used it now have no category.");
}
