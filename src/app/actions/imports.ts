"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import type { ImportRow } from "@/lib/csv-import";
import { finishImportSchema, importChunkSchema, startImportSchema } from "@/lib/validation";

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
