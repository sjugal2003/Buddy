import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SentimentBadge, StatusBadge, UrgencyBadge } from "@/components/ui/badges";
import { FormMessage } from "@/components/auth/auth-card";
import { UpdateIssueForm } from "@/components/issues/issue-forms";
import { requireUser } from "@/lib/auth";
import {
  getIssue,
  getMembershipBySlug,
  listCategories,
  listIssueActivity,
  listMembers,
  listTeams,
  type IssueActivity,
} from "@/lib/data/live";
import { channelLabels, intentLabels, statusLabels } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { statusSchema } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

function statusName(value: string | null) {
  const parsed = statusSchema.safeParse(value);
  return parsed.success ? statusLabels[parsed.data] : (value ?? "none");
}

function describe(event: IssueActivity) {
  switch (event.kind) {
    case "created":
      return `Issue created as ${statusName(event.toValue)}`;
    case "status_changed":
      return `Status changed from ${statusName(event.fromValue)} to ${statusName(event.toValue)}`;
    case "assignee_changed":
      if (!event.toValue) return `Unassigned (was ${event.fromValue})`;
      return event.fromValue ? `Reassigned from ${event.fromValue} to ${event.toValue}` : `Assigned to ${event.toValue}`;
    case "team_changed":
      return event.toValue ? `Moved to team ${event.toValue}` : `Removed from team ${event.fromValue ?? ""}`.trim();
    case "escalated":
      return "Escalated";
  }
}

export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; issueId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { workspace: slug, issueId } = await params;
  const user = await requireUser(`/w/${slug}/issues/${issueId}`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership || !z.string().uuid().safeParse(issueId).success) notFound();

  const orgId = membership.organization.id;
  const issue = await getIssue(orgId, issueId);
  if (!issue) notFound();
  const [activity, members, teams, categories] = await Promise.all([
    listIssueActivity(orgId, issueId),
    listMembers(orgId),
    listTeams(orgId),
    listCategories(orgId),
  ]);
  const team = teams.find((t) => t.id === issue.teamId);
  const category = categories.find((c) => c.id === issue.categoryId);
  const { created } = await searchParams;

  return (
    <>
      <Link href={`/w/${slug}/issues`} className="text-sm font-medium text-brand-700 hover:underline">
        ← Back to issues
      </Link>
      <div className="mb-6 mt-3">
        <p className="text-xs text-slate-500">
          {issue.reference} · {channelLabels[issue.channel]} · received {formatDateTime(issue.receivedAt)}
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{issue.subject}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge status={issue.status} />
          <UrgencyBadge urgency={issue.urgency} />
          <SentimentBadge sentiment={issue.sentiment} />
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{intentLabels[issue.intent]}</span>
          {category && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{category.name}</span>
          )}
          {team && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              <span className="h-2 w-2 rounded-full" style={{ background: team.color }} aria-hidden />
              {team.name}
            </span>
          )}
        </div>
      </div>

      {created === "1" && (
        <div className="mb-4">
          <FormMessage success="Issue saved." />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title={`From ${issue.customerName}`}>
            <blockquote className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-800">
              {issue.message}
            </blockquote>
          </Card>
          <Card title="Handling" description="Changes are saved to the history below.">
            <UpdateIssueForm
              issueId={issue.id}
              status={issue.status}
              assigneeName={issue.assigneeName}
              teamId={issue.teamId}
              categoryId={issue.categoryId}
              memberNames={members.map((m) => m.fullName)}
              teams={teams}
              categories={categories}
            />
          </Card>
        </div>

        <Card title="History">
          {activity.length === 0 ? (
            <p className="text-sm text-slate-500">No changes yet.</p>
          ) : (
            <ol className="space-y-3 border-l border-slate-200 pl-4">
              {activity.map((event) => (
                <li key={event.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-300" />
                  <p className="text-slate-800">{describe(event)}</p>
                  <p className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="h-3 w-3" aria-hidden /> {formatDateTime(event.at)}
                    {event.actorName && <> · {event.actorName}</>}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
