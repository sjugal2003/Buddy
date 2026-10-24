import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createClaudeAnalyser } from "@/lib/ai/claude";
import { fakeAnalyser } from "@/lib/ai/fake";
import type { Analyser } from "@/lib/ai/schema";

/**
 * Picks the analyser for this server:
 * - BUDDY_AI_MODE=fake uses the free keyword stand-in (automated tests and CI).
 * - Otherwise ANTHROPIC_API_KEY turns on Claude.
 * - With neither, returns null and the app says AI is not set up.
 * Only reports whether a key exists; never logs or returns its value.
 */
export function getAnalyser(): Analyser | null {
  if (process.env.BUDDY_AI_MODE === "fake") return fakeAnalyser;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return createClaudeAnalyser(new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 }).messages);
}
