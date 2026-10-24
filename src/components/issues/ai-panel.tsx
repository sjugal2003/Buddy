"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { acceptAiValue, analyseIssue } from "@/app/actions/ai";
import type { FormState } from "@/app/actions/types";
import { FormMessage } from "@/components/auth/auth-card";
import { secondaryButton } from "@/components/ui/form";
import type { LiveAnalysis, LiveCategory } from "@/lib/data/live";
import { formatDateTime } from "@/lib/format";
import { intentLabels, sentimentLabels, urgencyLabels } from "@/lib/labels";
import type { Intent, Sentiment, Urgency } from "@/lib/types";
import type { AiField } from "@/lib/validation";

// The AI panel on an issue page. Suggestions are only suggestions: each one
// that differs from the issue has its own Accept button, and nothing a person
// chose is changed without one.

/** The stored model name as people read it. */
function modelName(model: string) {
  if (model === "fake") return "Test analyser";
  if (model.startsWith("gemini-3.5-flash-lite")) return "Gemini 3.5 Flash-Lite";
  if (model.startsWith("claude-haiku-5-5")) return "Claude Haiku 5.5";
  return model;
}

/** A pending analysis older than this never finished (the server stopped). */
const STUCK_AFTER_MS = 5 * 60_000;

function AcceptButton({ analysisId, field, label }: { analysisId: string; field: AiField; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(acceptAiValue, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="analysisId" value={analysisId} />
      <input type="hidden" name="field" value={field} />
      <button type="submit" disabled={pending} className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50">
        {pending ? "Using…" : `Accept ${label}`}
      </button>
      {state.error && <span className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

export function AiPanel({
  issueId,
  analysis,
  aiEnabled,
  aiConfigured,
  autoFill,
  current,
  categories,
}: {
  issueId: string;
  analysis: LiveAnalysis | null;
  aiEnabled: boolean;
  aiConfigured: boolean;
  /** Set right after the issue was created: analyse now and fill these fields. */
  autoFill: AiField[] | null;
  current: { sentiment: Sentiment; intent: Intent; urgency: Urgency; categoryId: string | null };
  categories: LiveCategory[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [running, startTransition] = useTransition();
  const [message, setMessage] = useState<FormState>({});
  const started = useRef(false);
  // Read once on the first render, so the stuck check stays the same between renders.
  const [openedAt] = useState(() => Date.now());

  const run = (fill: AiField[]) => {
    setMessage({});
    startTransition(async () => {
      const result = await analyseIssue(issueId, fill);
      setMessage(result.error ? { error: result.error } : {});
      router.refresh();
    });
  };

  useEffect(() => {
    if (autoFill === null || analysis || started.current) return;
    started.current = true;
    // Drop ?analyse from the address so reloading the page doesn't analyse again.
    router.replace(`${pathname}?created=1`, { scroll: false });
    run(autoFill);
    // Runs once, right after the issue was created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!aiEnabled) {
    return <p className="text-sm text-slate-500">AI analysis is off for this company. Owners and admins can switch it on in Settings.</p>;
  }
  if (!aiConfigured) {
    return <p className="text-sm text-slate-500">AI is not set up on this server yet (add GEMINI_API_KEY or ANTHROPIC_API_KEY to .env.local).</p>;
  }

  const stuck = analysis?.status === "pending" && openedAt - new Date(analysis.createdAt).getTime() > STUCK_AFTER_MS;
  const waitingToStart = autoFill !== null && !analysis && !message.error;
  const busy = running || waitingToStart || (analysis?.status === "pending" && !stuck);
  const category = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "No category";

  const rows: { field: AiField; label: string; value: string; differs: boolean }[] =
    analysis?.status === "done"
      ? [
          { field: "urgency", label: "urgency", value: urgencyLabels[analysis.urgency!], differs: analysis.urgency !== current.urgency },
          {
            field: "sentiment",
            label: "sentiment",
            value: sentimentLabels[analysis.sentiment!],
            differs: analysis.sentiment !== current.sentiment,
          },
          { field: "intent", label: "type", value: intentLabels[analysis.intent!], differs: analysis.intent !== current.intent },
          {
            field: "category",
            label: "category",
            value: category(analysis.categoryId),
            differs: analysis.categoryId !== null && analysis.categoryId !== current.categoryId,
          },
        ]
      : [];

  return (
    <div className="space-y-3 text-sm" data-testid="ai-panel">
      {busy && (
        <p className="flex items-center gap-2 text-slate-600" role="status">
          <Sparkles className="h-4 w-4 animate-pulse text-brand-600" aria-hidden /> Analysing with AI…
        </p>
      )}

      {!busy && !analysis && <p className="text-slate-500">Not analysed yet.</p>}

      {!busy && (analysis?.status === "failed" || stuck) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
          Analysis failed: {analysis?.failureReason ?? "it did not finish."} The issue itself is saved.
        </p>
      )}

      {!busy && analysis?.status === "done" && (
        <>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
              <Sparkles className="h-3 w-3" aria-hidden /> AI suggested
            </span>
            {modelName(analysis.model)} · {formatDateTime(analysis.createdAt)}
            {analysis.confidence !== null && <> · {Math.round(analysis.confidence * 100)}% sure</>}
          </p>
          <p className="text-slate-800">{analysis.summary}</p>
          {analysis.suggestedAction && (
            <p className="text-slate-600">
              <span className="font-medium text-slate-700">Next step:</span> {analysis.suggestedAction}
            </p>
          )}
          {analysis.themes.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {analysis.themes.map((t) => (
                <li key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {t}
                </li>
              ))}
            </ul>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3">
            {rows.map((row) => (
              <div key={row.field} className="contents">
                <dt className="capitalize text-slate-500">{row.label}</dt>
                <dd className="flex flex-wrap items-center gap-2 text-slate-900">
                  {row.value}
                  {row.differs ? (
                    <AcceptButton analysisId={analysis.id} field={row.field} label={row.label} />
                  ) : (
                    <span className="text-xs text-slate-400">matches</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <FormMessage error={message.error} />
      {!busy && (
        <button type="button" onClick={() => run([])} className={`${secondaryButton} w-full`}>
          {analysis ? "Analyse again" : "Analyse with AI"}
        </button>
      )}
    </div>
  );
}
