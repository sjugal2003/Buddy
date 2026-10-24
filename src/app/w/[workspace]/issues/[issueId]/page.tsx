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
import { escalationConditionLabels, isEscalationCondition, openEscalationLevel } from "@/lib/escalations";
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
  type IssueActivity,
} from "@/lib/data/live";
import { findMatchingRule } from "@/lib/routing";
import { ApplySuggestionButton } from "@/components/routing/routing-forms";
import { channelLabels, intentLabels, sentimentLabels, statusLabels, urgencyLabels } from "@/lib/labels";
import { formatDateTime, formatDateTimeIn } from "@/lib/format";
import { aiFieldSchema, intentSchema, sentimentSchema, statusSchema, urgencySchema } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

function statusName(value: string | null) {
  const parsed = statusSchema.safeParse(value);
  return parsed.success ? statusLabels[parsed.data] : (value ?? "none");
}

const fieldNames: Record<string, string> = { sentiment: "sentiment", intent: "type", urgency: "urgency", category: "category" };

/** A value as people read it, e.g. "very_negative" becomes "Very negative". */
function valueName(field: string, value: string | null) {
  const label =
    (field === "urgency" && urgencySchema.safeParse(value).success && urgencyLabels[value as keyof typeof urgencyLabels]) ||
    (field === "sentiment" && sentimentSchema.safeParse(value).success && sentimentLabels[value as keyof typeof sentimentLabels]) ||
    (field === "intent" && intentSchema.safeParse(value).success && intentLabels[value as keyof typeof intentLabels]);
  return label || (value ?? "none");
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
      // Written by the escalation check: from_value is the level, to_value the reason.
      return event.fromValue ? `Escalated (level ${event.fromValue}): ${event.toValue ?? ""}`.trim() : "Escalated";
    case "escalation_acknowledged": {
      const what = isEscalationCondition(event.fromValue) ? ` (${escalationConditionLabels[event.fromValue]})` : "";
      return `Escalation acknowledged${what}${event.toValue ? `: “${event.toValue}”` : ""}`;
    }
    case "category_changed":
      return `Category changed from ${event.fromValue ?? "No category"} to ${event.toValue ?? "No category"}`;
    case "first_response":
      return "First response recorded";
    case "resolved":
      return `Resolved (was ${statusName(event.fromValue)})`;
    case "reopened":
      return `Reopened as ${statusName(event.toValue)}`;
    case "ai_analysed":
      return `Analysed by AI (suggested urgency ${valueName("urgency", event.toValue)})`;
    case "ai_accepted": {
      // from_value is "<field>:<old value>", written by accept_issue_analysis.
      const [field, ...rest] = (event.fromValue ?? "").split(":");
      return `Accepted AI ${fieldNames[field] ?? field}: ${valueName(field, rest.join(":"))} → ${valueName(field, event.toValue)}`;
    }
  }
}

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
  const suggestedRule = findMatchingRule(rules, toRoutable(issue));
  const suggestedTeam = teams.find((t) => t.id === suggestedRule?.teamId);
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
              {suggestedRule && suggestedTeam ? (
                <div className="space-y-2">
                  <p className="text-slate-600">
                    Routing rule <span className="font-medium text-slate-800">&ldquo;{suggestedRule.name}&rdquo;</span>{" "}
                    suggests <span className="font-medium text-slate-800">{suggestedTeam.name}</span>.
                  </p>
                  {suggestedTeam.id !== issue.teamId && (
                    <ApplySuggestionButton organizationId={orgId} issueId={issue.id} teamName={suggestedTeam.name} />
                  )}
                </div>
              ) : (
                <p className="text-slate-500">
                  No{" "}
                  <Link href={`/w/${slug}/routing`} className="text-brand-700 hover:underline">
                    routing rule
                  </Link>{" "}
                  matches this issue.
                </p>
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
      </div>
    </>
  );
}
