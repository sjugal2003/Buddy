"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { deleteCustomerDataSchema, deleteIssueSchema, fieldErrors, retentionSchema } from "@/lib/validation";
import type { FormState } from "./types";

// Deleting customer data and how long it is kept (Phase 7 stage 37). Only a
// company's owner may do these: the database functions check the role, log
// every deletion and refuse anyone else with a message we show as is.

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };

export async function deleteIssue(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = deleteIssueSchema.safeParse({
    issueId: formData.get("issueId"),
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  const { data: issue, error: readError } = await supabase
    .from("issues")
    .select("reference, organization:organizations (slug)")
    .eq("id", parsed.data.issueId)
    .maybeSingle();
  if (readError) return { error: friendlyError(readError, "We couldn't delete the issue. Please try again.", "deleteIssue") };
  if (!issue) return { error: "This issue no longer exists, or you no longer have access to it." };
  if (parsed.data.confirm !== issue.reference.toUpperCase()) {
    return { fieldErrors: { confirm: `Type ${issue.reference} to confirm.` } };
  }

  const { data: deleted, error } = await supabase.rpc("delete_issue", { p_issue_id: parsed.data.issueId });
  if (error || !deleted) {
    return { error: friendlyError(error ?? {}, "We couldn't delete the issue. Please try again.", "deleteIssue") };
  }

  const slug = (issue.organization as unknown as { slug: string }).slug;
  revalidatePath(`/w/${slug}`, "layout");
  redirect(`/w/${slug}/issues?deleted=${encodeURIComponent(deleted)}`);
}

export async function deleteCustomerData(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = deleteCustomerDataSchema.safeParse({
    organizationId: formData.get("organizationId"),
    email: formData.get("email") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_customer_data", {
    p_org: parsed.data.organizationId,
    p_email: parsed.data.email,
  });
  if (error || typeof data !== "number") {
    return {
      error: friendlyError(error ?? {}, "We couldn't delete the customer's data. Please try again.", "deleteCustomerData"),
    };
  }

  revalidatePath("/w/[workspace]", "layout");
  if (data === 0) return { success: "No issues in this company use that email, so nothing was deleted." };
  return { success: `Deleted ${data} ${data === 1 ? "issue" : "issues"} from that email.` };
}

export async function updateRetention(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = retentionSchema.safeParse({
    organizationId: formData.get("organizationId"),
    retentionDays: formData.get("retentionDays") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_retention_days", {
    p_org: parsed.data.organizationId,
    p_days: parsed.data.retentionDays,
  });
  if (error) return { error: friendlyError(error, "We couldn't save how long issues are kept. Please try again.", "updateRetention") };

  revalidatePath("/w/[workspace]", "layout");
  return {
    success:
      parsed.data.retentionDays === null
        ? "Saved. Resolved issues are kept until someone deletes them."
        : "Saved. The daily clean-up (03:30 UTC) deletes resolved issues older than this.",
  };
}
