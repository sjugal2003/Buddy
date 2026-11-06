"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { getAnalyser } from "@/lib/ai";
import { createIssueSchema, fieldErrors, idSchema, updateIssueSchema, type AiField } from "@/lib/validation";
import type { FormState } from "./types";

// Every action below runs as the signed-in user. The database checks that
// they belong to the issue's organisation before reading or changing it, and
// records each change in the issue's history itself.

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };

// A team or category from another company (or one just deleted) breaks the
// database's link check.
const STALE_LINK = "That team or category no longer exists. Reload the page and try again.";
const STALE_MEMBER = "That person is no longer a member of this company. Reload the page and pick someone else.";

export async function createIssue(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const parsed = createIssueSchema.safeParse({
    organizationId: formData.get("organizationId"),
    teamId: formData.get("teamId") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    customerName: formData.get("customerName"),
    customerEmail: formData.get("customerEmail") ?? "",
    channel: formData.get("channel"),
    subject: formData.get("subject"),
    message: formData.get("message"),
    urgency: formData.get("urgency"),
    sentiment: formData.get("sentiment"),
    intent: formData.get("intent"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  // Fields left to the AI are saved with the usual defaults and filled in
  // after the AI answers. Fields a person chose are never overwritten.
  const fill: AiField[] = [];
  if (parsed.data.urgency === "ai") fill.push("urgency");
  if (parsed.data.sentiment === "ai") fill.push("sentiment");
  if (parsed.data.intent === "ai") fill.push("intent");
  if (!parsed.data.categoryId) fill.push("category");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .insert({
      organization_id: parsed.data.organizationId,
      customer_name: parsed.data.customerName,
      customer_email: parsed.data.customerEmail,
      channel: parsed.data.channel,
      subject: parsed.data.subject,
      message: parsed.data.message,
      urgency: parsed.data.urgency === "ai" ? "medium" : parsed.data.urgency,
      sentiment: parsed.data.sentiment === "ai" ? "neutral" : parsed.data.sentiment,
      intent: parsed.data.intent === "ai" ? "question" : parsed.data.intent,
      team_id: parsed.data.teamId,
      category_id: parsed.data.categoryId,
      created_by: user.id,
    })
    .select("id, organization:organizations (slug, ai_enabled)")
    .single();
  if (error?.code === "23503") return { error: STALE_LINK };
  if (error || !data) {
    return { error: friendlyError(error ?? {}, "We couldn't save the issue. Please try again.", "createIssue") };
  }

  const org = data.organization as unknown as { slug: string; ai_enabled: boolean };
  revalidatePath(`/w/${org.slug}`, "layout");
  // The issue is saved now. The issue page starts the analysis in a separate
  // request, so a slow or failed AI call never loses what was typed.
  const analyse = org.ai_enabled && getAnalyser() ? `&analyse=${fill.join(",") || "none"}` : "";
  redirect(`/w/${org.slug}/issues/${data.id}?created=1${analyse}`);
}

export async function updateIssue(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = updateIssueSchema.safeParse({
    issueId: formData.get("issueId"),
    status: formData.get("status"),
    teamId: formData.get("teamId") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    assigneeName: formData.get("assigneeName") ?? "",
    assigneeId: formData.get("assigneeId") ?? undefined,
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { assigneeId } = parsed.data;
  // With members to pick from, the database fills in the name itself. Without
  // (the database change isn't applied yet), the name is saved as before.
  const assignee =
    assigneeId === undefined
      ? { assignee_name: parsed.data.assigneeName }
      : assigneeId === "keep"
        ? {}
        : assigneeId === ""
          ? { assignee_id: null, assignee_name: null }
          : { assignee_id: assigneeId };

  const supabase = await createClient();
  // The row comes back only if the update really happened: an issue the user
  // can't see (or that was deleted) updates nothing and returns no row.
  const { data, error } = await supabase
    .from("issues")
    .update({
      status: parsed.data.status,
      team_id: parsed.data.teamId,
      category_id: parsed.data.categoryId,
      ...assignee,
    })
    .eq("id", parsed.data.issueId)
    .select("id, organization:organizations (slug)");
  if (error?.code === "23503") {
    return { error: error.message?.includes("issues_assignee_member_fkey") ? STALE_MEMBER : STALE_LINK };
  }
  if (error) return { error: friendlyError(error, "We couldn't save your changes. Please try again.", "updateIssue") };
  if (!data || data.length === 0) {
    return { error: "This issue no longer exists, or you no longer have access to it." };
  }

  const slug = (data[0].organization as unknown as { slug: string }).slug;
  revalidatePath(`/w/${slug}`, "layout");
  return { success: "Changes saved." };
}

/**
 * Records that someone answered the customer. Buddy doesn't send replies
 * itself yet, so a person says when they did; the database stores the time
 * and who, only once, and only for their own company's issues.
 */
export async function recordFirstResponse(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const issueId = idSchema.safeParse(formData.get("issueId"));
  if (!issueId.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_first_response", { p_issue_id: issueId.data });
  if (error) return { error: friendlyError(error, "We couldn't record the first response. Please try again.", "recordFirstResponse") };
  revalidatePath("/w/[workspace]", "layout");
  return { success: "First response recorded." };
}
