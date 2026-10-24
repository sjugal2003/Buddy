import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { AiBadge, StatusBadge, UrgencyBadge, SentimentBadge } from "@/components/ui/badges";
import { DeadlineBadge } from "@/components/issues/deadline-badge";
import { EscalationBadge } from "@/components/escalations/escalation-badge";
import { compareAttention, deadlines, isOverdue, nextDeadline } from "@/lib/targets";
import { inputClass, primaryButton, secondaryButton } from "@/components/ui/form";
import { requireUser } from "@/lib/auth";
import {
  DEADLINE_SCAN_LIMIT,
  getMembershipBySlug,
  getOrganizationSettings,
  ISSUE_LIST_LIMIT,
  listIssues,
  listTeams,
  openEscalationLevels,
  type LiveTeam,
} from "@/lib/data/live";
import { channelLabels, statusLabels, statusOrder, urgencyLabels, urgencyOrder } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { issueFiltersSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

function TeamLabel({ team }: { team?: LiveTeam }) {
  if (!team) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <span className="h-2 w-2 rounded-full" style={{ background: team.color }} aria-hidden />
      {team.name}
    </span>
  );
}

function deadlineToShow(d: ReturnType<typeof deadlines>) {
  const next = nextDeadline(d);
  return { kind: next.kind, deadline: next.deadline };
}

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}/issues`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  const raw = await searchParams;
  const filters = issueFiltersSchema.parse({
    status: raw.status,
    urgency: raw.urgency,
    team: raw.team,
    due: raw.due,
    sort: raw.sort,
    q: raw.q,
  });
  const [rows, teams, settings] = await Promise.all([
    listIssues(membership.organization.id, filters),
    listTeams(membership.organization.id),
    getOrganizationSettings(membership.organization.id),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const filtered =
    filters.status !== "active" || filters.urgency !== "" || filters.team !== "" || filters.due !== "" || filters.q !== "";

  // Deadlines use the server's clock and the company's targets (src/lib/targets.ts).
  const now = new Date();
  const targets = { firstResponse: settings.targetHours, resolution: settings.resolutionHours };
  let withDeadlines = rows.map((issue) => ({ issue, urgency: issue.urgency, d: deadlines(issue, targets, now) }));
  if (filters.due === "overdue") withDeadlines = withDeadlines.filter((x) => x.issue.status !== "resolved" && isOverdue(x.d));
  if (filters.due === "soon")
    withDeadlines = withDeadlines.filter(
      (x) => x.issue.status !== "resolved" && [x.d.firstResponse, x.d.resolution].some((d) => d.state === "due_soon"),
    );
  if (filters.sort === "attention") withDeadlines = [...withDeadlines].sort(compareAttention);
  const scanFull = (filters.due || filters.sort) && rows.length === DEADLINE_SCAN_LIMIT;
  const issues = withDeadlines.slice(0, ISSUE_LIST_LIMIT);
  const escalationLevels = await openEscalationLevels(
    membership.organization.id,
    issues.map((x) => x.issue.id),
  );

  return (
    <>
      <PageHeader
        title="Issues"
        description="Customer issues for this workspace. Only its members can see them."
        actions={
          <Link href={`/w/${slug}/issues/new`} className={primaryButton}>
            <Plus className="h-4 w-4" aria-hidden /> New issue
          </Link>
        }
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* A plain form: filters go in the address bar, so a filtered list can be bookmarked. */}
        <form method="get" className="grid gap-2 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Search customer, reference, subject or message"
              aria-label="Search issues"
              className={`${inputClass} pl-9`}
            />
          </div>
          <select name="status" defaultValue={filters.status} aria-label="Status" className={inputClass}>
            <option value="active">All open</option>
            <option value="all">All statuses</option>
            {statusOrder.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
          <select name="urgency" defaultValue={filters.urgency} aria-label="Urgency" className={inputClass}>
            <option value="">Any urgency</option>
            {urgencyOrder.map((u) => (
              <option key={u} value={u}>
                {urgencyLabels[u]}
              </option>
            ))}
          </select>
          <select name="due" defaultValue={filters.due} aria-label="Deadlines" className={inputClass}>
            <option value="">Any deadline</option>
            <option value="overdue">Overdue</option>
            <option value="soon">Due soon</option>
          </select>
          <select name="sort" defaultValue={filters.sort} aria-label="Sort" className={inputClass}>
            <option value="">Newest first</option>
            <option value="attention">Needs attention first</option>
          </select>
          <select name="team" defaultValue={filters.team} aria-label="Team" className={inputClass}>
            <option value="">Any team</option>
            <option value="unassigned">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="submit" className={secondaryButton}>
              Filter
            </button>
            {filtered && (
              <Link href={`/w/${slug}/issues`} className={secondaryButton}>
                Clear
              </Link>
            )}
          </div>
        </form>

        {issues.length === 0 ? (
          filtered ? (
            <p className="p-8 text-center text-sm text-slate-500">No issues match these filters.</p>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-900">No open issues yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Add the first one by hand. Importing from email and other sources comes in a later phase.
              </p>
              <Link href={`/w/${slug}/issues/new`} className={`${primaryButton} mt-4`}>
                <Plus className="h-4 w-4" aria-hidden /> New issue
              </Link>
            </div>
          )
        ) : (
          <ul className="divide-y divide-slate-100">
            {issues.map(({ issue, d }) => (
              <li key={issue.id}>
                <Link
                  href={`/w/${slug}/issues/${issue.id}`}
                  className="flex flex-col gap-2 px-4 py-3 hover:bg-slate-50 md:flex-row md:items-center md:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900">{issue.subject}</p>
                      {issue.analysisSource === "ai" && <AiBadge />}
                    </div>
                    {/* The AI's summary is usually quicker to scan than the message itself. */}
                    <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                      {issue.analysisSource === "ai" && issue.summary ? issue.summary : issue.message}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {issue.reference} · {issue.customerName} · {channelLabels[issue.channel]} · {formatDateTime(issue.receivedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 md:w-80 md:justify-end">
                    <EscalationBadge level={escalationLevels.get(issue.id) ?? 0} />
                    {issue.status !== "resolved" && <DeadlineBadge {...deadlineToShow(d)} />}
                    <UrgencyBadge urgency={issue.urgency} />
                    <SentimentBadge sentiment={issue.sentiment} />
                    <StatusBadge status={issue.status} />
                    <TeamLabel team={issue.teamId ? teamById.get(issue.teamId) : undefined} />
                    <span className={`text-xs ${issue.assigneeName ? "text-slate-500" : "font-medium text-brand-700"}`}>
                      {issue.assigneeName ?? "Unassigned"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {scanFull && (
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Deadlines were checked for the newest {DEADLINE_SCAN_LIMIT} matching issues. Narrow the filters to see older ones.
          </p>
        )}
        {issues.length === ISSUE_LIST_LIMIT && (
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Showing the newest {ISSUE_LIST_LIMIT}. Use search or filters to find older issues.
          </p>
        )}
      </div>
    </>
  );
}
