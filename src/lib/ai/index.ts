import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { createClaudeAnalyser } from "@/lib/ai/claude";
import { fakeAnalyser } from "@/lib/ai/fake";
import { createGeminiAnalyser } from "@/lib/ai/gemini";
import type { AiProvider, Analyser } from "@/lib/ai/schema";
import { runsOnThisComputer } from "@/lib/site-url";

const TIMEOUT_MS = 30_000;

/** Shown wherever AI is needed but this server isn't set up for it. */
export const AI_NOT_SET_UP =
  "AI is not set up on this server yet. It needs GEMINI_API_KEY or ANTHROPIC_API_KEY, and BUDDY_AI_RESULT_KEY, in .env.local (see the README).";

/**
 * The key that proves an AI result comes from Buddy's server (Phase 7 stage
 * 36): start_issue_analysis and finish_issue_analysis refuse without it, so
 * a member can't record a made-up answer. The database keeps only its hash.
 * Server only; never logged or sent to the browser. Null when missing or too short.
 */
export function aiResultKey(): string | null {
  const key = process.env.BUDDY_AI_RESULT_KEY?.trim();
  return key && key.length >= 32 ? key : null;
}

/**
 * Which AI service this server uses:
 * - BUDDY_AI_MODE=fake: the free keyword stand-in (automated tests and CI),
 *   only when Buddy runs on this computer; on a live server it is refused.
 * - ANTHROPIC_API_KEY: Claude.
 * - GEMINI_API_KEY: Gemini (used when there is no Anthropic key).
 * - Neither, or no BUDDY_AI_RESULT_KEY: the app says AI is not set up.
 * Only checks whether a key exists; never logs or returns its value.
 */
export function aiServiceStatus(): AiProvider | "not_configured" {
  if (!aiResultKey()) return "not_configured";
  if (process.env.BUDDY_AI_MODE === "fake") {
    if (runsOnThisComputer(process.env)) return "fake";
    console.error("[ai] BUDDY_AI_MODE=fake is for tests only and is ignored on a live server");
    return "not_configured";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "claude";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  return "not_configured";
}

export function getAnalyser(): Analyser | null {
  switch (aiServiceStatus()) {
    case "fake":
      return fakeAnalyser;
    case "claude":
      return createClaudeAnalyser(
        new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), timeout: TIMEOUT_MS, maxRetries: 1 }).messages,
      );
    case "gemini":
      return createGeminiAnalyser(
        new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim(), httpOptions: { timeout: TIMEOUT_MS } }).models,
      );
    case "not_configured":
      return null;
  }
}

/** Shown in Settings and next to each analysis. */
export const providerNames: Record<AiProvider, string> = {
  claude: "Claude Haiku 5.5",
  gemini: "Gemini 3.5 Flash-Lite",
  fake: "Test analyser (no real AI, free)",
};
