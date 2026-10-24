"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { aiServiceStatus } from "@/lib/ai";
import { MAX_IMPORT_ROWS, type ImportRow } from "@/lib/csv-import";
import { getAiSettings } from "@/lib/data/live";
import { aiPauseMs, planAiBatch } from "@/lib/import-ai";
import { finishImportSchema, idSchema, importChunkSchema, startImportSchema } from "@/lib/validation";

// CSV import (Phase 5 stage 23). The browser reads the file and sends the rows
// in pieces of up to 500; each piece is checked again here and in the
// database (public.import_issues), which only lets owners and admins of the
// company import, and only into the import they started.

const SIGNED_OUT = "Your session has ended. Please sign in again.";
const BROKEN = "Something went wrong. Reload the page and try again.";

export type StartImportResult = { runId: string } | { error: string };

export async function startCsvImport(organizationId: string, fileName: string): Promise<StartImportResult> {
  if (!(await getCurrentUser())) return { error: SIGNED_OUT };
  const parsed = startImportSchema.safeParse({ organizationId, fileName });
  if (!parsed.success) return { error: BROKEN };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_import", {
    p_organization_id: parsed.data.organizationId,
    p_source: "csv",
    p_file_name: parsed.data.fileName,
  });
  if (error) return { error: friendlyError(error, "We couldn't start the import. Please try again.", "startCsvImport") };
  if (typeof data !== "string") return { error: "We couldn't start the import. Please try again." };
  return { runId: data };
}

export interface RowOutcome {
  row: number | null;
  outcome: "imported" | "duplicate" | "rejected";
  reason?: string;
}

export type ImportChunkResult = { outcomes: RowOutcome[] } | { error: string };

export async function importCsvChunk(runId: string, rows: ImportRow[], asHistory: boolean): Promise<ImportChunkResult> {
  if (!(await getCurrentUser())) return { error: SIGNED_OUT };
  const parsed = importChunkSchema.safeParse({ runId, rows, asHistory });
  if (!parsed.success) return { error: BROKEN };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_issues", {
    p_run_id: parsed.data.runId,
    p_rows: parsed.data.rows,
    p_as_history: parsed.data.asHistory,
  });
  if (error) return { error: friendlyError(error, "We couldn't save these rows. Please try again.", "importCsvChunk") };
  // One outcome per row sent, or the save cannot be trusted.
  if (!Array.isArray(data) || data.length !== parsed.data.rows.length) {
    return { error: "We couldn't confirm these rows were saved. Check the import history." };
  }
  return {
    outcomes: (data as { row: number | null; outcome: RowOutcome["outcome"]; reason?: string }[]).map((o) => ({
      row: o.row,
      outcome: o.outcome,
      reason: o.reason,
    })),
  };
}

/** Closes the import; with an error it is marked as stopped (rows already saved stay). */
export async function finishCsvImport(runId: string, failure: string | null): Promise<{ error?: string }> {
  if (!(await getCurrentUser())) return { error: SIGNED_OUT };
  const parsed = finishImportSchema.safeParse({ runId, error: failure });
  if (!parsed.success) return { error: BROKEN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finish_import", { p_run_id: parsed.data.runId, p_error: parsed.data.error });
  revalidatePath("/w/[workspace]", "layout");
  if (error) return { error: friendlyError(error, "We couldn't close the import. Check the import history.", "finishCsvImport") };
  return {};
}

export type ImportAiPlan =
  | {
      /** Issues to analyse, oldest first, already capped at what is left this month. */
      issueIds: string[];
      waiting: number;
      used: number;
      limit: number;
      left: number;
      pauseMs: number;
    }
  | { error: string };

/**
 * What "Analyse with AI" would do for one import: its issues that have no
 * finished analysis, and how many analyses are left this month. Nothing is
 * sent to the AI here; each issue then goes through analyseIssue, where the
 * database checks the switch and the monthly limit again.
 */
export async function planImportAnalysis(runId: string): Promise<ImportAiPlan> {
  const user = await getCurrentUser();
  if (!user) return { error: SIGNED_OUT };
  const parsed = idSchema.safeParse(runId);
  if (!parsed.success) return { error: BROKEN };

  const supabase = await createClient();
  const { data: run, error: runError } = await supabase
    .from("import_runs")
    .select("id, organization_id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (runError) return { error: friendlyError(runError, "We couldn't load this import.", "planImportAnalysis") };
  if (!run) return { error: "That import was not found." };
  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", run.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (member?.role !== "owner" && member?.role !== "admin") {
    return { error: "Only owners and admins can analyse imported issues in one go." };
  }

  const service = aiServiceStatus();
  if (service === "not_configured") {
    return { error: "AI is not set up on this server yet (add GEMINI_API_KEY or ANTHROPIC_API_KEY to .env.local)." };
  }
  let settings;
  try {
    settings = await getAiSettings(run.organization_id);
  } catch {
    return { error: "We couldn't load the AI settings. Please try again." };
  }
  if (!settings.enabled) return { error: "AI analysis is switched off. An owner or admin can switch it on in Settings." };

  const { data: issues, error: issuesError } = await supabase
    .from("issues")
    .select("id")
    .eq("organization_id", run.organization_id)
    .eq("import_run_id", run.id)
    .order("received_at", { ascending: true })
    .limit(MAX_IMPORT_ROWS);
  if (issuesError) return { error: friendlyError(issuesError, "We couldn't load this import's issues.", "planImportAnalysis") };
  const ids = (issues ?? []).map((i) => i.id as string);

  // Issues that already have a finished analysis are skipped.
  const analysed = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("issue_analyses")
      .select("issue_id")
      .eq("organization_id", run.organization_id)
      .eq("status", "done")
      .in("issue_id", ids.slice(i, i + 200));
    if (error) return { error: friendlyError(error, "We couldn't check which issues are analysed.", "planImportAnalysis") };
    for (const row of data ?? []) analysed.add(row.issue_id as string);
  }
  const waitingIds = ids.filter((id) => !analysed.has(id));
  const plan = planAiBatch(waitingIds.length, settings.usedThisMonth, settings.monthlyLimit);
  return {
    issueIds: waitingIds.slice(0, plan.toAnalyse),
    waiting: plan.waiting,
    used: settings.usedThisMonth,
    limit: settings.monthlyLimit,
    left: plan.left,
    pauseMs: aiPauseMs(service),
  };
}
