import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SentimentBadge, StatusBadge, UrgencyBadge } from "@/components/ui/badges";
import { FormMessage } from "@/components/auth/auth-card";
import { UpdateIssueForm } from "@/components/issues/issue-forms";
import { AiPanel } from "@/components/issues/ai-panel";
import { DeadlineBadge } from "@/components/issues/deadline-badge";
import { RecordFirstResponseButton } from "@/components/issues/record-response-button";
import { AcknowledgeForm } from "@/components/escalations/escalation-forms";
import { EscalationBadge } from "@/components/escalations/escalation-badge";
import { deadlines } from "@/lib/targets";
import { escalationConditionLabels, openEscalationLevel } from "@/lib/escalations";
import { aiServiceStatus } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import {
  getAiEnabled,
  getIssue,
  getLatestAnalysis,
  getMembershipBySlug,
  getOrganizationSettings,
  listCategories,
  listIssueActivity,
  listIssueEscalations,
  listMembers,
  listRoutingRules,
  listTeams,
  toRoutable,
} from "@/lib/data/live";
import { describeReasons, matchedConditions, routeIssue } from "@/lib/routing";
import { ApplySuggestionButton, DismissSuggestionButton } from "@/components/routing/routing-forms";
import { channelLabels, intentLabels } from "@/lib/labels";
import { formatDateTime, formatDateTimeIn } from "@/lib/format";
import { describeActivity } from "@/lib/activity";
import { aiFieldSchema } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; issueId: string }>;
  searchParams: Promise<{ created?: string; analyse?: string }>;
}) {
  const { workspace: slug, issueId } = await params;
  const user = await requireUser(`/w/${slug}/issues/${issueId}`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership || !z.string().uuid().safeParse(issueId).success) notFound();

  const orgId = membership.organization.id;
  const issue = await getIssue(orgId, issueId);
  if (!issue) notFound();
  const [activity, members, teams, categories, analysis, aiEnabled, settings, escalations] = await Promise.all([
    listIssueActivity(orgId, issueId),
    listMembers(orgId),
    listTeams(orgId),
    listCategories(orgId),
    getLatestAnalysis(orgId, issueId),
    getAiEnabled(orgId),
    getOrganizationSettings(orgId),
    listIssueEscalations(orgId, issueId),
  ]);
  const escalationLevel = openEscalationLevel(escalations);
  // Worked out on the server with the server's clock, never the browser's.
  const due = deadlines(issue, { firstResponse: settings.targetHours, resolution: settings.resolutionHours }, new Date());
  const rules = await listRoutingRules(orgId);
  // Every rule is checked; rules that disagree about the team are a conflict.
  const routing = routeIssue(rules, toRoutable(issue));
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "a deleted team";
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const team = teams.find((t) => t.id === issue.teamId);
  const category = categories.find((c) => c.id === issue.categoryId);
  const { created, analyse } = await searchParams;
  // ?analyse=urgency,category (or "none") is set right after the issue is created.
  const autoFill =
    analyse === undefined ? null : analyse.split(",").flatMap((f) => (aiFieldSchema.safeParse(f).success ? [aiFieldSchema.parse(f)] : []));

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
          <EscalationBadge level={escalationLevel} />
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
            {(issue.customerEmail || issue.source !== "manual") && (
              <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs" data-testid="issue-origin">
                {issue.customerEmail && (
                  <>
                    <dt className="text-slate-500">Email</dt>
                    <dd className="break-all text-slate-800" data-testid="customer-email">
                      {issue.customerEmail}
                    </dd>
                  </>
                )}
                {issue.source !== "manual" && (
                  <>
                    <dt className="text-slate-500">Imported from</dt>
                    <dd className="text-slate-800">
                      {issue.source === "csv" ? "Spreadsheet (CSV)" : "Gmail"}
                      {issue.source === "csv" && issue.sourceRecordId && !issue.sourceRecordId.startsWith("fp:") && (
                        <span className="text-slate-500"> (ID {issue.sourceRecordId})</span>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            )}
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
            <div className="mt-4 border-t border-slate-100 pt-4 text-sm">
              {routing.kind === "none" ? (
                <p className="text-slate-500">
                  No{" "}
                  <Link href={`/w/${slug}/routing`} className="text-brand-700 hover:underline">
                    routing rule
                  </Link>{" "}
                  matches this issue.
                </p>
              ) : issue.routingDismissedAt ? (
                <p className="text-slate-500" data-testid="routing-suggestion">
                  The routing suggestion was dismissed. It comes back if the category, urgency, type or channel changes.
                </p>
              ) : routing.kind === "match" ? (
                <div className="space-y-2" data-testid="routing-suggestion">
                  <p className="text-slate-600">
                    Suggested team: <span className="font-medium text-slate-800">{teamName(routing.teamId)}</span>, because
                    rule <span className="font-medium text-slate-800">&ldquo;{routing.rule.name}&rdquo;</span> matched:{" "}
                    {describeReasons(routing.reasons, categoryNames)}.
                  </p>
                  {routing.teamId === issue.teamId ? (
                    <p className="text-xs text-slate-500">The issue already has this team.</p>
                  ) : (
                    <>
                      <ApplySuggestionButton
                        organizationId={orgId}
                        issueId={issue.id}
                        ruleId={routing.rule.id}
                        label={`Apply suggestion: give it to ${teamName(routing.teamId)}`}
                      />
                      <DismissSuggestionButton issueId={issue.id} />
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3" data-testid="routing-suggestion">
                  <p className="font-medium text-amber-800">
                    Conflict: {routing.rules.length} rules match and name different teams. Choose one, or pick a team above.
                  </p>
                  <ul className="space-y-3">
                    {routing.rules.map((rule) => (
                      <li key={rule.id} className="space-y-1">
                        <p className="text-slate-600">
                          <span className="font-medium text-slate-800">&ldquo;{rule.name}&rdquo;</span> suggests{" "}
                          <span className="font-medium text-slate-800">{teamName(rule.teamId)}</span>:{" "}
                          {describeReasons(matchedConditions(rule, toRoutable(issue)), categoryNames)}.
                        </p>
                        {rule.teamId !== issue.teamId && (
                          <ApplySuggestionButton
                            organizationId={orgId}
                            issueId={issue.id}
                            ruleId={rule.id}
                            label={`Use this rule: give it to ${teamName(rule.teamId)}`}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                  <DismissSuggestionButton issueId={issue.id} />
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Deadlines" description={`Times in ${settings.timezone}, counted around the clock.`}>
            <dl className="space-y-3 text-sm" data-testid="deadlines">
              <div>
                <dt className="mb-1">
                  <DeadlineBadge kind="first_response" deadline={due.firstResponse} />
                </dt>
                <dd className="text-xs text-slate-500">
                  {issue.firstResponseAt
                    ? `Recorded ${formatDateTimeIn(issue.firstResponseAt, settings.timezone)}`
                    : `Due ${formatDateTimeIn(due.firstResponse.dueAt, settings.timezone)}`}
                </dd>
              </div>
              <div>
                <dt className="mb-1">
                  <DeadlineBadge kind="resolution" deadline={due.resolution} />
                </dt>
                <dd className="text-xs text-slate-500">
                  {issue.status === "resolved" && issue.resolvedAt
                    ? `Resolved ${formatDateTimeIn(issue.resolvedAt, settings.timezone)}`
                    : `Due ${formatDateTimeIn(due.resolution.dueAt, settings.timezone)}`}
                  {issue.reopenedCount > 0 && ` · reopened ${issue.reopenedCount} ${issue.reopenedCount === 1 ? "time" : "times"}`}
                </dd>
              </div>
            </dl>
            {!issue.firstResponseAt && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <RecordFirstResponseButton issueId={issue.id} />
              </div>
            )}
          </Card>

          {escalations.length > 0 && (
            <Card title="Escalations" description="Raised by the escalation check. Acknowledging keeps the record.">
              <ul className="space-y-4 text-sm" data-testid="escalations">
                {escalations.map((e) => (
                  <li key={e.id} className="space-y-1">
                    <p className="font-medium text-slate-900">
                      Level {e.level} · {escalationConditionLabels[e.condition]}
                    </p>
                    <p className="text-slate-700">{e.reason}</p>
                    <p className="text-xs text-slate-500">Raised {formatDateTimeIn(e.createdAt, settings.timezone)}</p>
                    {e.acknowledgedAt ? (
                      <p className="text-xs text-slate-500">
                        Acknowledged {formatDateTimeIn(e.acknowledgedAt, settings.timezone)}
                        {e.acknowledgedByName && <> by {e.acknowledgedByName}</>}
                        {e.acknowledgeNote && <>: &ldquo;{e.acknowledgeNote}&rdquo;</>}
                      </p>
                    ) : (
                      <AcknowledgeForm escalationId={e.id} />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="AI analysis">
            <AiPanel
              issueId={issue.id}
              analysis={analysis}
              aiEnabled={aiEnabled}
              aiConfigured={aiServiceStatus() !== "not_configured"}
              autoFill={autoFill}
              current={{ sentiment: issue.sentiment, intent: issue.intent, urgency: issue.urgency, categoryId: issue.categoryId }}
              categories={categories}
            />
          </Card>

          <Card title="History">
            {activity.length === 0 ? (
              <p className="text-sm text-slate-500">No changes yet.</p>
            ) : (
              <ol className="space-y-3 border-l border-slate-200 pl-4">
                {activity.map((event) => (
                  <li key={event.id} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-300" />
                    <p className="text-slate-800">{describeActivity(event)}</p>
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
      </div>
    </>
  );
}
