import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CancelInvitationButton, InviteForm, MemberRow } from "@/components/org/members";
import { requireUser } from "@/lib/auth";
import {
  countIssuesSince,
  DEADLINE_SCAN_LIMIT,
  getMembershipBySlug,
  getOrganizationSettings,
  listMembers,
  listMostReportedOpen,
  countAssignedOpen,
  listOpenInvitations,
  listOpenIssuesForDashboard,
  listRecentActivity,
  listUnacknowledgedEscalationIssueIds,
} from "@/lib/data/live";
import { describeActivity } from "@/lib/activity";
import { reportedTimes } from "@/lib/similar";
import { startOfWeek, summariseOpenIssues } from "@/lib/dashboard";
import { formatDate, formatDateTimeIn } from "@/lib/format";

export const dynamic = "force-dynamic";

const roleLabels = { owner: "Owner", admin: "Admin", member: "Member" } as const;

const RECENT_ACTIVITY = 10;

/** One number on the home page, linking to the Issues list filtered the same way. */
function CountCard({
  label,
  value,
  href,
  hint,
  alert = false,
  testId,
}: {
  label: string;
  value: number;
  href: string;
  hint: string;
  alert?: boolean;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:bg-brand-50/40"
    >
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alert && value > 0 ? "text-red-600" : "text-slate-900"}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </Link>
  );
}

export default async function LiveWorkspaceHome({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  const { organization, role } = membership;
  const isAdmin = role === "owner" || role === "admin";
  const orgId = organization.id;
  // Counted on the server, from this company's own issues only.
  const now = new Date();
  const settings = await getOrganizationSettings(orgId);
  const weekStart = startOfWeek(now, settings.timezone);
  const [members, invitations, openIssues, escalatedIds, week, recent, mostReported, assignedToMe] = await Promise.all([
    listMembers(orgId),
    isAdmin ? listOpenInvitations(orgId) : Promise.resolve([]),
    listOpenIssuesForDashboard(orgId),
    listUnacknowledgedEscalationIssueIds(orgId),
    countIssuesSince(orgId, weekStart),
    listRecentActivity(orgId, RECENT_ACTIVITY),
    // Empty (card hidden) when the database change for similar issues isn't applied yet.
    listMostReportedOpen(orgId).catch(() => []),
    // Null (card hidden) when the database change for assigning people isn't applied yet.
    countAssignedOpen(orgId, user.id).catch(() => null),
  ]);
  const targets = { firstResponse: settings.targetHours, resolution: settings.resolutionHours };
  const counts = summariseOpenIssues(openIssues, targets, escalatedIds, now);
  const issuesHref = `/w/${slug}/issues`;

  return (
    <>
      <PageHeader
        title={organization.name}
        description={`You are ${role === "member" ? "a" : "an"} ${roleLabels[role].toLowerCase()} of this workspace.`}
      />

      <section aria-labelledby="overview-heading" className="mb-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="overview-heading" className="text-sm font-semibold text-slate-900">
            <Link href={issuesHref} className="hover:underline" data-testid="open-issue-count">
              {openIssues.length === 0
                ? "No open issues"
                : `${openIssues.length}${openIssues.length === DEADLINE_SCAN_LIMIT ? "+" : ""} open ${openIssues.length === 1 ? "issue" : "issues"}`}
            </Link>
          </h2>
          <p className="text-xs text-slate-500">Counted just now from this workspace&apos;s own issues.</p>
        </div>
        {/* No history at all means the company has never had an issue. */}
        {openIssues.length === 0 && recent.length === 0 && (
          <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600" data-testid="dashboard-empty">
            Nothing yet. These numbers fill in as issues arrive.{" "}
            <Link href={`${issuesHref}/new`} className="font-medium text-brand-700 hover:underline">
              Add the first issue
            </Link>
            .
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {assignedToMe !== null && (
            <CountCard
              testId="card-assigned"
              label="Assigned to me"
              value={assignedToMe}
              href={`${issuesHref}?mine=1`}
              hint="Open issues given to you"
            />
          )}
          <CountCard
            testId="card-urgent"
            label="Urgent open issues"
            value={counts.urgent}
            href={`${issuesHref}?urgency=urgent`}
            hint="Critical or High urgency"
          />
          <CountCard
            testId="card-due-soon"
            label="Due within 2 hours"
            value={counts.dueSoon}
            href={`${issuesHref}?due=2h`}
            hint="A first response or resolution"
          />
          <CountCard
            testId="card-breached"
            label="Targets missed"
            value={counts.breached}
            href={`${issuesHref}?due=overdue`}
            hint="Open issues past a target"
            alert
          />
          <CountCard
            testId="card-escalated"
            label="Escalations not acknowledged"
            value={counts.escalated}
            href={`${issuesHref}?escalated=open`}
            hint="Open issues with one or more"
            alert
          />
          <CountCard
            testId="card-no-team"
            label="Open with no team"
            value={counts.noTeam}
            href={`${issuesHref}?team=unassigned`}
            hint="Nobody's queue yet"
          />
          <CountCard
            testId="card-waiting"
            label="Waiting on customer"
            value={counts.waiting}
            href={`${issuesHref}?status=waiting_on_customer`}
            hint="Resolution timer paused"
          />
          <Link
            href={`${issuesHref}?status=all&week=1`}
            data-testid="card-week"
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:bg-brand-50/40 sm:col-span-2"
          >
            <p className="text-xs font-medium text-slate-500">This week</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              <span data-testid="week-resolved">{week.resolved}</span> resolved{" "}
              <span className="text-base font-normal text-slate-500">
                · <span data-testid="week-opened">{week.opened}</span> opened
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">Since Monday {formatDateTimeIn(weekStart, settings.timezone)}</p>
          </Link>
        </div>
        {openIssues.length === DEADLINE_SCAN_LIMIT && (
          <p className="mt-2 text-xs text-slate-500">Counted over the newest {DEADLINE_SCAN_LIMIT} open issues.</p>
        )}
      </section>

      {mostReported.length > 0 && (
        <Card
          title="Most reported open problems"
          description="Open issues that other reports were linked to as the same problem."
          className="mb-6"
        >
          <ul className="-my-2 divide-y divide-slate-100" data-testid="most-reported">
            {mostReported.map((issue) => (
              <li key={issue.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <Link href={`${issuesHref}/${issue.id}`} className="font-medium text-slate-900 hover:underline">
                    {issue.subject}
                  </Link>
                  <span className="text-xs text-slate-500"> · {issue.reference}</span>
                </span>
                <span className="shrink-0 font-medium text-amber-800">{reportedTimes(issue.reports)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Recent activity" description={`The latest ${RECENT_ACTIVITY} changes across this workspace's issues`} className="mb-6">
        {recent.length === 0 ? (
          <p className="text-sm text-slate-500" data-testid="recent-activity-empty">
            Nothing yet. Changes to issues show up here.
          </p>
        ) : (
          <ul className="-my-2 divide-y divide-slate-100" data-testid="recent-activity">
            {recent.map((event) => (
              <li key={event.id} className="py-2 text-sm">
                <Link href={`${issuesHref}/${event.issueId}`} className="font-medium text-slate-900 hover:underline">
                  {event.issueSubject || event.issueReference}
                </Link>
                <span className="text-slate-700">: {describeActivity(event)}</span>
                <p className="text-xs text-slate-500">
                  {event.issueReference} · {formatDateTimeIn(event.at, settings.timezone)}
                  {event.actorName && <> · {event.actorName}</>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Members" description={`${members.length} ${members.length === 1 ? "person" : "people"}`}>
          <ul className="-my-3 divide-y divide-slate-100">
            {members.map((m) => (
              <MemberRow
                key={m.userId}
                organizationId={organization.id}
                member={m}
                myRole={role}
                isMe={m.userId === user.id}
              />
            ))}
          </ul>
        </Card>

        {isAdmin && (
          <Card title="Invite a colleague" description="They join with the role you choose.">
            <InviteForm organizationId={organization.id} />
            {invitations.length > 0 && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Open invitations</h3>
                <ul className="mt-2 divide-y divide-slate-100">
                  {invitations.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate text-slate-900">{inv.email}</span>
                        <span className="text-xs text-slate-500">
                          {roleLabels[inv.role]} ·{" "}
                          {new Date(inv.expiresAt) < new Date() ? "expired" : `expires ${formatDate(inv.expiresAt)}`}
                        </span>
                      </span>
                      <CancelInvitationButton invitationId={inv.id} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
