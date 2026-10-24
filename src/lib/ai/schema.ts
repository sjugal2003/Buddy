import { z } from "zod";
import type { Channel, Intent, Sentiment, Urgency } from "@/lib/types";

// Shapes shared by every analyser (the real Claude one and the fake one used
// in tests). Nothing here talks to the network, so it is safe to unit test.

export const sentimentValues = ["positive", "neutral", "negative", "very_negative"] as const satisfies readonly Sentiment[];
export const intentValues = [
  "complaint",
  "question",
  "request",
  "bug_report",
  "cancellation",
  "praise",
] as const satisfies readonly Intent[];
export const urgencyValues = ["low", "medium", "high", "critical"] as const satisfies readonly Urgency[];

/** Written when the AI thinks none of the company's categories fit. */
export const NO_CATEGORY = "none";

/** What Buddy sends to an analyser. Only these fields leave the server. */
export interface AnalysisInput {
  subject: string;
  message: string;
  channel: Channel;
  categories: { id: string; name: string }[];
}

/** The answer format the model is asked for (sent to the API as a JSON schema). */
export const aiAnswerSchema = z.object({
  sentiment: z.enum(sentimentValues),
  sentiment_score: z.number(),
  intent: z.enum(intentValues),
  urgency: z.enum(urgencyValues),
  category: z.string(),
  themes: z.array(z.string()),
  summary: z.string(),
  suggested_action: z.string(),
  confidence: z.number(),
});

export type AiAnswer = z.infer<typeof aiAnswerSchema>;

/** A checked suggestion, ready to show next to an issue or store. */
export interface AiSuggestion {
  sentiment: Sentiment;
  /** -1 (very negative) to 1 (very positive). */
  sentimentScore: number;
  intent: Intent;
  urgency: Urgency;
  /** null when no category fits. */
  categoryId: string | null;
  themes: string[];
  summary: string;
  suggestedAction: string;
  /** 0 to 1. */
  confidence: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const tidy = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Turns a raw answer into a suggestion Buddy can trust: checks every field,
 * keeps numbers in range, shortens long text, and maps the category name back
 * to one of the company's own category ids (anything else becomes null).
 * Returns null when the answer is not usable at all.
 */
export function toSuggestion(raw: unknown, categories: AnalysisInput["categories"]): AiSuggestion | null {
  const parsed = aiAnswerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const answer = parsed.data;

  const summary = tidy(answer.summary, 200);
  if (!summary || !Number.isFinite(answer.sentiment_score) || !Number.isFinite(answer.confidence)) return null;

  const wanted = answer.category.trim().toLowerCase();
  const category = categories.find((c) => c.name.trim().toLowerCase() === wanted);

  const themes = [...new Set(answer.themes.map((t) => tidy(t, 40).toLowerCase()).filter(Boolean))].slice(0, 5);

  return {
    sentiment: answer.sentiment,
    sentimentScore: Math.round(clamp(answer.sentiment_score, -1, 1) * 100) / 100,
    intent: answer.intent,
    urgency: answer.urgency,
    categoryId: category?.id ?? null,
    themes,
    summary,
    suggestedAction: tidy(answer.suggested_action, 300),
    confidence: Math.round(clamp(answer.confidence, 0, 1) * 100) / 100,
  };
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AnalyseResult =
  | { ok: true; suggestion: AiSuggestion; usage: AiUsage; model: string }
  | { ok: false; reason: AnalyseFailure; message: string };

export type AnalyseFailure =
  | "not_configured"
  | "bad_key"
  | "rate_limited"
  | "out_of_credit"
  | "unavailable"
  | "refused"
  | "bad_answer";

export type AiProvider = "claude" | "gemini" | "fake";

export interface Analyser {
  /** The real services ("claude", "gemini") or "fake", the free test stand-in. */
  kind: AiProvider;
  analyse(input: AnalysisInput): Promise<AnalyseResult>;
}
