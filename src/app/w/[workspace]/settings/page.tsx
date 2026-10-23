import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  AddCategoryForm,
  AddTeamForm,
  CategoryRow,
  OrganizationForm,
  TeamRow,
} from "@/components/settings/settings-forms";
import { requireUser } from "@/lib/auth";
import { getMembershipBySlug, getOrganizationSettings, listCategories, listTeams } from "@/lib/data/live";
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
  const [settings, teams, categories] = await Promise.all([
    getOrganizationSettings(orgId),
    listTeams(orgId),
    listCategories(orgId),
  ]);
  // Listed on the server so the page and the browser show the same options.
  const timeZones = Array.from(new Set(["UTC", settings.timezone, ...Intl.supportedValuesOf("timeZone")]));

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          canEdit
            ? "Company profile, response targets, teams and issue categories."
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
            </dl>
          )}
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
