"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { analyseIssue } from "@/app/actions/ai";
import { planImportAnalysis, type ImportAiPlan } from "@/app/actions/imports";
import { FormMessage } from "@/components/auth/auth-card";
import { primaryButton, secondaryButton } from "@/components/ui/form";
import { describeBatchTime } from "@/lib/import-ai";
import type { AiField } from "@/lib/validation";

// "Analyse with AI" for one import (Phase 5 stage 24). Nothing is sent to the
// AI until the person has seen how many issues it covers and how many
// analyses are left this month, and pressed Confirm. Issues are analysed one
// at a time through the same analyseIssue as the issue page, which the
// database limits; the batch stops at the first problem so a failing service
// does not use up the month's analyses.

// Nobody chose these values on an imported issue, so the AI may fill them all.
const FILL: AiField[] = ["sentiment", "intent", "urgency", "category", "summary"];

type Plan = Extract<ImportAiPlan, { issueIds: string[] }>;

const numberFormat = new Intl.NumberFormat("en-GB");
const n = (value: number) => numberFormat.format(value);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ImportAiButton({ runId, compact = false }: { runId: string; compact?: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "loading" | "confirm" | "running" | "done">("idle");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<string>();

  // Leaving the page stops the batch part-way; warn first.
  useEffect(() => {
    if (stage !== "running") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stage]);

  async function loadPlan() {
    setStage("loading");
    setError(undefined);
    setSummary(undefined);
    let answer: ImportAiPlan;
    try {
      answer = await planImportAnalysis(runId);
    } catch {
      answer = { error: "The connection to Buddy was lost. Please try again." };
    }
    if ("error" in answer) {
      setError(answer.error);
      setStage("idle");
      return;
    }
    setPlan(answer);
    setStage("confirm");
  }

  async function run() {
    if (!plan) return;
    setStage("running");
    setProgress({ done: 0, total: plan.issueIds.length });
    let done = 0;
    let failure: string | undefined;
    for (const [index, issueId] of plan.issueIds.entries()) {
      if (index > 0 && plan.pauseMs > 0) await wait(plan.pauseMs);
      let result;
      try {
        result = await analyseIssue(issueId, FILL);
      } catch {
        result = { error: "The connection to Buddy was lost." };
      }
      if (result.error) {
        failure = result.error;
        break;
      }
      done++;
      setProgress({ done, total: plan.issueIds.length });
    }
    const left = plan.waiting - done;
    setSummary(
      failure
        ? `Stopped after analysing ${n(done)} of ${n(plan.issueIds.length)} issues: ${failure}`
        : `Analysed ${n(done)} ${done === 1 ? "issue" : "issues"}.${left > 0 ? ` ${n(left)} still waiting for the AI.` : ""}`,
    );
    if (failure) setError(failure);
    setStage("done");
    router.refresh();
  }

  if (stage === "idle" || stage === "loading") {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={loadPlan}
          disabled={stage === "loading"}
          className={compact ? "text-xs font-medium text-brand-700 hover:underline disabled:opacity-50" : secondaryButton}
          data-testid="import-ai-open"
        >
          {!compact && <Sparkles className="h-4 w-4" aria-hidden />}
          {stage === "loading" ? "Checking…" : "Analyse with AI"}
        </button>
        {error && (
          <div className={compact ? "text-xs" : ""} data-testid="import-ai-error">
            <FormMessage error={error} />
          </div>
        )}
      </div>
    );
  }

  if (stage === "confirm" && plan) {
    const nothingToDo = plan.waiting === 0;
    const noneLeft = plan.waiting > 0 && plan.left === 0;
    return (
      <div
        className={`space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm ${compact ? "min-w-72" : ""}`}
        data-testid="import-ai-confirm"
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-slate-500">Issues without AI analysis</dt>
          <dd className="text-slate-900" data-testid="import-ai-waiting">
            {n(plan.waiting)}
          </dd>
          <dt className="text-slate-500">AI analyses this month</dt>
          <dd className="text-slate-900" data-testid="import-ai-usage">
            {n(plan.used)} of {n(plan.limit)} used, {n(plan.left)} left
          </dd>
        </dl>
        {nothingToDo ? (
          <p className="text-slate-700">Every issue from this import already has an AI analysis.</p>
        ) : noneLeft ? (
          <p className="text-slate-700">
            This month&apos;s AI analyses are used up. An owner or admin can raise the limit in Settings, or wait until
            the 1st.
          </p>
        ) : (
          <p className="text-slate-700" data-testid="import-ai-plan">
            This analyses {n(plan.issueIds.length)} {plan.issueIds.length === 1 ? "issue" : "issues"}, one at a time (
            {describeBatchTime(plan.issueIds.length, plan.pauseMs)}), and uses {n(plan.issueIds.length)} of your{" "}
            {n(plan.left)} remaining analyses.
            {plan.issueIds.length < plan.waiting &&
              ` The other ${n(plan.waiting - plan.issueIds.length)} wait until there are analyses left.`}{" "}
            The AI fills in sentiment, type, urgency, category and a summary, each marked &ldquo;AI suggested&rdquo;.
            Use made-up messages only.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!nothingToDo && !noneLeft && (
            <button type="button" className={primaryButton} onClick={run} data-testid="import-ai-confirm-button">
              Analyse {n(plan.issueIds.length)} {plan.issueIds.length === 1 ? "issue" : "issues"}
            </button>
          )}
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              setStage("idle");
              setPlan(null);
            }}
          >
            {nothingToDo || noneLeft ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    );
  }

  if (stage === "running") {
    return (
      <p className="text-sm text-slate-700" role="status" data-testid="import-ai-progress">
        Analysed {n(progress.done)} of {n(progress.total)} issues. Keep this page open.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="import-ai-done">
      {error ? <FormMessage error={summary} /> : <FormMessage success={summary} />}
      <button
        type="button"
        className={compact ? "text-xs font-medium text-brand-700 hover:underline" : secondaryButton}
        onClick={() => {
          setStage("idle");
          setPlan(null);
          setError(undefined);
        }}
      >
        Close
      </button>
    </div>
  );
}
