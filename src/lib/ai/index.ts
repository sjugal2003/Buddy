import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { createClaudeAnalyser } from "@/lib/ai/claude";
import { fakeAnalyser } from "@/lib/ai/fake";
import { createGeminiAnalyser } from "@/lib/ai/gemini";
import type { AiProvider, Analyser } from "@/lib/ai/schema";

const TIMEOUT_MS = 30_000;

/**
 * Which AI service this server uses:
 * - BUDDY_AI_MODE=fake: the free keyword stand-in (automated tests and CI).
 * - ANTHROPIC_API_KEY: Claude.
 * - GEMINI_API_KEY: Gemini (used when there is no Anthropic key).
 * - Neither: null, and the app says AI is not set up.
 * Only checks whether a key exists; never logs or returns its value.
 */
export function aiServiceStatus(): AiProvider | "not_configured" {
  if (process.env.BUDDY_AI_MODE === "fake") return "fake";
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
