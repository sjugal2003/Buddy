"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { describeRun } from "@/lib/escalations";
import { acknowledgeEscalationSchema, fieldErrors, idSchema, updateEscalationSettingsSchema } from "@/lib/validation";
import type { FormState } from "./types";

// Escalation settings, "Check now" and Acknowledge. The database decides who
// may do each (owners and admins for settings and checks, any member to
// acknowledge) and is the only place escalations are created.

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };

export async function updateEscalationSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const on = (name: string) => (formData.get(name) === "on" ? "on" : "off");
  const parsed = updateEscalationSettingsSchema.safeParse({
    organizationId: formData.get("organizationId"),
    firstResponse: on("firstResponse"),
    resolution: on("resolution"),
    urgentNoTeam: on("urgentNoTeam"),
    urgentNoTeamHours: formData.get("urgentNoTeamHours"),
    noTeam: on("noTeam"),
    noTeamHours: formData.get("noTeamHours"),
    noUpdate: on("noUpdate"),
    noUpdateHours: formData.get("noUpdateHours"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("escalation_settings")
    .update({
      first_response_enabled: d.firstResponse === "on",
      resolution_enabled: d.resolution === "on",
      urgent_no_team_enabled: d.urgentNoTeam === "on",
      urgent_no_team_hours: d.urgentNoTeamHours,
      no_team_enabled: d.noTeam === "on",
      no_team_hours: d.noTeamHours,
      no_update_enabled: d.noUpdate === "on",
      no_update_hours: d.noUpdateHours,
    })
    .eq("organization_id", d.organizationId)
    .select("organization_id");
  if (error) {
    return { error: friendlyError(error, "We couldn't save the escalation settings. Please try again.", "updateEscalationSettings") };
  }
  // Row Level Security refuses by changing nothing, so check a row came back.
  if (!data?.length) return { error: "Only owners and admins can change this." };
  revalidatePath("/w/[workspace]", "layout");
  return { success: "Escalation settings saved." };
}

export async function runEscalationCheck(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const organizationId = idSchema.safeParse(formData.get("organizationId"));
  if (!organizationId.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_escalation_check", { p_organization_id: organizationId.data });
  if (error) return { error: friendlyError(error, "We couldn't run the check. Please try again.", "runEscalationCheck") };
  const run = (data as { issues_checked: number; escalations_created: number; error: string | null }[] | null)?.[0];
  if (!run) return { error: "We couldn't run the check. Please try again." };
  revalidatePath("/w/[workspace]", "layout");
  const summary = { issuesChecked: run.issues_checked, escalationsCreated: run.escalations_created, error: run.error };
  // A failed check is logged by the database and saves nothing.
  return run.error ? { error: describeRun(summary) } : { success: describeRun(summary) };
}

export async function acknowledgeEscalation(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = acknowledgeEscalationSchema.safeParse({
    escalationId: formData.get("escalationId"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_escalation", {
    p_escalation_id: parsed.data.escalationId,
    p_note: parsed.data.note,
  });
  if (error) return { error: friendlyError(error, "We couldn't acknowledge the escalation. Please try again.", "acknowledgeEscalation") };
  revalidatePath("/w/[workspace]", "layout");
  return { success: "Escalation acknowledged." };
}
