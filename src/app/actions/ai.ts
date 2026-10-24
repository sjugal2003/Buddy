"use server";

import { revalidatePath } from "next/cache";
import { getAnalyser } from "@/lib/ai";
import type { AnalyseResult } from "@/lib/ai/schema";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { getIssue, listRoutingRules, toRoutable } from "@/lib/data/live";
import { routeIssue } from "@/lib/routing";
import { acceptAiValueSchema, analyseIssueSchema, type AiField } from "@/lib/validation";
import type { FormState } from "./types";

// AI analysis of one issue. Runs on the server as the signed-in user:
// start_issue_analysis checks membership, the on/off switch, the monthly
// limit and the 30-second wait before anything is sent to the AI, and
// finish_issue_analysis records the answer (or the failure) exactly once.
// If an owner switched on automatic routing, an issue without a team then
// gets the team its matching rules agree on (never when they disagree).

const SIGNED_OUT: FormState = { error: "Your session has ended. Please sign in again." };
const NOT_SET_UP = "AI is not set up on this server yet (add GEMINI_API_KEY or ANTHROPIC_API_KEY to .env.local).";

function refresh() {
  revalidatePath("/w/[workspace]", "layout");
}

/** Analyse an issue and, when asked, fill the listed fields with the AI's answer. */
export async function analyseIssue(issueId: string, fill: AiField[]): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = analyseIssueSchema.safeParse({ issueId, fill });
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };

  const analyser = getAnalyser();
  if (!analyser) return { error: NOT_SET_UP };

  const supabase = await createClient();
  const started = await supabase.rpc("start_issue_analysis", { p_issue_id: parsed.data.issueId });
  if (started.error) {
    return { error: friendlyError(started.error, "We couldn't start the analysis. Please try again.", "analyseIssue") };
  }
  const analysisId = started.data as string;

  // Only what the AI needs: never the customer's name or anything else.
  const { data: issue, error: issueError } = await supabase
    .from("issues")
    .select("organization_id, subject, message, channel")
    .eq("id", parsed.data.issueId)
    .single();
  const { data: categories, error: categoryError } = issue
    ? await supabase.from("categories").select("id, name").eq("organization_id", issue.organization_id)
    : { data: null, error: null };

  let result: AnalyseResult;
  if (issueError || categoryError || !issue) {
    console.error("[analyseIssue] load", (issueError ?? categoryError)?.code);
    result = { ok: false, reason: "unavailable", message: "The issue could not be loaded. Try again." };
  } else {
    result = await analyser.analyse({
      subject: issue.subject,
      message: issue.message,
      channel: issue.channel,
      categories: categories ?? [],
    });
  }

  const record = result.ok
    ? {
        ok: true,
        sentiment: result.suggestion.sentiment,
        sentiment_score: result.suggestion.sentimentScore,
        intent: result.suggestion.intent,
        urgency: result.suggestion.urgency,
        category_id: result.suggestion.categoryId,
        themes: result.suggestion.themes,
        summary: result.suggestion.summary,
        suggested_action: result.suggestion.suggestedAction,
        confidence: result.suggestion.confidence,
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
      }
    : { ok: false, reason: result.message };
  const finished = await supabase.rpc("finish_issue_analysis", { p_analysis_id: analysisId, p_result: record });
  refresh();
  if (finished.error) {
    return { error: friendlyError(finished.error, "We couldn't save the AI's answer. Please try again.", "analyseIssue") };
  }
  if (!result.ok) return { error: result.message };

  // The analysis is always kept; filling fields is a separate step.
  const fields: AiField[] = ["summary", ...parsed.data.fill.filter((f) => f !== "summary")];
  const accepted = await supabase.rpc("accept_issue_analysis", { p_analysis_id: analysisId, p_fields: fields });
  refresh();
  if (accepted.error) {
    return {
      error: friendlyError(accepted.error, "The AI answered, but we couldn't fill in the issue. Use the Accept buttons.", "analyseIssue"),
    };
  }
  if (!issue) return { success: "AI analysis finished." };
  return autoRoute(issue.organization_id, parsed.data.issueId);
}

/** Applies the matching routing rule when the company asked for that. */
async function autoRoute(organizationId: string, issueId: string): Promise<FormState> {
  const supabase = await createClient();
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("ai_auto_route")
    .eq("id", organizationId)
    .single();
  if (orgError) console.error("[autoRoute] settings", orgError.code);
  if (!org?.ai_auto_route) return { success: "AI analysis finished." };

  // Read again after the AI values were filled in, so rules see them.
  const issue = await getIssue(organizationId, issueId);
  if (!issue || issue.teamId || issue.routingDismissedAt) return { success: "AI analysis finished." };
  const outcome = routeIssue(await listRoutingRules(organizationId), toRoutable(issue));
  if (outcome.kind === "none") return { success: "AI analysis finished. No routing rule matches this issue." };
  if (outcome.kind === "conflict") {
    return { success: "AI analysis finished. Matching routing rules name different teams, so choose the team yourself." };
  }
  const rule = outcome.rule;

  // Only while the issue still has no team: never overwrite a person's choice.
  const { data, error } = await supabase.rpc("apply_routing_rule", {
    p_issue_id: issueId,
    p_rule_id: rule.id,
    p_expected_team: null,
  });
  refresh();
  if (error) {
    return {
      error: friendlyError(error, "The AI finished, but we couldn't apply the routing rule. Use the suggestion button.", "autoRoute"),
    };
  }
  return { success: data ? `AI analysis finished. Routing rule "${rule.name}" was applied.` : "AI analysis finished." };
}

/** Use one AI suggestion on the issue (the Accept buttons). */
export async function acceptAiValue(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return SIGNED_OUT;
  const parsed = acceptAiValueSchema.safeParse({ analysisId: formData.get("analysisId"), field: formData.get("field") });
  if (!parsed.success) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_issue_analysis", {
    p_analysis_id: parsed.data.analysisId,
    p_fields: [parsed.data.field],
  });
  if (error) return { error: friendlyError(error, "We couldn't use that suggestion. Please try again.", "acceptAiValue") };
  refresh();
  return data ? { success: "AI suggestion used." } : { success: "The issue already has this value." };
}
