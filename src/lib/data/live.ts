import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Reads for real (signed-in) workspaces. Every query runs as the signed-in
// user, so the database only returns rows from their own organisations.
// Nothing here trusts an organisation ID sent by the browser.

export type Role = "owner" | "admin" | "member";

export interface Organization {
  id: string;
  slug: string;
  name: string;
  industry: string;
  timezone: string;
}

export interface Membership {
  organization: Organization;
  role: Role;
}

export interface Member {
  userId: string;
  fullName: string;
  role: Role;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  expiresAt: string;
  createdAt: string;
}

const ORG_COLUMNS = "id, slug, name, industry, timezone";

/** The organisations the signed-in user belongs to, with their role. */
export const listMyMemberships = cache(async (userId: string): Promise<Membership[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select(`role, organization:organizations (${ORG_COLUMNS})`)
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error("Could not load your workspaces.");
  return (data ?? []).map((row) => ({
    role: row.role as Role,
    organization: row.organization as unknown as Organization,
  }));
});

/**
 * One organisation by its web address, if the signed-in user belongs to it.
 * Returns null both when it does not exist and when the user is not a member,
 * so the app never reveals which company addresses exist.
 */
export async function getMembershipBySlug(userId: string, slug: string): Promise<Membership | null> {
  const memberships = await listMyMemberships(userId);
  return memberships.find((m) => m.organization.slug === slug) ?? null;
}

export async function listMembers(organizationId: string): Promise<Member[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("user_id, role, created_at, profile:profiles (full_name)")
    .eq("organization_id", organizationId)
    .order("created_at");
  if (error) throw new Error("Could not load the members of this workspace.");
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    role: row.role as Role,
    joinedAt: row.created_at,
    fullName: (row.profile as unknown as { full_name: string } | null)?.full_name || "Unnamed member",
  }));
}

/** Open invitations. Only owners and admins get rows back. */
export async function listOpenInvitations(organizationId: string): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_invitations")
    .select("id, email, role, expires_at, created_at")
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Could not load invitations.");
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role as Invitation["role"],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}
