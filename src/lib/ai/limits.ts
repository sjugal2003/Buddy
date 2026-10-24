import type { AiUsage } from "@/lib/ai/schema";

// Spending guards that run before every analysis. The Anthropic Console spend
// limit is the hard stop; these keep each company well inside it.

export const DEFAULT_MONTHLY_LIMIT = 500;
export const MAX_MONTHLY_LIMIT = 2000;
/** Seconds to wait before the same issue can be analysed again. */
export const RETRY_COOLDOWN_SECONDS = 30;

/** Paid prices in US dollars per million tokens. Claude Haiku 5.5 is for prompts up to 100K tokens. */
export const PRICE_PER_MILLION = {
  claude: { input: 0.1, output: 0.5 },
  // Gemini 3.5 Flash-Lite on Google's paid tier. Its free tier costs nothing, within Google's limits.
  gemini: { input: 0.3, output: 2.5 },
};

export interface AiAllowanceInput {
  enabled: boolean;
  monthlyLimit: number;
  /** Analyses this company has already used since the start of the month (UTC). */
  usedThisMonth: number;
  /** When this issue was last analysed, if ever. */
  lastAnalysedAt?: Date | null;
  now: Date;
}

export type AiAllowance =
  | { ok: true; remaining: number }
  | { ok: false; reason: "disabled" | "limit_reached" | "cooldown"; message: string };

export function checkAiAllowance(input: AiAllowanceInput): AiAllowance {
  if (!input.enabled) {
    return { ok: false, reason: "disabled", message: "AI analysis is turned off for this company." };
  }
  const limit = Math.min(Math.max(Math.floor(input.monthlyLimit), 0), MAX_MONTHLY_LIMIT);
  if (input.usedThisMonth >= limit) {
    return {
      ok: false,
      reason: "limit_reached",
      message: `This company has used all ${limit} AI analyses for this month. The count resets on the 1st.`,
    };
  }
  if (input.lastAnalysedAt) {
    const waited = (input.now.getTime() - input.lastAnalysedAt.getTime()) / 1000;
    if (waited < RETRY_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RETRY_COOLDOWN_SECONDS - waited);
      return { ok: false, reason: "cooldown", message: `Please wait ${wait} seconds before analysing this issue again.` };
    }
  }
  return { ok: true, remaining: limit - input.usedThisMonth };
}

/** Start of the current month in UTC, the point the monthly count resets. */
export function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Approximate cost in US dollars at paid prices, for the usage line in
 * Settings. `model` is the model name stored with each analysis; the free
 * test analyser costs nothing.
 */
export function estimateCostUsd(usage: AiUsage, model = "claude") {
  const price = model.startsWith("gemini") ? PRICE_PER_MILLION.gemini : model === "fake" ? null : PRICE_PER_MILLION.claude;
  if (!price) return 0;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
