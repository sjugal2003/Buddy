"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { idSchema } from "@/lib/validation";
import type { FormState } from "./types";

// Marking notifications as read. The database changes only the signed-in
// person's own notifications; nobody can create, edit or delete one from here.

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };
const RELOAD: FormState = { error: "Something went wrong. Reload the page and try again." };

export async function markNotificationRead(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const notificationId = idSchema.safeParse(formData.get("notificationId"));
  if (!notificationId.success) return RELOAD;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_notification_read", { p_notification_id: notificationId.data });
  if (error) return { error: friendlyError(error, "We couldn't mark the notification as read. Please try again.", "markNotificationRead") };
  // The database returns when it was read; nothing back means nothing was saved.
  if (!data) return { error: "We couldn't mark the notification as read. Please try again." };
  revalidatePath("/w/[workspace]", "layout");
  return { success: "Marked as read." };
}

export async function markAllNotificationsRead(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const organizationId = idSchema.safeParse(formData.get("organizationId"));
  if (!organizationId.success) return RELOAD;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read", { p_organization_id: organizationId.data });
  if (error) return { error: friendlyError(error, "We couldn't mark your notifications as read. Please try again.", "markAllNotificationsRead") };
  if (typeof data !== "number") return { error: "We couldn't mark your notifications as read. Please try again." };
  revalidatePath("/w/[workspace]", "layout");
  return { success: data === 0 ? "Nothing was unread." : `Marked ${data} ${data === 1 ? "notification" : "notifications"} as read.` };
}
