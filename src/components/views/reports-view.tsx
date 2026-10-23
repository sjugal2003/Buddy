"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge, UrgencyBadge } from "@/components/ui/badges";
import { inputClass, secondaryButton } from "@/components/ui/form";
import { BarList } from "@/components/charts/bar-list";
import { WeeklyBars } from "@/components/charts/weekly-bars";
import { useWorkspace } from "@/components/workspace/workspace-store";
import {
  averageFirstResponseHours,
  averageResolutionHours,
  countBy,
  inLastDays,
  isOpen,
  negativeShare,
  responseTargetRate,
} from "@/lib/analytics";
import { formatDate, formatHours, percent, timeAgo } from "@/lib/format";

const DAY = 24 * 60 * 60 * 1000;

export function ReportsView() {
  const { workspace, teams, issues, now, categoryName } = useWorkspace();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const team = teams.find((t) => t.id === teamId)!;

  const report = useMemo(() => {
    const teamIssues = issues.filter((i) => i.teamId === teamId);
    const last30 = inLastDays(teamIssues, 30, now);
    const open = teamIssues.filter(isOpen);
    const weekly = Array.from({ length: 8 }, (_, idx) => {
      const w = 7 - idx;
      const end = now.getTime() - w * 7 * DAY;
      const start = end - 7 * DAY;
      const inWeek = (iso: string | null) => iso !== null && new Date(iso).getTime() > start && new Date(iso).getTime() <= end;
      return {
        week: formatDate(new Date(start + DAY).toISOString()),
        received: teamIssues.filter((i) => inWeek(i.receivedAt)).length,
        resolved: teamIssues.filter((i) => inWeek(i.resolvedAt)).length,
      };
    });
    const agents = countBy(
      last30.filter((i) => i.status === "resolved" && i.assignee),
      (i) => i.assignee!,
    );
    return {
      last30,
      open,
      oldestOpen: [...open].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).slice(0, 8),
      weekly,
      categories: [...countBy(last30, (i) => i.analysis.categoryId)].sort((a, b) => b[1] - a[1]),
      agents: [...agents].sort((a, b) => b[1] - a[1]),
    };
  }, [issues, teamId, now]);

  return (
    <>
      <PageHeader
        title="Department Reports"
        description="Trends, unresolved issues and team performance for one department."
        actions={
          <>
            <select className={`${inputClass} w-56`} value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Department">
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button className={secondaryButton} onClick={() => window.print()}>
              Print / save as PDF
            </button>
          </>
        }
      />

      <p className="mb-4 text-sm text-slate-600">
        <span className="font-medium text-slate-900">{team.name}</span> · lead {team.lead} · last 30 days
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Received" value={String(report.last30.length)} />
        <StatCard label="Still open" value={String(report.open.length)} tone={report.open.length > 10 ? "danger" : "default"} />
        <StatCard label="First response" value={formatHours(averageFirstResponseHours(report.last30))} hint={`${percent(responseTargetRate(report.last30, workspace))} within target`} />
        <StatCard label="Resolution time" value={formatHours(averageResolutionHours(report.last30))} />
        <StatCard label="Negative sentiment" value={percent(negativeShare(report.last30))} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Weekly volume" description="Received vs resolved" className="lg:col-span-2">
          <WeeklyBars data={report.weekly} />
        </Card>
        <Card title="Top categories">
          <BarList items={report.categories.map(([id, value]) => ({ label: categoryName(id), value, color: team.color }))} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          title="Oldest unresolved issues"
          className="lg:col-span-2"
          action={
            <Link href={`/w/${workspace.slug}/inbox?team=${teamId}`} className="text-xs font-medium text-brand-600 hover:underline">
              Open in inbox
            </Link>
          }
        >
          {report.oldestOpen.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing unresolved. Nice work.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {report.oldestOpen.map((i) => (
                <li key={i.id}>
                  <Link href={`/w/${workspace.slug}/inbox?issue=${i.id}`} className="-mx-2 flex flex-col gap-1 rounded-lg px-2 py-2 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-900">{i.subject}</span>
                      <span className="text-xs text-slate-500">
                        {i.reference} · {i.assignee ?? "No assignee"} · opened {timeAgo(i.receivedAt, now)}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      <UrgencyBadge urgency={i.analysis.urgency} />
                      <StatusBadge status={i.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Resolved by person">
          {report.agents.length === 0 ? (
            <p className="text-sm text-slate-500">No resolved issues in this period.</p>
          ) : (
            <BarList items={report.agents.map(([name, value]) => ({ label: name, value, color: team.color }))} />
          )}
        </Card>
      </div>
    </>
  );
}
