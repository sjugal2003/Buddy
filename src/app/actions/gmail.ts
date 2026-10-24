"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { revokeToken, tokenKey } from "@/lib/gmail";
import { decryptToken } from "@/lib/gmail/crypto";
import { idSchema } from "@/lib/validation";
import type { FormState } from "./types";

// Disconnecting the company's Gmail inbox (owners only; the database checks).
// Buddy first asks Google to cancel its access, then deletes the connection
// and its token. Issues already in Buddy stay.

export async function disconnectGmail(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return { error: "Your session has ended. Please sign in again." };
  const organizationId = idSchema.safeParse(formData.get("organizationId"));
  if (!organizationId.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  // Only owners and admins get the token; disconnect_mailbox below refuses admins.
  const token = await supabase.rpc("mailbox_token", { p_organization_id: organizationId.data });
  if (token.error) return { error: friendlyError(token.error, "We couldn't disconnect the inbox. Please try again.", "disconnectGmail") };

  let revoked = false;
  const key = tokenKey();
  const refreshToken = typeof token.data === "string" && key ? decryptToken(token.data, key) : null;
  if (refreshToken) revoked = await revokeToken(refreshToken);

  const { data, error } = await supabase.rpc("disconnect_mailbox", { p_organization_id: organizationId.data });
  if (error) return { error: friendlyError(error, "We couldn't disconnect the inbox. Please try again.", "disconnectGmail") };
  revalidatePath("/w/[workspace]", "layout");
  if (data !== true) return { error: "No inbox was connected. Reload the page." };
  // The card redraws without the connection, so the result is shown by the page.
  const slug = formData.get("slug");
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,63}$/.test(slug)) return { success: "Gmail disconnected." };
  redirect(`/w/${slug}/data-sources?gmail=${revoked ? "disconnected" : "disconnected_local"}`);
}
