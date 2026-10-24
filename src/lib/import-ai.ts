import type { AiProvider } from "@/lib/ai/schema";

// AI analysis of imported issues (Phase 5 stage 24). Pure helpers shared by
// the server action that plans a batch and the browser that runs it, so the
// numbers people confirm are the numbers that run.

/** Imported issues can be analysed in one batch up to this many at a time. */
export const MAX_AI_BATCH = 2000;

export interface AiBatchPlan {
  /** Issues from the import without a finished analysis. */
  waiting: number;
  /** How many this batch will analyse: never more than what is left this month. */
  toAnalyse: number;
  /** Analyses left this month before this batch. */
  left: number;
}

export function planAiBatch(waiting: number, usedThisMonth: number, monthlyLimit: number): AiBatchPlan {
  const left = Math.max(0, monthlyLimit - usedThisMonth);
  return { waiting, left, toAnalyse: Math.min(waiting, left, MAX_AI_BATCH) };
}

/**
 * Time between analyses, so a batch stays inside each service's request limits
 * (Gemini's free tier allows only a few requests a minute). The test analyser
 * needs no pause.
 */
export function aiPauseMs(service: AiProvider): number {
  if (service === "fake") return 0;
  if (service === "claude") return 1000;
  return 4500;
}

/** "about 3 minutes" for a batch, counting the pauses and a few seconds per answer. */
export function describeBatchTime(count: number, pauseMs: number): string {
  const seconds = Math.ceil((count * (pauseMs + 2000)) / 1000);
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}
