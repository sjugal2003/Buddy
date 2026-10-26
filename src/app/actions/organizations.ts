"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { siteUrl } from "@/lib/site-url";
import {
  createInvitationSchema,
  createOrganizationSchema,
  fieldErrors,
  idSchema,
  inviteTokenSchema,
  memberChangeSchema,
  roleSchema,
} from "@/lib/validation";
import type { FormState } from "./types";

// Every action below runs as the signed-in user. The organisation ID in a
// request is only a pointer: the database checks the user's membership and
// role before reading or changing anything.

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };

export async function createOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    industry: formData.get("industry") ?? "",
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_industry: parsed.data.industry,
    p_timezone: parsed.data.timezone,
  });
  if (error) {
    if (error.code === "23505") return { fieldErrors: { slug: "That web address is already taken. Try another." } };
    return { error: friendlyError(error, "We couldn't create the workspace. Please try again.", "createOrganization") };
  }
  redirect(`/w/${parsed.data.slug}`);
}

export async function createInvitation(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = createInvitationSchema.safeParse({
    organizationId: formData.get("organizationId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  // Checked first, so an invitation is never saved without a link to share.
  const site = await siteUrl();
  if ("error" in site) return { error: site.error };

  // The code goes in the link; only its hash is stored, so a database
  // leak would not reveal working invitation links.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

  const supabase = await createClient();
  const { error } = await supabase.from("organization_invitations").insert({
    organization_id: parsed.data.organizationId,
    email: parsed.data.email,
    role: parsed.data.role,
    token_hash: tokenHash,
  });
  if (error) {
    if (error.code === "23505") {
      return { fieldErrors: { email: "There is already an open invitation for this email. Cancel it first to send a new one." } };
    }
    return { error: friendlyError(error, "We couldn't create the invitation.", "createInvitation") };
  }

  revalidatePath("/w/[workspace]", "layout");
  return {
    success: `Invitation created for ${parsed.data.email}.`,
    link: `${site.url}/invite?token=${token}`,
  };
}

export async function cancelInvitation(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const id = idSchema.safeParse(formData.get("invitationId"));
  if (!id.success) return { error: "Something went wrong. Reload the page and try again." };
  const supabase = await createClient();
  // The row comes back only if it was really deleted: one the user may not
  // cancel, or that was already used or cancelled, deletes nothing.
  const { data, error } = await supabase.from("organization_invitations").delete().eq("id", id.data).select("id");
  if (error) return { error: friendlyError(error, "We couldn't cancel the invitation. Please try again.", "cancelInvitation") };
  if (!data?.length) return { error: "This invitation was already used or cancelled, or you can't cancel it." };
  revalidatePath("/w/[workspace]", "layout");
  return { success: "Invitation cancelled." };
}

export async function acceptInvitation(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const token = inviteTokenSchema.safeParse(formData.get("token"));
  if (!token.success) return { error: "This invitation link is incomplete. Ask for a new one." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token.data });
  if (error) return { error: friendlyError(error, "We couldn't accept this invitation.", "acceptInvitation") };
  redirect(`/w/${data as string}`);
}

export async function changeMemberRole(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const ids = memberChangeSchema.safeParse({
    organizationId: formData.get("organizationId"),
    userId: formData.get("userId"),
  });
  const role = roleSchema.safeParse(formData.get("role"));
  if (!ids.success || !role.success) return { error: "That change isn't valid." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", {
    p_organization_id: ids.data.organizationId,
    p_user_id: ids.data.userId,
    p_role: role.data,
  });
  if (error) return { error: friendlyError(error, "We couldn't change that role.", "changeMemberRole") };
  revalidatePath("/w/[workspace]", "layout");
  return { success: "Role updated." };
}

export async function removeMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const ids = memberChangeSchema.safeParse({
    organizationId: formData.get("organizationId"),
    userId: formData.get("userId"),
  });
  if (!ids.success) return { error: "That change isn't valid." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    p_organization_id: ids.data.organizationId,
    p_user_id: ids.data.userId,
  });
  if (error) return { error: friendlyError(error, "We couldn't remove that member.", "removeMember") };
  if (ids.data.userId === user.id) redirect("/");
  revalidatePath("/w/[workspace]", "layout");
  return { success: "Member removed." };
}
