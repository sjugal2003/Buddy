"use client";

import { Bot, Clock, X } from "lucide-react";
import { useEffect } from "react";
import { SentimentBadge, StatusBadge, Tag, UrgencyBadge } from "@/components/ui/badges";
import { Field, inputClass, secondaryButton } from "@/components/ui/form";
import { useWorkspace } from "@/components/workspace/workspace-store";
import { channelLabels, intentLabels, statusLabels, statusOrder } from "@/lib/labels";
import { formatDateTime, formatHours } from "@/lib/format";
import { hoursBetween, isOverdue } from "@/lib/analytics";
import { findMatchingRule } from "@/lib/routing";
import type { Issue, IssueStatus } from "@/lib/types";

export function IssueDetail({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const { workspace, teams, rules, now, categoryName, teamName, setIssueStatus, assignIssue } = useWorkspace();
  const suggestedRule = findMatchingRule(rules, issue);
  const overdue = isOverdue(issue, workspace, now);
  const target = workspace.responseTargetsHours[issue.analysis.urgency];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="issue-title">
      <button className="absolute inset-0 bg-slate-900/40" aria-label="Close issue" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">
              {issue.reference} · {channelLabels[issue.channel]} · {formatDateTime(issue.receivedAt)}
            </p>
            <h2 id="issue-title" className="mt-0.5 text-lg font-semibold text-slate-900">
              {issue.subject}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusBadge status={issue.status} />
              <UrgencyBadge urgency={issue.analysis.urgency} />
              <SentimentBadge sentiment={issue.analysis.sentiment} />
              {overdue && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">No reply yet · target {target}h</span>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <p className="text-xs font-medium text-slate-500">From {issue.customerName}</p>
            <blockquote className="mt-1.5 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-800">{issue.message}</blockquote>
          </section>

          <section className="rounded-lg border border-brand-100 bg-brand-50/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Bot className="h-4 w-4 text-brand-600" aria-hidden /> Message analysis
              </h3>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                Demo: pre-written, not live AI
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-700">{issue.analysis.summary}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-500">Intent</dt>
                <dd className="font-medium text-slate-800">{intentLabels[issue.analysis.intent]}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Category</dt>
                <dd className="font-medium text-slate-800">{categoryName(issue.analysis.categoryId)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Sentiment score</dt>
                <dd className="font-medium text-slate-800">{issue.analysis.sentimentScore.toFixed(2)} (−1 to 1)</dd>
              </div>
              <div>
                <dt className="text-slate-500">Confidence</dt>
                <dd className="font-medium text-slate-800">{Math.round(issue.analysis.confidence * 100)}%</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {issue.analysis.themes.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">Suggested next step</p>
            <p className="text-sm text-slate-800">{issue.analysis.suggestedAction}</p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <select
                className={inputClass}
                value={issue.status}
                onChange={(e) => setIssueStatus(issue.id, e.target.value as IssueStatus)}
              >
                {statusOrder.map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Team"
              hint={
                suggestedRule
                  ? `Routing rule "${suggestedRule.name}" suggests ${teamName(suggestedRule.teamId)}.`
                  : "No routing rule matches this issue."
              }
            >
              <select
                className={inputClass}
                value={issue.teamId ?? ""}
                onChange={(e) => assignIssue(issue.id, e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            {suggestedRule && suggestedRule.teamId !== issue.teamId && (
              <button className={`${secondaryButton} sm:col-span-2`} onClick={() => assignIssue(issue.id, suggestedRule.teamId)}>
                Apply suggestion: route to {teamName(suggestedRule.teamId)}
              </button>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-slate-500">Assignee</p>
              <p className="mt-0.5 font-medium text-slate-800">{issue.assignee ?? "Nobody yet"}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-slate-500">First response</p>
              <p className="mt-0.5 font-medium text-slate-800">
                {issue.firstResponseAt ? formatHours(hoursBetween(issue.receivedAt, issue.firstResponseAt)) : "Not yet"}
                <span className="font-normal text-slate-500"> · target {target}h</span>
              </p>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Activity</h3>
            <ol className="space-y-2.5 border-l border-slate-200 pl-4">
              {[...issue.events].reverse().map((event, index) => (
                <li key={`${event.at}-${index}`} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-300" />
                  <p className="text-slate-800">{event.text}</p>
                  <p className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="h-3 w-3" aria-hidden /> {formatDateTime(event.at)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
