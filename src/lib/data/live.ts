import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Channel, Intent, IssueStatus, Sentiment, Urgency } from "@/lib/types";

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

export interface LiveIssue {
  id: string;
  reference: string;
  customerName: string;
  channel: Channel;
  subject: string;
  message: string;
  receivedAt: string;
  sentiment: Sentiment;
  intent: Intent;
  urgency: Urgency;
  status: IssueStatus;
  assigneeName: string | null;
  updatedAt: string;
}

export interface IssueActivity {
  id: number;
  kind: "created" | "status_changed" | "team_changed" | "assignee_changed" | "escalated";
  fromValue: string | null;
  toValue: string | null;
  actorName: string | null;
  at: string;
}

export interface IssueFilters {
  status: IssueStatus | "active" | "all";
  urgency: Urgency | "";
  q: string;
}

/** How many issues the inbox shows at once. Paging comes with bigger data sets. */
export const ISSUE_LIST_LIMIT = 200;

const ISSUE_COLUMNS =
  "id, reference, customer_name, channel, subject, message, received_at, sentiment, intent, urgency, status, assignee_name, updated_at";

type IssueRow = {
  id: string;
  reference: string;
  customer_name: string;
  channel: string;
  subject: string;
  message: string;
  received_at: string;
  sentiment: string;
  intent: string;
  urgency: string;
  status: string;
  assignee_name: string | null;
  updated_at: string;
};

function toIssue(row: IssueRow): LiveIssue {
  return {
    id: row.id,
    reference: row.reference,
    customerName: row.customer_name,
    channel: row.channel as Channel,
    subject: row.subject,
    message: row.message,
    receivedAt: row.received_at,
    sentiment: row.sentiment as Sentiment,
    intent: row.intent as Intent,
    urgency: row.urgency as Urgency,
    status: row.status as IssueStatus,
    assigneeName: row.assignee_name,
    updatedAt: row.updated_at,
  };
}

/** Issues in one organisation, newest first. `q` must already be cleaned (see issueFiltersSchema). */
export async function listIssues(organizationId: string, filters: IssueFilters): Promise<LiveIssue[]> {
  const supabase = await createClient();
  let query = supabase
    .from("issues")
    .select(ISSUE_COLUMNS)
    .eq("organization_id", organizationId)
    .order("received_at", { ascending: false })
    .limit(ISSUE_LIST_LIMIT);
  if (filters.status === "active") query = query.neq("status", "resolved");
  else if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.urgency) query = query.eq("urgency", filters.urgency);
  if (filters.q) {
    const like = `%${filters.q}%`;
    query = query.or(`subject.ilike."${like}",customer_name.ilike."${like}",reference.ilike."${like}",message.ilike."${like}"`);
  }
  const { data, error } = await query;
  if (error) {
    console.error("[listIssues]", error.code, error.message);
    throw new Error("Could not load issues.");
  }
  return (data ?? []).map(toIssue);
}

/** Counts for the workspace overview. */
export async function countOpenIssues(organizationId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("issues")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .neq("status", "resolved");
  if (error) throw new Error("Could not count issues.");
  return count ?? 0;
}

/** One issue, only if it belongs to this organisation (and the user can see it). */
export async function getIssue(organizationId: string, issueId: string): Promise<LiveIssue | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .select(ISSUE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", issueId)
    .maybeSingle();
  if (error) {
    console.error("[getIssue]", error.code, error.message);
    throw new Error("Could not load this issue.");
  }
  return data ? toIssue(data) : null;
}

/** The change history of one issue, newest first. */
export async function listIssueActivity(organizationId: string, issueId: string): Promise<IssueActivity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issue_activity")
    .select("id, kind, from_value, to_value, created_at, actor:profiles (full_name)")
    .eq("organization_id", organizationId)
    .eq("issue_id", issueId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) {
    console.error("[listIssueActivity]", error.code, error.message);
    throw new Error("Could not load the history of this issue.");
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind as IssueActivity["kind"],
    fromValue: row.from_value,
    toValue: row.to_value,
    at: row.created_at,
    actorName: (row.actor as unknown as { full_name: string } | null)?.full_name || null,
  }));
}
