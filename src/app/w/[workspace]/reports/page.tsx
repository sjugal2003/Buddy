import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Download } from "lucide-react";
import { inputClass, primaryButton, secondaryButton } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { requireUser } from "@/lib/auth";
import { getIssueReport, getMembershipBySlug } from "@/lib/data/live";
import { escalationConditionLabels, isEscalationCondition } from "@/lib/escalations";
import { percent } from "@/lib/format";
import { channelLabels, sentimentLabels, urgencyLabels, urgencyOrder } from "@/lib/labels";
import {
  describeRange,
  formatSeconds,
  inOrder,
  presetLabels,
  resolveReportRange,
  responseTargetShare,
  todayIn,
  type IssueReport,
  type ReportPreset,
} from "@/lib/reports";

export const dynamic = "force-dynamic";

const sentimentOrder = ["very_negative", "negative", "neutral", "positive"] as const;
const importSourceLabels: Record<string, string> = { csv: "CSV import", gmail: "Gmail fetch", google_play: "Google Play fetch" };

function label<T extends string>(labels: Record<T, string>, key: string) {
  return (labels as Record<string, string>)[key] ?? key;
}

/** Counts with a bar showing each one's share of the total. */
function Breakdown({ title, rows, total, testId }: { title: string; rows: { label: string; count: number }[]; total: number; testId: string }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing in this period.</p>
      ) : (
        <ul className="space-y-2" data-testid={testId}>
          {rows.map((row) => (
            <li key={row.label} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-700">{row.label}</span>
                <span className="tabular-nums text-slate-900">{row.count}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100" aria-hidden>
                <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${total ? Math.round((row.count / total) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}/reports`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  const timeZone = membership.organization.timezone;
  const today = todayIn(new Date(), timeZone);
  const range = resolveReportRange(await searchParams, today);
  const result = await getIssueReport(membership.organization.id, range.from, range.to);
  const base = `/w/${slug}/reports`;
  // The file covers exactly the range on screen.
  const rangeQuery =
    range.preset === "custom" ? `range=custom&from=${range.from}&to=${range.to}` : `range=${range.preset}`;

  const presetLink = (preset: Exclude<ReportPreset, "custom">) => (
    <Link
      key={preset}
      href={`${base}?range=${preset}`}
      aria-current={range.preset === preset ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        range.preset === preset ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {presetLabels[preset]}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Reports"
        description="Figures for the whole company, counted by the database from this workspace's own issues. Everyone in the company can see them. There are no figures for individual people."
        actions={
          "error" in result ? undefined : (
            // A plain link: the browser saves the file the server sends.
            <a href={`${base}/download?${rangeQuery}`} download className={secondaryButton} data-testid="report-download">
              <Download className="h-4 w-4" aria-hidden /> Download CSV
            </a>
          )
        }
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2">{(["7d", "30d"] as const).map(presetLink)}</div>
          {/* A plain form: the range goes in the address bar, so a report can be bookmarked. */}
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="range" value="custom" />
            <label className="text-xs text-slate-500">
              From
              <input type="date" name="from" defaultValue={range.from} max={today} required className={`${inputClass} mt-1 block`} />
            </label>
            <label className="text-xs text-slate-500">
              To
              <input type="date" name="to" defaultValue={range.to} max={today} required className={`${inputClass} mt-1 block`} />
            </label>
            <button type="submit" className={primaryButton}>
              Show custom range
            </button>
          </form>
        </div>
        <p className="mt-3 text-sm text-slate-700" data-testid="report-range">
          {presetLabels[range.preset]}: {describeRange(range.from, range.to)}, in {timeZone}.
        </p>
        {range.error && (
          <p className="mt-1 text-sm text-red-700" role="alert" data-testid="report-range-error">
            {range.error} Showing the last 30 days instead.
          </p>
        )}
      </Card>

      {"error" in result ? (
        <Card>
          <p className="text-sm text-red-700" role="alert" data-testid="report-error">
            {result.error}
          </p>
        </Card>
      ) : (
        <ReportBody report={result.report} />
      )}
    </>
  );
}

function ReportBody({ report }: { report: IssueReport }) {
  const { totals, response_target: target } = report;
  const share = responseTargetShare(target);
  const nothing = totals.received === 0 && report.resolved === 0 && report.escalations.length === 0 && report.imports.length === 0;

  if (nothing) {
    return (
      <Card>
        <div className="py-6 text-center text-sm" data-testid="report-empty">
          <p className="font-medium text-slate-900">Nothing happened in this period.</p>
          <p className="mt-1 text-slate-500">No issues were received or resolved, and there were no escalations or imports.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div data-testid="report-received">
          <StatCard label="Issues received" value={String(totals.received)} hint={`${totals.still_open} of them still open`} />
        </div>
        <div data-testid="report-resolved">
          <StatCard label="Issues resolved" value={String(report.resolved)} hint="Resolved in this period, whenever received" />
        </div>
        <div data-testid="report-response-median">
          <StatCard
            label="Median first response"
            value={formatSeconds(report.first_response.median_seconds)}
            hint={`Average ${formatSeconds(report.first_response.average_seconds)}, ${report.first_response.count} answered`}
          />
        </div>
        <div data-testid="report-target-share">
          <StatCard
            label="Response target met"
            value={share === null ? "–" : percent(share)}
            hint={`${target.met} on time, ${target.late} late, ${target.missed} missed`}
            tone={share === null ? "default" : share >= 0.9 ? "good" : share < 0.7 ? "danger" : "default"}
          />
        </div>
      </div>

      <Card title="Times" description="For issues received in this period. Times run around the clock, from when the issue arrived.">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-slate-500">First response</dt>
          <dd className="text-slate-900">
            Median {formatSeconds(report.first_response.median_seconds)}, average {formatSeconds(report.first_response.average_seconds)} (
            {report.first_response.count} answered)
          </dd>
          <dt className="text-slate-500">Resolution</dt>
          <dd className="text-slate-900" data-testid="report-resolution">
            Median {formatSeconds(report.resolution.median_seconds)}, average {formatSeconds(report.resolution.average_seconds)} (
            {report.resolution.count} resolved so far)
          </dd>
          <dt className="text-slate-500">Response target</dt>
          <dd className="text-slate-900">
            {target.met} answered on time, {target.late} answered late, {target.missed} still unanswered past the target.{" "}
            {target.not_due > 0 && `${target.not_due} not due yet. `}
            {target.resolved_without_response > 0 && `${target.resolved_without_response} resolved with no first response recorded. `}
            Uses the current targets in Settings.
          </dd>
        </dl>
        {totals.history > 0 && (
          <p className="mt-3 text-xs text-slate-500" data-testid="report-history-note">
            {totals.history} past {totals.history === 1 ? "conversation" : "conversations"} imported as already resolved{" "}
            {totals.history === 1 ? "is" : "are"} counted as received but left out of the times and the target.
          </p>
        )}
      </Card>

      <Card title="Teams" description="Workload and times per team. These are team figures, not a ranking of people.">
        {report.teams.length === 0 ? (
          <p className="text-sm text-slate-500">No issues in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="report-teams">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Team</th>
                  <th className="py-2 pr-4 font-medium">Received</th>
                  <th className="py-2 pr-4 font-medium">Still open</th>
                  <th className="py-2 pr-4 font-medium">Median first response</th>
                  <th className="py-2 font-medium">Median resolution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.teams.map((team) => (
                  <tr key={team.name ?? ""}>
                    <td className="py-2 pr-4 text-slate-900">{team.name ?? "No team"}</td>
                    <td className="py-2 pr-4 tabular-nums">{team.received}</td>
                    <td className="py-2 pr-4 tabular-nums">{team.still_open}</td>
                    <td className="py-2 pr-4">{formatSeconds(team.median_response_seconds)}</td>
                    <td className="py-2">{formatSeconds(team.median_resolution_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Breakdown
          title="By urgency"
          testId="report-urgency"
          total={totals.received}
          rows={inOrder(report.urgency, urgencyOrder).map((r) => ({ label: label(urgencyLabels, r.key), count: r.count }))}
        />
        <Breakdown
          title="By sentiment"
          testId="report-sentiment"
          total={totals.received}
          rows={inOrder(report.sentiment, sentimentOrder).map((r) => ({ label: label(sentimentLabels, r.key), count: r.count }))}
        />
        <Breakdown
          title="By channel"
          testId="report-channels"
          total={totals.received}
          rows={report.channels.map((r) => ({ label: label(channelLabels, r.key), count: r.count }))}
        />
        <Breakdown
          title="By category"
          testId="report-categories"
          total={totals.received}
          rows={report.categories.map((r) => ({ label: r.name ?? "No category", count: r.count }))}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Escalations" description="Raised in this period, by reason.">
          {report.escalations.length === 0 ? (
            <p className="text-sm text-slate-500" data-testid="report-escalations-empty">
              No escalations in this period.
            </p>
          ) : (
            <table className="w-full text-left text-sm" data-testid="report-escalations">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Raised</th>
                  <th className="py-2 font-medium">Acknowledged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.escalations.map((e) => (
                  <tr key={e.condition}>
                    <td className="py-2 pr-4 text-slate-900">
                      {isEscalationCondition(e.condition) ? escalationConditionLabels[e.condition] : e.condition}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{e.count}</td>
                    <td className="py-2 tabular-nums">{e.acknowledged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Imports and fetches" description="CSV imports and Gmail fetches started in this period.">
          {report.imports.length === 0 ? (
            <p className="text-sm text-slate-500">No imports in this period.</p>
          ) : (
            <table className="w-full text-left text-sm" data-testid="report-imports">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">Runs</th>
                  <th className="py-2 pr-3 font-medium">Imported</th>
                  <th className="py-2 pr-3 font-medium">Already in Buddy</th>
                  <th className="py-2 font-medium">Rejected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.imports.map((r) => (
                  <tr key={r.source}>
                    <td className="py-2 pr-3 text-slate-900">{importSourceLabels[r.source] ?? r.source}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {r.runs}
                      {r.failed > 0 && <span className="text-red-700"> ({r.failed} failed)</span>}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{r.imported}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.skipped_duplicate}</td>
                    <td className="py-2 tabular-nums">{r.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
