"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { idSchema } from "@/lib/validation";
import type { FormState } from "./types";

// "Same problem" links (improvement D, step 1). Both run as the signed-in
// user; the database checks the issues are in their company, keeps links one
// level deep, writes the history and limits how often this can be done.

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };
const BAD_FORM: FormState = { error: "Something went wrong. Reload the page and try again." };

export async function linkDuplicate(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const issueId = idSchema.safeParse(formData.get("issueId"));
  const mainId = idSchema.safeParse(formData.get("mainId"));
  if (!issueId.success || !mainId.success) return BAD_FORM;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("link_duplicate", { p_issue_id: issueId.data, p_main_id: mainId.data });
  if (error || typeof data !== "string") {
    return { error: friendlyError(error ?? {}, "We couldn't link these issues. Please try again.", "linkDuplicate") };
  }
  revalidatePath("/w/[workspace]", "layout");
  return { success: `Linked to ${data} as the same problem.` };
}

export async function unlinkDuplicate(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const issueId = idSchema.safeParse(formData.get("issueId"));
  if (!issueId.success) return BAD_FORM;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unlink_duplicate", { p_issue_id: issueId.data });
  if (error) return { error: friendlyError(error, "We couldn't unlink this issue. Please try again.", "unlinkDuplicate") };
  revalidatePath("/w/[workspace]", "layout");
  return data === true ? { success: "Unlinked." } : { error: "This issue wasn't linked to another one." };
}
