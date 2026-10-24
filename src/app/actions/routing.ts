"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import {
  getIssue,
  listCategories,
  listRoutingRules,
  listUnroutedIssues,
  toRoutable,
  type LiveIssue,
} from "@/lib/data/live";
import { canApplyRule, routeIssue } from "@/lib/routing";
import type { RuleCondition } from "@/lib/types";
import {
  createRuleSchema,
  fieldErrors,
  idSchema,
  moveRuleSchema,
  toggleRuleSchema,
  updateRuleSchema,
} from "@/lib/validation";
import type { FormState } from "./types";

// Routing rules only suggest a team; nothing here moves an issue unless a
// person presses a button. Owners and admins manage rules (the database
// refuses anyone else). Any member may apply a suggestion, because members
// may already change an issue's team.

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };
const NOT_ALLOWED: FormState = { error: "Only owners and admins can change rules, or this rule no longer exists." };
const STALE_TEAM: FormState = { fieldErrors: { teamId: "That team no longer exists. Reload the page and try again." } };

function done(success: string): FormState {
  revalidatePath("/w/[workspace]", "layout");
  return { success };
}

/** Category conditions must name one of this company's categories. */
async function checkCategories(organizationId: string, conditions: RuleCondition[]): Promise<FormState | null> {
  const wanted = conditions.filter((c) => c.field === "category").map((c) => c.value);
  if (wanted.length === 0) return null;
  const known = new Set((await listCategories(organizationId)).map((c) => c.id));
  return wanted.every((id) => known.has(id))
    ? null
    : { fieldErrors: { conditions: "A category in this rule no longer exists. Reload the page and try again." } };
}

function ruleInput(formData: FormData) {
  return {
    name: formData.get("name"),
    match: formData.get("match"),
    teamId: formData.get("teamId"),
    conditions: formData.get("conditions"),
  };
}

export async function createRule(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = createRuleSchema.safeParse({ organizationId: formData.get("organizationId"), ...ruleInput(formData) });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { organizationId, name, match, teamId, conditions } = parsed.data;
  const badCategory = await checkCategories(organizationId, conditions);
  if (badCategory) return badCategory;

  const supabase = await createClient();
  // New rules go to the bottom of the list.
  const { data: last } = await supabase
    .from("routing_rules")
    .select("position")
    .eq("organization_id", organizationId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("routing_rules").insert({
    organization_id: organizationId,
    name,
    match_mode: match,
    team_id: teamId,
    conditions,
    position: (last?.position ?? -1) + 1,
  });
  if (error?.code === "23503") return STALE_TEAM;
  if (error) return { error: friendlyError(error, "We couldn't add the rule. Please try again.", "createRule") };
  return done(`Rule "${name}" added.`);
}

export async function updateRule(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = updateRuleSchema.safeParse({ ruleId: formData.get("ruleId"), ...ruleInput(formData) });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { ruleId, name, match, teamId, conditions } = parsed.data;

  const supabase = await createClient();
  const { data: rule } = await supabase.from("routing_rules").select("organization_id").eq("id", ruleId).maybeSingle();
  if (!rule) return NOT_ALLOWED;
  const badCategory = await checkCategories(rule.organization_id, conditions);
  if (badCategory) return badCategory;

  const { data, error } = await supabase
    .from("routing_rules")
    .update({ name, match_mode: match, team_id: teamId, conditions })
    .eq("id", ruleId)
    .select("id");
  if (error?.code === "23503") return STALE_TEAM;
  if (error) return { error: friendlyError(error, "We couldn't save the rule. Please try again.", "updateRule") };
  if (!data?.length) return NOT_ALLOWED;
  return done("Rule saved.");
}

export async function toggleRule(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = toggleRuleSchema.safeParse({ ruleId: formData.get("ruleId"), enabled: formData.get("enabled") });
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };

  const enabled = parsed.data.enabled === "true";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("routing_rules")
    .update({ enabled })
    .eq("id", parsed.data.ruleId)
    .select("id");
  if (error) return { error: friendlyError(error, "We couldn't change the rule. Please try again.", "toggleRule") };
  if (!data?.length) return NOT_ALLOWED;
  return done(enabled ? "Rule switched on." : "Rule switched off.");
}

export async function deleteRule(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = idSchema.safeParse(formData.get("ruleId"));
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("routing_rules").delete().eq("id", parsed.data).select("id");
  if (error) return { error: friendlyError(error, "We couldn't delete the rule. Please try again.", "deleteRule") };
  if (!data?.length) return NOT_ALLOWED;
  return done("Rule deleted.");
}

/** Swaps a rule with its neighbour, then numbers the whole list 0, 1, 2… again. */
export async function moveRule(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = moveRuleSchema.safeParse({ ruleId: formData.get("ruleId"), direction: formData.get("direction") });
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };
  const { ruleId, direction } = parsed.data;

  const supabase = await createClient();
  const { data: rule } = await supabase.from("routing_rules").select("organization_id").eq("id", ruleId).maybeSingle();
  if (!rule) return NOT_ALLOWED;
  const rules = await listRoutingRules(rule.organization_id);
  const from = rules.findIndex((r) => r.id === ruleId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= rules.length) return {};
  [rules[from], rules[to]] = [rules[to], rules[from]];

  for (const [position, r] of rules.entries()) {
    const { data, error } = await supabase.from("routing_rules").update({ position }).eq("id", r.id).select("id");
    if (error) return { error: friendlyError(error, "We couldn't reorder the rules. Please try again.", "moveRule") };
    if (!data?.length) return NOT_ALLOWED;
  }
  return done("Order saved.");
}

/**
 * Gives the issue the team of one rule, through the database function that
 * also records the rule in the history. Changes nothing if the issue's team
 * is no longer what we read: a team someone chose is never overwritten.
 */
async function applyRule(issue: LiveIssue, ruleId: string) {
  const supabase = await createClient();
  return supabase.rpc("apply_routing_rule", {
    p_issue_id: issue.id,
    p_rule_id: ruleId,
    p_expected_team: issue.teamId,
  });
}

/** Gives one issue the team of the suggested rule, or of the rule a person picked in a conflict. */
export async function applySuggestedTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const organizationId = idSchema.safeParse(formData.get("organizationId"));
  const issueId = idSchema.safeParse(formData.get("issueId"));
  const ruleId = idSchema.safeParse(formData.get("ruleId"));
  if (!organizationId.success || !issueId.success || !ruleId.success) {
    return { error: "Something went wrong. Reload the page and try again." };
  }

  // Worked out again here rather than trusting the browser: the rule must
  // still be the suggestion, or one of the rules in a conflict.
  const issue = await getIssue(organizationId.data, issueId.data);
  if (!issue) return { error: "This issue no longer exists, or you no longer have access to it." };
  const rules = await listRoutingRules(organizationId.data);
  const outcome = routeIssue(rules, toRoutable(issue));
  if (!canApplyRule(outcome, ruleId.data)) return { error: "That rule no longer matches this issue. Reload the page to see why." };
  const rule = rules.find((r) => r.id === ruleId.data)!;
  if (rule.teamId === issue.teamId) return { success: "The issue already has that team." };

  const { data, error } = await applyRule(issue, rule.id);
  if (error) return { error: friendlyError(error, "We couldn't change the team. Please try again.", "applySuggestedTeam") };
  if (!data) return { error: "Someone changed this issue's team just now. Reload the page to see it." };
  return done("Team applied.");
}

/** Hides the suggestion on one issue until its category, urgency, type or channel changes. */
export async function dismissRoutingSuggestion(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const issueId = idSchema.safeParse(formData.get("issueId"));
  if (!issueId.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_routing_suggestion", { p_issue_id: issueId.data });
  if (error) return { error: friendlyError(error, "We couldn't dismiss the suggestion. Please try again.", "dismissRoutingSuggestion") };
  return done("Suggestion dismissed.");
}

/** How many open issues without a team are looked at in one go. */
const ROUTE_BATCH = 500;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Gives every open issue without a team the team its matching rules agree on.
 * Issues whose rules name different teams, or whose suggestion was dismissed,
 * are left for a person.
 */
export async function routeUnassignedIssues(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const organizationId = idSchema.safeParse(formData.get("organizationId"));
  if (!organizationId.success) return { error: "Something went wrong. Reload the page and try again." };

  const issues = await listUnroutedIssues(organizationId.data, ROUTE_BATCH);
  const rules = await listRoutingRules(organizationId.data);
  let routed = 0;
  let unmatched = 0;
  let conflicts = 0;
  for (const issue of issues) {
    const outcome = routeIssue(rules, toRoutable(issue));
    if (outcome.kind === "none") {
      unmatched++;
      continue;
    }
    if (outcome.kind === "conflict") {
      conflicts++;
      continue;
    }
    const { data, error } = await applyRule(issue, outcome.rule.id);
    if (error) {
      const message = friendlyError(error, "We couldn't route all the issues.", "routeUnassigned");
      if (routed === 0) return { error: message };
      revalidatePath("/w/[workspace]", "layout");
      return { error: `${message} ${routed} were routed before the problem.` };
    }
    if (data) routed++;
  }

  if (issues.length === 0) return { success: "There are no open issues without a team (or their suggestions were dismissed)." };
  const skipped =
    (conflicts ? ` ${plural(conflicts, "issue was", "issues were")} skipped because matching rules name different teams.` : "") +
    (unmatched ? ` ${plural(unmatched, "issue still has", "issues still have")} no team because no rule matches.` : "");
  if (routed === 0) return { success: `No issues were routed.${skipped}` };
  return done(`Routed ${plural(routed, "issue", "issues")}.${skipped}`);
}
