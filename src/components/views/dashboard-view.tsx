"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { SentimentBadge, StatusBadge, UrgencyBadge } from "@/components/ui/badges";
import { SentimentTrendChart } from "@/components/charts/sentiment-trend";
import { BarList } from "@/components/charts/bar-list";
import { TrendPill } from "@/components/charts/trend-pill";
import { useWorkspace } from "@/components/workspace/workspace-store";
import {
  averageFirstResponseHours,
  averageResolutionHours,
  byPriority,
  countBy,
  inLastDays,
  isOpen,
  negativeShare,
  responseTargetRate,
  teamPerformance,
  themeTrends,
  weeklySentiment,
} from "@/lib/analytics";
import { formatDate, formatHours, percent, timeAgo } from "@/lib/format";

export function DashboardView() {
  const { workspace, issues, teams, now, categoryName } = useWorkspace();
  const base = `/demo/${workspace.slug}`;

  const stats = useMemo(() => {
    const open = issues.filter(isOpen);
    const last30 = inLastDays(issues, 30, now);
    const last7 = inLastDays(issues, 7, now);
    const prev7 = inLastDays(issues, 7, now, 7);
    return {
      open,
      urgentOpen: open.filter((i) => i.analysis.urgency === "critical" || i.analysis.urgency === "high"),
      escalated: open.filter((i) => i.status === "escalated"),
      unrouted: open.filter((i) => !i.teamId),
      last7,
      prev7,
      firstResponse: averageFirstResponseHours(last30),
      resolution: averageResolutionHours(last30),
      targetRate: responseTargetRate(last30, workspace),
      negative7: negativeShare(last7),
      negativePrev7: negativeShare(prev7),
      trend: weeklySentiment(issues, now),
      themes: themeTrends(issues.filter((i) => i.analysis.intent !== "praise"), now).slice(0, 6),
      categories: [...countBy(open, (i) => i.analysis.categoryId)].sort((a, b) => b[1] - a[1]),
      teams: teamPerformance(issues, teams, now),
    };
  }, [issues, teams, now, workspace]);

  const negativeChange = stats.negative7 - stats.negativePrev7;
  const urgentList = [...stats.urgentOpen].sort(byPriority).slice(0, 6);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${workspace.name} · demo data up to ${formatDate(now.toISOString())}`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Open issues" value={String(stats.open.length)} hint={`${stats.unrouted.length} not yet routed`} />
        <StatCard
          label="Urgent open"
          value={String(stats.urgentOpen.length)}
          hint={`${stats.escalated.length} escalated`}
          tone={stats.urgentOpen.length > 0 ? "danger" : "default"}
        />
        <StatCard
          label="Negative sentiment (7 days)"
          value={percent(stats.negative7)}
          hint={`${negativeChange >= 0 ? "+" : ""}${Math.round(negativeChange * 100)} pts vs previous week`}
          tone={negativeChange > 0.02 ? "danger" : negativeChange < -0.02 ? "good" : "default"}
        />
        <StatCard label="Avg first response (30 days)" value={formatHours(stats.firstResponse)} hint={`${percent(stats.targetRate)} within target`} />
        <StatCard label="Avg resolution time (30 days)" value={formatHours(stats.resolution)} hint={`${stats.last7.length} new issues this week`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Sentiment trend" description="Issues received per week, by sentiment" className="lg:col-span-2">
          <SentimentTrendChart data={stats.trend} />
        </Card>

        <Card title="Recurring problems" description="Top themes, last 14 days vs the 14 days before">
          <ul className="divide-y divide-slate-100">
            {stats.themes.map((t) => (
              <li key={t.theme} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="truncate text-slate-700">{t.theme}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums text-slate-900">{t.current}</span>
                  <span className="w-12 text-right">
                    <TrendPill change={t.change} previous={t.previous} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="Urgent complaints"
          description="Critical and high urgency, still open"
          className="lg:col-span-2"
          action={
            <Link href={`${base}/inbox?urgency=urgent`} className="text-xs font-medium text-brand-600 hover:underline">
              View all in inbox
            </Link>
          }
        >
          {urgentList.length === 0 ? (
            <p className="text-sm text-slate-500">No urgent issues open.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {urgentList.map((issue) => (
                <li key={issue.id}>
                  <Link href={`${base}/inbox?issue=${issue.id}`} className="-mx-2 flex flex-col gap-1 rounded-lg px-2 py-2.5 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{issue.subject}</p>
                      <p className="truncate text-xs text-slate-500">
                        {issue.reference} · {issue.customerName} · {categoryName(issue.analysis.categoryId)} · {timeAgo(issue.receivedAt, now)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <UrgencyBadge urgency={issue.analysis.urgency} />
                      <SentimentBadge sentiment={issue.analysis.sentiment} />
                      <StatusBadge status={issue.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Open issues by category">
          <BarList items={stats.categories.map(([id, value]) => ({ label: categoryName(id), value }))} />
        </Card>
      </div>

      <Card title="Resolution performance by team" description="Last 30 days" className="mt-6">
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium sm:px-0">Team</th>
                <th className="px-2 py-2 text-right font-medium">Open</th>
                <th className="px-2 py-2 text-right font-medium">Escalated</th>
                <th className="px-2 py-2 text-right font-medium">Resolved</th>
                <th className="px-2 py-2 text-right font-medium">First response</th>
                <th className="px-4 py-2 text-right font-medium sm:px-0">Resolution time</th>
              </tr>
            </thead>
            <tbody>
              {stats.teams.map((row) => (
                <tr key={row.team.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 sm:px-0">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: row.team.color }} />
                      {row.team.name}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{row.open}</td>
                  <td className={`px-2 py-2.5 text-right tabular-nums ${row.escalated ? "font-medium text-red-600" : ""}`}>{row.escalated}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{row.resolvedLast30}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatHours(row.avgFirstResponseHours)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums sm:px-0">{formatHours(row.avgResolutionHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
