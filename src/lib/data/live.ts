import "server-only";
import { cache } from "react";
import { estimateCostUsd, monthStart } from "@/lib/ai/limits";
import { createClient } from "@/lib/supabase/server";
import type { RoutableMessage } from "@/lib/routing";
import type { EscalationCondition } from "@/lib/escalations";
import type { DashboardIssue } from "@/lib/dashboard";
import { isNotificationKind, NOTIFICATION_LIST_LIMIT, type NotificationKind } from "@/lib/notifications";
import { friendlyError } from "@/lib/errors";
import { issueReportSchema, type IssueReport } from "@/lib/reports";
import type { Channel, Intent, IssueSource, IssueStatus, RoutingRule, RuleCondition, Sentiment, Urgency } from "@/lib/types";

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
  customerEmail: string | null;
  /** Where the issue came from: typed in, or an import. */
  source: IssueSource;
  /** The record's ID in its source; null for typed-in issues. */
  sourceRecordId: string | null;
  channel: Channel;
  subject: string;
  message: string;
  receivedAt: string;
  sentiment: Sentiment;
  intent: Intent;
  urgency: Urgency;
  status: IssueStatus;
  assigneeName: string | null;
  teamId: string | null;
  categoryId: string | null;
  /** "ai" once an AI value was used on the issue. */
  analysisSource: "manual" | "demo" | "ai";
  firstResponseAt: string | null;
  resolvedAt: string | null;
  waitingSeconds: number;
  waitingSince: string | null;
  reopenedCount: number;
  /** When someone dismissed the routing suggestion, or null. */
  routingDismissedAt: string | null;
  /** The AI's one-line summary, or "" if there is none. */
  summary: string;
  updatedAt: string;
}

export interface IssueActivity {
  id: number;
  kind:
    | "created"
    | "status_changed"
    | "team_changed"
    | "assignee_changed"
    | "escalated"
    | "ai_analysed"
    | "ai_accepted"
    | "category_changed"
    | "first_response"
    | "resolved"
    | "reopened"
    | "escalation_acknowledged"
    | "routing_applied"
    | "routing_dismissed";
  fromValue: string | null;
  toValue: string | null;
  actorName: string | null;
  at: string;
}

export interface IssueFilters {
  status: IssueStatus | "active" | "all";
  /** "urgent" is Critical or High. */
  urgency: Urgency | "urgent" | "";
  /** A team ID, "unassigned", or "" for any team. */
  team: string;
  due: "" | "overdue" | "soon" | "2h";
  escalated: "" | "open";
  sort: "" | "attention";
  q: string;
}

/** How many issues the inbox shows at once. Paging comes with bigger data sets. */
export const ISSUE_LIST_LIMIT = 200;

const ISSUE_COLUMNS =
  "id, reference, customer_name, customer_email, source, source_record_id, channel, subject, message, received_at, sentiment, intent, urgency, status, assignee_name, team_id, category_id, analysis_source, summary, first_response_at, resolved_at, waiting_seconds, waiting_since, reopened_count, routing_dismissed_at, updated_at";

type IssueRow = {
  id: string;
  reference: string;
  customer_name: string;
  customer_email: string | null;
  source: string;
  source_record_id: string | null;
  channel: string;
  subject: string;
  message: string;
  received_at: string;
  sentiment: string;
  intent: string;
  urgency: string;
  status: string;
  assignee_name: string | null;
  team_id: string | null;
  category_id: string | null;
  analysis_source: string;
  summary: string;
  first_response_at: string | null;
  resolved_at: string | null;
  waiting_seconds: number;
  waiting_since: string | null;
  reopened_count: number;
  routing_dismissed_at: string | null;
  updated_at: string;
};

function toIssue(row: IssueRow): LiveIssue {
  return {
    id: row.id,
    reference: row.reference,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    source: row.source as IssueSource,
    sourceRecordId: row.source_record_id,
    channel: row.channel as Channel,
    subject: row.subject,
    message: row.message,
    receivedAt: row.received_at,
    sentiment: row.sentiment as Sentiment,
    intent: row.intent as Intent,
    urgency: row.urgency as Urgency,
    status: row.status as IssueStatus,
    assigneeName: row.assignee_name,
    teamId: row.team_id,
    categoryId: row.category_id,
    analysisSource: row.analysis_source as LiveIssue["analysisSource"],
    summary: row.summary,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    waitingSeconds: row.waiting_seconds,
    waitingSince: row.waiting_since,
    reopenedCount: row.reopened_count,
    routingDismissedAt: row.routing_dismissed_at,
    updatedAt: row.updated_at,
  };
}

/** How many open issues are read when the list is filtered or sorted by deadline. */
export const DEADLINE_SCAN_LIMIT = 1000;

/**
 * Issues in one organisation, newest first. `q` must already be cleaned (see
 * issueFiltersSchema). Deadline filters and sorting are applied by the page
 * (src/lib/targets.ts); for those it reads up to DEADLINE_SCAN_LIMIT issues.
 */
export async function listIssues(organizationId: string, filters: IssueFilters): Promise<LiveIssue[]> {
  const supabase = await createClient();
  let query = supabase
    .from("issues")
    .select(ISSUE_COLUMNS)
    .eq("organization_id", organizationId)
    .order("received_at", { ascending: false })
    .limit(filters.due || filters.sort || filters.escalated ? DEADLINE_SCAN_LIMIT : ISSUE_LIST_LIMIT);
  if (filters.status === "active") query = query.neq("status", "resolved");
  else if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.urgency === "urgent") query = query.in("urgency", ["critical", "high"]);
  else if (filters.urgency) query = query.eq("urgency", filters.urgency);
  if (filters.team === "unassigned") query = query.is("team_id", null);
  else if (filters.team) query = query.eq("team_id", filters.team);
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

/**
 * Open issues for the workspace home's counts (src/lib/dashboard.ts), newest
 * first, up to DEADLINE_SCAN_LIMIT like the Issues list's deadline filters.
 */
export async function listOpenIssuesForDashboard(organizationId: string): Promise<DashboardIssue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .select("id, received_at, urgency, status, team_id, first_response_at, resolved_at, waiting_seconds, waiting_since")
    .eq("organization_id", organizationId)
    .neq("status", "resolved")
    .order("received_at", { ascending: false })
    .limit(DEADLINE_SCAN_LIMIT);
  if (error) {
    console.error("[listOpenIssuesForDashboard]", error.code, error.message);
    throw new Error("Could not load issues.");
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    receivedAt: row.received_at,
    urgency: row.urgency as Urgency,
    status: row.status as IssueStatus,
    teamId: row.team_id,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    waitingSeconds: row.waiting_seconds,
    waitingSince: row.waiting_since,
  }));
}

/** How many issues arrived, and how many were resolved, since `since`. */
export async function countIssuesSince(organizationId: string, since: Date): Promise<{ opened: number; resolved: number }> {
  const supabase = await createClient();
  const [opened, resolved] = await Promise.all([
    supabase
      .from("issues")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("received_at", since.toISOString()),
    // A reopened issue is resolved again later, so it is counted once, by its latest resolution.
    supabase
      .from("issues")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "resolved")
      .gte("resolved_at", since.toISOString()),
  ]);
  for (const { error } of [opened, resolved]) {
    if (error) {
      console.error("[countIssuesSince]", error.code, error.message);
      throw new Error("Could not count issues.");
    }
  }
  return { opened: opened.count ?? 0, resolved: resolved.count ?? 0 };
}

export interface RecentActivity extends IssueActivity {
  issueId: string;
  issueReference: string;
  issueSubject: string;
}

/** The latest history entries across the company's issues, newest first. */
export async function listRecentActivity(organizationId: string, limit: number): Promise<RecentActivity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issue_activity")
    .select("id, issue_id, kind, from_value, to_value, created_at, actor:profiles (full_name), issue:issues (reference, subject)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[listRecentActivity]", error.code, error.message);
    throw new Error("Could not load recent activity.");
  }
  return (data ?? []).map((row) => {
    const issue = row.issue as unknown as { reference: string; subject: string } | null;
    return {
      id: row.id,
      issueId: row.issue_id,
      issueReference: issue?.reference ?? "",
      issueSubject: issue?.subject ?? "",
      kind: row.kind as IssueActivity["kind"],
      fromValue: row.from_value,
      toValue: row.to_value,
      at: row.created_at,
      actorName: (row.actor as unknown as { full_name: string } | null)?.full_name || null,
    };
  });
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

export interface LiveAnalysis {
  id: string;
  status: "pending" | "done" | "failed";
  failureReason: string | null;
  sentiment: Sentiment | null;
  intent: Intent | null;
  urgency: Urgency | null;
  categoryId: string | null;
  themes: string[];
  summary: string;
  suggestedAction: string;
  confidence: number | null;
  model: string;
  createdAt: string;
}

/** The most recent AI analysis of an issue, if any. */
export async function getLatestAnalysis(organizationId: string, issueId: string): Promise<LiveAnalysis | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issue_analyses")
    .select(
      "id, status, failure_reason, sentiment, intent, urgency, category_id, themes, summary, suggested_action, confidence, model, created_at",
    )
    .eq("organization_id", organizationId)
    .eq("issue_id", issueId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[getLatestAnalysis]", error.code, error.message);
    throw new Error("Could not load the AI analysis of this issue.");
  }
  if (!data) return null;
  return {
    id: data.id,
    status: data.status,
    failureReason: data.failure_reason,
    sentiment: data.sentiment,
    intent: data.intent,
    urgency: data.urgency,
    categoryId: data.category_id,
    themes: data.themes ?? [],
    summary: data.summary,
    suggestedAction: data.suggested_action,
    confidence: data.confidence === null ? null : Number(data.confidence),
    model: data.model,
    createdAt: data.created_at,
  };
}

/** Whether AI analysis is switched on for this company. */
export async function getAiEnabled(organizationId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("ai_enabled").eq("id", organizationId).single();
  if (error) {
    console.error("[getAiEnabled]", error.code, error.message);
    throw new Error("Could not load the AI settings.");
  }
  return data.ai_enabled;
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

export interface OrganizationSettings {
  name: string;
  industry: string;
  timezone: string;
  /** First-response targets. */
  targetHours: Record<Urgency, number>;
  resolutionHours: Record<Urgency, number>;
}

export interface AiSettings {
  enabled: boolean;
  monthlyLimit: number;
  /** Give a newly analysed issue without a team the team its routing rule suggests. */
  autoRoute: boolean;
  /** Analyses started since the 1st of this month (UTC), including failed ones. */
  usedThisMonth: number;
  /** At paid prices; a free tier may make it lower. */
  estimatedCostUsd: number;
}

export interface LiveTeam {
  id: string;
  name: string;
  leadName: string;
  email: string;
  color: string;
}

export interface LiveCategory {
  id: string;
  name: string;
}

export async function getOrganizationSettings(organizationId: string): Promise<OrganizationSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select(
      "name, industry, timezone, target_hours_critical, target_hours_high, target_hours_medium, target_hours_low, resolution_hours_critical, resolution_hours_high, resolution_hours_medium, resolution_hours_low",
    )
    .eq("id", organizationId)
    .single();
  if (error) {
    console.error("[getOrganizationSettings]", error.code, error.message);
    throw new Error("Could not load the workspace settings.");
  }
  return {
    name: data.name,
    industry: data.industry,
    timezone: data.timezone,
    targetHours: {
      critical: data.target_hours_critical,
      high: data.target_hours_high,
      medium: data.target_hours_medium,
      low: data.target_hours_low,
    },
    resolutionHours: {
      critical: data.resolution_hours_critical,
      high: data.resolution_hours_high,
      medium: data.resolution_hours_medium,
      low: data.resolution_hours_low,
    },
  };
}

export async function getAiSettings(organizationId: string): Promise<AiSettings> {
  const supabase = await createClient();
  const [org, usage] = await Promise.all([
    supabase.from("organizations").select("ai_enabled, ai_monthly_limit, ai_auto_route").eq("id", organizationId).single(),
    // At most 2,000 a month per company, so reading the token counts is cheap.
    supabase
      .from("issue_analyses")
      .select("model, input_tokens, output_tokens")
      .eq("organization_id", organizationId)
      .gte("created_at", monthStart(new Date()).toISOString())
      .limit(2500),
  ]);
  const error = org.error ?? usage.error;
  if (error || !org.data) {
    console.error("[getAiSettings]", error?.code, error?.message);
    throw new Error("Could not load the AI settings.");
  }
  const rows = usage.data ?? [];
  return {
    enabled: org.data.ai_enabled,
    monthlyLimit: org.data.ai_monthly_limit,
    autoRoute: org.data.ai_auto_route,
    usedThisMonth: rows.length,
    estimatedCostUsd: rows.reduce(
      (sum, r) => sum + estimateCostUsd({ inputTokens: r.input_tokens, outputTokens: r.output_tokens }, r.model),
      0,
    ),
  };
}

export async function listTeams(organizationId: string): Promise<LiveTeam[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, lead_name, email, color")
    .eq("organization_id", organizationId)
    .order("name");
  if (error) {
    console.error("[listTeams]", error.code, error.message);
    throw new Error("Could not load teams.");
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    leadName: row.lead_name,
    email: row.email,
    color: row.color,
  }));
}

export async function listCategories(organizationId: string): Promise<LiveCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name");
  if (error) {
    console.error("[listCategories]", error.code, error.message);
    throw new Error("Could not load categories.");
  }
  return data ?? [];
}

/** Routing rules in the order they are checked (lowest position first). */
export async function listRoutingRules(organizationId: string): Promise<RoutingRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("routing_rules")
    .select("id, organization_id, name, enabled, match_mode, conditions, team_id")
    .eq("organization_id", organizationId)
    .order("position")
    .order("created_at");
  if (error) {
    console.error("[listRoutingRules]", error.code, error.message);
    throw new Error("Could not load routing rules.");
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    workspaceId: row.organization_id,
    name: row.name,
    enabled: row.enabled,
    match: row.match_mode as RoutingRule["match"],
    conditions: row.conditions as RuleCondition[],
    teamId: row.team_id,
  }));
}

/** The parts of a real issue that routing rules look at. */
export function toRoutable(issue: LiveIssue): RoutableMessage {
  return {
    subject: issue.subject,
    message: issue.message,
    channel: issue.channel,
    analysis: {
      categoryId: issue.categoryId ?? "",
      urgency: issue.urgency,
      sentiment: issue.sentiment,
      intent: issue.intent,
    },
  };
}

/** Open issues that have no team yet and no dismissed suggestion, newest first. */
export async function listUnroutedIssues(organizationId: string, limit: number): Promise<LiveIssue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .select(ISSUE_COLUMNS)
    .eq("organization_id", organizationId)
    .is("team_id", null)
    .is("routing_dismissed_at", null)
    .neq("status", "resolved")
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[listUnroutedIssues]", error.code, error.message);
    throw new Error("Could not load the issues without a team.");
  }
  return (data ?? []).map(toIssue);
}

export interface EscalationSettings {
  firstResponse: boolean;
  resolution: boolean;
  urgentNoTeam: boolean;
  urgentNoTeamHours: number;
  noTeam: boolean;
  noTeamHours: number;
  noUpdate: boolean;
  noUpdateHours: number;
}

export interface EscalationRun {
  source: "manual" | "scheduled";
  startedAt: string;
  issuesChecked: number;
  escalationsCreated: number;
  error: string | null;
}

export async function getEscalationSettings(
  organizationId: string,
): Promise<{
  settings: EscalationSettings;
  lastRun: EscalationRun | null;
  lastScheduledAt: string | null;
  lastScheduledError: string | null;
  lastScheduledSuccessAt: string | null;
}> {
  const supabase = await createClient();
  const [settings, runs, scheduled, scheduledOk] = await Promise.all([
    supabase
      .from("escalation_settings")
      .select(
        "first_response_enabled, resolution_enabled, urgent_no_team_enabled, urgent_no_team_hours, no_team_enabled, no_team_hours, no_update_enabled, no_update_hours",
      )
      .eq("organization_id", organizationId)
      .single(),
    supabase
      .from("escalation_runs")
      .select("source, started_at, issues_checked, escalations_created, error")
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(1),
    // The latest check started by the database scheduler (stage 20), if any ever ran.
    supabase
      .from("escalation_runs")
      .select("started_at, error")
      .eq("organization_id", organizationId)
      .eq("source", "scheduled")
      .order("started_at", { ascending: false })
      .limit(1),
    // The latest scheduled check that finished without an error (stage 31).
    supabase
      .from("escalation_runs")
      .select("started_at")
      .eq("organization_id", organizationId)
      .eq("source", "scheduled")
      .is("error", null)
      .not("finished_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1),
  ]);
  const error = settings.error ?? runs.error ?? scheduled.error ?? scheduledOk.error;
  if (error || !settings.data) {
    console.error("[getEscalationSettings]", error?.code, error?.message);
    throw new Error("Could not load the escalation settings.");
  }
  const s = settings.data;
  const run = runs.data?.[0];
  return {
    settings: {
      firstResponse: s.first_response_enabled,
      resolution: s.resolution_enabled,
      urgentNoTeam: s.urgent_no_team_enabled,
      urgentNoTeamHours: s.urgent_no_team_hours,
      noTeam: s.no_team_enabled,
      noTeamHours: s.no_team_hours,
      noUpdate: s.no_update_enabled,
      noUpdateHours: s.no_update_hours,
    },
    lastRun: run
      ? {
          source: run.source as EscalationRun["source"],
          startedAt: run.started_at,
          issuesChecked: run.issues_checked,
          escalationsCreated: run.escalations_created,
          error: run.error,
        }
      : null,
    lastScheduledAt: scheduled.data?.[0]?.started_at ?? null,
    lastScheduledError: scheduled.data?.[0]?.error ?? null,
    lastScheduledSuccessAt: scheduledOk.data?.[0]?.started_at ?? null,
  };
}

export interface LiveEscalation {
  id: string;
  condition: EscalationCondition;
  level: number;
  reason: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  acknowledgeNote: string | null;
}

/** One issue's escalations, newest first. */
export async function listIssueEscalations(organizationId: string, issueId: string): Promise<LiveEscalation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("escalations")
    .select("id, condition, level, reason, created_at, acknowledged_at, acknowledge_note, acknowledger:profiles (full_name)")
    .eq("organization_id", organizationId)
    .eq("issue_id", issueId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[listIssueEscalations]", error.code, error.message);
    throw new Error("Could not load the escalations of this issue.");
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    condition: row.condition as EscalationCondition,
    level: row.level,
    reason: row.reason,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedByName: (row.acknowledger as unknown as { full_name: string } | null)?.full_name || null,
    acknowledgeNote: row.acknowledge_note,
  }));
}

/** Issues with at least one escalation nobody has acknowledged. */
export async function listUnacknowledgedEscalationIssueIds(organizationId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("escalations")
    .select("issue_id")
    .eq("organization_id", organizationId)
    .is("acknowledged_at", null);
  if (error) {
    console.error("[listUnacknowledgedEscalationIssueIds]", error.code, error.message);
    throw new Error("Could not load escalations.");
  }
  return new Set((data ?? []).map((row) => row.issue_id as string));
}

/** The highest unacknowledged escalation level per issue, for the given issues. */
export async function openEscalationLevels(organizationId: string, issueIds: string[]): Promise<Map<string, number>> {
  const levels = new Map<string, number>();
  if (issueIds.length === 0) return levels;
  const supabase = await createClient();
  // In batches, so the list of IDs stays well inside the request's address.
  const batches = [];
  for (let i = 0; i < issueIds.length; i += 100) batches.push(issueIds.slice(i, i + 100));
  const results = await Promise.all(
    batches.map((ids) =>
      supabase
        .from("escalations")
        .select("issue_id, level")
        .eq("organization_id", organizationId)
        .is("acknowledged_at", null)
        .in("issue_id", ids),
    ),
  );
  for (const { data, error } of results) {
    if (error) {
      console.error("[openEscalationLevels]", error.code, error.message);
      throw new Error("Could not load escalations.");
    }
    for (const row of data ?? []) levels.set(row.issue_id, Math.max(levels.get(row.issue_id) ?? 0, row.level));
  }
  return levels;
}

export interface ImportRun {
  id: string;
  source: "csv" | "gmail";
  fileName: string;
  startedByName: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "finished" | "failed";
  rowsExamined: number;
  imported: number;
  skippedDuplicate: number;
  rejected: number;
  problems: { row: number | null; reason: string }[];
  error: string | null;
}

/** The company's imports, newest first. */
export async function listImportRuns(organizationId: string, limit = 50): Promise<ImportRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("import_runs")
    .select(
      "id, source, file_name, started_at, finished_at, status, rows_examined, imported, skipped_duplicate, rejected, problems, error, starter:profiles (full_name)",
    )
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[listImportRuns]", error.code, error.message);
    throw new Error("Could not load the import history.");
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    source: row.source as ImportRun["source"],
    fileName: row.file_name,
    startedByName: (row.starter as unknown as { full_name: string } | null)?.full_name || null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as ImportRun["status"],
    rowsExamined: row.rows_examined,
    imported: row.imported,
    skippedDuplicate: row.skipped_duplicate,
    rejected: row.rejected,
    problems: Array.isArray(row.problems) ? (row.problems as ImportRun["problems"]) : [],
    error: row.error,
  }));
}

export interface MailboxConnection {
  emailAddress: string;
  connectedByName: string | null;
  connectedAt: string;
  lastFetchedAt: string | null;
}

/** The company's connected Gmail inbox, if any. Never includes the token. */
export async function getMailboxConnection(organizationId: string): Promise<MailboxConnection | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mailbox_connections")
    .select("email_address, connected_at, last_fetched_at, connector:profiles (full_name)")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    console.error("[getMailboxConnection]", error.code, error.message);
    throw new Error("Could not load the inbox connection.");
  }
  if (!data) return null;
  return {
    emailAddress: data.email_address,
    connectedByName: (data.connector as unknown as { full_name: string } | null)?.full_name || null,
    connectedAt: data.connected_at,
    lastFetchedAt: data.last_fetched_at,
  };
}

export interface LiveNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  issueId: string | null;
  createdAt: string;
  readAt: string | null;
}

/** The signed-in person's notifications in one company, newest first. Row Level Security returns only their own. */
export async function listNotifications(organizationId: string, limit = NOTIFICATION_LIST_LIMIT): Promise<LiveNotification[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, issue_id, created_at, read_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[listNotifications]", error.code, error.message);
    throw new Error("Could not load your notifications.");
  }
  return (data ?? [])
    .filter((row) => isNotificationKind(row.kind))
    .map((row) => ({
      id: row.id,
      kind: row.kind as NotificationKind,
      title: row.title,
      issueId: row.issue_id,
      createdAt: row.created_at,
      readAt: row.read_at,
    }));
}

/** How many of the signed-in person's notifications in one company are unread. */
export async function countUnreadNotifications(organizationId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .is("read_at", null);
  if (error) {
    console.error("[countUnreadNotifications]", error.code, error.message);
    throw new Error("Could not load your notifications.");
  }
  return count ?? 0;
}

/**
 * The company's figures for a range of calendar days (inclusive), counted by
 * the database in the company's time zone. A refusal (for example a range
 * that is too long) comes back as a message to show.
 */
export async function getIssueReport(
  organizationId: string,
  from: string,
  to: string,
): Promise<{ report: IssueReport } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_report", { p_organization_id: organizationId, p_from: from, p_to: to });
  if (error) return { error: friendlyError(error, "Could not count the report. Please try again.", "getIssueReport") };
  const parsed = issueReportSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[getIssueReport] unexpected shape", parsed.error.issues[0]?.path.join("."));
    return { error: "Could not count the report. Please try again." };
  }
  return { report: parsed.data };
}
