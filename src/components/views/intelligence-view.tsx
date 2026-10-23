"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DemoNotice } from "@/components/ui/notice";
import { BarList } from "@/components/charts/bar-list";
import { Donut } from "@/components/charts/donut";
import { TrendPill } from "@/components/charts/trend-pill";
import { useWorkspace } from "@/components/workspace/workspace-store";
import { countBy, inLastDays, isOpen, themeTrends } from "@/lib/analytics";
import { intentLabels, sentimentColors, sentimentLabels, urgencyLabels, urgencyOrder } from "@/lib/labels";
import type { Intent, Sentiment } from "@/lib/types";

const intentColors: Record<Intent, string> = {
  complaint: "#ef4444",
  bug_report: "#f59e0b",
  cancellation: "#ec4899",
  request: "#6366f1",
  question: "#0ea5e9",
  praise: "#10b981",
};

export function IntelligenceView() {
  const { issues, now, categories, categoryName } = useWorkspace();

  const data = useMemo(() => {
    const last30 = inLastDays(issues, 30, now);
    const sentiment = countBy(last30, (i) => i.analysis.sentiment);
    const intents = countBy(last30, (i) => i.analysis.intent);
    const open = issues.filter(isOpen);
    const matrix = categories.map((c) => ({
      category: c,
      counts: urgencyOrder.map((u) => open.filter((i) => i.analysis.categoryId === c.id && i.analysis.urgency === u).length),
    }));
    const churnSignals = open.filter((i) => i.analysis.intent === "cancellation" || i.analysis.themes.includes("Churn risk"));
    return {
      last30,
      sentiment: (["positive", "neutral", "negative", "very_negative"] as Sentiment[]).map((s) => ({
        name: sentimentLabels[s],
        value: sentiment.get(s) ?? 0,
        color: sentimentColors[s],
      })),
      intents: [...intents].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: intentLabels[k], value: v, color: intentColors[k] })),
      themes: themeTrends(issues, now),
      matrix,
      churnSignals,
      avgConfidence: last30.reduce((s, i) => s + i.analysis.confidence, 0) / Math.max(1, last30.length),
    };
  }, [issues, now, categories]);

  return (
    <>
      <PageHeader
        title="AI Intelligence"
        description="Sentiment, intent, urgency, categories and recurring themes across customer messages (last 30 days)."
      />
      <DemoNotice>
        <strong>Demo analysis.</strong> The labels on these messages were written by hand to show what Buddy will do. No AI model is
        running yet. Live analysis arrives in Phase 3, where messages will be sent to an AI service from the server, never from your
        browser.
      </DemoNotice>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Sentiment" description={`${data.last30.length} messages`}>
          <Donut data={data.sentiment} />
        </Card>
        <Card title="What customers want (intent)">
          <BarList items={data.intents} />
        </Card>
      </div>

      <Card title="Recurring themes" description="Last 14 days compared with the 14 days before" className="mt-6">
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium sm:px-0">Theme</th>
                <th className="px-2 py-2 text-right font-medium">Last 14 days</th>
                <th className="px-2 py-2 text-right font-medium">Previous 14</th>
                <th className="px-2 py-2 text-right font-medium">Change</th>
                <th className="px-4 py-2 text-right font-medium sm:px-0">Still open</th>
              </tr>
            </thead>
            <tbody>
              {data.themes.map((t) => (
                <tr key={t.theme} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 sm:px-0">{t.theme}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{t.current}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{t.previous}</td>
                  <td className="px-2 py-2 text-right">
                    <TrendPill change={t.change} previous={t.previous} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums sm:px-0">{t.openCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Open issues: category × urgency" className="lg:col-span-2">
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium sm:px-0">Category</th>
                  {urgencyOrder.map((u) => (
                    <th key={u} className="px-2 py-2 text-center font-medium">
                      {urgencyLabels[u]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.matrix.map(({ category, counts }) => (
                  <tr key={category.id}>
                    <td className="px-4 py-1.5 text-slate-700 sm:px-0">{categoryName(category.id)}</td>
                    {counts.map((count, idx) => (
                      <td key={idx} className="px-1 py-1">
                        <div
                          className={`rounded-md py-1.5 text-center tabular-nums ${count === 0 ? "text-slate-300" : idx <= 1 ? "font-medium text-white" : "text-slate-800"}`}
                          style={{
                            background:
                              count === 0
                                ? "#f8fafc"
                                : idx === 0
                                  ? `rgba(220,38,38,${0.45 + Math.min(count, 8) * 0.07})`
                                  : idx === 1
                                    ? `rgba(234,88,12,${0.4 + Math.min(count, 8) * 0.07})`
                                    : `rgba(99,102,241,${0.1 + Math.min(count, 8) * 0.05})`,
                          }}
                        >
                          {count}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Churn signals" description="Open messages that mention cancelling">
          <p className="text-3xl font-semibold tabular-nums text-slate-900">{data.churnSignals.length}</p>
          <p className="mt-1 text-xs text-slate-500">customers currently at risk of leaving</p>
          <ul className="mt-4 space-y-2 text-sm">
            {data.churnSignals.slice(0, 5).map((i) => (
              <li key={i.id} className="truncate text-slate-700">
                {i.customerName}: <span className="text-slate-500">{i.subject}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">Average demo confidence: {Math.round(data.avgConfidence * 100)}%</p>
        </Card>
      </div>
    </>
  );
}
