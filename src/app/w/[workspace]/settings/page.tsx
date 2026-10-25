import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  AddCategoryForm,
  AddTeamForm,
  AiSettingsForm,
  CategoryRow,
  OrganizationForm,
  TeamRow,
} from "@/components/settings/settings-forms";
import { CheckNowButton, EscalationSettingsForm } from "@/components/escalations/escalation-forms";
import { requireUser } from "@/lib/auth";
import { aiServiceStatus, providerNames } from "@/lib/ai";
import {
  getAiSettings,
  getEscalationSettings,
  getMembershipBySlug,
  getOrganizationSettings,
  listCategories,
  listTeams,
} from "@/lib/data/live";
import { automaticCheckStatus, describeRun, escalationConditionLabels } from "@/lib/escalations";
import { formatDateTimeIn } from "@/lib/format";
import { urgencyLabels, urgencyOrder } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const user = await requireUser(`/w/${slug}/settings`);
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) notFound();

  const orgId = membership.organization.id;
  // These only decide which forms to show. The database makes the real
  // decision and refuses changes from members.
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const [settings, ai, escalation, teams, categories] = await Promise.all([
    getOrganizationSettings(orgId),
    getAiSettings(orgId),
    getEscalationSettings(orgId),
    listTeams(orgId),
    listCategories(orgId),
  ]);
  const aiService = aiServiceStatus();
  // Judged from the scheduled checks actually logged, with the server's clock.
  const automatic = automaticCheckStatus(escalation.lastScheduledAt, new Date(), {
    error: escalation.lastScheduledError,
    lastSuccessAt: escalation.lastScheduledSuccessAt,
  });
  const aiCost = ai.estimatedCostUsd;
  // Listed on the server so the page and the browser show the same options.
  const timeZones = Array.from(new Set(["UTC", settings.timezone, ...Intl.supportedValuesOf("timeZone")]));

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          canEdit
            ? "Company profile, response targets, AI analysis, escalations, teams and issue categories."
            : "Only owners and admins can change these settings."
        }
      />

      <div className="space-y-6">
        <Card title="Company profile and response targets">
          {canEdit ? (
            <OrganizationForm organizationId={orgId} settings={settings} timeZones={timeZones} />
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-slate-500">Name</dt>
              <dd className="text-slate-900">{settings.name}</dd>
              <dt className="text-slate-500">Industry</dt>
              <dd className="text-slate-900">{settings.industry || "Not set"}</dd>
              <dt className="text-slate-500">Time zone</dt>
              <dd className="text-slate-900">{settings.timezone}</dd>
              {urgencyOrder.map((u) => (
                <div key={u} className="contents">
                  <dt className="text-slate-500">{urgencyLabels[u]} target</dt>
                  <dd className="text-slate-900">{settings.targetHours[u]} h</dd>
                </div>
              ))}
              {urgencyOrder.map((u) => (
                <div key={`r-${u}`} className="contents">
                  <dt className="text-slate-500">{urgencyLabels[u]} resolution target</dt>
                  <dd className="text-slate-900">{settings.resolutionHours[u]} h</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        <Card title="AI analysis" description="AI suggests each issue's sentiment, type, urgency and category.">
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              When on, each new issue is analysed after it is saved. Results are marked &ldquo;AI suggested&rdquo; and
              people can change them.
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-slate-500">Status</dt>
              <dd className="text-slate-900" data-testid="ai-status">
                {ai.enabled ? "On" : "Off"}
              </dd>
              <dt className="text-slate-500">Automatic routing</dt>
              <dd className="text-slate-900" data-testid="ai-auto-route">
                {ai.autoRoute ? "On" : "Off (rules only suggest a team)"}
              </dd>
              <dt className="text-slate-500">Analyses this month</dt>
              <dd className="text-slate-900" data-testid="ai-usage">
                {ai.usedThisMonth} of {ai.monthlyLimit}
                {ai.usedThisMonth > 0 && (
                  <span className="text-slate-500">
                    {" "}
                    (about ${aiCost < 0.01 ? "0.01 or less" : aiCost.toFixed(2)} at paid prices)
                  </span>
                )}
              </dd>
              <dt className="text-slate-500">AI service on this server</dt>
              <dd className="text-slate-900">
                {aiService === "not_configured"
                  ? "Not set up: add GEMINI_API_KEY or ANTHROPIC_API_KEY to .env.local"
                  : aiService === "fake"
                    ? providerNames.fake
                    : `Set up: ${providerNames[aiService]}`}
              </dd>
            </dl>
            {canEdit ? (
              <div className="border-t border-slate-100 pt-4">
                <AiSettingsForm organizationId={orgId} settings={ai} isOwner={membership.role === "owner"} />
              </div>
            ) : (
              <p className="text-xs text-slate-500">Only owners and admins can change these.</p>
            )}
          </div>
        </Card>

        <Card
          title="Escalations"
          description="Flags open issues that need attention. An escalation never changes the issue's status, team or urgency."
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-slate-500">Last check</dt>
              <dd className="text-slate-900" data-testid="escalation-last-run">
                {escalation.lastRun
                  ? `${formatDateTimeIn(escalation.lastRun.startedAt, settings.timezone)} (${
                      escalation.lastRun.source === "manual" ? "Check now" : "scheduled"
                    }). ${describeRun(escalation.lastRun)}`
                  : "Never run"}
              </dd>
              <dt className="text-slate-500">Automatic checks</dt>
              <dd className={automatic.failing ? "text-red-700" : "text-slate-900"} data-testid="automatic-checks">
                {automatic.text}
                {escalation.lastScheduledAt && (
                  <span className="block text-xs text-slate-500">
                    Last scheduled check: {formatDateTimeIn(escalation.lastScheduledAt, settings.timezone)}
                  </span>
                )}
                {automatic.failing && (
                  <span className="block text-xs text-slate-500" data-testid="automatic-last-success">
                    Last successful scheduled check:{" "}
                    {escalation.lastScheduledSuccessAt
                      ? formatDateTimeIn(escalation.lastScheduledSuccessAt, settings.timezone)
                      : "none yet"}
                  </span>
                )}
              </dd>
              <dt className="text-slate-500">Email and chat notifications</dt>
              <dd className="text-slate-900">Not set up. Notifications appear in Buddy only (the bell at the top).</dd>
            </dl>
            {canEdit ? (
              <>
                <div className="border-t border-slate-100 pt-4">
                  <EscalationSettingsForm organizationId={orgId} settings={escalation.settings} />
                </div>
                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-2 text-xs text-slate-500">
                    Checks open issues against the conditions switched on above. Each condition escalates an issue once
                    until it is resolved and reopened, so checking again never repeats an escalation.
                  </p>
                  <CheckNowButton organizationId={orgId} />
                </div>
              </>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-slate-700">
                  Switched on:{" "}
                  {[
                    escalation.settings.firstResponse && escalationConditionLabels.first_response_breached,
                    escalation.settings.resolution && escalationConditionLabels.resolution_breached,
                    escalation.settings.urgentNoTeam &&
                      `${escalationConditionLabels.urgent_no_team} (after ${escalation.settings.urgentNoTeamHours} h)`,
                    escalation.settings.noTeam && `${escalationConditionLabels.no_team} (after ${escalation.settings.noTeamHours} h)`,
                    escalation.settings.noUpdate && `${escalationConditionLabels.no_update} (for ${escalation.settings.noUpdateHours} h)`,
                  ]
                    .filter(Boolean)
                    .join(", ") || "nothing"}
                </p>
                <p className="text-xs text-slate-500">Only owners and admins can change these or run a check.</p>
              </div>
            )}
          </div>
        </Card>

        <Card title="Teams" description={`${teams.length} ${teams.length === 1 ? "team" : "teams"}. Issues can be given to a team.`}>
          {teams.length === 0 && <p className="text-sm text-slate-500">No teams yet.</p>}
          {canEdit ? (
            <>
              {teams.length > 0 && (
                <ul className="-mt-4 divide-y divide-slate-100">
                  {teams.map((t) => (
                    <TeamRow key={t.id} team={t} />
                  ))}
                </ul>
              )}
              <div className="mt-4 border-t border-slate-100 pt-4">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Add a team</h3>
                <AddTeamForm organizationId={orgId} />
              </div>
            </>
          ) : (
            <ul className="divide-y divide-slate-100">
              {teams.map((t) => (
                <li key={t.id} className="flex min-w-0 items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} aria-hidden />
                    {t.name}
                  </span>
                  <span className="min-w-0 truncate text-xs text-slate-500">
                    {[t.leadName, t.email].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Issue categories" description="For example Billing, Access or Refunds.">
          {categories.length === 0 && <p className="text-sm text-slate-500">No categories yet.</p>}
          {canEdit ? (
            <>
              {categories.length > 0 && (
                <ul className="-mt-3 divide-y divide-slate-100">
                  {categories.map((c) => (
                    <CategoryRow key={c.id} category={c} />
                  ))}
                </ul>
              )}
              <div className="mt-4 border-t border-slate-100 pt-4">
                <AddCategoryForm organizationId={orgId} />
              </div>
            </>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <li key={c.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
                  {c.name}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
