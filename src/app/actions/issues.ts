"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { createIssueSchema, fieldErrors, updateIssueSchema } from "@/lib/validation";
import type { FormState } from "./types";

// Every action below runs as the signed-in user. The database checks that
// they belong to the issue's organisation before reading or changing it, and
// records each change in the issue's history itself.

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };

// A team or category from another company (or one just deleted) breaks the
// database's link check.
const STALE_LINK = "That team or category no longer exists. Reload the page and try again.";

export async function createIssue(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const parsed = createIssueSchema.safeParse({
    organizationId: formData.get("organizationId"),
    teamId: formData.get("teamId") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    customerName: formData.get("customerName"),
    channel: formData.get("channel"),
    subject: formData.get("subject"),
    message: formData.get("message"),
    urgency: formData.get("urgency"),
    sentiment: formData.get("sentiment"),
    intent: formData.get("intent"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .insert({
      organization_id: parsed.data.organizationId,
      customer_name: parsed.data.customerName,
      channel: parsed.data.channel,
      subject: parsed.data.subject,
      message: parsed.data.message,
      urgency: parsed.data.urgency,
      sentiment: parsed.data.sentiment,
      intent: parsed.data.intent,
      team_id: parsed.data.teamId,
      category_id: parsed.data.categoryId,
      created_by: user.id,
    })
    .select("id, organization:organizations (slug)")
    .single();
  if (error?.code === "23503") return { error: STALE_LINK };
  if (error || !data) {
    return { error: friendlyError(error ?? {}, "We couldn't save the issue. Please try again.", "createIssue") };
  }

  const slug = (data.organization as unknown as { slug: string }).slug;
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/issues/${data.id}?created=1`);
}

export async function updateIssue(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = updateIssueSchema.safeParse({
    issueId: formData.get("issueId"),
    status: formData.get("status"),
    teamId: formData.get("teamId") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    assigneeName: formData.get("assigneeName") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  // The row comes back only if the update really happened: an issue the user
  // can't see (or that was deleted) updates nothing and returns no row.
  const { data, error } = await supabase
    .from("issues")
    .update({
      status: parsed.data.status,
      team_id: parsed.data.teamId,
      category_id: parsed.data.categoryId,
      assignee_name: parsed.data.assigneeName,
    })
    .eq("id", parsed.data.issueId)
    .select("id, organization:organizations (slug)");
  if (error?.code === "23503") return { error: STALE_LINK };
  if (error) return { error: friendlyError(error, "We couldn't save your changes. Please try again.", "updateIssue") };
  if (!data || data.length === 0) {
    return { error: "This issue no longer exists, or you no longer have access to it." };
  }

  const slug = (data[0].organization as unknown as { slug: string }).slug;
  revalidatePath(`/w/${slug}`, "layout");
  return { success: "Changes saved." };
}
