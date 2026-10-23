import { NO_CATEGORY, toSuggestion, type AiAnswer, type Analyser, type AnalysisInput } from "@/lib/ai/schema";

// A stand-in analyser for automated tests and CI. It follows simple keyword
// rules, so it is free, needs no key and always gives the same answer.
// Anything it produces is labelled as coming from the test analyser.

const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

export function fakeAnswer(input: AnalysisInput): AiAnswer {
  const text = `${input.subject} ${input.message}`.toLowerCase();

  const angry = has(text, ["angry", "furious", "unacceptable", "worst", "terrible"]);
  const unhappy = angry || has(text, ["not working", "broken", "problem", "issue", "wrong", "charged twice", "refund"]);
  const happy = has(text, ["thank", "great", "love", "brilliant"]);

  const intent: AiAnswer["intent"] = has(text, ["cancel", "leaving"])
    ? "cancellation"
    : has(text, ["crash", "error", "bug", "not working", "broken"])
      ? "bug_report"
      : has(text, ["charged", "refund", "bill"])
        ? "complaint"
        : happy && !unhappy
          ? "praise"
          : text.includes("?")
            ? "question"
            : "request";

  const urgency: AiAnswer["urgency"] = has(text, ["outage", "down for everyone", "urgent", "lawyer"])
    ? "critical"
    : angry || intent === "cancellation"
      ? "high"
      : unhappy
        ? "medium"
        : "low";

  const category = input.categories.find((c) => text.includes(c.name.toLowerCase()))?.name ?? NO_CATEGORY;

  return {
    sentiment: angry ? "very_negative" : unhappy ? "negative" : happy ? "positive" : "neutral",
    sentiment_score: angry ? -0.8 : unhappy ? -0.4 : happy ? 0.7 : 0,
    intent,
    urgency,
    category,
    themes: category === NO_CATEGORY ? [] : [category.toLowerCase()],
    summary: `Test analyser: ${input.subject.trim() || "message"} (${intent.replace("_", " ")}).`,
    suggested_action: "Test analyser: review the message and reply to the customer.",
    confidence: 0.5,
  };
}

export const fakeAnalyser: Analyser = {
  kind: "fake",
  async analyse(input) {
    const suggestion = toSuggestion(fakeAnswer(input), input.categories);
    if (!suggestion) return { ok: false, reason: "bad_answer", message: "The test analyser gave an unusable answer." };
    return { ok: true, suggestion, usage: { inputTokens: 0, outputTokens: 0 }, model: "fake" };
  },
};
