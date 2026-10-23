import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";
import { aiAnswerSchema, toSuggestion, type AnalyseResult, type Analyser } from "@/lib/ai/schema";

// The real analyser. It runs only on the server: the key comes from the
// server-only ANTHROPIC_API_KEY variable and never reaches the browser.

export const AI_MODEL = "claude-haiku-5-5";
/** A full answer is about 300 tokens; this caps the cost of any single call. */
export const MAX_OUTPUT_TOKENS = 600;

/** The one SDK call Buddy makes, so tests can swap in a stand-in client. */
export type ParseClient = Pick<Anthropic["messages"], "parse">;

export function createClaudeAnalyser(client: ParseClient): Analyser {
  return {
    kind: "claude",
    async analyse(input): Promise<AnalyseResult> {
      try {
        const response = await client.parse({
          model: AI_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          // Sorting a message is a quick judgement: no extended thinking, low effort.
          thinking: { type: "disabled" },
          output_config: { effort: "low", format: zodOutputFormat(aiAnswerSchema) },
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildUserPrompt(input) }],
        });

        if (response.stop_reason === "refusal") {
          return { ok: false, reason: "refused", message: "The AI declined to analyse this message." };
        }
        const suggestion =
          response.stop_reason === "end_turn" ? toSuggestion(response.parsed_output, input.categories) : null;
        if (!suggestion) {
          return { ok: false, reason: "bad_answer", message: "The AI's answer could not be used. Try again." };
        }
        return {
          ok: true,
          suggestion,
          usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
          model: response.model,
        };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

function failure(error: unknown): AnalyseResult {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { ok: false, reason: "bad_key", message: "The AI key was not accepted. Check ANTHROPIC_API_KEY in .env.local." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { ok: false, reason: "rate_limited", message: "The AI service is busy. Try again in a minute." };
  }
  // A spend limit or empty balance comes back as a 402 billing error.
  if (error instanceof Anthropic.APIError && error.status === 402) {
    return {
      ok: false,
      reason: "out_of_credit",
      message: "The AI account has no credit left or reached its spend limit (see console.anthropic.com).",
    };
  }
  return { ok: false, reason: "unavailable", message: "The AI service could not be reached. Try again later." };
}
