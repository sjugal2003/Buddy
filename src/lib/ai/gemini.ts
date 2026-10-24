import "server-only";
import { ApiError, type GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";
import { aiAnswerSchema, toSuggestion, type AnalyseResult, type Analyser } from "@/lib/ai/schema";

// The Gemini analyser, an alternative to Claude. Same prompt, same answer
// format and same checks; only the service differs. Server only: the key
// comes from the server-only GEMINI_API_KEY variable.

/** Google's smallest current model: free tier available, made for high-volume sorting. */
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
/** Includes the model's thinking, so a little more room than Claude's 600. */
export const GEMINI_MAX_OUTPUT_TOKENS = 1024;

/** The one SDK call Buddy makes, so tests can swap in a stand-in client. */
export type GenerateClient = Pick<GoogleGenAI["models"], "generateContent">;

// The answer format as a JSON schema, without the "$schema" line Gemini doesn't need.
const { $schema: _unused, ...answerJsonSchema } = z.toJSONSchema(aiAnswerSchema);
void _unused;

export function createGeminiAnalyser(client: GenerateClient): Analyser {
  return {
    kind: "gemini",
    async analyse(input): Promise<AnalyseResult> {
      try {
        const response = await client.generateContent({
          model: GEMINI_MODEL,
          contents: buildUserPrompt(input),
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: "application/json",
            responseJsonSchema: answerJsonSchema,
            // Flash-Lite models think very little by default, which suits a quick
            // sorting job, so thinking is left at Google's default.
            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          },
        });

        const candidate = response.candidates?.[0];
        if (response.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") {
          return { ok: false, reason: "refused", message: "The AI declined to analyse this message." };
        }
        let raw: unknown = null;
        if (candidate?.finishReason === "STOP" && response.text) {
          try {
            raw = JSON.parse(response.text);
          } catch {
            raw = null;
          }
        }
        const suggestion = toSuggestion(raw, input.categories);
        if (!suggestion) {
          return { ok: false, reason: "bad_answer", message: "The AI's answer could not be used. Try again." };
        }
        const usage = response.usageMetadata;
        return {
          ok: true,
          suggestion,
          usage: {
            inputTokens: usage?.promptTokenCount ?? 0,
            outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
          },
          model: GEMINI_MODEL,
        };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

function failure(error: unknown): AnalyseResult {
  // Logged on the server only, to help when Google changes something. Never includes the key.
  console.error("[gemini]", error instanceof ApiError ? error.status : "", error instanceof Error ? error.message.slice(0, 300) : "");
  if (error instanceof ApiError) {
    // Google answers a wrong key with 400 "API key not valid", or 401/403.
    if (error.status === 401 || error.status === 403 || (error.status === 400 && /api key/i.test(error.message))) {
      return { ok: false, reason: "bad_key", message: "The AI key was not accepted. Check GEMINI_API_KEY in .env.local." };
    }
    if (error.status === 429) {
      return {
        ok: false,
        reason: "rate_limited",
        message: "Gemini's free or per-minute limit was reached. Try again in a minute (see aistudio.google.com for limits).",
      };
    }
  }
  return { ok: false, reason: "unavailable", message: "The AI service could not be reached. Try again later." };
}
